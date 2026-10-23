package storage

import (
	"context"
	"encoding/json"
	"testing"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestDashboardWidgetsPersistAndBelongToTheirUser(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	users := make([]string, 2)
	for index := range users {
		name := auth.RandomID()
		if err := auth.Bootstrap(ctx, pool, name, "dashboard-test-password-123"); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", name).Scan(&users[index]); err != nil {
			t.Fatal(err)
		}
	}
	registry := Registry{Pool: pool}
	created, err := registry.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-sensor-value", "type": "trend", "title": "Temperature trend", "settings": map[string]any{"range_minutes": float64(60)}})
	if err != nil {
		t.Fatal(err)
	}
	var widget struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(created, &widget) != nil || widget.ID == "" {
		t.Fatal("missing widget ID")
	}
	restarted := Registry{Pool: pool}
	raw, err := restarted.ListWidgets(ctx, users[0])
	if err != nil {
		t.Fatal(err)
	}
	var own []map[string]any
	if json.Unmarshal(raw, &own) != nil || len(own) != 1 || own[0]["title"] != "Temperature trend" {
		t.Fatalf("persisted widgets invalid: %s", raw)
	}
	raw, err = restarted.ListWidgets(ctx, users[1])
	if err != nil || string(raw) != "[]" {
		t.Fatalf("another user sees dashboard: %s %v", raw, err)
	}
	if _, err := restarted.SaveWidget(ctx, users[1], widget.ID, map[string]any{"title": "Hijacked"}); err == nil {
		t.Fatal("another user can modify widget")
	}
	if err := restarted.DeleteWidget(ctx, users[1], widget.ID); err == nil {
		t.Fatal("another user can delete widget")
	}
	if err := restarted.DeleteWidget(ctx, users[0], widget.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-motor-run", "type": "trend"}); err == nil {
		t.Fatal("numeric trend accepted a boolean tag")
	}
}
