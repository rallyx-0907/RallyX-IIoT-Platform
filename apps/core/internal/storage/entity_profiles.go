package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"rallyx.local/core/internal/auth"
)

type MetricDefinition struct {
	Key       string   `json:"key"`
	Name      string   `json:"name"`
	DataType  string   `json:"data_type"`
	Unit      string   `json:"unit"`
	Precision int      `json:"precision"`
	Min       *float64 `json:"min,omitempty"`
	Max       *float64 `json:"max,omitempty"`
	History   bool     `json:"history"`
}
type EntityProfileInput struct {
	Name                   string             `json:"name"`
	Metrics                []MetricDefinition `json:"metrics"`
	Revision               int                `json:"revision"`
	DefaultTemplateID      string             `json:"default_template_id"`
	DefaultTemplateVersion int                `json:"default_template_version"`
}
type EntityProfile struct {
	ID                     string             `json:"id"`
	Name                   string             `json:"name"`
	Revision               int                `json:"revision"`
	Metrics                []MetricDefinition `json:"metrics"`
	DefaultTemplateID      *string            `json:"default_template_id"`
	DefaultTemplateVersion *int               `json:"default_template_version"`
}

func validateMetrics(metrics []MetricDefinition) error {
	if len(metrics) < 1 || len(metrics) > 128 {
		return fmt.Errorf("%w: profile needs 1–128 metrics", ErrValidation)
	}
	seen := map[string]bool{}
	for _, m := range metrics {
		if !semanticKey.MatchString(m.Key) || seen[m.Key] || strings.TrimSpace(m.Name) == "" || utf8.RuneCountInString(m.Name) > 160 || len(m.Unit) > 32 || m.Precision < 0 || m.Precision > 6 {
			return fmt.Errorf("%w: invalid or duplicate metric %s", ErrValidation, m.Key)
		}
		seen[m.Key] = true
		if m.DataType != "number" && m.DataType != "boolean" && m.DataType != "string" {
			return fmt.Errorf("%w: invalid metric datatype", ErrValidation)
		}
		if m.Min != nil {
			if _, ok := finiteNumber(*m.Min); !ok {
				return ErrValidation
			}
		}
		if m.Max != nil {
			if _, ok := finiteNumber(*m.Max); !ok {
				return ErrValidation
			}
		}
		if m.Min != nil && m.Max != nil && *m.Min >= *m.Max {
			return fmt.Errorf("%w: metric range invalid", ErrValidation)
		}
	}
	return nil
}
func (s Registry) ListEntityProfiles(ctx context.Context) (json.RawMessage, error) {
	return s.List(ctx, `SELECT p.*,v.metrics,v.default_template_id,v.default_template_version FROM entity_profiles p JOIN entity_profile_versions v ON v.profile_id=p.id AND v.version=p.revision ORDER BY p.name,p.id`)
}
func (s Registry) SaveEntityProfile(ctx context.Context, id string, in EntityProfileInput) (EntityProfile, error) {
	var out EntityProfile
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 160 {
		return out, ErrValidation
	}
	if err := validateMetrics(in.Metrics); err != nil {
		return out, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	version := 1
	if id == "" {
		id = auth.RandomID()
	} else {
		var old int
		if err = tx.QueryRow(ctx, "SELECT revision FROM entity_profiles WHERE id=$1 FOR UPDATE", id).Scan(&old); err != nil {
			return out, err
		}
		if old != in.Revision {
			return out, ErrRevision
		}
		version = old + 1
	}
	var tid, tv any
	if in.DefaultTemplateID != "" {
		if in.DefaultTemplateVersion < 1 {
			return out, ErrValidation
		}
		tid = in.DefaultTemplateID
		tv = in.DefaultTemplateVersion
	}
	_, err = tx.Exec(ctx, `INSERT INTO entity_profiles(id,name,revision,default_template_id,default_template_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,revision=EXCLUDED.revision,default_template_id=EXCLUDED.default_template_id,default_template_version=EXCLUDED.default_template_version`, id, in.Name, version, tid, tv)
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_profile_versions(profile_id,version,metrics,default_template_id,default_template_version) VALUES($1,$2,$3,$4,$5)`, id, version, in.Metrics, tid, tv); err != nil {
		return out, err
	}
	if err = commitEntity(ctx, tx, "save:entity-profile", id); err != nil {
		return out, err
	}
	out = EntityProfile{ID: id, Name: in.Name, Revision: version, Metrics: in.Metrics}
	if tid != nil {
		out.DefaultTemplateID = &in.DefaultTemplateID
		out.DefaultTemplateVersion = &in.DefaultTemplateVersion
	}
	return out, nil
}
func (s Registry) EntityMetrics(ctx context.Context, id string) ([]MetricDefinition, error) {
	var out []MetricDefinition
	err := s.Pool.QueryRow(ctx, `SELECT v.metrics FROM entities e JOIN entity_profile_versions v ON v.profile_id=e.profile_id AND v.version=e.profile_version WHERE e.id=$1 AND NOT e.archived`, id).Scan(&out)
	return out, err
}

func (s Registry) AvailableEntityMetrics(ctx context.Context, id, scope string) (json.RawMessage, error) {
	if scope != "current" && scope != "parent" && scope != "children" && scope != "descendants" {
		return nil, ErrValidation
	}
	targets, err := s.scopeEntities(ctx, id, MetricScope{Scope: scope})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(targets))
	for _, target := range targets {
		ids = append(ids, target.ID)
	}
	return s.List(ctx, `SELECT m->>'key' AS key,min(m->>'name') AS name,m->>'data_type' AS data_type,COALESCE(m->>'unit','') AS unit,count(*) AS entities FROM entities e JOIN entity_profile_versions p ON p.profile_id=e.profile_id AND p.version=e.profile_version CROSS JOIN LATERAL jsonb_array_elements(p.metrics) m WHERE e.id=ANY($1::text[]) GROUP BY m->>'key',m->>'data_type',COALESCE(m->>'unit','') ORDER BY key LIMIT 256`, ids)
}
func (s Registry) ListEntityBindings(ctx context.Context, id string) (json.RawMessage, error) {
	return s.List(ctx, `SELECT b.metric_key,b.tag_id,t.name AS tag_name,t.key AS source_key,t.unit,t.datatype,t.data_type,t.device_id,d.name AS device_name FROM entity_metric_bindings b JOIN tags t ON t.id=b.tag_id JOIN devices d ON d.id=t.device_id WHERE b.entity_id=$1 ORDER BY b.metric_key`, id)
}
func (s Registry) SaveEntityBindings(ctx context.Context, id string, revision int, bindings map[string]string) (Entity, error) {
	var zero Entity
	if len(bindings) > 128 {
		return zero, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return zero, err
	}
	e, err := readEntity(tx.QueryRow(ctx, entitySelect+" WHERE e.id=$1 AND NOT e.archived FOR UPDATE OF e", id))
	if err != nil {
		return zero, err
	}
	if e.Revision != revision {
		return zero, ErrRevision
	}
	var metrics []MetricDefinition
	if err = tx.QueryRow(ctx, `SELECT v.metrics FROM entities e JOIN entity_profile_versions v ON v.profile_id=e.profile_id AND v.version=e.profile_version WHERE e.id=$1`, id).Scan(&metrics); err != nil {
		return zero, fmt.Errorf("%w: assign a profile before mapping metrics", ErrValidation)
	}
	definitions := map[string]MetricDefinition{}
	for _, m := range metrics {
		definitions[m.Key] = m
	}
	for key, tagID := range bindings {
		m, exists := definitions[key]
		if !exists {
			return zero, fmt.Errorf("%w: metric %s is not in this profile", ErrValidation, key)
		}
		if tagID == "" {
			continue
		}
		var datatype, unit string
		var history bool
		err = tx.QueryRow(ctx, `SELECT t.datatype,t.unit,t.store_history FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id WHERE t.id=$1 AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL FOR SHARE OF t,d,a`, tagID).Scan(&datatype, &unit, &history)
		if err != nil {
			return zero, fmt.Errorf("%w: source for %s unavailable", ErrValidation, key)
		}
		if datatype != m.DataType || unit != m.Unit || m.History && !history {
			return zero, fmt.Errorf("%w: %s requires %s [%s] and compatible history", ErrValidation, key, m.DataType, m.Unit)
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM entity_metric_bindings WHERE entity_id=$1", id); err != nil {
		return zero, err
	}
	for key, tagID := range bindings {
		if tagID != "" {
			if _, err = tx.Exec(ctx, "INSERT INTO entity_metric_bindings(entity_id,metric_key,tag_id) VALUES($1,$2,$3)", id, key, tagID); err != nil {
				return zero, err
			}
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE entities SET revision=revision+1,updated_at=now() WHERE id=$1", id); err != nil {
		return zero, err
	}
	out, err := readEntity(tx.QueryRow(ctx, entitySelect+" WHERE e.id=$1", id))
	if err != nil {
		return zero, err
	}
	return out, commitEntity(ctx, tx, "save:entity-bindings", id)
}

// Sources are paginated and requested only while engineering a mapping.
func (s Registry) EntitySources(ctx context.Context, search string, limit, offset int) (json.RawMessage, error) {
	if limit < 1 || limit > 200 || offset < 0 {
		return nil, ErrValidation
	}
	return s.List(ctx, `SELECT t.id,t.key,t.name,t.datatype,t.data_type,t.unit,t.store_history,d.id AS device_id,d.name AS device_name,a.name AS asset_name FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id WHERE t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL AND ($1='' OR t.name ILIKE '%'||$1||'%' OR t.key ILIKE '%'||$1||'%' OR d.name ILIKE '%'||$1||'%') ORDER BY d.name,t.name,t.id LIMIT $2 OFFSET $3`, search, limit, offset)
}
