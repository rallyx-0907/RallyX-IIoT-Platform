package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestRegistryAuthenticationAndAudit(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	username := fmt.Sprintf("test-admin-%d", time.Now().UnixNano())
	if err := auth.Bootstrap(ctx, pool, username, "initial-test-password-123"); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(pool, func(context.Context) bool { return true })
	request := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if got := request("POST", "/api/v1/tags", `{}`, nil).Code; got != 401 {
		t.Fatalf("unauthenticated config status=%d", got)
	}
	login := request("POST", "/api/v1/auth/login", fmt.Sprintf(`{"username":%q,"password":"initial-test-password-123"}`, username), nil)
	if login.Code != 200 || len(login.Result().Cookies()) == 0 {
		t.Fatalf("login: %d %s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("session cookie missing security attributes")
	}
	if got := request("GET", "/api/v1/sites", "", cookie).Code; got != 403 {
		t.Fatalf("bootstrap password must be changed: %d", got)
	}
	changed := request("POST", "/api/v1/auth/password", `{"current_password":"initial-test-password-123","new_password":"changed-test-password-456"}`, cookie)
	if changed.Code != 200 {
		t.Fatalf("change password: %d %s", changed.Code, changed.Body.String())
	}
	if got := request("GET", "/api/v1/sites", "", cookie).Code; got != 200 {
		t.Fatalf("sites: %d", got)
	}
	bad := request("POST", "/api/v1/tags", `{"id":"bad-tag","asset_id":"missing-asset","key":"x","name":"X","datatype":"boolean"}`, cookie)
	if bad.Code != 422 {
		t.Fatalf("orphan tag status=%d body=%s", bad.Code, bad.Body.String())
	}
	bad = request("POST", "/api/v1/tags", `{"id":"bad-tag","asset_id":"demo-motor","key":"x","name":"X","datatype":"imaginary"}`, cookie)
	if bad.Code != 422 {
		t.Fatalf("invalid datatype status=%d", bad.Code)
	}
	id := fmt.Sprintf("test-tag-%d", time.Now().UnixNano())
	created := request("POST", "/api/v1/tags", fmt.Sprintf(`{"id":%q,"asset_id":"demo-motor","device_id":"demo-motor-device","key":%q,"name":"Test tag","datatype":"number","unit":"A"}`, id, id), cookie)
	if created.Code != 201 {
		t.Fatalf("create tag: %d %s", created.Code, created.Body.String())
	}
	duplicate := request("POST", "/api/v1/tags", fmt.Sprintf(`{"id":%q,"asset_id":"demo-motor","device_id":"demo-motor-device","key":%q,"name":"Test tag","datatype":"number"}`, id, id), cookie)
	if duplicate.Code != 409 {
		t.Fatalf("duplicate status=%d", duplicate.Code)
	}
	if got := request("GET", "/api/v1/tags/"+id+"/history?from=invalid", "", cookie).Code; got != 422 {
		t.Fatalf("invalid history range status=%d", got)
	}
	if got := request("GET", "/api/v1/tags/"+id+"/history?limit=50000", "", cookie).Code; got != 422 {
		t.Fatalf("unbounded history status=%d", got)
	}
	if got := request("GET", "/api/v1/tags/"+id+"/history", "", cookie).Code; got != 200 {
		t.Fatalf("empty history status=%d", got)
	}
	if got := request("GET", "/api/v1/assets", "", cookie).Code; got != 200 {
		t.Fatalf("asset summaries status=%d", got)
	}
	patched := request("PATCH", "/api/v1/tags/"+id, `{"scale":2,"stale_seconds":60,"mapping":{"address":0,"function":3}}`, cookie)
	if patched.Code != 200 {
		t.Fatalf("mapping update: %d %s", patched.Code, patched.Body.String())
	}
	createdUser := request("POST", "/api/v1/users", fmt.Sprintf(`{"username":%q,"password":"viewer-test-password-123","role":"viewer"}`, id), cookie)
	if createdUser.Code != 201 {
		t.Fatalf("create user: %d %s", createdUser.Code, createdUser.Body.String())
	}
	users := request("GET", "/api/v1/users", "", cookie)
	if users.Code != 200 || strings.Contains(users.Body.String(), "password_hash") || strings.Contains(users.Body.String(), "viewer-test-password-123") {
		t.Fatal("user list must never expose password material")
	}
	simulator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"available":true,"enabled":true,"run":false,"fault":false,"current":0,"value":25}`))
	}))
	defer simulator.Close()
	t.Setenv("NODE_RED_URL", simulator.URL)
	if got := request("GET", "/api/v1/simulator", "", cookie).Code; got != 200 {
		t.Fatalf("simulator proxy status=%d", got)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO rules(id,tag_id,name,type,threshold) VALUES($1,$2,'Test threshold','high',10)", id+"-rule", id); err != nil {
		t.Fatal(err)
	}
	var alarmID int64
	definition := fmt.Sprintf(`{"name":"API composite","enabled":true,"logic":"any","severity":"warning","activation_delay_ms":5000,"conditions":[{"tag_id":%q,"operator":"gt","threshold":10,"hysteresis":1}]}`, id)
	tested := request("POST", "/api/v1/rules/test", definition, cookie)
	if tested.Code != 200 || !strings.Contains(tested.Body.String(), `"known"`) {
		t.Fatalf("rule test: %d %s", tested.Code, tested.Body.String())
	}
	var sideEffects int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM rules r JOIN rule_conditions c ON c.rule_id=r.id WHERE r.name='API composite' AND c.tag_id=$1", id).Scan(&sideEffects); err != nil || sideEffects != 0 {
		t.Fatalf("test persisted rule: %d %v", sideEffects, err)
	}
	composite := request("POST", "/api/v1/rules", definition, cookie)
	if composite.Code != 201 {
		t.Fatalf("create composite: %d %s", composite.Code, composite.Body.String())
	}
	var saved map[string]any
	if err := json.Unmarshal(composite.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if got := request("GET", "/api/v1/rules/"+saved["id"].(string), "", cookie); got.Code != 200 || !strings.Contains(got.Body.String(), `"conditions"`) {
		t.Fatalf("read composite: %d %s", got.Code, got.Body.String())
	}
	if err := pool.QueryRow(ctx, "INSERT INTO alarms(rule_id,asset_id,activated_at,severity) VALUES($1,'demo-motor',now(),'warning') RETURNING id", id+"-rule").Scan(&alarmID); err != nil {
		t.Fatal(err)
	}
	var audit int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE resource=$1 AND action='create:tags'", id).Scan(&audit); err != nil || audit != 1 {
		t.Fatalf("audit=%d err=%v", audit, err)
	}
	tree := request("GET", "/api/v1/assets/tree", "", cookie)
	var sites []map[string]any
	if tree.Code != 200 || json.Unmarshal(tree.Body.Bytes(), &sites) != nil || len(sites) == 0 {
		t.Fatalf("invalid asset tree: %s", tree.Body.String())
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET role_id='viewer' WHERE username=$1", username); err != nil {
		t.Fatal(err)
	}
	if got := request("PATCH", "/api/v1/tags/"+id, `{"unit":"mA"}`, cookie).Code; got != 403 {
		t.Fatalf("viewer write status=%d", got)
	}
	if got := request("POST", "/api/v1/rules/test", definition, cookie).Code; got != 403 {
		t.Fatalf("viewer rule test status=%d", got)
	}
	if got := request("GET", "/api/v1/assets/demo-motor/tags", "", cookie).Code; got != 200 {
		t.Fatalf("viewer read status=%d", got)
	}
	if got := request("GET", "/api/v1/simulator", "", cookie).Code; got != 403 {
		t.Fatalf("viewer simulator status=%d", got)
	}
	ackPath := fmt.Sprintf("/api/v1/alarms/%d/ack", alarmID)
	if got := request("POST", ackPath, `{}`, cookie).Code; got != 403 {
		t.Fatalf("viewer alarm ack status=%d", got)
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET role_id='operator' WHERE username=$1", username); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if got := request("POST", ackPath, `{}`, cookie).Code; got != 200 {
			t.Fatalf("operator ack status=%d", got)
		}
	}
	var acknowledgements int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE action='ack:alarm' AND resource=$1", fmt.Sprint(alarmID)).Scan(&acknowledgements); err != nil || acknowledgements != 1 {
		t.Fatalf("ack audit=%d err=%v", acknowledgements, err)
	}
	logout := request("POST", "/api/v1/auth/logout", "", cookie)
	if logout.Code != 200 {
		t.Fatalf("logout=%d", logout.Code)
	}
	if got := request("GET", "/api/v1/sites", "", cookie).Code; got != 401 {
		t.Fatalf("revoked session status=%d", got)
	}
}
