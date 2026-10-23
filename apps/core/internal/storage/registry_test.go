package storage

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/telemetry"
	"rallyx.local/core/internal/testutil"
)

func TestConfigurationEditsPreserveStateIntegrity(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	id := auth.RandomID()
	if err := auth.Bootstrap(ctx, pool, id, "configuration-test-password-123"); err != nil {
		t.Fatal(err)
	}
	var actor string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", id).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO assets(id,area_id,name) VALUES($1,'demo-area',$1)", id); err != nil {
		t.Fatal(err)
	}
	deviceID := testutil.Device(t, pool, id)
	for _, tag := range []struct{ key, datatype, semantic string }{{"run", "boolean", "run"}, {"current", "number", ""}} {
		if _, err := pool.Exec(ctx, "INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type,semantic) VALUES($1,$2,$6,$3,$3,$4,CASE WHEN $4='boolean' THEN 'bool' ELSE 'float64' END,$5)", id+"-"+tag.key, id, tag.key, tag.datatype, tag.semantic, deviceID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, "INSERT INTO rules(id,tag_id,name,type,threshold) VALUES($1,$2,'High','high',10),($3,$4,'Stale','stale',NULL)", id+"-high", id+"-current", id+"-stale", id+"-run"); err != nil {
		t.Fatal(err)
	}
	engine := telemetry.Engine{Pool: pool}
	if err := engine.Process(ctx, telemetry.Message{DeviceID: deviceID, AssetID: id, Timestamp: time.Now().Add(-time.Minute), Quality: "good", Tags: map[string]json.RawMessage{"run": json.RawMessage("true"), "current": json.RawMessage("20")}}); err != nil {
		t.Fatal(err)
	}
	if err := engine.Sweep(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	registry := Registry{Pool: pool}
	t.Run("semantic cannot orphan an open session", func(t *testing.T) {
		if _, err := registry.Write(ctx, "tags", id+"-run", map[string]any{"semantic": ""}, actor); !errors.Is(err, ErrValidation) {
			t.Fatalf("semantic edit accepted: %v", err)
		}
	})
	t.Run("datatype cannot invalidate attached threshold rules", func(t *testing.T) {
		if _, err := registry.Write(ctx, "tags", id+"-current", map[string]any{"datatype": "string"}, actor); !errors.Is(err, ErrValidation) {
			t.Fatalf("datatype edit accepted: %v", err)
		}
	})
	for _, ruleID := range []string{id + "-high", id + "-stale"} {
		t.Run("disabled rule clears alarm "+ruleID, func(t *testing.T) {
			if _, err := registry.Write(ctx, "rules", ruleID, map[string]any{"enabled": false}, actor); err != nil {
				t.Fatal(err)
			}
			var active, reason int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", ruleID).Scan(&active); err != nil || active != 0 {
				t.Fatalf("stranded alarms=%d err=%v", active, err)
			}
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE asset_id=$1 AND kind='alarm_cleared' AND detail->>'reason'='rule_disabled'", id).Scan(&reason); err != nil || reason == 0 {
				t.Fatalf("missing clear reason: %d %v", reason, err)
			}
		})
	}
}
