package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
	"strings"
	"testing"
	"time"
)

func TestGrafanaRequiresCurrentRallyXIdentity(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	username := fmt.Sprintf("grafana-%d", time.Now().UnixNano())
	if err := auth.Bootstrap(ctx, pool, username, "grafana-initial-password-123"); err != nil {
		t.Fatal(err)
	}
	var received http.Header
	var path string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Clone()
		path = r.URL.RequestURI()
		w.Header().Set("Set-Cookie", "grafana_session=must-not-escape")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()
	t.Setenv("GRAFANA_URL", upstream.URL)
	handler := NewServer(pool, func(context.Context) bool { return true })
	call := func(method, target, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("X-WEBAUTH-USER", "spoofed-admin")
		req.Header.Set("X-WEBAUTH-ROLE", "Admin")
		req.Header.Set("Authorization", "Bearer fake")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	if w := call("GET", "/grafana/api/user", "", nil); w.Code != 401 {
		t.Fatalf("anonymous=%d", w.Code)
	}
	if received != nil {
		t.Fatal("anonymous request reached Grafana")
	}
	login := call("POST", "/api/v1/auth/login", fmt.Sprintf(`{"username":%q,"password":"grafana-initial-password-123"}`, username), nil)
	if login.Code != 200 {
		t.Fatal(login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	if w := call("GET", "/grafana/", "", cookie); w.Code != 403 {
		t.Fatalf("forced password=%d", w.Code)
	}
	if w := call("POST", "/api/v1/auth/password", `{"current_password":"grafana-initial-password-123","new_password":"grafana-changed-password-456"}`, cookie); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var userID string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", username).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"admin", "operator", "viewer"} {
		if _, err := pool.Exec(ctx, "UPDATE users SET role_id=$1 WHERE id=$2", role, userID); err != nil {
			t.Fatal(err)
		}
		w := call("GET", "/grafana/api/user?x=1", "", cookie)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", role, w.Code, w.Body.String())
		}
		want := "Viewer"
		if role == "admin" {
			want = "Editor"
		}
		if received.Get("X-WEBAUTH-USER") != userID || received.Get("X-WEBAUTH-ROLE") != want || received.Get("Authorization") != "" || received.Get("Cookie") != "" {
			t.Fatalf("bad forwarded identity: role=%s headers=%v", role, received)
		}
		if path != "/grafana/api/user?x=1" {
			t.Fatalf("path=%s", path)
		}
		if w.Header().Get("Set-Cookie") != "" {
			t.Fatal("Grafana independent session escaped proxy")
		}
	}
	req := httptest.NewRequest("POST", "/grafana/api/dashboards/db", strings.NewReader(`{}`))
	req.AddCookie(cookie)
	req.Header.Set("Origin", "https://other.example")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("cross-origin write=%d", w.Code)
	}
	if w := call("POST", "/api/v1/auth/logout", `{}`, cookie); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("GET", "/grafana/api/user", "", cookie); w.Code != 401 {
		t.Fatalf("logged out=%d", w.Code)
	}
}
