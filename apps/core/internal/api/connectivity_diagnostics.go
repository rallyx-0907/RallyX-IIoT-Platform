package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/storage"
)

func registerConnectivityDiagnostics(mux *http.ServeMux) {
	for _, operation := range []string{"connection", "read"} {
		path := "/api/v1/connections/{id}/test"
		if operation == "read" {
			path += "-read"
		}
		mux.HandleFunc("POST "+path, func(w http.ResponseWriter, r *http.Request) {
			if auth.Current(r).Role != "admin" {
				writeError(w, 403, "forbidden", "Administrator role required")
				return
			}
			body, err := readObject(w, r)
			if err != nil {
				apiError(w, err)
				return
			}
			for key, value := range body {
				if key != "device_id" && key != "tag_id" {
					apiError(w, storage.ErrValidation)
					return
				}
				if text, ok := value.(string); !ok || text == "" || len(text) > 64 {
					apiError(w, storage.ErrValidation)
					return
				}
			}
			if operation == "read" && (body["device_id"] == nil || body["tag_id"] == nil) {
				apiError(w, storage.ErrValidation)
				return
			}
			token := os.Getenv("CONNECTIVITY_TOKEN")
			base := strings.TrimRight(os.Getenv("CONNECTIVITY_URL"), "/")
			if len(token) < 32 || strings.Contains(token, "CHANGE_ME") || base == "" {
				writeError(w, 503, "connectivity_unavailable", "Connectivity service is not configured")
				return
			}
			body["connection_id"] = r.PathValue("id")
			payload, _ := json.Marshal(body)
			req, err := http.NewRequestWithContext(r.Context(), "POST", base+"/internal/test/"+operation, bytes.NewReader(payload))
			if err != nil {
				writeError(w, 503, "connectivity_unavailable", "Connectivity service is unavailable")
				return
			}
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			client := http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			response, err := client.Do(req)
			if err != nil {
				writeError(w, 502, "connectivity_failed", "Connectivity operation failed")
				return
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				code := 502
				if response.StatusCode == 404 || response.StatusCode == 422 {
					code = response.StatusCode
				}
				writeError(w, code, "connectivity_failed", "Connectivity operation failed")
				return
			}
			var result struct {
				Connected bool `json:"connected,omitempty"`
				Readings  []struct {
					TagID   string `json:"tag_id"`
					Raw     any    `json:"raw"`
					Decoded any    `json:"decoded"`
					Scaled  any    `json:"scaled"`
				} `json:"readings,omitempty"`
			}
			if json.NewDecoder(io.LimitReader(response.Body, 262144)).Decode(&result) != nil {
				writeError(w, 502, "connectivity_failed", "Invalid connectivity response")
				return
			}
			writeJSON(w, 200, result)
		})
	}
}
