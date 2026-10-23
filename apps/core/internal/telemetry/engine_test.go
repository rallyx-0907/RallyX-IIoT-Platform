package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"rallyx.local/core/internal/testutil"
)

func TestDurableTransitionsAndRules(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	id := fmt.Sprintf("engine-%d", time.Now().UnixNano())
	_, err := pool.Exec(ctx, "INSERT INTO assets(id,panel_id,name) VALUES($1,'demo-panel',$1)", id)
	if err != nil {
		t.Fatal(err)
	}
	for _, tag := range []struct{ key, datatype, semantic string }{{"run", "boolean", "run"}, {"fault", "boolean", "fault"}, {"current", "number", ""}} {
		_, err = pool.Exec(ctx, "INSERT INTO tags(id,asset_id,key,name,datatype,semantic) VALUES($1,$2,$3,$3,$4,$5)", id+"-"+tag.key, id, tag.key, tag.datatype, tag.semantic)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = pool.Exec(ctx, "INSERT INTO rules(id,tag_id,name,type,threshold,hysteresis) VALUES($1,$2,'High current','high',10,2),($3,$4,'Stale run','stale',NULL,0),($5,$6,'Fault','fault',NULL,0)", id+"-high", id+"-current", id+"-stale", id+"-run", id+"-fault-rule", id+"-fault")
	if err != nil {
		t.Fatal(err)
	}
	engine := &Engine{Pool: pool}
	at := time.Now().UTC().Truncate(time.Microsecond)
	process := func(ts time.Time, quality string, tags string) error {
		var values map[string]json.RawMessage
		if err := json.Unmarshal([]byte(tags), &values); err != nil {
			t.Fatal(err)
		}
		return engine.Process(ctx, Message{SiteID: "demo-site", AssetID: id, Timestamp: ts, Quality: quality, Tags: values})
	}
	if err := process(at, "good", `{"run":true,"fault":true,"current":12}`); err != nil {
		t.Fatal(err)
	}
	if err := process(at, "good", `{"run":true,"fault":true,"current":12}`); err != nil {
		t.Fatal(err)
	}
	var starts int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE asset_id=$1 AND kind='start'", id).Scan(&starts); err != nil || starts != 1 {
		t.Fatalf("duplicate starts=%d err=%v", starts, err)
	}
	// Recreate the engine to prove session state comes from PostgreSQL.
	engine = &Engine{Pool: pool}
	if err := process(at.Add(time.Second), "bad", `{"run":false}`); err != nil {
		t.Fatal(err)
	}
	var open int
	pool.QueryRow(ctx, "SELECT count(*) FROM runtime_sessions WHERE asset_id=$1 AND kind='run' AND ended_at IS NULL", id).Scan(&open)
	if open != 1 {
		t.Fatal("bad quality must not close a valid running session")
	}
	if err := process(at.Add(-time.Second), "good", `{"run":false}`); err != nil {
		t.Fatal(err)
	}
	if err := process(at.Add(60*time.Second), "good", `{"run":false,"fault":false,"current":9}`); err != nil {
		t.Fatal(err)
	}
	var seconds float64
	if err := pool.QueryRow(ctx, "SELECT extract(epoch FROM ended_at-started_at)::float8 FROM runtime_sessions WHERE asset_id=$1 AND kind='run'", id).Scan(&seconds); err != nil || seconds != 60 {
		t.Fatalf("duration=%v err=%v", seconds, err)
	}
	var active int
	pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-high").Scan(&active)
	if active != 1 {
		t.Fatal("hysteresis should keep high alarm active at 9")
	}
	if err := process(at.Add(61*time.Second), "good", `{"current":8}`); err != nil {
		t.Fatal(err)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-high").Scan(&active)
	if active != 0 {
		t.Fatal("high alarm should clear at threshold minus hysteresis")
	}
	if err := process(at.Add(62*time.Second), "good", `{"run":true,"not_registered":1}`); err == nil {
		t.Fatal("unknown tag accepted")
	}
	var value bool
	pool.QueryRow(ctx, "SELECT value::boolean FROM tag_current_state WHERE tag_id=$1", id+"-run").Scan(&value)
	if value {
		t.Fatal("invalid mixed payload partially committed")
	}
	if err := engine.Sweep(ctx, at.Add(91*time.Second)); err != nil {
		t.Fatal(err)
	}
	var quality string
	pool.QueryRow(ctx, "SELECT quality FROM tag_current_state WHERE tag_id=$1", id+"-run").Scan(&quality)
	if quality != "stale" {
		t.Fatalf("quality=%s", quality)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-stale").Scan(&active)
	if active != 1 {
		t.Fatal("stale communication alarm missing")
	}
	if err := process(at.Add(92*time.Second), "good", `{"run":false}`); err != nil {
		t.Fatal(err)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-stale").Scan(&active)
	if active != 0 {
		t.Fatal("fresh telemetry did not clear stale alarm")
	}
}
