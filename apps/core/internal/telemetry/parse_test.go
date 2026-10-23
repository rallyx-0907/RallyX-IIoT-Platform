package telemetry

import "testing"

func TestParseTelemetryContract(t *testing.T) {
	message, err := Parse("rallyx/site-a/pump-a/telemetry", []byte(`{"ts":"2026-10-23T08:30:10+07:00","tags":{"run":true},"quality":"good"}`))
	if err != nil {
		t.Fatal(err)
	}
	if message.SiteID != "site-a" || message.AssetID != "pump-a" {
		t.Fatalf("wrong topic resolution: %+v", message)
	}
	if _, exists := message.Tags["current"]; exists {
		t.Fatal("missing tag was synthesized")
	}
	if got := message.Timestamp.UTC().Format("2006-01-02T15:04:05Z"); got != "2026-10-23T01:30:10Z" {
		t.Fatalf("timestamp=%s", got)
	}
}

func TestRejectMalformedTelemetry(t *testing.T) {
	for _, payload := range []string{
		`{"ts":"2026-10-23T08:30:10","tags":{"run":true},"quality":"good"}`,
		`{"ts":"2026-10-23T08:30:10Z","tags":{"run":null},"quality":"good"}`,
		`{"ts":"2026-10-23T08:30:10Z","tags":{"run":true},"quality":"excellent"}`,
		`{"ts":"2026-10-23T08:30:10Z","tags":{},"quality":"good"}`,
		`{"ts":"2026-10-23T08:30:10Z","tags":{"run":true},"quality":"good"} {}`,
	} {
		if _, err := Parse("rallyx/site/asset/telemetry", []byte(payload)); err == nil {
			t.Errorf("accepted invalid payload: %s", payload)
		}
	}
	if _, err := Parse("rallyx/+/asset/telemetry", []byte(`{}`)); err == nil {
		t.Fatal("accepted wildcard topic")
	}
}
