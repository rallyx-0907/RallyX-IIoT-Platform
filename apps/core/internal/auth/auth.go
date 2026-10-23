package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID                 string `json:"id"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}
type contextKey struct{}
type attempt struct {
	Count int
	Until time.Time
}
type Manager struct {
	Pool      *pgxpool.Pool
	mu        sync.Mutex
	attempts  map[string]attempt
	ProxyHost string
}

func New(pool *pgxpool.Pool) *Manager {
	return &Manager{Pool: pool, attempts: make(map[string]attempt), ProxyHost: os.Getenv("TRUSTED_PROXY_HOST")}
}
func Current(r *http.Request) User { u, _ := r.Context().Value(contextKey{}).(User); return u }
func RandomID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func digest(token string) string { h := sha256.Sum256([]byte(token)); return hex.EncodeToString(h[:]) }

func Bootstrap(ctx context.Context, pool *pgxpool.Pool, username, password string) error {
	if len(username) == 0 || len(username) > 64 || len(password) < 16 || len(password) > 72 || strings.Contains(password, "CHANGE_ME") {
		return errors.New("bootstrap requires username and a unique 16–72 byte password")
	}
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE username=$1)", username).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, "INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$2,$3,'admin') ON CONFLICT(username) DO NOTHING", RandomID(), username, string(hash))
	return err
}

func fail(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": message, "message": strings.ReplaceAll(message, "_", " ")}})
}
func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func (m *Manager) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
					fail(w, 403, "origin_rejected")
					return
				}
			}
		}
		if r.URL.Path == "/api/v1/auth/login" {
			m.Login(w, r)
			return
		}
		cookie, err := r.Cookie("rallyx_session")
		if err != nil {
			fail(w, 401, "authentication_required")
			return
		}
		var user User
		err = m.Pool.QueryRow(r.Context(), `SELECT u.id,u.username,u.role_id,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled`, digest(cookie.Value)).Scan(&user.ID, &user.Username, &user.Role, &user.MustChangePassword)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				fail(w, 401, "session_expired")
			} else {
				fail(w, 503, "authentication_unavailable")
			}
			return
		}
		if user.MustChangePassword && r.URL.Path != "/api/v1/auth/password" && r.URL.Path != "/api/v1/auth/me" && r.URL.Path != "/api/v1/auth/logout" {
			fail(w, 403, "password_change_required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, user)))
	})
}

func (m *Manager) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		fail(w, 405, "method_not_allowed")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil || len(body.Password) > 72 || len(body.Username) > 64 {
		fail(w, 422, "invalid_credentials_format")
		return
	}
	ip := m.clientAddress(r)
	if !m.allowAttempt(ip, body.Username) {
		fail(w, 429, "too_many_attempts")
		return
	}
	var user User
	var hash string
	err := m.Pool.QueryRow(r.Context(), "SELECT id,username,role_id,must_change_password,password_hash FROM users WHERE username=$1 AND enabled", body.Username).Scan(&user.ID, &user.Username, &user.Role, &user.MustChangePassword, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 503, "authentication_unavailable")
		return
	}
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		fail(w, 401, "invalid_credentials")
		return
	}
	token := RandomID()
	expires := time.Now().Add(12 * time.Hour)
	if _, err = m.Pool.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", digest(token), user.ID, expires); err != nil {
		fail(w, 503, "authentication_unavailable")
		return
	}
	m.loginSucceeded(ip, body.Username)
	http.SetCookie(w, &http.Cookie{Name: "rallyx_session", Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteStrictMode, Expires: expires})
	respond(w, user)
}

func (m *Manager) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) { respond(w, Current(r)) })
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		cookie, _ := r.Cookie("rallyx_session")
		if _, err := m.Pool.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", digest(cookie.Value)); err != nil {
			fail(w, 503, "logout_unavailable")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "rallyx_session", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		respond(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/v1/auth/password", m.Password)
}

func (m *Manager) SessionValid(r *http.Request) bool {
	cookie, err := r.Cookie("rallyx_session")
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var valid bool
	err = m.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled AND NOT u.must_change_password)", digest(cookie.Value)).Scan(&valid)
	return err == nil && valid
}

func (m *Manager) Password(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil || len(body.New) < 16 || len(body.New) > 72 || body.New == body.Current {
		fail(w, 422, "password_requires_16_to_72_bytes_and_must_differ")
		return
	}
	u := Current(r)
	var hash string
	if err := m.Pool.QueryRow(r.Context(), "SELECT password_hash FROM users WHERE id=$1", u.ID).Scan(&hash); err != nil {
		fail(w, 503, "authentication_unavailable")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Current)) != nil {
		fail(w, 401, "invalid_current_password")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(body.New), 12)
	if err != nil {
		fail(w, 500, "password_update_failed")
		return
	}
	tx, err := m.Pool.Begin(r.Context())
	if err != nil {
		fail(w, 503, "authentication_unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2", string(newHash), u.ID)
	if err == nil {
		cookie, _ := r.Cookie("rallyx_session")
		_, err = tx.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", u.ID, digest(cookie.Value))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'change:password',$1)", u.ID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, 500, "password_update_failed")
		return
	}
	u.MustChangePassword = false
	respond(w, u)
}
