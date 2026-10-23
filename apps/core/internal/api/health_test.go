package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthReportsDependenciesSeparately(t *testing.T) {
	for _, tc := range []struct {
		name       string
		db, broker bool
		code       int
	}{
		{"healthy", true, true, http.StatusOK},
		{"database down", false, true, http.StatusServiceUnavailable},
		{"broker down", true, false, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := HealthHandler(func(context.Context) bool { return tc.db }, func(context.Context) bool { return tc.broker })
			r := httptest.NewRecorder()
			h.ServeHTTP(r, httptest.NewRequest("GET", "/health", nil))
			if r.Code != tc.code {
				t.Fatalf("status=%d, want %d", r.Code, tc.code)
			}
			var result struct {
				Database bool `json:"database"`
				MQTT     bool `json:"mqtt"`
			}
			if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Database != tc.db || result.MQTT != tc.broker {
				t.Fatalf("incorrect dependency report: %s", r.Body.String())
			}
		})
	}
}
