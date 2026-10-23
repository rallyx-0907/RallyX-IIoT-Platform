package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerConnectivity(root *http.ServeMux, registry storage.Registry, hub *realtime.Hub) {
	service := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			configured := os.Getenv("CONNECTIVITY_TOKEN")
			provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if len(configured) < 32 || strings.Contains(configured, "CHANGE_ME") || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || subtle.ConstantTimeCompare([]byte(configured), []byte(provided)) != 1 {
				writeError(w, 401, "service_authentication_required", "Connectivity service authentication required")
				return
			}
			next(w, r)
		}
	}
	root.HandleFunc("GET /internal/connectivity/config", service(func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.ConnectivityConfiguration(r.Context())
		if err != nil {
			writeError(w, 503, "configuration_unavailable", "Connectivity configuration is temporarily unavailable")
			return
		}
		writeJSON(w, 200, map[string]any{"connections": result})
	}))
	root.HandleFunc("POST /internal/connectivity/status", service(func(w http.ResponseWriter, r *http.Request) {
		var body storage.ConnectivityStatus
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 262144))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil {
			apiError(w, storage.ErrValidation)
			return
		}
		if err := registry.UpdateConnectivityStatus(r.Context(), body); err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "connection"})
		writeJSON(w, 200, map[string]bool{"ok": true})
	}))
}
