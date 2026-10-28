package api

import (
	"net/http"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerConfigurationTools(mux *http.ServeMux, registry storage.Registry, hub *realtime.Hub) {
	admin := func(w http.ResponseWriter, r *http.Request) bool {
		if auth.Current(r).Role != "admin" {
			writeError(w, 403, "forbidden", "Administrator role required")
			return false
		}
		return true
	}
	for _, resource := range []string{"connections", "devices", "tags", "device_templates", "assets"} {
		path := resource
		if resource == "device_templates" {
			path = "templates"
		}
		mux.HandleFunc("DELETE /api/v1/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			if !admin(w, r) {
				return
			}
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			confirmed, _ := body["confirm"].(bool)
			policy, _ := body["history_policy"].(string)
			if !confirmed || policy != "retain" || len(body) != 2 {
				writeError(w, 422, "confirmation_required", "Confirm deletion with history_policy=retain. Configuration will be archived; history is retained.")
				return
			}
			if err := registry.Archive(r.Context(), resource, r.PathValue("id"), auth.Current(r).ID); err != nil {
				apiError(w, err)
				return
			}
			hub.Broadcast(map[string]any{"type": "configuration"})
			writeJSON(w, 200, map[string]any{"archived": true, "history_policy": "retain"})
		})
	}
	for _, preview := range []bool{true, false} {
		path := "/api/v1/config/import"
		if preview {
			path += "/preview"
		}
		mux.HandleFunc("POST "+path, func(w http.ResponseWriter, r *http.Request) {
			if !admin(w, r) {
				return
			}
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			content, ok := body["csv"].(string)
			if !ok || len(body) != 1 {
				apiError(w, storage.ErrValidation)
				return
			}
			if preview {
				result, err := registry.PreviewCSV(r.Context(), content)
				if err != nil {
					apiError(w, err)
					return
				}
				writeJSON(w, 200, result)
				return
			}
			count, err := registry.ImportCSV(r.Context(), content, auth.Current(r).ID)
			if err != nil {
				apiError(w, err)
				return
			}
			hub.Broadcast(map[string]any{"type": "configuration"})
			writeJSON(w, 201, map[string]int{"imported": count})
		})
	}
	mux.HandleFunc("GET /api/v1/config/tags.csv", func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.ExportTagsCSV(r.Context(), r.URL.Query().Get("device_id"))
		if err != nil {
			apiError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="rallyx-tags.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(result))
	})
	mux.HandleFunc("GET /api/v1/dashboard", func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.ListWidgets(r.Context(), auth.Current(r).ID)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/dashboard/boards", func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.ListDashboardBoards(r.Context(), auth.Current(r).ID)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("POST /api/v1/dashboard/boards", func(w http.ResponseWriter, r *http.Request) {
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		name, ok := body["name"].(string)
		if !ok || len(body) != 1 {
			apiError(w, storage.ErrValidation)
			return
		}
		result, err := registry.CreateDashboardBoard(r.Context(), auth.Current(r).ID, name)
		if err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "dashboard"})
		writeJSON(w, 201, result)
	})
	mux.HandleFunc("PATCH /api/v1/dashboard/boards/{id}", func(w http.ResponseWriter, r *http.Request) {
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		name, ok := body["name"].(string)
		if !ok || len(body) != 1 {
			apiError(w, storage.ErrValidation)
			return
		}
		result, err := registry.RenameDashboardBoard(r.Context(), auth.Current(r).ID, r.PathValue("id"), name)
		if err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "dashboard"})
		writeJSON(w, 200, result)
	})
	for _, method := range []string{"POST", "PATCH"} {
		path := "/api/v1/dashboard"
		if method == "PATCH" {
			path += "/{id}"
		}
		mux.HandleFunc(method+" "+path, func(w http.ResponseWriter, r *http.Request) {
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			result, err := registry.SaveWidget(r.Context(), auth.Current(r).ID, r.PathValue("id"), body)
			if err != nil {
				apiError(w, err)
				return
			}
			hub.Broadcast(map[string]any{"type": "dashboard"})
			status := 200
			if method == "POST" {
				status = 201
			}
			writeJSON(w, status, result)
		})
	}
	mux.HandleFunc("DELETE /api/v1/dashboard/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := registry.DeleteWidget(r.Context(), auth.Current(r).ID, r.PathValue("id")); err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "dashboard"})
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
}
