package storage

import (
	"context"
	"testing"

	"rallyx.local/core/internal/testutil"
)

func TestEntityProfilesBindingsAndSharedTemplate(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	p, err := s.SaveEntityProfile(ctx, "", EntityProfileInput{Name: "Thermal profile", Metrics: []MetricDefinition{{Key: "temperature", Name: "Temperature", DataType: "number", Unit: "°C"}}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.SaveEntity(ctx, "", EntityInput{Name: "Sensor A", TypeKey: "group", ProfileID: p.ID, ProfileVersion: p.Revision})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.SaveEntity(ctx, "", EntityInput{Name: "Sensor B", TypeKey: "group", ProfileID: p.ID, ProfileVersion: p.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveEntityBindings(ctx, a.ID, a.Revision, map[string]string{"temperature": "demo-motor-current"}); err == nil {
		t.Fatal("incompatible unit accepted")
	}
	a, err = s.SaveEntityBindings(ctx, a.ID, a.Revision, map[string]string{"temperature": "demo-sensor-value"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveEntityBindings(ctx, b.ID, b.Revision, map[string]string{"unknown": "demo-sensor-value"}); err == nil {
		t.Fatal("unknown profile key accepted")
	}
	doc := DashboardDocument{SchemaVersion: 1, Pages: []DashboardPage{{ID: "main", Name: "Overview", Widgets: []SemanticWidget{{ID: "temperature", Type: "value-card", Title: "Temperature", Binding: MetricScope{Scope: "current", Metric: "temperature"}, Aggregation: "last", Layout: WidgetLayout{X: 0, Y: 0, W: 8, H: 5}}}}}}
	board, err := s.SaveEntityDashboard(ctx, "", EntityDashboardInput{Name: "Reusable thermal view", Document: doc, Publish: true})
	if err != nil {
		t.Fatal(err)
	}
	if board.PublishedVersion != 1 {
		t.Fatal("template was not published")
	}
	if err = s.AssignEntityDashboard(ctx, a.ID, board.ID, 1, 0); err != nil {
		t.Fatal(err)
	}
	if err = s.AssignEntityDashboard(ctx, b.ID, board.ID, 1, 0); err != nil {
		t.Fatal(err)
	}
	got, version, err := s.ResolveEntityDashboard(ctx, a.ID)
	if err != nil || version.TemplateID != board.ID || got.Pages[0].Widgets[0].Binding.Metric != "temperature" {
		t.Fatalf("template did not resolve: %+v %v", version, err)
	}
	if _, err = s.SaveEntityDashboard(ctx, board.ID, EntityDashboardInput{Name: board.Name, Document: doc, Revision: 0, Publish: true}); err == nil {
		t.Fatal("stale template overwrote published version")
	}
	if _, err = s.SaveEntityDashboard(ctx, board.ID, EntityDashboardInput{Name: board.Name, Document: doc, Revision: board.Revision, Publish: true, EntityID: b.ID, AssignmentRevision: 999}); err == nil {
		t.Fatal("stale assignment accepted")
	}
	after, err := s.GetEntityDashboard(ctx, board.ID)
	if err != nil || after.PublishedVersion != 1 {
		t.Fatal("failed Apply left a published version behind")
	}
	doc.Pages[0].Widgets[0].Binding.Scope = "fixed:demo-sensor-value"
	if _, err = s.SaveEntityDashboard(ctx, "", EntityDashboardInput{Name: "Bad", Document: doc, Publish: true}); err == nil {
		t.Fatal("physical source accepted in template")
	}
}
