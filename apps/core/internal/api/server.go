package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func NewServer(pool *pgxpool.Pool, mqttHealthy func(context.Context) bool, streams ...*realtime.Hub) http.Handler {
	root := http.NewServeMux()
	mux := http.NewServeMux()
	manager := auth.New(pool)
	manager.Register(mux)
	registry := storage.Registry{Pool: pool}
	hub := realtime.NewHub()
	if len(streams) > 0 {
		hub = streams[0]
	}
	hub.SessionValid = manager.SessionValid
	mux.Handle("GET /api/v1/ws", hub)
	registerHistory(mux, pool, hub)
	registerAdmin(mux, pool, mqttHealthy)
	databaseHealthy := func(ctx context.Context) bool { return pool.Ping(ctx) == nil }
	health := HealthHandler(databaseHealthy, mqttHealthy)
	root.Handle("GET /health", health)
	mux.Handle("GET /api/v1/system/status", health)
	mux.HandleFunc("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"version": "0.1.0", "stage": "development"})
	})
	for resource, query := range map[string]string{
		"sites":       "SELECT * FROM sites ORDER BY name,id",
		"areas":       "SELECT * FROM areas ORDER BY name,id",
		"panels":      "SELECT * FROM panels ORDER BY name,id",
		"assets":      storage.AssetSummaryQuery,
		"connectors":  "SELECT id,site_id,name,type,last_seen,quality FROM connectors ORDER BY name,id",
		"devices":     "SELECT id,connector_id,asset_id,name FROM devices ORDER BY name,id",
		"tags":        "SELECT t.*,s.value,COALESCE(s.quality,'unknown') AS quality,s.ts,s.received_at FROM tags t LEFT JOIN tag_current_state s ON s.tag_id=t.id ORDER BY t.name,t.id",
		"rules":       "SELECT * FROM rules ORDER BY name,id",
		"assets/tree": storage.TreeQuery,
	} {
		mux.HandleFunc("GET /api/v1/"+resource, func(w http.ResponseWriter, r *http.Request) {
			result, err := registry.List(r.Context(), query)
			if err != nil {
				apiError(w, err)
				return
			}
			writeJSON(w, 200, result)
		})
	}
	for _, resource := range []string{"sites", "areas", "panels", "assets", "connectors", "devices", "tags", "rules"} {
		mux.HandleFunc("POST /api/v1/"+resource, func(w http.ResponseWriter, r *http.Request) {
			if auth.Current(r).Role != "admin" {
				writeError(w, 403, "forbidden", "Administrator role required")
				return
			}
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			result, err := registry.Write(r.Context(), resource, "", body, auth.Current(r).ID)
			if err != nil {
				apiError(w, err)
				return
			}
			writeJSON(w, 201, result)
		})
	}
	for _, resource := range []string{"tags", "rules"} {
		mux.HandleFunc("PATCH /api/v1/"+resource+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			if auth.Current(r).Role != "admin" {
				writeError(w, 403, "forbidden", "Administrator role required")
				return
			}
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			result, err := registry.Write(r.Context(), resource, r.PathValue("id"), body, auth.Current(r).ID)
			if err != nil {
				apiError(w, err)
				return
			}
			writeJSON(w, 200, result)
		})
	}
	mux.HandleFunc("GET /api/v1/assets/{id}", func(w http.ResponseWriter, r *http.Request) {
		var result json.RawMessage
		err := pool.QueryRow(r.Context(), "SELECT to_jsonb(a) FROM assets a WHERE id=$1", r.PathValue("id")).Scan(&result)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/assets/{id}/tags", func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.List(r.Context(), "SELECT t.*,s.value,s.quality,s.ts FROM tags t LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=$1 ORDER BY t.name,t.id", r.PathValue("id"))
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	root.Handle("/api/", manager.Wrap(mux))
	return root
}

func readObject(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	var body map[string]any
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
	if err := decoder.Decode(&body); err != nil {
		return nil, storage.ErrValidation
	}
	if decoder.Decode(new(any)) != io.EOF || body == nil {
		return nil, storage.ErrValidation
	}
	return body, nil
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func apiError(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	switch {
	case errors.Is(err, storage.ErrValidation):
		writeError(w, 422, "validation_error", err.Error())
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, 404, "not_found", "Resource not found")
	case errors.As(err, &pg):
		switch pg.Code {
		case "23505":
			writeError(w, 409, "conflict", "Identifier or name already exists in this scope")
		case "23503", "23514", "23502", "22P02", "22003":
			writeError(w, 422, "validation_error", "Invalid resource fields or reference")
		default:
			slog.Error("database request failed", "code", pg.Code)
			writeError(w, 500, "storage_error", "Database operation failed")
		}
	default:
		slog.Error("request failed", "error", err)
		writeError(w, 500, "internal_error", "Request could not be completed")
	}
}
