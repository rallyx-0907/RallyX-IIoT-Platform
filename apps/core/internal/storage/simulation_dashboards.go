package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/auth"
)

type SimulationCanvas struct {
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	GridSize        float64 `json:"gridSize"`
	SnapToGrid      bool    `json:"snapToGrid"`
	BackgroundColor string  `json:"backgroundColor,omitempty"`
	BackgroundImage string  `json:"backgroundImage,omitempty"`
}
type SimulationBinding struct {
	TagID        string `json:"tagId"`
	Operator     string `json:"operator"`
	CompareValue any    `json:"compareValue,omitempty"`
}
type SimulationControl struct {
	ID         string             `json:"id"`
	Type       string             `json:"type"`
	X          float64            `json:"x"`
	Y          float64            `json:"y"`
	Width      float64            `json:"width"`
	Height     float64            `json:"height"`
	Rotation   float64            `json:"rotation"`
	ZIndex     int                `json:"zIndex"`
	Properties map[string]any     `json:"properties"`
	Binding    *SimulationBinding `json:"binding,omitempty"`
}
type SimulationDashboard struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Type        string              `json:"type"`
	Canvas      SimulationCanvas    `json:"canvas"`
	Layout      []SimulationControl `json:"layout"`
	Revision    int                 `json:"revision"`
	CreatedBy   *string             `json:"createdBy,omitempty"`
	OwnerUserID *string             `json:"ownerUserId,omitempty"`
	CreatedAt   time.Time           `json:"createdAt"`
	UpdatedAt   time.Time           `json:"updatedAt"`
}
type DashboardCreate struct {
	Name   string              `json:"name"`
	Type   string              `json:"type"`
	Canvas *SimulationCanvas   `json:"canvas,omitempty"`
	Layout []SimulationControl `json:"layout,omitempty"`
}
type DashboardPatch struct {
	Name     *string              `json:"name,omitempty"`
	Canvas   *SimulationCanvas    `json:"canvas,omitempty"`
	Layout   *[]SimulationControl `json:"layout,omitempty"`
	Revision int                  `json:"revision"`
}

func DefaultSimulationCanvas() SimulationCanvas {
	return SimulationCanvas{Width: 1200, Height: 800, GridSize: 10, SnapToGrid: true}
}
func simulationInvalid(reason string) error { return fmt.Errorf("%w: %s", ErrValidation, reason) }
func bounded(n, min, max float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= min && n <= max
}

var simulationColor = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$`)
var simulationImage = regexp.MustCompile(`^/(assets|images)/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp|gif)$`)

func safeSimulationImage(s string) bool { return s == "" || simulationImage.MatchString(s) }

var simulationProperties = map[string]map[string]string{
	"text":           {"text": "string", "fontSize": "fontSize", "fontWeight": "weight", "textAlign": "align"},
	"indicator-lamp": {"label": "string", "onColor": "color", "offColor": "color", "borderStyle": "border"},
	"analog-gauge":   {"min": "number", "max": "number", "unit": "string", "precision": "precision", "label": "string"},
	"numeric-value":  {"label": "string", "unit": "string", "precision": "precision", "prefix": "string", "suffix": "string"},
	"rectangle":      {"fill": "color", "borderColor": "color", "borderWidth": "borderWidth", "borderRadius": "radius"},
	"line":           {"stroke": "color", "strokeWidth": "borderWidth", "lineStyle": "lineStyle"},
	"image":          {"source": "image", "objectFit": "fit", "opacity": "opacity"},
}

func validateSimulationProperty(kind string, v any) bool {
	switch kind {
	case "string":
		s, ok := v.(string)
		return ok && utf8.RuneCountInString(s) <= 2000
	case "color":
		s, ok := v.(string)
		return ok && simulationColor.MatchString(s)
	case "image":
		s, ok := v.(string)
		return ok && safeSimulationImage(s)
	case "weight":
		s, ok := v.(string)
		return ok && (s == "400" || s == "600" || s == "700")
	case "align", "border", "lineStyle", "fit":
		s, ok := v.(string)
		if !ok {
			return false
		}
		allowed := map[string][]string{"align": {"left", "center", "right"}, "border": {"solid", "dashed", "dotted", "none"}, "lineStyle": {"solid", "dashed", "dotted"}, "fit": {"contain", "cover", "fill"}}
		for _, a := range allowed[kind] {
			if a == s {
				return true
			}
		}
		return false
	default:
		n, ok := v.(float64)
		if !ok {
			if i, yes := v.(int); yes {
				n = float64(i)
				ok = true
			}
		}
		if !ok {
			return false
		}
		switch kind {
		case "number":
			return bounded(n, -1e15, 1e15)
		case "fontSize":
			return bounded(n, 8, 200)
		case "precision":
			return bounded(n, 0, 6) && math.Trunc(n) == n
		case "borderWidth":
			return bounded(n, 0, 30)
		case "radius":
			return bounded(n, 0, 200)
		case "opacity":
			return bounded(n, 0, 1)
		}
	}
	return false
}
func ValidateSimulationDashboard(d SimulationDashboard) error {
	if strings.TrimSpace(d.Name) == "" || utf8.RuneCountInString(d.Name) > 200 {
		return simulationInvalid("dashboard name")
	}
	if d.Type != "standard" && d.Type != "simulation" {
		return simulationInvalid("dashboard type")
	}
	c := d.Canvas
	if !bounded(c.Width, 320, 10000) || !bounded(c.Height, 240, 10000) || !bounded(c.GridSize, 1, 100) {
		return simulationInvalid("canvas dimensions")
	}
	if c.BackgroundColor != "" && !simulationColor.MatchString(c.BackgroundColor) || !safeSimulationImage(c.BackgroundImage) {
		return simulationInvalid("canvas appearance")
	}
	if len(d.Layout) > 1000 || d.Type == "standard" && len(d.Layout) > 0 {
		return simulationInvalid("layout limit or dashboard type")
	}
	seen := map[string]bool{}
	for _, v := range d.Layout {
		if strings.TrimSpace(v.ID) == "" || len(v.ID) > 128 || seen[v.ID] {
			return simulationInvalid("control id")
		}
		seen[v.ID] = true
		schema, ok := simulationProperties[v.Type]
		if !ok {
			return simulationInvalid("control type")
		}
		if !bounded(v.X, 0, c.Width) || !bounded(v.Y, 0, c.Height) || !bounded(v.Width, 1, c.Width) || !bounded(v.Height, 1, c.Height) || v.X+v.Width > c.Width || v.Y+v.Height > c.Height || !bounded(v.Rotation, -360, 360) || v.ZIndex < -100000 || v.ZIndex > 100000 {
			return simulationInvalid("control geometry")
		}
		if v.Properties == nil {
			return simulationInvalid("control properties")
		}
		for key, val := range v.Properties {
			kind, ok := schema[key]
			if !ok || !validateSimulationProperty(kind, val) {
				return simulationInvalid("control property " + key)
			}
		}
		if v.Type == "analog-gauge" {
			min, max := 0.0, 100.0
			if n, ok := v.Properties["min"].(float64); ok {
				min = n
			}
			if n, ok := v.Properties["max"].(float64); ok {
				max = n
			}
			if min >= max {
				return simulationInvalid("gauge range")
			}
		}
		if b := v.Binding; b != nil {
			if b.CompareValue != nil {
				switch value := b.CompareValue.(type) {
				case bool:
				case string:
					if utf8.RuneCountInString(value) > 2000 {
						return simulationInvalid("comparison value")
					}
				case float64:
					if !bounded(value, -1e15, 1e15) {
						return simulationInvalid("comparison value")
					}
				default:
					return simulationInvalid("comparison value")
				}
			}
			if v.Type != "indicator-lamp" && v.Type != "analog-gauge" && v.Type != "numeric-value" {
				return simulationInvalid("control binding")
			}
			if strings.TrimSpace(b.TagID) == "" || len(b.TagID) > 200 {
				return simulationInvalid("binding tag")
			}
			switch b.Operator {
			case "direct":
			case "==", "!=", ">", ">=", "<", "<=":
				switch n := b.CompareValue.(type) {
				case bool, string:
					if b.Operator != "==" && b.Operator != "!=" {
						return simulationInvalid("comparison type")
					}
				case float64:
					if !bounded(n, -1e15, 1e15) {
						return simulationInvalid("comparison value")
					}
				default:
					return simulationInvalid("comparison value")
				}
			default:
				return simulationInvalid("binding operator")
			}
			if v.Type == "analog-gauge" && b.Operator != "direct" {
				return simulationInvalid("gauge requires numeric direct binding")
			}
		}
	}
	return nil
}

const dashboardColumns = "id,name,type,canvas,layout,revision,created_by,owner_user_id,created_at,updated_at"

func scanDashboard(row pgx.Row) (SimulationDashboard, error) {
	var d SimulationDashboard
	var c, l []byte
	err := row.Scan(&d.ID, &d.Name, &d.Type, &c, &l, &d.Revision, &d.CreatedBy, &d.OwnerUserID, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return d, err
	}
	if err = json.Unmarshal(c, &d.Canvas); err != nil {
		return d, err
	}
	err = json.Unmarshal(l, &d.Layout)
	return d, err
}
func (s Registry) ListDashboards(ctx context.Context) ([]SimulationDashboard, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+dashboardColumns+" FROM dashboards ORDER BY created_at,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SimulationDashboard{}
	for rows.Next() {
		d, e := scanDashboard(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
func (s Registry) GetDashboard(ctx context.Context, id string) (SimulationDashboard, error) {
	return scanDashboard(s.Pool.QueryRow(ctx, "SELECT "+dashboardColumns+" FROM dashboards WHERE id=$1", id))
}
func validateDashboardTags(ctx context.Context, tx pgx.Tx, d SimulationDashboard) error {
	for _, c := range d.Layout {
		if c.Binding == nil {
			continue
		}
		var datatype string
		err := tx.QueryRow(ctx, "SELECT t.datatype FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id JOIN connections cn ON cn.id=d.connection_id WHERE t.id=$1 AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL AND cn.deleted_at IS NULL", c.Binding.TagID).Scan(&datatype)
		if err == pgx.ErrNoRows {
			return simulationInvalid("missing or archived tag")
		}
		if err != nil {
			return err
		}
		if c.Type == "analog-gauge" && datatype != "number" {
			return simulationInvalid("gauge tag must be numeric")
		}
		if c.Binding.Operator != "direct" {
			switch c.Binding.CompareValue.(type) {
			case float64:
				if datatype != "number" {
					return simulationInvalid("comparison datatype")
				}
			case bool:
				if datatype != "boolean" {
					return simulationInvalid("comparison datatype")
				}
			case string:
				if datatype != "string" {
					return simulationInvalid("comparison datatype")
				}
			}
		}
	}
	return nil
}
func (s Registry) CreateDashboard(ctx context.Context, in DashboardCreate, actor string) (SimulationDashboard, error) {
	d := SimulationDashboard{ID: auth.RandomID(), Name: strings.TrimSpace(in.Name), Type: in.Type, Canvas: DefaultSimulationCanvas(), Layout: in.Layout}
	if in.Canvas != nil {
		d.Canvas = *in.Canvas
	}
	if d.Layout == nil {
		d.Layout = []SimulationControl{}
	}
	if err := ValidateSimulationDashboard(d); err != nil {
		return d, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return d, err
	}
	defer tx.Rollback(ctx)
	if err = validateDashboardTags(ctx, tx, d); err != nil {
		return d, err
	}
	c, _ := json.Marshal(d.Canvas)
	l, _ := json.Marshal(d.Layout)
	d, err = scanDashboard(tx.QueryRow(ctx, "INSERT INTO dashboards(id,name,type,canvas,layout,created_by) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')) RETURNING "+dashboardColumns, d.ID, d.Name, d.Type, c, l, actor))
	if err != nil {
		return d, err
	}
	return d, commitEntity(WithEntityActor(ctx, actor), tx, "dashboard.create", d.ID)
}
func (s Registry) UpdateDashboard(ctx context.Context, id string, in DashboardPatch) (SimulationDashboard, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SimulationDashboard{}, err
	}
	defer tx.Rollback(ctx)
	d, err := scanDashboard(tx.QueryRow(ctx, "SELECT "+dashboardColumns+" FROM dashboards WHERE id=$1 FOR UPDATE", id))
	if err != nil {
		return d, err
	}
	if in.Revision != d.Revision {
		return d, ErrRevision
	}
	if in.Name != nil {
		d.Name = strings.TrimSpace(*in.Name)
	}
	if in.Canvas != nil {
		d.Canvas = *in.Canvas
	}
	if in.Layout != nil {
		d.Layout = *in.Layout
	}
	if d.Layout == nil {
		d.Layout = []SimulationControl{}
	}
	if err = ValidateSimulationDashboard(d); err != nil {
		return d, err
	}
	if err = validateDashboardTags(ctx, tx, d); err != nil {
		return d, err
	}
	c, _ := json.Marshal(d.Canvas)
	l, _ := json.Marshal(d.Layout)
	d, err = scanDashboard(tx.QueryRow(ctx, "UPDATE dashboards SET name=$2,canvas=$3,layout=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING "+dashboardColumns, id, d.Name, c, l))
	if err != nil {
		return d, err
	}
	return d, commitEntity(ctx, tx, "dashboard.update", id)
}
func (s Registry) DeleteDashboard(ctx context.Context, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, "DELETE FROM dashboards WHERE id=$1", id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return commitEntity(ctx, tx, "dashboard.delete", id)
}
