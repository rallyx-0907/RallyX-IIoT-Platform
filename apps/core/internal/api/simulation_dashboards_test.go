package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestSimulationDashboardAPI(t *testing.T) {
	t.Setenv("SESSION_SECRET", "simulation-dashboard-test-secret-32-minimum")
	pool := testutil.Database(t)
	ctx := context.Background()
	handler := NewServer(pool, func(context.Context) bool { return true })
	call := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
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
		if err := auth.Bootstrap(ctx, pool, name, "dashboard-test-password-123"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "UPDATE users SET role_id=$2,must_change_password=false WHERE username=$1", name, role); err != nil {
			t.Fatal(err)
		}
		w := call("POST", "/auth/login", `{"username":"`+name+`","password":"dashboard-test-password-123"}`, nil)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		return w.Result().Cookies()[0]
	}
	admin, viewer, operator := login("admin"), login("viewer"), login("operator")
	server := httptest.NewServer(handler)
	defer server.Close()
	streamCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	stream, _, err := websocket.Dial(streamCtx, strings.Replace(server.URL, "http://", "ws://", 1)+"/api/v1/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": []string{admin.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.CloseNow()
	if _, _, err = stream.Read(streamCtx); err != nil {
		t.Fatal(err)
	}
	assertDashboardEvent := func() {
		t.Helper()
		_, raw, err := stream.Read(streamCtx)
		if err != nil || string(raw) != `{"type":"dashboard"}` {
			t.Fatalf("dashboard notification: %s %v", raw, err)
		}
	}
	if w := call("GET", "/dashboards", "", nil); w.Code != 401 {
		t.Fatal("unauthenticated", w.Code)
	}
	for _, cookie := range []*http.Cookie{viewer, operator} {
		if w := call("POST", "/dashboards", `{"name":"Forbidden","type":"simulation"}`, cookie); w.Code != 403 {
			t.Fatal("role write allowed", w.Code)
		}
	}
	if w := call("POST", "/dashboards", `{"name":"Bad","type":"other"}`, admin); w.Code != 422 {
		t.Fatal("type accepted", w.Code)
	}
	w := call("POST", "/dashboards", `{"name":"Cabinet API","type":"simulation"}`, admin)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	assertDashboardEvent()
	var d struct {
		ID       string `json:"id"`
		Revision int    `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	for _, cookie := range []*http.Cookie{viewer, operator} {
		if w := call("GET", "/dashboards/"+d.ID, "", cookie); w.Code != 200 {
			t.Fatal("view forbidden", w.Code)
		}
		if w := call("PATCH", "/dashboards/"+d.ID, `{"name":"No","revision":1}`, cookie); w.Code != 403 {
			t.Fatal(w.Code)
		}
		if w := call("DELETE", "/dashboards/"+d.ID, "", cookie); w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
	if w := call("PATCH", "/dashboards/"+d.ID, `{"name":"Renamed","revision":1}`, admin); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	assertDashboardEvent()
	if w := call("PATCH", "/dashboards/"+d.ID, `{"name":"Overwrite","revision":1}`, admin); w.Code != 409 {
		t.Fatal("conflict not detected", w.Code)
	}
	if w := call("PATCH", "/dashboards/"+d.ID, `{"revision":2,"unexpected":true}`, admin); w.Code != 422 {
		t.Fatal("unknown accepted", w.Code)
	}
	if w := call("GET", "/dashboards", "", viewer); w.Code != 200 || !strings.Contains(w.Body.String(), "Renamed") {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call("DELETE", "/dashboards/"+d.ID, "", admin); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	assertDashboardEvent()
	if w := call("GET", "/dashboards/"+d.ID, "", admin); w.Code != 404 {
		t.Fatal(w.Code)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE resource=$1 AND action IN ('dashboard.create','dashboard.update','dashboard.delete') AND user_id IS NOT NULL", d.ID).Scan(&count); err != nil || count != 3 {
		t.Fatal("audit missing", count, err)
	}
	// Parent flags remain explicit even when a last GOOD sample is still fresh.
	assetID, deviceID, tagID := auth.RandomID(), auth.RandomID(), auth.RandomID()
	if _, err := pool.Exec(ctx, "INSERT INTO assets(id,panel_id,area_id,name) SELECT $1,panel_id,area_id,$1 FROM assets WHERE id='demo-motor'", assetID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO devices(id,connection_id,asset_id,name) VALUES($1,'demo-simulator',$2,$1)", deviceID, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type) VALUES($1,$2,$3,$1,$1,'number','float64')", tagID, assetID, deviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO tag_current_state(tag_id,value,quality,ts) VALUES($1,'12','GOOD',now())", tagID); err != nil {
		t.Fatal(err)
	}
	assertParentFlags := func(deviceEnabled, assetEnabled bool) {
		t.Helper()
		w := call("GET", "/tags", "", viewer)
		var rows []map[string]any
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &rows) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		for _, row := range rows {
			if row["id"] == tagID {
				if row["device_enabled"] != deviceEnabled || row["asset_enabled"] != assetEnabled || row["quality"] != "GOOD" {
					t.Fatal("parent availability missing", row)
				}
				return
			}
		}
		t.Fatal("tag missing")
	}
	assertParentFlags(true, true)
	if _, err := pool.Exec(ctx, "UPDATE devices SET enabled=false WHERE id=$1", deviceID); err != nil {
		t.Fatal(err)
	}
	assertParentFlags(false, true)
	if _, err := pool.Exec(ctx, "UPDATE assets SET enabled=false WHERE id=$1", assetID); err != nil {
		t.Fatal(err)
	}
	assertParentFlags(false, false)
}
