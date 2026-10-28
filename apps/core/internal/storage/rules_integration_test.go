package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"rallyx.local/core/internal/telemetry"
	"rallyx.local/core/internal/testutil"
)

func TestCompositeRuleDurableLifecycle(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	registry := Registry{Pool: pool}
	id := fmt.Sprintf("composite-%d", time.Now().UnixNano())
	if _, err := pool.Exec(ctx, "INSERT INTO assets(id,area_id,name) VALUES($1,'demo-area',$1)", id); err != nil {
		t.Fatal(err)
	}
	device := testutil.Device(t, pool, id)
	for _, key := range []string{"run", "current"} {
		dtype := "number"
		typed := "float64"
		if key == "run" {
			dtype = "boolean"
			typed = "bool"
		}
		if _, err := pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type,stale_seconds) VALUES($1,$2,$3,$4,$4,$5,$6,60)`, id+"-"+key, id, device, key, dtype, typed); err != nil {
			t.Fatal(err)
		}
	}
	var actor string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE role_id='admin' LIMIT 1").Scan(&actor); err != nil {
		t.Fatal(err)
	}
	definition := map[string]any{"id": id + "-rule", "name": "Run without current", "enabled": true, "logic": "all", "severity": "critical", "activation_delay_ms": float64(5000), "clear_delay_ms": float64(2000), "conditions": []any{map[string]any{"tag_id": id + "-run", "operator": "is_true"}, map[string]any{"tag_id": id + "-current", "operator": "lt", "threshold": float64(1), "hysteresis": float64(.2)}}}
	if _, err := registry.Write(ctx, "rules", "", definition, actor); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Microsecond)
	clock := at
	engine := &telemetry.Engine{Pool: pool, Now: func() time.Time { return clock }}
	publish := func(offset time.Duration, values string, quality string) {
		t.Helper()
		clock = at.Add(offset)
		var tags map[string]json.RawMessage
		if err := json.Unmarshal([]byte(values), &tags); err != nil {
			t.Fatal(err)
		}
		if err := engine.Process(ctx, telemetry.Message{DeviceID: device, AssetID: id, Timestamp: clock, Quality: quality, Tags: tags}); err != nil {
			t.Fatal(err)
		}
	}
	state := func(want string) {
		t.Helper()
		var got string
		if err := pool.QueryRow(ctx, "SELECT state FROM rule_evaluation_state WHERE rule_id=$1", id+"-rule").Scan(&got); err != nil || got != want {
			t.Fatalf("state=%s want=%s err=%v", got, want, err)
		}
	}
	count := func(want int) {
		t.Helper()
		var got int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-rule").Scan(&got); err != nil || got != want {
			t.Fatalf("alarms=%d want=%d err=%v", got, want, err)
		}
	}
	publish(0, `{"run":true,"current":0.5}`, "GOOD")
	state("pending_active")
	count(0)
	// Pure Test must not advance persisted pending state or create an alarm.
	if _, err := registry.TestRule(ctx, definition); err != nil {
		t.Fatal(err)
	}
	state("pending_active")
	count(0)
	clock = at.Add(4900 * time.Millisecond)
	if err := engine.Sweep(ctx, clock); err != nil {
		t.Fatal(err)
	}
	count(0)
	// Recreate engine, resume the original pending timestamp rather than restarting the timer.
	engine = &telemetry.Engine{Pool: pool, Now: func() time.Time { return clock }}
	clock = at.Add(5 * time.Second)
	if err := engine.RecoverRules(ctx); err != nil {
		t.Fatal(err)
	}
	state("active")
	count(1)
	var alarm int64
	if err := pool.QueryRow(ctx, "SELECT id FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-rule").Scan(&alarm); err != nil {
		t.Fatal(err)
	}
	publish(6*time.Second, `{"run":true,"current":0.5}`, "GOOD")
	count(1)
	engine = &telemetry.Engine{Pool: pool, Now: func() time.Time { return clock }}
	if err := engine.RecoverRules(ctx); err != nil {
		t.Fatal(err)
	}
	var recovered int64
	if err := pool.QueryRow(ctx, "SELECT id FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL", id+"-rule").Scan(&recovered); err != nil || recovered != alarm {
		t.Fatalf("recovered alarm=%d want=%d err=%v", recovered, alarm, err)
	}
	publish(7*time.Second, `{"current":1.1}`, "GOOD")
	state("active")
	publish(8*time.Second, `{"current":1.3}`, "GOOD")
	state("pending_clear")
	publish(9*time.Second, `{"current":0}`, "BAD")
	state("active")
	count(1)
	publish(10*time.Second, `{"current":1.3}`, "GOOD")
	state("pending_clear")
	clock = at.Add(12 * time.Second)
	engine = &telemetry.Engine{Pool: pool, Now: func() time.Time { return clock }}
	if err := engine.RecoverRules(ctx); err != nil {
		t.Fatal(err)
	}
	state("inactive")
	count(0)
	var snapshots bool
	if err := pool.QueryRow(ctx, "SELECT activation_snapshot<>'{}'::jsonb AND clear_snapshot IS NOT NULL AND clear_reason='condition_cleared' FROM alarms WHERE id=$1", alarm).Scan(&snapshots); err != nil || !snapshots {
		t.Fatalf("snapshots=%v err=%v", snapshots, err)
	}
	if _, err := registry.Write(ctx, "rules", id+"-rule", map[string]any{"enabled": false}, actor); err != nil {
		t.Fatal(err)
	}
}
