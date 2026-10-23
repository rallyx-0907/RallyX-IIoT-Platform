package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/secrets"
	"rallyx.local/core/internal/storage"
	"rallyx.local/core/internal/testutil"
)

func TestConnectivityServiceTokenAndCredentialBoundary(t *testing.T) {
	const key = "test-only-connectivity-installation-key-minimum-32"
	const token = "test-only-connectivity-service-token-minimum-32"
	t.Setenv("SESSION_SECRET", key)
	t.Setenv("CONNECTIVITY_TOKEN", token)
	pool := testutil.Database(t)
	ctx := context.Background()
	name := auth.RandomID()
	if err := auth.Bootstrap(ctx, pool, name, "connectivity-api-test-password-123"); err != nil {
		t.Fatal(err)
	}
	var actor string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", name).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	vault, err := secrets.New(key)
	if err != nil {
		t.Fatal(err)
	}
	registry := storage.Registry{Pool: pool, Vault: vault}
	connectionID := auth.RandomID()
	if _, err := registry.Write(ctx, "connections", "", map[string]any{"id": connectionID, "site_id": "demo-site", "name": name, "protocol": "mqtt", "protocol_config": map[string]any{"broker_url": "mqtt://broker:1883", "topic": "field/{device}/telemetry"}, "credentials": map[string]any{"username": "test-client", "password": "fixture-internal-secret"}}, actor); err != nil {
		t.Fatal(err)
	}
	deviceID := auth.RandomID()
	if _, err := registry.Write(ctx, "devices", "", map[string]any{"id": deviceID, "name": name, "asset_id": "demo-motor", "connection_id": connectionID}, actor); err != nil {
		t.Fatal(err)
	}
	tagID := auth.RandomID()
	if _, err := registry.Write(ctx, "tags", "", map[string]any{"id": tagID, "device_id": deviceID, "key": "current", "name": "Current", "data_type": "float32", "address": "current"}, actor); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(pool, func(context.Context) bool { return true })
	call := func(method, path, bearer string, body any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, bad := range []string{"", "wrong-token"} {
		if got := call("GET", "/internal/connectivity/config", bad, nil).Code; got != 401 {
			t.Fatalf("unauthorized worker config status=%d", got)
		}
	}
	config := call("GET", "/internal/connectivity/config", token, nil)
	if config.Code != 200 || !strings.Contains(config.Body.String(), "fixture-internal-secret") || !strings.Contains(config.Body.String(), deviceID) {
		t.Fatalf("authorized worker config status=%d", config.Code)
	}
	if got := call("GET", "/api/v1/connections", token, nil).Code; got != 401 {
		t.Fatalf("worker token grants browser API privileges: %d", got)
	}
	status := call("POST", "/internal/connectivity/status", token, map[string]any{"device_id": deviceID, "status": "ERROR", "error": "Read timeout", "tag_errors": []any{map[string]any{"tag_id": tagID, "error": "Read timeout"}}})
	if status.Code != 200 {
		t.Fatalf("status update: %d %s", status.Code, status.Body.String())
	}
	var quality, deviceStatus string
	if err := pool.QueryRow(ctx, "SELECT quality FROM tags WHERE id=$1", tagID).Scan(&quality); err != nil || quality != "BAD" {
		t.Fatalf("quality=%s err=%v", quality, err)
	}
	if err := pool.QueryRow(ctx, "SELECT status FROM devices WHERE id=$1", deviceID).Scan(&deviceStatus); err != nil || deviceStatus != "ERROR" {
		t.Fatalf("device status=%s err=%v", deviceStatus, err)
	}
	var stateCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tag_current_state WHERE tag_id=$1", tagID).Scan(&stateCount); err != nil || stateCount != 0 {
		t.Fatal("missing value fabricated while reporting a read failure")
	}
}

func TestAdministratorConnectivityDiagnostics(t *testing.T) {
	const token = "test-only-worker-diagnostics-token-minimum-32"
	t.Setenv("CONNECTIVITY_TOKEN", token)
	var forwarded int
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded++
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("worker token missing")
		}
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil || body["connection_id"] != "connection" || body["device_id"] != "device" || body["tag_id"] != "tag" {
			t.Error("invalid forwarded identifiers")
		}
		writeJSON(w, 200, map[string]any{"readings": []any{map[string]any{"tag_id": "tag", "raw": 12, "decoded": 12, "scaled": 1.2}}})
	}))
	defer worker.Close()
	t.Setenv("CONNECTIVITY_URL", worker.URL)
	pool := testutil.Database(t)
	handler := NewServer(pool, func(context.Context) bool { return true })
	call := func(path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", path, strings.NewReader(string(data)))
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	login := func(role string) *http.Cookie {
		name := auth.RandomID()
		if err := auth.Bootstrap(context.Background(), pool, name, "diagnostics-test-password-123"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(context.Background(), "UPDATE users SET role_id=$2,must_change_password=false WHERE username=$1", name, role); err != nil {
			t.Fatal(err)
		}
		response := call("/api/v1/auth/login", map[string]any{"username": name, "password": "diagnostics-test-password-123"}, nil)
		if response.Code != 200 {
			t.Fatal("login failed")
		}
		return response.Result().Cookies()[0]
	}
	admin, viewer := login("admin"), login("viewer")
	body := map[string]any{"device_id": "device", "tag_id": "tag"}
	path := "/api/v1/connections/connection/test-read"
	if got := call(path, body, nil).Code; got != 401 {
		t.Fatalf("anonymous=%d", got)
	}
	if got := call(path, body, viewer).Code; got != 403 {
		t.Fatalf("viewer=%d", got)
	}
	if forwarded != 0 {
		t.Fatal("unauthorized diagnostic reached worker")
	}
	result := call(path, body, admin)
	if result.Code != 200 || !strings.Contains(result.Body.String(), `"scaled":1.2`) {
		t.Fatalf("read=%d %s", result.Code, result.Body.String())
	}
	if got := call(path, map[string]any{"credentials": "forbidden"}, admin).Code; got != 422 {
		t.Fatalf("arbitrary config accepted: %d", got)
	}
	if forwarded != 1 {
		t.Fatal("invalid diagnostic reached worker")
	}
}
