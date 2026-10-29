package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/auth"
)

var ErrRevision = errors.New("configuration revision conflict; reload before saving")
var semanticKey = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$`)

type MetadataField struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}
type EntityTypeInput struct {
	Name     string          `json:"name"`
	Fields   []MetadataField `json:"fields"`
	Revision int             `json:"revision"`
}
type EntityInput struct {
	Name           string         `json:"name"`
	Code           string         `json:"code"`
	TypeKey        string         `json:"type_key"`
	ParentID       string         `json:"parent_id"`
	Metadata       map[string]any `json:"metadata"`
	Enabled        *bool          `json:"enabled,omitempty"`
	Archived       bool           `json:"archived"`
	Revision       int            `json:"revision"`
	ProfileID      string         `json:"profile_id"`
	ProfileVersion int            `json:"profile_version"`
}
type Entity struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Code           string         `json:"code"`
	TypeKey        string         `json:"type_key"`
	ParentID       *string        `json:"parent_id"`
	Metadata       map[string]any `json:"metadata"`
	Enabled        bool           `json:"enabled"`
	Archived       bool           `json:"archived"`
	Revision       int            `json:"revision"`
	ProfileID      *string        `json:"profile_id"`
	ProfileVersion *int           `json:"profile_version"`
	ChildCount     int            `json:"child_count"`
	LegacyKind     string         `json:"legacy_kind"`
	LegacyID       string         `json:"legacy_id"`
}

const entitySelect = `SELECT to_jsonb(e)||jsonb_build_object('child_count',(SELECT count(*) FROM entities c WHERE c.parent_id=e.id AND NOT c.archived),'legacy_kind',COALESCE(r.resource_kind,''),'legacy_id',COALESCE(r.resource_id,'')) FROM entities e LEFT JOIN entity_legacy_refs r ON r.entity_id=e.id `

func readEntity(row pgx.Row) (Entity, error) {
	var raw []byte
	var out Entity
	err := row.Scan(&raw)
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	return out, err
}
func (s Registry) GetEntity(ctx context.Context, id string) (Entity, error) {
	return readEntity(s.Pool.QueryRow(ctx, entitySelect+" WHERE e.id=$1", id))
}
func (s Registry) ListEntities(ctx context.Context, parent, search string, limit, offset int) (json.RawMessage, error) {
	if limit < 1 || limit > 200 || offset < 0 {
		return nil, ErrValidation
	}
	var result json.RawMessage
	err := s.Pool.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(doc),'[]'::jsonb) FROM ("+entitySelect+` WHERE NOT e.archived AND ($2<>'' OR COALESCE(e.parent_id,'')=$1) AND ($2='' OR e.name ILIKE '%'||$2||'%' OR e.code ILIKE '%'||$2||'%') ORDER BY e.name,e.id LIMIT $3 OFFSET $4) result(doc)`, parent, search, limit, offset).Scan(&result)
	return result, err
}
func (s Registry) EntityContext(ctx context.Context, id string) (json.RawMessage, error) {
	return s.List(ctx, `WITH RECURSIVE path AS (SELECT e.*,0 AS depth FROM entities e WHERE id=$1 UNION ALL SELECT p.*,c.depth+1 FROM entities p JOIN path c ON p.id=c.parent_id WHERE c.depth<64) SELECT id,name,type_key,parent_id,enabled,archived FROM path ORDER BY depth DESC`, id)
}
func (s Registry) ListEntityTypes(ctx context.Context) (json.RawMessage, error) {
	return s.List(ctx, "SELECT * FROM entity_types ORDER BY name,key")
}
func validateMetadata(fields []MetadataField, values map[string]any) error {
	for _, f := range fields {
		v, ok := values[f.Key]
		if !ok || v == nil {
			if f.Required {
				return fmt.Errorf("%w: missing metadata %s", ErrValidation, f.Key)
			}
			continue
		}
		valid := false
		switch f.Type {
		case "string":
			_, valid = v.(string)
		case "number":
			_, valid = finiteNumber(v)
		case "boolean":
			_, valid = v.(bool)
		}
		if !valid {
			return fmt.Errorf("%w: metadata %s requires %s", ErrValidation, f.Key, f.Type)
		}
	}
	return nil
}
func (s Registry) SaveEntityType(ctx context.Context, key string, in EntityTypeInput) (json.RawMessage, error) {
	if !semanticKey.MatchString(key) || strings.TrimSpace(in.Name) == "" || utf8.RuneCountInString(in.Name) > 200 || len(in.Fields) > 64 {
		return nil, ErrValidation
	}
	if in.Fields == nil {
		in.Fields = []MetadataField{}
	}
	seen := map[string]bool{}
	for _, f := range in.Fields {
		if !semanticKey.MatchString(f.Key) || seen[f.Key] || (f.Type != "string" && f.Type != "number" && f.Type != "boolean") {
			return nil, ErrValidation
		}
		seen[f.Key] = true
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, "SELECT metadata FROM entities WHERE type_key=$1 AND NOT archived", key)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var values map[string]any
		if err = rows.Scan(&values); err != nil {
			rows.Close()
			return nil, err
		}
		if err = validateMetadata(in.Fields, values); err != nil {
			rows.Close()
			return nil, err
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage
	err = tx.QueryRow(ctx, `INSERT INTO entity_types(key,name,fields) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,fields=EXCLUDED.fields,revision=entity_types.revision+1 WHERE entity_types.revision=$4 RETURNING to_jsonb(entity_types.*)`, key, strings.TrimSpace(in.Name), in.Fields, in.Revision).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRevision
	}
	if err != nil {
		return nil, err
	}
	return raw, commitEntity(ctx, tx, "save:entity-type", key)
}
func (s Registry) SaveEntity(ctx context.Context, id string, in EntityInput) (Entity, error) {
	var zero Entity
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 200 || len(in.Code) > 160 || !semanticKey.MatchString(in.TypeKey) {
		return zero, ErrValidation
	}
	if in.Metadata == nil {
		in.Metadata = map[string]any{}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return zero, err
	}
	var old Entity
	creating := id == ""
	if creating {
		id = auth.RandomID()
	} else {
		old, err = readEntity(tx.QueryRow(ctx, entitySelect+" WHERE e.id=$1 FOR UPDATE OF e", id))
		if err != nil {
			return zero, err
		}
		if old.Revision != in.Revision {
			return zero, ErrRevision
		}
		if old.LegacyKind != "" && old.TypeKey != in.TypeKey {
			return zero, fmt.Errorf("%w: physical resource type cannot change", ErrValidation)
		}
	}
	var fields []MetadataField
	if err = tx.QueryRow(ctx, "SELECT fields FROM entity_types WHERE key=$1", in.TypeKey).Scan(&fields); err != nil {
		return zero, err
	}
	if err = validateMetadata(fields, in.Metadata); err != nil {
		return zero, err
	}
	if in.ParentID != "" {
		var validParent bool
		if err = tx.QueryRow(ctx, `WITH RECURSIVE ancestors AS (SELECT id,parent_id,archived,0 AS depth FROM entities WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.archived,c.depth+1 FROM entities p JOIN ancestors c ON p.id=c.parent_id WHERE c.depth<64) SELECT count(*)>0 AND NOT COALESCE(bool_or(id=$2 OR archived OR depth>=63),false) FROM ancestors`, in.ParentID, id).Scan(&validParent); err != nil {
			return zero, err
		}
		if !validParent {
			return zero, fmt.Errorf("%w: invalid parent, cycle, archive or hierarchy depth", ErrValidation)
		}
	}
	if in.Archived {
		var populated bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM entities WHERE parent_id=$1 AND NOT archived)", id).Scan(&populated); err != nil {
			return zero, err
		}
		if populated {
			return zero, fmt.Errorf("%w: reparent or archive children first", ErrValidation)
		}
	}
	if !creating && old.LegacyKind != "" {
		oldParent := ""
		if old.ParentID != nil {
			oldParent = *old.ParentID
		}
		if oldParent != in.ParentID {
			// Grouping can change, but the nearest physical ownership anchor must stay the same.
			kind := map[string]string{"areas": "sites", "assets": "areas", "devices": "assets"}[old.LegacyKind]
			if kind != "" {
				anchor := func(parent string) (string, error) {
					var result string
					err := tx.QueryRow(ctx, `WITH RECURSIVE a AS (SELECT id,parent_id,0 AS depth FROM entities WHERE id=$1 UNION ALL SELECT e.id,e.parent_id,a.depth+1 FROM entities e JOIN a ON e.id=a.parent_id WHERE a.depth<64) SELECT COALESCE((SELECT r.resource_id FROM a JOIN entity_legacy_refs r ON r.entity_id=a.id WHERE r.resource_kind=$2 ORDER BY a.depth LIMIT 1),'')`, parent, kind).Scan(&result)
					return result, err
				}
				before, e := anchor(oldParent)
				if e != nil {
					return zero, e
				}
				after, e := anchor(in.ParentID)
				if e != nil {
					return zero, e
				}
				if before != after {
					return zero, fmt.Errorf("%w: physical ownership must remain in the original site/area/asset", ErrValidation)
				}
			}
		}
	}
	enabled := true
	if !creating {
		enabled = old.Enabled
	}
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	var parent, profile, version any
	if in.ParentID != "" {
		parent = in.ParentID
	}
	if in.ProfileID != "" {
		profile = in.ProfileID
		version = in.ProfileVersion
	}
	if !creating && old.ProfileID != nil && (profile == nil || *old.ProfileID != in.ProfileID || old.ProfileVersion == nil || *old.ProfileVersion != in.ProfileVersion) {
		var bound bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM entity_metric_bindings WHERE entity_id=$1)", id).Scan(&bound); err != nil {
			return zero, err
		}
		if bound {
			return zero, fmt.Errorf("%w: clear or remap bindings before changing profile version", ErrValidation)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO entities(id,name,code,type_key,parent_id,metadata,enabled,archived,profile_id,profile_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,type_key=EXCLUDED.type_key,parent_id=EXCLUDED.parent_id,metadata=EXCLUDED.metadata,enabled=EXCLUDED.enabled,archived=EXCLUDED.archived,profile_id=EXCLUDED.profile_id,profile_version=EXCLUDED.profile_version,revision=entities.revision+1,updated_at=now()`, id, in.Name, in.Code, in.TypeKey, parent, in.Metadata, enabled, in.Archived, profile, version)
	if err != nil {
		return zero, err
	}
	if old.LegacyKind != "" {
		if in.Archived != old.Archived {
			return zero, fmt.Errorf("%w: archive physical resources through device/asset lifecycle", ErrValidation)
		}
		if _, err = tx.Exec(ctx, "SELECT set_config('rallyx.entity_sync','off',true)"); err != nil {
			return zero, err
		}
		if _, err = tx.Exec(ctx, "UPDATE "+old.LegacyKind+" SET name=$2 WHERE id=$1", old.LegacyID, in.Name); err != nil {
			return zero, err
		}
	}
	out, err := readEntity(tx.QueryRow(ctx, entitySelect+" WHERE e.id=$1", id))
	if err != nil {
		return zero, err
	}
	return out, commitEntity(ctx, tx, "save:entity", id)
}
