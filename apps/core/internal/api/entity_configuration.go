package api

import (
	"net/http"
	"strconv"

	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func registerEntityConfiguration(mux *http.ServeMux, s storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("GET /api/v1/entity-profiles", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.ListEntityProfiles(r.Context())
		platformReply(w, hub, v, e, false)
	})
	saveProfile := func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, e := platformBody[storage.EntityProfileInput](w, r)
		if e != nil {
			apiError(w, e)
			return
		}
		v, e := s.SaveEntityProfile(r.Context(), r.PathValue("id"), in)
		platformReply(w, hub, v, e, true)
	}
	mux.HandleFunc("POST /api/v1/entity-profiles", saveProfile)
	mux.HandleFunc("PUT /api/v1/entity-profiles/{id}", saveProfile)
	mux.HandleFunc("GET /api/v1/entities/{id}/metrics", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.EntityMetrics(r.Context(), r.PathValue("id"))
		platformReply(w, hub, v, e, false)
	})
	mux.HandleFunc("GET /api/v1/entities/{id}/bindings", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.ListEntityBindings(r.Context(), r.PathValue("id"))
		platformReply(w, hub, v, e, false)
	})
	mux.HandleFunc("PUT /api/v1/entities/{id}/bindings", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, e := platformBody[struct {
			Revision int               `json:"revision"`
			Bindings map[string]string `json:"bindings"`
		}](w, r)
		if e != nil {
			apiError(w, e)
			return
		}
		v, e := s.SaveEntityBindings(r.Context(), r.PathValue("id"), in.Revision, in.Bindings)
		platformReply(w, hub, v, e, true)
	})
	mux.HandleFunc("GET /api/v1/entity-sources", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		limit, offset := 100, 0
		var e error
		if q := r.URL.Query().Get("limit"); q != "" {
			limit, e = strconv.Atoi(q)
		}
		if e == nil {
			if q := r.URL.Query().Get("offset"); q != "" {
				offset, e = strconv.Atoi(q)
			}
		}
		if e != nil {
			apiError(w, storage.ErrValidation)
			return
		}
		v, e := s.EntitySources(r.Context(), r.URL.Query().Get("search"), limit, offset)
		platformReply(w, hub, v, e, false)
	})
	mux.HandleFunc("GET /api/v1/entity-dashboard-templates", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.ListEntityDashboards(r.Context())
		platformReply(w, hub, v, e, false)
	})
	mux.HandleFunc("GET /api/v1/entity-dashboard-templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.GetEntityDashboard(r.Context(), r.PathValue("id"))
		platformReply(w, hub, v, e, false)
	})
	saveTemplate := func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, e := platformBody[storage.EntityDashboardInput](w, r)
		if e != nil {
			apiError(w, e)
			return
		}
		v, e := s.SaveEntityDashboard(r.Context(), r.PathValue("id"), in)
		platformReply(w, hub, v, e, true)
	}
	mux.HandleFunc("POST /api/v1/entity-dashboard-templates", saveTemplate)
	mux.HandleFunc("PUT /api/v1/entity-dashboard-templates/{id}", saveTemplate)
	mux.HandleFunc("PUT /api/v1/entities/{id}/dashboard-assignment", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, e := platformBody[storage.DashboardVersion](w, r)
		if e != nil {
			apiError(w, e)
			return
		}
		e = s.AssignEntityDashboard(r.Context(), r.PathValue("id"), in.TemplateID, in.TemplateVersion, in.Revision)
		platformReply(w, hub, map[string]bool{"saved": e == nil}, e, true)
	})
}
