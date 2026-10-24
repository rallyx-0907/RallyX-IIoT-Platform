package storage

import "testing"

func TestOptionalPollIntervalCanReturnToConnectionDefault(t *testing.T) {
	kind := resources["tags"].Fields["poll_interval_ms"]
	if !valid(kind, nil) {
		t.Fatal("null must clear a tag poll override to the connection default")
	}
	for _, value := range []any{float64(100), float64(1000), float64(86400000)} {
		if !valid(kind, value) {
			t.Errorf("rejected valid interval %v", value)
		}
	}
	for _, value := range []any{float64(0), float64(99), float64(100.5), float64(86400001), "1000"} {
		if valid(kind, value) {
			t.Errorf("accepted invalid interval %v", value)
		}
	}
	if valid(resources["connections"].Fields["polling_interval_ms"], nil) {
		t.Fatal("connection polling interval remains required and non-null")
	}
}
