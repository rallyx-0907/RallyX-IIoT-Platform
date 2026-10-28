package storage

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestDashboardBoardsArePersistedAndOwned(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	users := dashboardTestUsers(t, pool)
	registry := Registry{Pool: pool}
	boardName := strings.Repeat("á", 80)
	board, err := registry.CreateDashboardBoard(ctx, users[0], boardName)
	if err != nil {
		t.Fatal(err)
	}
	boards, err := registry.ListDashboardBoards(ctx, users[0])
	if err != nil {
		t.Fatal(err)
	}
	var own []map[string]any
	if json.Unmarshal(boards, &own) != nil || len(own) != 1 || own[0]["name"] != boardName {
		t.Fatalf("board did not persist: %s", boards)
	}
	other, err := registry.ListDashboardBoards(ctx, users[1])
	if err != nil || string(other) != "[]" {
		t.Fatalf("board leaked across users: %s %v", other, err)
	}
	if _, err := registry.RenameDashboardBoard(ctx, users[1], board.ID, "Hijacked"); err == nil {
		t.Fatal("another user renamed board")
	}
	if _, err := registry.SaveWidget(ctx, users[1], "", map[string]any{"tag_id": "demo-sensor-value", "type": "value", "board_id": board.ID}); err == nil {
		t.Fatal("another user's board accepted widget")
	}
}

func TestDashboardWidgetBoardAndSettingsValidation(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	users := dashboardTestUsers(t, pool)
	registry := Registry{Pool: pool}
	boardA, err := registry.CreateDashboardBoard(ctx, users[0], "A")
	if err != nil {
		t.Fatal(err)
	}
	boardB, err := registry.CreateDashboardBoard(ctx, users[0], "B")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, tag, kind string
		settings        map[string]any
		ok              bool
	}{
		{"numeric gauge", "demo-sensor-value", "gauge", map[string]any{"min": float64(-10), "max": float64(120), "precision": float64(2), "show_unit": true, "size": "wide"}, true},
		{"numeric level", "demo-sensor-value", "level", map[string]any{}, true},
		{"boolean gauge", "demo-motor-run", "gauge", map[string]any{}, false},
		{"bad range", "demo-sensor-value", "gauge", map[string]any{"min": float64(5), "max": float64(5)}, false},
		{"non-finite bound", "demo-sensor-value", "level", map[string]any{"min": math.NaN()}, false},
	} {
		_, err := registry.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": tc.tag, "type": tc.kind, "board_id": boardA.ID, "settings": tc.settings})
		if (err == nil) != tc.ok {
			t.Errorf("%s: expected ok=%v, err=%v", tc.name, tc.ok, err)
		}
	}
	for _, board := range []string{boardA.ID, boardB.ID} {
		if _, err := registry.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-sensor-value", "type": "value", "board_id": board}); err != nil {
			t.Fatalf("same point cannot be placed on separate boards: %v", err)
		}
	}
	created, err := registry.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-sensor-value", "type": "gauge", "board_id": boardA.ID, "settings": map[string]any{"min": float64(0), "max": float64(200)}})
	if err != nil {
		t.Fatal(err)
	}
	var widget map[string]any
	if err := json.Unmarshal(created, &widget); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SaveWidget(ctx, users[0], widget["id"].(string), map[string]any{"settings": map[string]any{"max": float64(-1)}}); err == nil {
		t.Fatal("PATCH validated only changed settings instead of merged settings")
	}
	updated, err := registry.SaveWidget(ctx, users[0], widget["id"].(string), map[string]any{"title": "Renamed"})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(updated, &widget); err != nil {
		t.Fatal(err)
	}
	if widget["board_id"] != boardA.ID || widget["title"] != "Renamed" {
		t.Fatalf("PATCH did not retain board assignment: %s", updated)
	}
}

func dashboardTestUsers(t *testing.T, pool *pgxpool.Pool) []string {
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
	return users
}
