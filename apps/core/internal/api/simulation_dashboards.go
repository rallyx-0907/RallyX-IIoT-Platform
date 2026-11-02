package api

import (
	"net/http"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerSimulationDashboards(mux *http.ServeMux, s storage.Registry, hub *realtime.Hub) {
	reply := func(w http.ResponseWriter, status int, value any, err error, changed bool) {
		if err != nil {
			apiError(w, err)
			return
		}
		if status == 204 {
			w.WriteHeader(status)
		} else {
			writeJSON(w, status, value)
		}
		if changed {
			hub.Broadcast(map[string]string{"type": "dashboard"})
		}
	}
	mux.HandleFunc("GET /api/v1/dashboards", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.ListDashboards(r.Context())
		reply(w, 200, value, err, false)
	})
	mux.HandleFunc("GET /api/v1/dashboards/{id}", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.GetDashboard(r.Context(), r.PathValue("id"))
		reply(w, 200, value, err, false)
	})
	mux.HandleFunc("POST /api/v1/dashboards", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.DashboardCreate](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		value, err := s.CreateDashboard(r.Context(), in, auth.Current(r).ID)
		reply(w, 201, value, err, true)
	})
	mux.HandleFunc("PATCH /api/v1/dashboards/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.DashboardPatch](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		value, err := s.UpdateDashboard(r.Context(), r.PathValue("id"), in)
		reply(w, 200, value, err, true)
	})
	mux.HandleFunc("DELETE /api/v1/dashboards/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		err := s.DeleteDashboard(r.Context(), r.PathValue("id"))
		reply(w, 204, nil, err, true)
	})
}
