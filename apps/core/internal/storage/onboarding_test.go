package storage

import (
	"context"
	"encoding/json"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
	"testing"
)

func TestOnboardingAtomicAndIdempotent(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	actor := auth.RandomID()
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$1,'fixture','admin')", actor); err != nil {
		t.Fatal(err)
	}
	in := OnboardingInput{RequestID: auth.RandomID(), ConnectionID: "demo-simulator", DeviceName: "Three-step device", Location: OnboardingLocation{AssetID: "demo-motor"}, Signals: []map[string]any{{"key": "power", "name": "Power", "data_type": "float64", "unit": "kW", "metadata": map[string]any{"simulator_value": 12.0}}}}
	in.Operation = "read"
	sources, sourceErr := s.EntitySources(ctx, "", 100, 0, "demo-motor-device")
	if sourceErr != nil {
		t.Fatal(sourceErr)
	}
	var filtered []struct {
		DeviceID string `json:"device_id"`
	}
	if json.Unmarshal(sources, &filtered) != nil || len(filtered) == 0 {
		t.Fatal("device source filter returned no signals")
	}
	for _, source := range filtered {
		if source.DeviceID != "demo-motor-device" {
			t.Fatal("source filter leaked another device")
		}
	}
	before := 0
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM devices").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PrepareOnboarding(ctx, in); err != nil {
		t.Fatal(err)
	}
	after := 0
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM devices").Scan(&after)
	if after != before {
		t.Fatal("preview saved configuration")
	}
	first, err := s.CompleteOnboarding(ctx, in, actor)
	if err != nil {
		t.Fatal(err)
	}
	if first.Mapped != 1 || first.Total != 1 {
		t.Fatalf("mapping missing: %+v", first)
	}
	seed, seedErr := s.OnboardingDevice(ctx, first.DeviceID)
	if seedErr != nil {
		t.Fatal(seedErr)
	}
	if len(seed["signals"].([]map[string]any)) != 1 || seed["connection_id"] != in.ConnectionID {
		t.Fatal("same-device shortcut lost signal configuration")
	}
	again, err := s.CompleteOnboarding(ctx, in, actor)
	if err != nil || again.DeviceID != first.DeviceID {
		t.Fatal("retry duplicated device")
	}
	in.RequestID = auth.RandomID()
	in.Location = OnboardingLocation{SiteName: "Must roll back", AreaName: "New area", AssetName: "New machine"}
	in.ConnectionID = "missing-connection"
	if _, err = s.CompleteOnboarding(ctx, in, actor); err == nil {
		t.Fatal("invalid connection accepted")
	}
	var count int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM sites WHERE name='Must roll back'").Scan(&count)
	if count != 0 {
		t.Fatal("failed Finish left factory rows")
	}
}
