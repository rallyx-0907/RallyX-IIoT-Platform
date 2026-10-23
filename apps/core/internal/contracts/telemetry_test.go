package contracts

import "testing"

func TestDeviceTelemetryContract(t *testing.T) {
	topic, err := DeviceTopic("drive-a", "telemetry")
	if err != nil || topic != "rallyx/v1/device/drive-a/telemetry" {
		t.Fatalf("topic=%s err=%v", topic, err)
	}
	message, err := DecodeTelemetry(topic, []byte(`{"timestamp":"2026-10-23T09:00:00+07:00","device_id":"drive-a","asset_id":"conveyor-a","values":{"run":true,"current":7.42},"quality":"GOOD"}`))
	if err != nil {
		t.Fatal(err)
	}
	if message.DeviceID != "drive-a" || message.AssetID != "conveyor-a" || message.Timestamp.UTC().Format("2006-01-02T15:04:05Z") != "2026-10-23T02:00:00Z" {
		t.Fatalf("invalid normalized identity/time: %+v", message)
	}
	if _, exists := message.Tags["fault"]; exists {
		t.Fatal("missing value became an implicit value")
	}
}

func TestMalformedDeviceTelemetryIsRejected(t *testing.T) {
	for _, payload := range []string{
		`{"timestamp":"2026-10-23T09:00:00Z","device_id":"other","asset_id":"a","values":{"run":true},"quality":"GOOD"}`,
		`{"timestamp":"2026-10-23T09:00:00","device_id":"d","asset_id":"a","values":{"run":true},"quality":"GOOD"}`,
		`{"timestamp":"2026-10-23T09:00:00Z","device_id":"d","asset_id":"a","values":{"run":null},"quality":"GOOD"}`,
		`{"timestamp":"2026-10-23T09:00:00Z","device_id":"d","asset_id":"a","values":{"run":true},"quality":"good"}`,
		`{"timestamp":"2026-10-23T09:00:00Z","device_id":"d","asset_id":"a","values":{},"quality":"GOOD"}`,
		`{"timestamp":"2026-10-23T09:00:00Z","device_id":"d","asset_id":"a","values":{"run":true},"quality":"GOOD"} {}`,
	} {
		if _, err := DecodeTelemetry("rallyx/v1/device/d/telemetry", []byte(payload)); err == nil {
			t.Errorf("accepted malformed payload: %s", payload)
		}
	}
	for _, id := range []string{"+", "has/slash", ""} {
		if _, err := DeviceTopic(id, "telemetry"); err == nil {
			t.Errorf("accepted invalid device ID %q", id)
		}
	}
}
