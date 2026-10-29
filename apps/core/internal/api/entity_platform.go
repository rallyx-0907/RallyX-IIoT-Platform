package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/storage"
)

func platformBody[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	var out T
	body, err := readObject(w, r)
	if err != nil {
		return out, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return out, storage.ErrValidation
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&out) != nil {
		return out, storage.ErrValidation
	}
	return out, nil
}
func platformAdmin(w http.ResponseWriter, r *http.Request) bool {
	if auth.Current(r).Role != "admin" {
		writeError(w, 403, "forbidden", "Administrator role required")
		return false
	}
	return true
}
func platformReply(w http.ResponseWriter, hub *realtime.Hub, value any, err error, changed bool) {
	if err != nil {
		apiError(w, err)
		return
	}
	writeJSON(w, 200, value)
	if changed {
		hub.Broadcast(map[string]any{"type": "configuration"})
	}
}
func registerEntityPlatform(mux *http.ServeMux, s storage.Registry, hub *realtime.Hub) {
	mux.HandleFunc("GET /api/v1/entity-types", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.ListEntityTypes(r.Context())
		platformReply(w, hub, value, err, false)
	})
	mux.HandleFunc("PUT /api/v1/entity-types/{key}", func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.EntityTypeInput](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		value, err := s.SaveEntityType(r.Context(), r.PathValue("key"), in)
		platformReply(w, hub, value, err, true)
	})
	mux.HandleFunc("GET /api/v1/entities", func(w http.ResponseWriter, r *http.Request) {
		limit, offset := 100, 0
		var err error
		if v := r.URL.Query().Get("limit"); v != "" {
			limit, err = strconv.Atoi(v)
		}
		if err == nil {
			if v := r.URL.Query().Get("offset"); v != "" {
				offset, err = strconv.Atoi(v)
			}
		}
		if err != nil {
			apiError(w, storage.ErrValidation)
			return
		}
		value, err := s.ListEntities(r.Context(), r.URL.Query().Get("parent"), r.URL.Query().Get("search"), limit, offset)
		platformReply(w, hub, value, err, false)
	})
	mux.HandleFunc("GET /api/v1/entities/{id}", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.GetEntity(r.Context(), r.PathValue("id"))
		platformReply(w, hub, value, err, false)
	})
	mux.HandleFunc("GET /api/v1/entities/{id}/context", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.EntityContext(r.Context(), r.PathValue("id"))
		platformReply(w, hub, value, err, false)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		if !platformAdmin(w, r) {
			return
		}
		in, err := platformBody[storage.EntityInput](w, r)
		if err != nil {
			apiError(w, err)
			return
		}
		value, err := s.SaveEntity(r.Context(), r.PathValue("id"), in)
		platformReply(w, hub, value, err, true)
	}
	mux.HandleFunc("POST /api/v1/entities", save)
	mux.HandleFunc("PUT /api/v1/entities/{id}", save)
}
