package storage

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/telemetry"
	"rallyx.local/core/internal/testutil"
)

func TestDisablingAndArchivingPreservesHistoryWithoutInventingStarts(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	id := auth.RandomID()
	if err := auth.Bootstrap(ctx, pool, id, "lifecycle-test-password-123"); err != nil {
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
	tagID := id + "-run"
	if _, err := pool.Exec(ctx, "INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type,semantic) VALUES($1,$2,$3,'run','Run','boolean','bool','run')", tagID, id, deviceID); err != nil {
		t.Fatal(err)
	}
	engine := telemetry.Engine{Pool: pool}
	registry := Registry{Pool: pool}
	message := telemetry.Message{DeviceID: deviceID, AssetID: id, Timestamp: time.Now().Add(-time.Minute), Quality: "GOOD", Tags: map[string]json.RawMessage{"run": json.RawMessage("true")}}
	if err := engine.Process(ctx, message); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Write(ctx, "devices", deviceID, map[string]any{"enabled": false}, actor); err != nil {
		t.Fatal(err)
	}
	var open int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM runtime_sessions WHERE tag_id=$1 AND ended_at IS NULL", tagID).Scan(&open); err != nil || open != 0 {
		t.Fatal("disabled device keeps accumulating runtime")
	}
	message.Timestamp = time.Now().Add(time.Second)
	if err := engine.Process(ctx, message); err == nil {
		t.Fatal("disabled device accepted telemetry")
	}
	if _, err := registry.Write(ctx, "devices", deviceID, map[string]any{"enabled": true}, actor); err != nil {
		t.Fatal(err)
	}
	if err := engine.Process(ctx, message); err != nil {
		t.Fatal(err)
	}
	var starts int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE tag_id=$1 AND kind='start'", tagID).Scan(&starts); err != nil || starts != 1 {
		t.Fatalf("resume invented starts: %d %v", starts, err)
	}
	if err := registry.Archive(ctx, "devices", deviceID, actor); err != nil {
		t.Fatal(err)
	}
	var samples int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM telemetry_samples WHERE tag_id=$1", tagID).Scan(&samples); err != nil || samples != 2 {
		t.Fatal("archive removed history")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM runtime_sessions WHERE tag_id=$1 AND ended_at IS NULL", tagID).Scan(&open); err != nil || open != 0 {
		t.Fatal("archived device has an open runtime session")
	}
}
