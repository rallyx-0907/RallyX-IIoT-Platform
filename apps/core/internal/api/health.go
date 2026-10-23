package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// HealthHandler reports dependencies independently so field support can locate a failure.
func HealthHandler(database, mqtt func(context.Context) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		dbOK, mqttOK := database(ctx), mqtt(ctx)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if !dbOK || !mqttOK {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"database": dbOK, "mqtt": mqttOK, "healthy": dbOK && mqttOK})
	})
}
