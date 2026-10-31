package storage

import (
	"context"
	"encoding/json"
	"testing"

	"rallyx.local/core/internal/testutil"
)

func TestMigrateDashboardBoardToNativeIsAtomicOwnedAndIdempotent(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	users := dashboardTestUsers(t, pool)
	r := Registry{Pool: pool}
	board, err := r.CreateDashboardBoard(ctx, users[0], "Operations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-sensor-value", "type": "gauge", "title": "Temperature", "position": float64(2), "settings": map[string]any{"precision": float64(2), "min": float64(0), "max": float64(100)}, "board_id": board.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-motor-run", "type": "status", "title": "Running", "position": float64(4), "board_id": board.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.MigrateDashboardBoardToNative(ctx, users[1], board.ID); err == nil {
		t.Fatal("another user's board was migrated")
	}
	first, err := r.MigrateDashboardBoardToNative(WithEntityActor(ctx, users[0]), users[0], board.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.MigrateDashboardBoardToNative(WithEntityActor(ctx, users[0]), users[0], board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.EntityID != second.EntityID {
		t.Fatalf("retry returned a different entity: %#v %#v", first, second)
	}
	var widgets, entities, profiles, templates, versions, assignments, audits int
	for _, q := range []struct {
		sql  string
		dest *int
	}{{"SELECT count(*) FROM dashboard_widgets WHERE board_id=$1", &widgets}, {"SELECT count(*) FROM entities WHERE id=$1", &entities}, {"SELECT count(*) FROM entity_profiles WHERE id=$1", &profiles}, {"SELECT count(*) FROM entity_dashboard_templates WHERE id=$1", &templates}, {"SELECT count(*) FROM entity_dashboard_versions WHERE template_id=$1", &versions}, {"SELECT count(*) FROM entity_dashboard_assignments WHERE entity_id=$1", &assignments}, {"SELECT count(*) FROM audit_log WHERE user_id=$1 AND action='migrate:legacy-dashboard' AND resource=$2", &audits}} {
		if q.dest == &audits {
			if err = pool.QueryRow(ctx, q.sql, users[0], first.EntityID).Scan(q.dest); err != nil {
				t.Fatal(err)
			}
		} else {
			arg := board.ID
			if q.dest != &widgets {
				arg = first.EntityID
			}
			if q.dest == &versions {
				arg = "legacy-dashboard-template:" + board.ID
			}
			if q.dest == &profiles {
				arg = "legacy-dashboard-profile:" + board.ID
			}
			if q.dest == &templates {
				arg = "legacy-dashboard-template:" + board.ID
			}
			if err = pool.QueryRow(ctx, q.sql, arg).Scan(q.dest); err != nil {
				t.Fatal(err)
			}
		}
	}
	if widgets != 2 || entities != 1 || profiles != 1 || templates != 1 || versions != 1 || assignments != 1 || audits != 1 {
		t.Fatalf("migration duplicated or lost state: widgets=%d entity=%d profiles=%d templates=%d versions=%d assignments=%d audit=%d", widgets, entities, profiles, templates, versions, assignments, audits)
	}
	var raw []byte
	if err = pool.QueryRow(ctx, "SELECT document FROM entity_dashboard_versions WHERE template_id=$1 AND version=1", "legacy-dashboard-template:"+board.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var doc DashboardDocument
	if err = json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Pages) != 1 || len(doc.Pages[0].Widgets) != 2 || doc.Pages[0].Widgets[0].Type != "gauge" || doc.Pages[0].Widgets[1].Type != "status-card" {
		t.Fatalf("unexpected converted widgets: %#v", doc)
	}
}

func TestMigrateDashboardBoardToNativeRollsBackInvalidBoard(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	users := dashboardTestUsers(t, pool)
	r := Registry{Pool: pool}
	board, err := r.CreateDashboardBoard(ctx, users[0], "Broken")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.SaveWidget(ctx, users[0], "", map[string]any{"tag_id": "demo-sensor-value", "type": "value", "board_id": board.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE dashboard_widgets SET type='status' WHERE board_id=$1", board.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = r.MigrateDashboardBoardToNative(ctx, users[0], board.ID); err == nil {
		t.Fatal("invalid widget type migrated")
	}
	var n int
	for _, table := range []string{"entities", "entity_profiles", "entity_dashboard_templates"} {
		if err = pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE id LIKE $1", "legacy-dashboard%:"+board.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("partial state in %s: %d", table, n)
		}
	}
}
