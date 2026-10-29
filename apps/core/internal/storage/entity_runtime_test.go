package storage

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestCombinedHistoryDeduplicatesPhysicalAliases(t *testing.T) {
	now := time.Now().UTC()
	series := []RuntimeSeries{{Points: []RuntimePoint{{TS: now, Quality: "GOOD", Value: float64(10)}}}, {Points: []RuntimePoint{{TS: now, Quality: "GOOD", Value: float64(10)}}}, {Points: []RuntimePoint{{TS: now, Quality: "GOOD", Value: float64(20)}}}}
	sources := []metricSource{{TagID: "a"}, {TagID: "a"}, {TagID: "b"}}
	got := combineSourceHistory(series, sources, "sum")
	if len(got) != 1 || got[0].Quality != "GOOD" || got[0].Value != float64(30) {
		t.Fatalf("history must match deduplicated current total: %+v", got)
	}
}

func TestEntityRuntimeContextQualityAndAggregation(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	p, err := s.SaveEntityProfile(ctx, "", EntityProfileInput{Name: "Current profile", Metrics: []MetricDefinition{{Key: "load", Name: "Load", DataType: "number", Unit: "A", History: true}, {Key: "aux", Name: "Auxiliary", DataType: "number", Unit: "A", History: true}}})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SaveEntity(ctx, "", EntityInput{Name: "Aggregate group", TypeKey: "group"})
	if err != nil {
		t.Fatal(err)
	}
	makeChild := func(name string) Entity {
		e, err := s.SaveEntity(ctx, "", EntityInput{Name: name, TypeKey: "group", ParentID: root.ID, ProfileID: p.ID, ProfileVersion: p.Revision})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	a := makeChild("Machine A")
	b := makeChild("Machine B")
	tagA := "native-load-a-" + auth.RandomID()[:12]
	tagB := "native-load-b-" + auth.RandomID()[:12]
	for _, id := range []string{tagA, tagB} {
		if _, err = pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type,unit,stale_seconds) VALUES($1,'demo-motor','demo-motor-device',$1,$1,'number','float64','A',30)`, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, pair := range []struct {
		e   Entity
		tag string
	}{{a, tagA}, {b, tagB}} {
		if _, err = s.SaveEntityBindings(ctx, pair.e.ID, pair.e.Revision, map[string]string{"load": pair.tag}); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	if _, err = pool.Exec(ctx, `INSERT INTO tag_current_state(tag_id,value,quality,ts) VALUES($1,'10','GOOD',$3),($2,'20','GOOD',$3)`, tagA, tagB, now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO telemetry_samples(tag_id,ts,value,quality) VALUES($1,$2,'10','GOOD'),($1,$2::timestamptz-interval '20 seconds','5','BAD')`, tagA, now); err != nil {
		t.Fatal(err)
	}
	doc := DashboardDocument{SchemaVersion: 1, Pages: []DashboardPage{{ID: "main", Name: "Main", Widgets: []SemanticWidget{{ID: "load", Type: "value-card", Title: "Load", Binding: MetricScope{Scope: "current", Metric: "load"}, Aggregation: "last", Layout: WidgetLayout{W: 8, H: 5}}}}}}
	run := func(entity string, d DashboardDocument) EntityRuntime {
		v, e := s.DashboardRuntime(ctx, entity, RuntimeInput{Document: &d})
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	one := run(a.ID, doc)
	two := run(b.ID, doc)
	if one.Overview.State != "ONLINE" {
		t.Fatal("mapped semantic entity does not show communication health")
	}
	if one.Widgets[0].Value != float64(10) || two.Widgets[0].Value != float64(20) {
		t.Fatalf("template context mixed: %+v %+v", one.Widgets, two.Widgets)
	}
	a, err = s.GetEntity(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveEntityBindings(ctx, a.ID, a.Revision, map[string]string{"load": tagA, "aux": tagB}); err != nil {
		t.Fatal(err)
	}
	doc.Pages[0].Widgets[0].Type = "timeseries"
	doc.Pages[0].Widgets[0].Metrics = []string{"aux"}
	history := run(a.ID, doc)
	if len(history.Widgets[0].Series) != 2 {
		t.Fatal("multiple semantic metrics were ignored")
	}
	hasBad := false
	for _, point := range history.Widgets[0].Series[0].Points {
		if point.Quality == "BAD" && point.Value == nil {
			hasBad = true
		}
	}
	if !hasBad {
		t.Fatal("historical BAD gap disappeared")
	}
	doc.Pages[0].Widgets[0].Type = "value-card"
	doc.Pages[0].Widgets[0].Metrics = nil
	doc.Pages[0].Widgets[0].Binding.Scope = "descendants"
	doc.Pages[0].Widgets[0].Aggregation = "sum"
	sum := run(root.ID, doc)
	if sum.Widgets[0].Value != float64(30) || sum.Widgets[0].Expected != 2 || sum.Widgets[0].Good != 2 {
		t.Fatalf("bad aggregate: %+v", sum.Widgets)
	}
	doc.Pages[0].Widgets[0].Aggregation = "last"
	ambiguous := run(root.ID, doc)
	if ambiguous.Widgets[0].Value != nil || ambiguous.Widgets[0].Quality != "AMBIGUOUS" {
		t.Fatal("singular metric chose arbitrary child")
	}
	if _, err = pool.Exec(ctx, "UPDATE tag_current_state SET ts=now()-interval '10 minutes' WHERE tag_id=$1", tagB); err != nil {
		t.Fatal(err)
	}
	doc.Pages[0].Widgets[0].Aggregation = "sum"
	partial := run(root.ID, doc)
	if partial.Widgets[0].Quality != "PARTIAL" || partial.Widgets[0].Good != 1 {
		t.Fatalf("stale source hidden: %+v", partial.Widgets)
	}
	c := makeChild("Machine C")
	_ = c
	added := run(root.ID, doc)
	if added.Widgets[0].Expected != 3 || added.Widgets[0].Quality != "PARTIAL" {
		t.Fatal("new unmapped child absent from coverage")
	}
	if _, err = pool.Exec(ctx, "UPDATE tags SET realtime_enabled=false WHERE id=$1", tagA); err != nil {
		t.Fatal(err)
	}
	none := run(root.ID, doc)
	if none.Widgets[0].Value != nil || none.Widgets[0].Quality == "GOOD" {
		t.Fatal("unavailable aggregate became zero/live")
	}
	raw, _ := json.Marshal(doc)
	if string(raw) == "" {
		t.Fatal("document not serializable")
	}
}
