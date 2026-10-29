package api

import (
	"context"
	"net/http"
	"time"

	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerEntityRuntime(mux *http.ServeMux, s storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("POST /api/v1/entities/{id}/dashboard-runtime", func(w http.ResponseWriter, r *http.Request) {
		in, err := platformBody[storage.RuntimeInput](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		if in.Document != nil && !platformAdmin(w, r) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		value, err := s.DashboardRuntime(ctx, r.PathValue("id"), in)
		platformReply(w, hub, value, err, false)
	})
}
