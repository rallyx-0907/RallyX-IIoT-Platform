package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"rallyx.local/core/internal/units"
)

type NativeDashboardMigration struct {
	EntityID string `json:"entity_id"`
}

type legacyDashboardWidget struct {
	ID, TagID, Kind, Title  string
	Position                int
	Settings                json.RawMessage
	TagName, Unit, DataType string
	History                 bool
}

// MigrateDashboardBoardToNative converts a user's saved point board into a
// published native dashboard. Stable IDs make retries safe; the source board
// and its widgets remain untouched.
func (s Registry) MigrateDashboardBoardToNative(ctx context.Context, userID, boardID string) (NativeDashboardMigration, error) {
	var out NativeDashboardMigration
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return out, err
	}
	var boardName string
	if err = tx.QueryRow(ctx, "SELECT name FROM dashboard_boards WHERE id=$1 AND user_id=$2 FOR SHARE", boardID, userID).Scan(&boardName); err != nil {
		return out, err
	}
	entityID := "legacy-dashboard:" + boardID
	profileID := "legacy-dashboard-profile:" + boardID
	templateID := "legacy-dashboard-template:" + boardID
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM entities WHERE id=$1)", entityID).Scan(&exists); err != nil {
		return out, err
	}
	if exists {
		return NativeDashboardMigration{EntityID: entityID}, tx.Commit(ctx)
	}
	var sourceCount int
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM dashboard_widgets WHERE user_id=$1 AND board_id=$2", userID, boardID).Scan(&sourceCount); err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT w.id,w.tag_id,w.type,w.title,w.position,w.settings,t.name,t.unit,t.datatype,t.store_history
		FROM dashboard_widgets w JOIN tags t ON t.id=w.tag_id
		JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id
		WHERE w.user_id=$1 AND w.board_id=$2 AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL
		ORDER BY w.position,w.created_at,w.id FOR SHARE OF w,t`, userID, boardID)
	if err != nil {
		return out, err
	}
	widgets := []legacyDashboardWidget{}
	for rows.Next() {
		var w legacyDashboardWidget
		if err = rows.Scan(&w.ID, &w.TagID, &w.Kind, &w.Title, &w.Position, &w.Settings, &w.TagName, &w.Unit, &w.DataType, &w.History); err != nil {
			rows.Close()
			return out, err
		}
		widgets = append(widgets, w)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return out, err
	}
	rows.Close()
	if len(widgets) != sourceCount || len(widgets) == 0 || len(widgets) > 64 {
		return out, fmt.Errorf("%w: board must contain 1–64 widgets with active tags", ErrValidation)
	}
	metrics := make([]MetricDefinition, 0, len(widgets))
	bindings := make(map[string]string, len(widgets))
	doc := DashboardDocument{SchemaVersion: 1, Pages: []DashboardPage{{ID: "overview", Name: boardName}}}
	row, column := 0, 0
	for i, w := range widgets {
		key := fmt.Sprintf("signal_%d", i+1)
		name := w.Title
		if name == "" {
			name = w.TagName
		}
		if name == "" {
			name = key
		}
		dataType := w.DataType
		if dataType == "bool" {
			dataType = "boolean"
		}
		if dataType != "number" && dataType != "boolean" && dataType != "string" {
			return out, fmt.Errorf("%w: unsupported legacy tag datatype", ErrValidation)
		}
		kind := map[string]string{"value": "value-card", "status": "status-card", "trend": "timeseries", "gauge": "gauge", "level": "progress"}[w.Kind]
		if kind == "" || kind == "status-card" && dataType != "boolean" || (kind == "gauge" || kind == "progress" || kind == "timeseries") && dataType != "number" {
			return out, fmt.Errorf("%w: legacy widget and tag type do not match", ErrValidation)
		}
		if kind == "timeseries" && !w.History {
			return out, fmt.Errorf("%w: trend source no longer has history enabled", ErrValidation)
		}
		settings := map[string]any{}
		_ = json.Unmarshal(w.Settings, &settings)
		precision := settingInt(settings, "precision", 0)
		unit := units.Canonical(w.Unit)
		metric := MetricDefinition{Key: key, Name: name, DataType: dataType, Unit: unit, Precision: precision, History: w.History}
		metrics = append(metrics, metric)
		bindings[key] = w.TagID
		x, y, width := column*12, row*8, 12
		if settings["size"] == "wide" {
			if column == 1 {
				row++
			}
			x, y, width = 0, row*8, 24
			row++
			column = 0
		} else {
			column++
			if column == 2 {
				row++
				column = 0
			}
		}
		presentation := WidgetPresentation{Unit: unit, Precision: precision}
		if n, ok := settingNumber(settings, "min"); ok {
			presentation.Min = &n
			metric.Min = &n
			metrics[len(metrics)-1] = metric
		}
		if n, ok := settingNumber(settings, "max"); ok {
			presentation.Max = &n
			metric.Max = &n
			metrics[len(metrics)-1] = metric
		}
		doc.Pages[0].Widgets = append(doc.Pages[0].Widgets, SemanticWidget{ID: fmt.Sprintf("widget_%d", i+1), Type: kind, Title: name, Binding: MetricScope{Scope: "current", Metric: key}, Aggregation: "last", Layout: WidgetLayout{X: x, Y: y, W: width, H: 8}, Presentation: presentation})
	}
	if err = validateMetrics(metrics); err != nil {
		return out, err
	}
	if err = ValidateDashboardDocument(doc); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_dashboard_templates(id,name,draft,revision,published_version) VALUES($1,$2,$3,1,1)`, templateID, boardName, doc); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_dashboard_versions(template_id,version,document) VALUES($1,1,$2)`, templateID, doc); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_profiles(id,name,revision,default_template_id,default_template_version) VALUES($1,$2,1,$3,1)`, profileID, boardName, templateID); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_profile_versions(profile_id,version,metrics,default_template_id,default_template_version) VALUES($1,1,$2,$3,1)`, profileID, metrics, templateID); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entities(id,name,type_key,profile_id,profile_version) VALUES($1,$2,'group',$3,1)`, entityID, boardName, profileID); err != nil {
		return out, err
	}
	for key, tagID := range bindings {
		if _, err = tx.Exec(ctx, "INSERT INTO entity_metric_bindings(entity_id,metric_key,tag_id) VALUES($1,$2,$3)", entityID, key, tagID); err != nil {
			return out, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entity_dashboard_assignments(entity_id,template_id,template_version) VALUES($1,$2,1)`, entityID, templateID); err != nil {
		return out, err
	}
	if err = commitEntity(ctx, tx, "migrate:legacy-dashboard", entityID); err != nil {
		return out, err
	}
	return NativeDashboardMigration{EntityID: entityID}, nil
}

func settingInt(m map[string]any, key string, fallback int) int {
	if n, ok := settingNumber(m, key); ok && n >= 0 && n <= 6 {
		return int(n)
	}
	return fallback
}

func settingNumber(m map[string]any, key string) (float64, bool) {
	n, ok := m[key].(float64)
	return n, ok
}
