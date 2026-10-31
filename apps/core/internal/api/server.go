package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/secrets"
	"rallyx.local/core/internal/storage"
)

func NewServer(pool *pgxpool.Pool, mqttHealthy func(context.Context) bool, streams ...*realtime.Hub) http.Handler {
	root := http.NewServeMux()
	mux := http.NewServeMux()
	manager := auth.New(pool)
	manager.Register(mux)
	registerGrafana(root, mux, manager)
	registry := storage.Registry{Pool: pool}
	registry.Vault, _ = secrets.New(os.Getenv("SESSION_SECRET"))
	hub := realtime.NewHub()
	if len(streams) > 0 {
		hub = streams[0]
	}
	hub.SessionValid = manager.SessionValid
	mux.Handle("GET /api/v1/ws", hub)
	registerHistory(mux, pool, hub)
	registerAdmin(mux, pool, mqttHealthy)
	registerConfigurationTools(mux, registry, hub)
	registerDashboardNativeMigration(mux, registry, hub)
	registerRules(mux, registry, hub)
	registerConnectivity(root, registry, hub)
	registerConnectivityDiagnostics(mux)
	registerEntityPlatform(mux, registry, hub)
	registerOnboarding(mux, registry, hub)
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
		"connectors":  "SELECT id,site_id,name,protocol AS type,last_seen,quality,status FROM connections WHERE deleted_at IS NULL ORDER BY name,id",
		"connections": "SELECT c.*,EXISTS(SELECT 1 FROM connection_credentials cc WHERE cc.connection_id=c.id) AS has_credentials FROM connections c WHERE c.deleted_at IS NULL ORDER BY c.name,c.id",
		"devices":     "SELECT id,connection_id,asset_id,area_id,template_id,template_version,name,manufacturer,model,serial_number,protocol_device_address,enabled,metadata,status,last_seen,last_successful_poll,last_error,created_at,updated_at FROM devices WHERE deleted_at IS NULL ORDER BY name,id",
		"templates":   "SELECT * FROM device_templates WHERE deleted_at IS NULL ORDER BY name,id",
		"tags":        "SELECT t.*,s.value,CASE WHEN upper(COALESCE(s.quality,t.quality))='UNKNOWN' THEN 'UNCERTAIN' ELSE upper(COALESCE(s.quality,t.quality)) END AS quality,s.ts,s.received_at,s.raw_value,d.name AS device_name,a.name AS asset_name FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.deleted_at IS NULL AND d.deleted_at IS NULL ORDER BY t.name,t.id",
		"rules":       storage.RulesQuery,
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
	for _, resource := range []string{"sites", "areas", "assets", "connections", "devices", "device_templates", "tags", "rules"} {
		path := resource
		if resource == "device_templates" {
			path = "templates"
		}
		mux.HandleFunc("POST /api/v1/"+path, func(w http.ResponseWriter, r *http.Request) {
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
			hub.Broadcast(map[string]any{"type": "configuration"})
		})
	}
	for _, resource := range []string{"sites", "areas", "assets", "connections", "devices", "device_templates", "tags", "rules"} {
		path := resource
		if resource == "device_templates" {
			path = "templates"
		}
		mux.HandleFunc("PATCH /api/v1/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
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
			hub.Broadcast(map[string]any{"type": "configuration"})
		})
	}
	for _, resource := range []string{"connections", "devices", "device_templates", "tags"} {
		path := resource
		if resource == "device_templates" {
			path = "templates"
		}
		mux.HandleFunc("GET /api/v1/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			var result json.RawMessage
			err := pool.QueryRow(r.Context(), "SELECT to_jsonb(x) FROM "+resource+" x WHERE id=$1", r.PathValue("id")).Scan(&result)
			if err != nil {
				apiError(w, err)
				return
			}
			writeJSON(w, 200, result)
		})
	}
	mux.HandleFunc("GET /api/v1/devices/{id}/tags", func(w http.ResponseWriter, r *http.Request) {
		result, err := registry.List(r.Context(), "SELECT t.*,s.value,upper(COALESCE(s.quality,t.quality)) AS quality,s.ts,s.raw_value FROM tags t LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.device_id=$1 AND t.deleted_at IS NULL ORDER BY t.name,t.id", r.PathValue("id"))
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
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
		result, err := registry.List(r.Context(), "SELECT t.*,s.value,upper(COALESCE(s.quality,t.quality)) AS quality,s.ts FROM tags t LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=$1 AND t.deleted_at IS NULL ORDER BY t.name,t.id", r.PathValue("id"))
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
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2097152))
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
	var csv *storage.CSVValidationError
	switch {
	case errors.Is(err, storage.ErrRevision):
		writeError(w, 409, "revision_conflict", err.Error())
	case errors.As(err, &csv):
		writeJSON(w, 422, map[string]any{"error": map[string]any{"code": "csv_validation_error", "message": csv.Error(), "details": csv.Preview.Errors}})
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
