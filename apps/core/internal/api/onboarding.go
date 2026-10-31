package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
	"strings"
	"time"
)

func registerOnboarding(mux *http.ServeMux, s storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("GET /api/v1/onboarding/devices/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		value, err := s.OnboardingDevice(r.Context(), r.PathValue("id"))
		platformReply(w, hub, value, err, false)
	})
	mux.HandleFunc("POST /api/v1/onboarding/complete", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.OnboardingInput](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		result, err := s.CompleteOnboarding(r.Context(), in, auth.Current(r).ID)
		platformReply(w, hub, result, err, true)
	})
	mux.HandleFunc("POST /api/v1/onboarding/preview", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.OnboardingInput](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		plan, err := s.PrepareOnboarding(r.Context(), in)
		if err != nil {
			apiError(w, err)
			return
		}
		base := strings.TrimRight(os.Getenv("CONNECTIVITY_URL"), "/")
		token := os.Getenv("CONNECTIVITY_TOKEN")
		if base == "" || len(token) < 32 {
			writeError(w, 503, "connectivity_unavailable", "Dịch vụ kết nối chưa sẵn sàng")
			return
		}
		payload, _ := json.Marshal(plan)
		req, err := http.NewRequestWithContext(r.Context(), "POST", base+"/internal/test/preview", bytes.NewReader(payload))
		if err != nil {
			apiError(w, err)
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		client := http.Client{Timeout: 40 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(req)
		if err != nil {
			writeError(w, 502, "connectivity_failed", "Thiết bị không phản hồi — kiểm tra IP, cáp mạng và mã thiết bị")
			return
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			writeError(w, 502, "connectivity_failed", "Thiết bị không phản hồi — kiểm tra địa chỉ, mạng và mã thiết bị")
			return
		}
		var result struct {
			Connected bool              `json:"connected"`
			ElapsedMS int64             `json:"elapsed_ms"`
			Readings  []json.RawMessage `json:"readings,omitempty"`
			Fields    []json.RawMessage `json:"fields,omitempty"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 2097152)).Decode(&result) != nil {
			writeError(w, 502, "connectivity_failed", "Không đọc được phản hồi từ thiết bị")
			return
		}
		writeJSON(w, 200, result)
	})
	mux.HandleFunc("GET /api/v1/templates/{id}/semantic-profile", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.TemplateSemanticInfo(r.Context(), r.PathValue("id"))
		platformReply(w, hub, value, err, false)
	})
}
