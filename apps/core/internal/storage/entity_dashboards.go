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

type WidgetLayout struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}
type MetricScope struct {
	Scope   string `json:"scope"`
	Metric  string `json:"metric"`
	TypeKey string `json:"type_key,omitempty"`
}
type WidgetPresentation struct {
	Unit      string   `json:"unit,omitempty"`
	Precision int      `json:"precision"`
	Min       *float64 `json:"min,omitempty"`
	Max       *float64 `json:"max,omitempty"`
	Color     string   `json:"color,omitempty"`
}
type SemanticWidget struct {
	ID           string             `json:"id"`
	Type         string             `json:"type"`
	Title        string             `json:"title"`
	Binding      MetricScope        `json:"binding"`
	Metrics      []string           `json:"metrics,omitempty"`
	Aggregation  string             `json:"aggregation"`
	Layout       WidgetLayout       `json:"layout"`
	Presentation WidgetPresentation `json:"presentation"`
}
type DashboardPage struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Widgets []SemanticWidget `json:"widgets"`
}
type DashboardDocument struct {
	SchemaVersion int             `json:"schema_version"`
	Pages         []DashboardPage `json:"pages"`
}
type EntityDashboardInput struct {
	Name     string            `json:"name"`
	Document DashboardDocument `json:"document"`
	Revision int               `json:"revision"`
	Publish  bool              `json:"publish"`
}
type EntityDashboard struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Revision         int               `json:"revision"`
	PublishedVersion int               `json:"published_version"`
	Document         DashboardDocument `json:"document"`
}
type DashboardVersion struct {
	TemplateID      string `json:"template_id"`
	TemplateVersion int    `json:"template_version"`
	Revision        int    `json:"revision"`
}

var NativeWidgetKinds = map[string]bool{"value-card": true, "status-card": true, "gauge": true, "progress": true, "timeseries": true, "bar": true, "distribution": true, "entity-table": true, "alarm-table": true, "state-timeline": true}
var colorValue = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func ValidateDashboardDocument(doc DashboardDocument) error {
	if doc.SchemaVersion != 1 || len(doc.Pages) < 1 || len(doc.Pages) > 8 {
		return fmt.Errorf("%w: unsupported dashboard schema or page count", ErrValidation)
	}
	seen := map[string]bool{}
	pages := map[string]bool{}
	count := 0
	for _, p := range doc.Pages {
		if !semanticKey.MatchString(p.ID) || pages[p.ID] || strings.TrimSpace(p.Name) == "" || len(p.Name) > 200 {
			return ErrValidation
		}
		pages[p.ID] = true
		for _, w := range p.Widgets {
			count++
			if count > 64 || !semanticKey.MatchString(w.ID) || seen[w.ID] || !NativeWidgetKinds[w.Type] || utf8.RuneCountInString(w.Title) > 160 {
				return fmt.Errorf("%w: invalid widget identity/type or more than 64 widgets", ErrValidation)
			}
			seen[w.ID] = true
			if w.Binding.Scope != "current" && w.Binding.Scope != "parent" && w.Binding.Scope != "children" && w.Binding.Scope != "descendants" {
				return fmt.Errorf("%w: invalid semantic scope", ErrValidation)
			}
			if w.Type != "entity-table" && w.Type != "alarm-table" && w.Type != "distribution" && !semanticKey.MatchString(w.Binding.Metric) {
				return fmt.Errorf("%w: widget requires semantic metric key", ErrValidation)
			}
			if w.Binding.TypeKey != "" && !semanticKey.MatchString(w.Binding.TypeKey) {
				return ErrValidation
			}
			if (w.Type == "entity-table" || w.Type == "distribution") && (w.Binding.Scope != "children" || w.Binding.TypeKey != "") {
				return fmt.Errorf("%w: this operational widget uses direct children", ErrValidation)
			}
			if w.Type == "alarm-table" && (w.Binding.Scope != "descendants" || w.Binding.TypeKey != "") {
				return fmt.Errorf("%w: alarm widget uses the current subtree", ErrValidation)
			}
			if len(w.Metrics) > 0 && w.Type != "timeseries" {
				return fmt.Errorf("%w: multiple metrics require a time series widget", ErrValidation)
			}
			if len(w.Metrics) > 12 {
				return ErrValidation
			}
			for _, key := range w.Metrics {
				if !semanticKey.MatchString(key) {
					return ErrValidation
				}
			}
			switch w.Aggregation {
			case "", "last", "sum", "avg", "min", "max", "count":
			default:
				return fmt.Errorf("%w: unsupported aggregation", ErrValidation)
			}
			g := w.Layout
			if g.X < 0 || g.Y < 0 || g.W < 3 || g.W > 24 || g.X+g.W > 24 || g.H < 3 || g.H > 30 || g.Y > 1000 {
				return fmt.Errorf("%w: invalid grid bounds", ErrValidation)
			}
			if w.Presentation.Precision < 0 || w.Presentation.Precision > 6 || len(w.Presentation.Unit) > 32 {
				return ErrValidation
			}
			if c := w.Presentation.Color; c != "" && !colorValue.MatchString(c) {
				return ErrValidation
			}
			if w.Presentation.Min != nil && w.Presentation.Max != nil && *w.Presentation.Min >= *w.Presentation.Max {
				return fmt.Errorf("%w: invalid display range", ErrValidation)
			}
		}
	}
	return nil
}
func (s Registry) ListEntityDashboards(ctx context.Context) (json.RawMessage, error) {
	return s.List(ctx, `SELECT id,name,revision,published_version FROM entity_dashboard_templates ORDER BY name,id`)
}
func (s Registry) GetEntityDashboard(ctx context.Context, id string) (EntityDashboard, error) {
	var out EntityDashboard
	var raw json.RawMessage
	err := s.Pool.QueryRow(ctx, `SELECT id,name,revision,COALESCE(published_version,0),draft FROM entity_dashboard_templates WHERE id=$1`, id).Scan(&out.ID, &out.Name, &out.Revision, &out.PublishedVersion, &raw)
	if err == nil {
		err = json.Unmarshal(raw, &out.Document)
	}
	return out, err
}
func (s Registry) SaveEntityDashboard(ctx context.Context, id string, in EntityDashboardInput) (EntityDashboard, error) {
	var out EntityDashboard
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 160 {
		return out, ErrValidation
	}
	if err := ValidateDashboardDocument(in.Document); err != nil {
		return out, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	revision, published := 1, 0
	if id == "" {
		id = auth.RandomID()
	} else {
		var old int
		if err = tx.QueryRow(ctx, "SELECT revision,COALESCE(published_version,0) FROM entity_dashboard_templates WHERE id=$1 FOR UPDATE", id).Scan(&old, &published); err != nil {
			return out, err
		}
		if old != in.Revision {
			return out, ErrRevision
		}
		revision = old + 1
	}
	if in.Publish {
		published++
	}
	var pub any
	if published > 0 {
		pub = published
	}
	_, err = tx.Exec(ctx, `INSERT INTO entity_dashboard_templates(id,name,draft,revision,published_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,draft=EXCLUDED.draft,revision=EXCLUDED.revision,published_version=EXCLUDED.published_version,updated_at=now()`, id, in.Name, in.Document, revision, pub)
	if err != nil {
		return out, err
	}
	if in.Publish {
		if _, err = tx.Exec(ctx, "INSERT INTO entity_dashboard_versions(template_id,version,document) VALUES($1,$2,$3)", id, published, in.Document); err != nil {
			return out, err
		}
	}
	out = EntityDashboard{ID: id, Name: in.Name, Revision: revision, PublishedVersion: published, Document: in.Document}
	return out, commitEntity(ctx, tx, "save:entity-dashboard", id)
}
func (s Registry) AssignEntityDashboard(ctx context.Context, entityID, templateID string, version, revision int) error {
	if version < 1 {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var active bool
	if err = tx.QueryRow(ctx, "SELECT NOT archived FROM entities WHERE id=$1 FOR UPDATE", entityID).Scan(&active); err != nil {
		return err
	}
	if !active {
		return ErrValidation
	}
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT document FROM entity_dashboard_versions WHERE template_id=$1 AND version=$2", templateID, version).Scan(&raw); err != nil {
		return err
	}
	var affected int64
	if revision == 0 {
		tag, e := tx.Exec(ctx, `INSERT INTO entity_dashboard_assignments(entity_id,template_id,template_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, entityID, templateID, version)
		err = e
		affected = tag.RowsAffected()
	} else {
		tag, e := tx.Exec(ctx, `UPDATE entity_dashboard_assignments SET template_id=$2,template_version=$3,revision=revision+1 WHERE entity_id=$1 AND revision=$4`, entityID, templateID, version, revision)
		err = e
		affected = tag.RowsAffected()
	}
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrRevision
	}
	return commitEntity(ctx, tx, "assign:entity-dashboard", entityID)
}
func (s Registry) ResolveEntityDashboard(ctx context.Context, id string) (DashboardDocument, DashboardVersion, error) {
	var doc DashboardDocument
	var v DashboardVersion
	var raw []byte
	err := s.Pool.QueryRow(ctx, `SELECT a.template_id,a.template_version,a.revision,v.document FROM entities e JOIN entity_dashboard_assignments a ON a.entity_id=e.id JOIN entity_dashboard_versions v ON v.template_id=a.template_id AND v.version=a.template_version WHERE e.id=$1 AND NOT e.archived`, id).Scan(&v.TemplateID, &v.TemplateVersion, &v.Revision, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.Pool.QueryRow(ctx, `SELECT p.default_template_id,p.default_template_version,0,v.document FROM entities e JOIN entity_profile_versions p ON p.profile_id=e.profile_id AND p.version=e.profile_version JOIN entity_dashboard_versions v ON v.template_id=p.default_template_id AND v.version=p.default_template_version WHERE e.id=$1 AND NOT e.archived`, id).Scan(&v.TemplateID, &v.TemplateVersion, &v.Revision, &raw)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.Pool.QueryRow(ctx, `SELECT v.template_id,v.version,0,v.document FROM entity_dashboard_versions v JOIN platform_settings p ON p.key='native_default_dashboard_template' AND p.value->>'id'=v.template_id AND (p.value->>'version')::integer=v.version WHERE EXISTS(SELECT 1 FROM entities WHERE id=$1 AND NOT archived)`, id).Scan(&v.TemplateID, &v.TemplateVersion, &v.Revision, &raw)
	}
	if err == nil {
		err = json.Unmarshal(raw, &doc)
	}
	return doc, v, err
}
