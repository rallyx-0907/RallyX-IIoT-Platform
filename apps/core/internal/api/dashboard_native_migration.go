package api

import (
	"net/http"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerDashboardNativeMigration(mux *http.ServeMux, registry storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("POST /api/v1/dashboard-boards/{id}/migrate-native", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		ctx := storage.WithEntityActor(r.Context(), auth.Current(r).ID)
		result, err := registry.MigrateDashboardBoardToNative(ctx, auth.Current(r).ID, r.PathValue("id"))
		platformReply(w, hub, result, err, true)
	})
}
