package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/storage"
)

func registerAdmin(mux *http.ServeMux, pool *pgxpool.Pool, mqttHealthy func(context.Context) bool) {
	store := storage.Registry{Pool: pool}
	admin := func(w http.ResponseWriter, r *http.Request) bool {
		if auth.Current(r).Role != "admin" {
			writeError(w, 403, "forbidden", "Administrator role required")
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/v1/users", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		result, err := store.List(r.Context(), "SELECT id,username,role_id AS role,must_change_password,enabled FROM users ORDER BY username,id")
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("POST /api/v1/users", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		username, _ := body["username"].(string)
		password, _ := body["password"].(string)
		role, _ := body["role"].(string)
		if len(body) != 3 || strings.TrimSpace(username) == "" || len(username) > 64 || len(password) < 16 || len(password) > 72 || (role != "admin" && role != "operator" && role != "viewer") {
			apiError(w, storage.ErrValidation)
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			apiError(w, err)
			return
		}
		tx, err := pool.Begin(r.Context())
		if err != nil {
			apiError(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		var result json.RawMessage
		err = tx.QueryRow(r.Context(), "INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$2,$3,$4) RETURNING jsonb_build_object('id',id,'username',username,'role',role_id,'must_change_password',must_change_password,'enabled',enabled)", auth.RandomID(), username, string(hash), role).Scan(&result)
		if err == nil {
			_, err = tx.Exec(r.Context(), "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'create:users',$2)", auth.Current(r).ID, username)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 201, result)
	})
	mux.HandleFunc("PATCH /api/v1/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		body, err := readObject(w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		role, rolePresent := body["role"].(string)
		enabled, enabledPresent := body["enabled"].(bool)
		if len(body) == 0 || (!rolePresent && !enabledPresent) || len(body) > 2 {
			apiError(w, storage.ErrValidation)
			return
		}
		for key := range body {
			if key != "role" && key != "enabled" {
				apiError(w, storage.ErrValidation)
				return
			}
		}
		if rolePresent && role != "admin" && role != "operator" && role != "viewer" {
			apiError(w, storage.ErrValidation)
			return
		}
		if r.PathValue("id") == auth.Current(r).ID && ((rolePresent && role != "admin") || (enabledPresent && !enabled)) {
			writeError(w, 422, "self_lockout", "Cannot remove your own administrator access")
			return
		}
		tx, err := pool.Begin(r.Context())
		if err != nil {
			apiError(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		var result json.RawMessage
		err = tx.QueryRow(r.Context(), "UPDATE users SET role_id=CASE WHEN $2 THEN $3 ELSE role_id END,enabled=CASE WHEN $4 THEN $5 ELSE enabled END WHERE id=$1 RETURNING jsonb_build_object('id',id,'username',username,'role',role_id,'enabled',enabled)", r.PathValue("id"), rolePresent, role, enabledPresent, enabled).Scan(&result)
		if err == nil {
			_, err = tx.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1", r.PathValue("id"))
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'update:users',$2)", auth.Current(r).ID, r.PathValue("id"))
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/audit", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		result, err := store.List(r.Context(), "SELECT a.id,u.username,a.action,a.resource,a.ts FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.ts DESC,a.id DESC LIMIT 200")
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, 200, result)
	})
	for _, method := range []string{"GET", "POST"} {
		mux.HandleFunc(method+" /api/v1/simulator", func(w http.ResponseWriter, r *http.Request) {
			if !admin(w, r) {
				return
			}
			base := os.Getenv("NODE_RED_URL")
			if base == "" {
				writeError(w, 503, "simulator_unavailable", "Simulator service is not configured")
				return
			}
			var content []byte
			if r.Method == "POST" {
				body, err := readObject(w, r)
				if err != nil {
					apiError(w, err)
					return
				}
				content, _ = json.Marshal(body)
			}
			upstream, err := http.NewRequestWithContext(r.Context(), r.Method, strings.TrimRight(base, "/")+"/simulator", bytes.NewReader(content))
			if err != nil {
				writeError(w, 503, "simulator_unavailable", "Simulator service is unavailable")
				return
			}
			upstream.Header.Set("Content-Type", "application/json")
			response, err := (&http.Client{Timeout: 5 * time.Second}).Do(upstream)
			if err != nil {
				writeError(w, 503, "simulator_unavailable", "Simulator service is unavailable")
				return
			}
			defer response.Body.Close()
			data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
			if err != nil || len(data) > 65536 || !json.Valid(data) {
				writeError(w, 502, "invalid_simulator_response", "Simulator returned an invalid response")
				return
			}
			status := response.StatusCode
			if status != 200 && status != 403 && status != 422 {
				writeError(w, 503, "simulator_unavailable", "Simulator service is unavailable")
				return
			}
			writeJSON(w, status, json.RawMessage(data))
		})
	}
	mux.HandleFunc("GET /api/v1/system/connections", func(w http.ResponseWriter, r *http.Request) {
		nodeOK := false
		if base := os.Getenv("NODE_RED_URL"); base != "" {
			upstream, err := http.NewRequestWithContext(r.Context(), "GET", strings.TrimRight(base, "/")+"/health", nil)
			if err == nil {
				response, err := (&http.Client{Timeout: 3 * time.Second}).Do(upstream)
				if err == nil {
					nodeOK = response.StatusCode == 200
					response.Body.Close()
				}
			}
		}
		writeJSON(w, 200, map[string]bool{"database": pool.Ping(r.Context()) == nil, "mqtt": mqttHealthy(r.Context()), "node_red": nodeOK})
	})
}
