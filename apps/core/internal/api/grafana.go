package api

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"rallyx.local/core/internal/auth"
	"strings"
	"time"
)

func registerGrafana(root, mux *http.ServeMux, manager *auth.Manager) {
	target, err := url.Parse(os.Getenv("GRAFANA_URL"))
	enabled := err == nil && (target.Scheme == "http" || target.Scheme == "https") && target.Host != "" && target.User == nil && (target.Path == "" || target.Path == "/") && target.RawQuery == ""
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			user := auth.Current(pr.In)
			pr.SetURL(target)
			pr.Out.Host = pr.In.Host
			for key := range pr.Out.Header {
				if strings.HasPrefix(strings.ToLower(key), "x-webauth-") || strings.HasPrefix(strings.ToLower(key), "x-grafana-") {
					pr.Out.Header.Del(key)
				}
			}
			pr.Out.Header.Del("Authorization")
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Set("X-WEBAUTH-USER", user.ID)
			pr.Out.Header.Set("X-WEBAUTH-NAME", user.Username)
			role := "Viewer"
			if user.Role == "admin" {
				role = "Editor"
			}
			pr.Out.Header.Set("X-WEBAUTH-ROLE", role)
			pr.SetXForwarded()
			if proto := pr.In.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
				pr.Out.Header.Set("X-Forwarded-Proto", proto)
			}
		},
		ModifyResponse: func(r *http.Response) error {
			r.Header.Del("Set-Cookie")
			r.Header.Set("Cache-Control", "no-store")
			r.Header.Set("X-Frame-Options", "SAMEORIGIN")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, 503, "grafana_unavailable", "Grafana is temporarily unavailable")
		},
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConns: 10, MaxIdleConnsPerHost: 5, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 60 * time.Second},
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !enabled {
			writeError(w, 503, "grafana_disabled", "Grafana is not configured")
			return
		}
		if r.URL.Path == "/grafana" {
			http.Redirect(w, r, "/grafana/", http.StatusTemporaryRedirect)
			return
		}
		// PostgreSQL dashboards use HTTP polling. Do not retain a live socket after RallyX logout.
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			writeError(w, 403, "unsupported_stream", "Grafana live streaming is disabled")
			return
		}
		proxy.ServeHTTP(w, r)
	})
	root.Handle("/grafana", manager.Wrap(handler))
	root.Handle("/grafana/", manager.Wrap(handler))
	mux.HandleFunc("GET /api/v1/grafana/status", func(w http.ResponseWriter, r *http.Request) {
		available := false
		if enabled {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(target.String(), "/")+"/api/health", nil)
			res, e := (&http.Client{Timeout: 2 * time.Second}).Do(req)
			if e == nil {
				available = res.StatusCode == 200
				res.Body.Close()
			}
		}
		writeJSON(w, 200, map[string]any{"enabled": enabled, "available": available, "url": "/grafana/d/rallyx-overview/rallyx", "can_edit": auth.Current(r).Role == "admin"})
	})
}
