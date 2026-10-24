package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestDynamicConfigurationCSVAndPersonalDashboardAPI(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-only-api-installation-encryption-key-32-minimum")
	pool := testutil.Database(t)
	ctx := context.Background()
	handler := NewServer(pool, func(context.Context) bool { return true })
	call := func(method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	login := func(role string) *http.Cookie {
		t.Helper()
		name := auth.RandomID()
		if err := auth.Bootstrap(ctx, pool, name, "extension-api-test-password-123"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "UPDATE users SET role_id=$2,must_change_password=false WHERE username=$1", name, role); err != nil {
			t.Fatal(err)
		}
		response := call("POST", "/api/v1/auth/login", map[string]any{"username": name, "password": "extension-api-test-password-123"}, nil)
		if response.Code != 200 || len(response.Result().Cookies()) == 0 {
			t.Fatal("fixture login failed")
		}
		return response.Result().Cookies()[0]
	}
	admin := login("admin")
	create := func(path string, body map[string]any) map[string]any {
		t.Helper()
		response := call("POST", "/api/v1"+path, body, admin)
		if response.Code != 201 {
			t.Fatalf("create %s: %d %s", path, response.Code, response.Body.String())
		}
		var result map[string]any
		if json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal("invalid resource JSON")
		}
		return result
	}
	connection := create("/connections", map[string]any{"site_id": "demo-site", "name": auth.RandomID(), "protocol": "simulator", "credentials": map[string]any{"username": "fixture-user", "password": "fixture-secret-never-return"}})
	if _, exposed := connection["credentials"]; exposed {
		t.Fatal("credentials exposed")
	}
	template := create("/templates", map[string]any{"name": auth.RandomID(), "protocol": "simulator", "tag_definitions": []any{map[string]any{"key": "value", "name": "Value", "data_type": "float32"}}})
	device := create("/devices", map[string]any{"asset_id": "demo-motor", "connection_id": connection["id"], "template_id": template["id"], "name": auth.RandomID()})
	deviceID := device["id"].(string)
	tags := call("GET", "/api/v1/devices/"+deviceID+"/tags", nil, admin)
	if tags.Code != 200 {
		t.Fatal("device tags unavailable")
	}
	var tagRows []map[string]any
	if json.Unmarshal(tags.Body.Bytes(), &tagRows) != nil || len(tagRows) != 1 {
		t.Fatal("template tag not instantiated")
	}
	tagID := tagRows[0]["id"].(string)
	if response := call("PATCH", "/api/v1/tags/"+tagID, map[string]any{"poll_interval_ms": 1500}, admin); response.Code != 200 {
		t.Fatalf("set poll override: %d %s", response.Code, response.Body.String())
	}
	if response := call("PATCH", "/api/v1/tags/"+tagID, map[string]any{"poll_interval_ms": nil}, admin); response.Code != 200 {
		t.Fatalf("clear poll override: %d %s", response.Code, response.Body.String())
	}
	var override *int
	if err := pool.QueryRow(ctx, "SELECT poll_interval_ms FROM tags WHERE id=$1", tagID).Scan(&override); err != nil || override != nil {
		t.Fatalf("poll override not cleared: %v %v", override, err)
	}
	tree := call("GET", "/api/v1/assets/tree", nil, admin)
	if tree.Code != 200 || strings.Contains(tree.Body.String(), `"panels":`) || !strings.Contains(tree.Body.String(), deviceID) {
		t.Fatal("active hierarchy is not device-oriented")
	}
	csv := fmt.Sprintf("device,tag,address,data_type,unit,scale,store_history\n%s,csv_value,0,float32,A,1,true\n", deviceID)
	preview := call("POST", "/api/v1/config/import/preview", map[string]any{"csv": csv}, admin)
	if preview.Code != 200 {
		t.Fatalf("preview: %d %s", preview.Code, preview.Body.String())
	}
	imported := call("POST", "/api/v1/config/import", map[string]any{"csv": csv}, admin)
	if imported.Code != 201 {
		t.Fatalf("import: %d %s", imported.Code, imported.Body.String())
	}
	exported := call("GET", "/api/v1/config/tags.csv?device_id="+deviceID, nil, admin)
	if exported.Code != 200 || !strings.Contains(exported.Header().Get("Content-Type"), "text/csv") || !strings.Contains(exported.Body.String(), "csv_value") {
		t.Fatal("CSV export failed")
	}
	viewer := login("viewer")
	if got := call("POST", "/api/v1/config/import/preview", map[string]any{"csv": csv}, viewer).Code; got != 403 {
		t.Fatalf("viewer import status=%d", got)
	}
	widget := call("POST", "/api/v1/dashboard", map[string]any{"tag_id": tagRows[0]["id"], "type": "value", "title": "Pinned value"}, viewer)
	if widget.Code != 201 {
		t.Fatalf("viewer personal pin: %d %s", widget.Code, widget.Body.String())
	}
	list := call("GET", "/api/v1/dashboard", nil, viewer)
	if list.Code != 200 || !strings.Contains(list.Body.String(), "Pinned value") {
		t.Fatal("pinned widget did not persist")
	}
	adminList := call("GET", "/api/v1/dashboard", nil, admin)
	if adminList.Code != 200 || strings.Contains(adminList.Body.String(), "Pinned value") {
		t.Fatal("dashboard scope is not per user")
	}
	deletePath := "/api/v1/devices/" + deviceID
	if got := call("DELETE", deletePath, map[string]any{"confirm": true, "history_policy": "retain"}, viewer).Code; got != 403 {
		t.Fatalf("viewer delete status=%d", got)
	}
	if got := call("DELETE", deletePath, map[string]any{}, admin).Code; got != 422 {
		t.Fatalf("missing delete confirmation status=%d", got)
	}
	deleted := call("DELETE", deletePath, map[string]any{"confirm": true, "history_policy": "retain"}, admin)
	if deleted.Code != 200 {
		t.Fatalf("archive device: %d %s", deleted.Code, deleted.Body.String())
	}
	devices := call("GET", "/api/v1/devices", nil, admin)
	if devices.Code != 200 || strings.Contains(devices.Body.String(), deviceID) {
		t.Fatal("archived device remains in active configuration")
	}
}
