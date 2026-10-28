package api

import (
	"encoding/json"
	"net/http"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerRules(mux *http.ServeMux, registry storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("POST /api/v1/rules/test", func(w http.ResponseWriter, r *http.Request) {
		if auth.Current(r).Role != "admin" {
			writeError(w, 403, "forbidden", "Administrator role required")
			return
		}
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		result, err := registry.TestRule(r.Context(), body)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		var result json.RawMessage
		err := registry.Pool.QueryRow(r.Context(), "SELECT to_jsonb(x) FROM ("+storage.RulesQuery+") x WHERE x.id=$1", r.PathValue("id")).Scan(&result)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("DELETE /api/v1/rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		if auth.Current(r).Role != "admin" {
			writeError(w, 403, "forbidden", "Administrator role required")
			return
		}
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		if body["confirm"] != true || body["history_policy"] != "retain" || len(body) != 2 {
			apiError(w, storage.ErrValidation)
			return
		}
		if err = registry.ArchiveRule(r.Context(), r.PathValue("id"), auth.Current(r).ID); err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "configuration"})
		writeJSON(w, 200, map[string]any{"archived": true})
	})
}
