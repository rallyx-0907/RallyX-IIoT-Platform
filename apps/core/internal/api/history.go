package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

type timeRange struct {
	From, To      time.Time
	Limit, Offset int
}

func parseRange(r *http.Request) (timeRange, error) {
	result := timeRange{To: time.Now().UTC(), Limit: 200}
	result.From = result.To.Add(-24 * time.Hour)
	var err error
	if value := r.URL.Query().Get("from"); value != "" {
		result.From, err = time.Parse(time.RFC3339Nano, value)
		if err != nil {
			return result, storage.ErrValidation
		}
	}
	if value := r.URL.Query().Get("to"); value != "" {
		result.To, err = time.Parse(time.RFC3339Nano, value)
		if err != nil {
			return result, storage.ErrValidation
		}
	}
	if !result.To.After(result.From) {
		return result, storage.ErrValidation
	}
	if value := r.URL.Query().Get("limit"); value != "" {
		result.Limit, err = strconv.Atoi(value)
		if err != nil || result.Limit < 1 || result.Limit > 2000 {
			return result, storage.ErrValidation
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		result.Offset, err = strconv.Atoi(value)
		if err != nil || result.Offset < 0 || result.Offset > 1000000 {
			return result, storage.ErrValidation
		}
	}
	return result, nil
}

func registerHistory(mux *http.ServeMux, pool *pgxpool.Pool, hub *realtime.Hub) {
	store := storage.Registry{Pool: pool}
	mux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		bounds, err := parseRange(r)
		if err != nil {
			apiError(w, err)
			return
		}
		result, err := store.List(r.Context(), "SELECT e.*,a.name AS asset_name FROM events e JOIN assets a ON a.id=e.asset_id WHERE e.ts>=$1 AND e.ts<$2 ORDER BY e.ts DESC,e.id DESC LIMIT $3 OFFSET $4", bounds.From, bounds.To, bounds.Limit, bounds.Offset)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/tags/{id}/current", func(w http.ResponseWriter, r *http.Request) {
		var result json.RawMessage
		err := pool.QueryRow(r.Context(), "SELECT to_jsonb(s) FROM tag_current_state s WHERE tag_id=$1", r.PathValue("id")).Scan(&result)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/tags/{id}/history", func(w http.ResponseWriter, r *http.Request) {
		bounds, err := parseRange(r)
		if err != nil {
			apiError(w, err)
			return
		}
		query := "SELECT ts,value,quality FROM telemetry_samples WHERE tag_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts LIMIT $4 OFFSET $5"
		args := []any{r.PathValue("id"), bounds.From, bounds.To, bounds.Limit, bounds.Offset}
		if bucket := r.URL.Query().Get("bucket"); bucket != "" {
			if bucket != "1 minute" && bucket != "1 hour" && bucket != "1 day" {
				apiError(w, storage.ErrValidation)
				return
			}
			query = "SELECT time_bucket($6::interval,ts) AS ts,avg((value#>>'{}')::float8) AS value,'GOOD' AS quality,count(*) AS samples FROM telemetry_samples WHERE tag_id=$1 AND ts>=$2 AND ts<$3 AND upper(quality)='GOOD' AND jsonb_typeof(value)='number' GROUP BY 1 ORDER BY 1 LIMIT $4 OFFSET $5"
			args = append(args, bucket)
		}
		result, err := store.List(r.Context(), query, args...)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/assets/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		bounds, err := parseRange(r)
		if err != nil {
			apiError(w, err)
			return
		}
		result, err := store.List(r.Context(), "SELECT * FROM events WHERE asset_id=$1 AND ts>=$2 AND ts<$3 ORDER BY ts DESC,id DESC LIMIT $4 OFFSET $5", r.PathValue("id"), bounds.From, bounds.To, bounds.Limit, bounds.Offset)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/assets/{id}/runtime", func(w http.ResponseWriter, r *http.Request) {
		bounds, err := parseRange(r)
		if err != nil {
			apiError(w, err)
			return
		}
		result, err := store.List(r.Context(), `SELECT *,extract(epoch FROM LEAST(COALESCE(ended_at,$3),$3::timestamptz)-GREATEST(started_at,$2::timestamptz))::float8 AS duration_seconds FROM runtime_sessions WHERE asset_id=$1 AND started_at<$3 AND (ended_at IS NULL OR ended_at>$2) ORDER BY started_at DESC,id DESC LIMIT $4 OFFSET $5`, r.PathValue("id"), bounds.From, bounds.To, bounds.Limit, bounds.Offset)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	for _, history := range []bool{false, true} {
		path := "/api/v1/alarms"
		filter := "a.cleared_at IS NULL"
		if history {
			path += "/history"
			filter = "a.cleared_at IS NOT NULL"
		}
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			bounds, err := parseRange(r)
			if err != nil {
				apiError(w, err)
				return
			}
			query := `SELECT a.*,r.name AS rule_name,t.name AS tag_name,x.name AS asset_name FROM alarms a JOIN rules r ON r.id=a.rule_id JOIN tags t ON t.id=r.tag_id JOIN assets x ON x.id=a.asset_id WHERE ` + filter + ` AND ($1='' OR a.asset_id=$1)`
			args := []any{r.URL.Query().Get("asset_id"), bounds.Limit, bounds.Offset}
			if history {
				query += " AND a.activated_at>=$4 AND a.activated_at<$5"
				args = append(args, bounds.From, bounds.To)
			}
			query += " ORDER BY a.activated_at DESC,a.id DESC LIMIT $2 OFFSET $3"
			result, err := store.List(r.Context(), query, args...)
			if err != nil {
				apiError(w, err)
				return
			}
			writeJSON(w, 200, result)
		})
	}
	mux.HandleFunc("POST /api/v1/alarms/{id}/ack", func(w http.ResponseWriter, r *http.Request) {
		user := auth.Current(r)
		if user.Role != "admin" && user.Role != "operator" {
			writeError(w, 403, "forbidden", "Operator or administrator role required")
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			apiError(w, storage.ErrValidation)
			return
		}
		tx, err := pool.Begin(r.Context())
		if err != nil {
			apiError(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		var acknowledged *time.Time
		if err = tx.QueryRow(r.Context(), "SELECT acknowledged_at FROM alarms WHERE id=$1 FOR UPDATE", id).Scan(&acknowledged); err != nil {
			apiError(w, err)
			return
		}
		if acknowledged == nil {
			_, err = tx.Exec(r.Context(), "UPDATE alarms SET acknowledged_at=now(),acknowledged_by=$2 WHERE id=$1", id, user.ID)
			if err == nil {
				_, err = tx.Exec(r.Context(), "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'ack:alarm',$2)", user.ID, r.PathValue("id"))
			}
		}
		var result json.RawMessage
		if err == nil {
			err = tx.QueryRow(r.Context(), "SELECT to_jsonb(a) FROM alarms a WHERE id=$1", id).Scan(&result)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			apiError(w, err)
			return
		}
		hub.Broadcast(map[string]any{"type": "alarm", "id": id})
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/system/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		if auth.Current(r).Role != "admin" {
			writeError(w, 403, "forbidden", "Administrator role required")
			return
		}
		result, err := store.List(r.Context(), "SELECT ts,topic,reason FROM ingestion_diagnostics ORDER BY ts DESC,id DESC LIMIT 200")
		if err != nil {
			apiError(w, err)
			return
		}
		w.Header().Set("Content-Disposition", `attachment; filename="rallyx-diagnostics.json"`)
		writeJSON(w, 200, result)
	})
}
