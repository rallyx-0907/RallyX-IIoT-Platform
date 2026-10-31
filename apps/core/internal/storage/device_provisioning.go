package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/units"
	"regexp"
	"strings"
)

var registerLabel = regexp.MustCompile(`(?i)(thanh\s+ghi\s+\d+|\b[HI]R\s*4?\d{4,})`)

func signalDisplayName(name string, index int) string {
	if strings.TrimSpace(name) == "" || registerLabel.MatchString(name) {
		return fmt.Sprintf("Tín hiệu %d", index+1)
	}
	runes := []rune(name)
	if len(runes) > 160 {
		return string(runes[:160])
	}
	return name
}

// Native defaults are semantic configuration, independent of individual tag IDs.
func DefaultDeviceDashboard(metrics []MetricDefinition) DashboardDocument {
	primary := []SemanticWidget{}
	secondary := []SemanticWidget{}
	groups := map[string][]string{}
	order := []string{}
	ranked := append([]MetricDefinition(nil), metrics...)
	// Run/fault and power are promoted without inventing values or meanings.
	priority := func(m MetricDefinition) bool {
		k := strings.ToLower(m.Key + " " + m.Name)
		return strings.Contains(k, "power") || strings.Contains(k, "công suất") || m.DataType == "boolean"
	}
	for i := 0; i < len(ranked); i++ {
		for j := i + 1; j < len(ranked); j++ {
			if !priority(ranked[i]) && priority(ranked[j]) {
				ranked[i], ranked[j] = ranked[j], ranked[i]
			}
		}
	}
	for i, m := range ranked {
		if i < 48 {
			kind := "value-card"
			if m.DataType == "boolean" {
				kind = "status-card"
			}
			w := SemanticWidget{ID: fmt.Sprintf("value-%d", i), Type: kind, Title: m.Name, Binding: MetricScope{Scope: "current", Metric: m.Key}, Aggregation: "last", Layout: WidgetLayout{X: (i % 4) * 6, W: 6, H: 6}, Presentation: WidgetPresentation{Precision: m.Precision}}
			if i < 4 {
				columns := len(ranked)
				if columns > 4 {
					columns = 4
				}
				w.Layout.W = 24 / columns
				w.Layout.X = i * w.Layout.W
				w.Layout.H = 8
				primary = append(primary, w)
			} else {
				w.Layout.Y = ((i - 4) / 4) * 6
				secondary = append(secondary, w)
			}
		}
		if m.History && m.DataType == "number" {
			u := units.Canonical(m.Unit)
			if _, ok := groups[u]; !ok {
				order = append(order, u)
			}
			groups[u] = append(groups[u], m.Key)
		}
	}
	pages := []DashboardPage{{ID: "main", Name: "Chỉ số chính", Widgets: primary}}
	if len(secondary) > 0 {
		label := "Tín hiệu phụ"
		if len(metrics) > 48 {
			label = fmt.Sprintf("Tín hiệu phụ (%d/%d)", len(secondary), len(metrics)-len(primary))
		}
		pages = append(pages, DashboardPage{ID: "signals", Name: label, Widgets: secondary})
	}
	trends := []SemanticWidget{}
	for _, u := range order {
		if len(trends) >= 8 {
			break
		}
		keys := groups[u]
		if len(keys) > 12 {
			keys = keys[:12]
		}
		trends = append(trends, SemanticWidget{ID: fmt.Sprintf("trend-%d", len(trends)), Type: "timeseries", Title: "Xu hướng " + u, Binding: MetricScope{Scope: "current", Metric: keys[0]}, Metrics: keys[1:], Aggregation: "last", Layout: WidgetLayout{Y: len(trends) * 12, W: 24, H: 12}, Presentation: WidgetPresentation{Precision: 1}})
	}
	if len(trends) > 0 {
		pages = append(pages, DashboardPage{ID: "history", Name: "Xu hướng", Widgets: trends})
	}
	return DashboardDocument{SchemaVersion: 1, Pages: pages}
}

// Called inside registry's configuration transaction; no nested commits.
func (s Registry) syncDeviceTemplateProfile(ctx context.Context, tx pgx.Tx, id string) (string, int, error) {
	var name, protocol string
	var version int
	var definitions []map[string]any
	if err := tx.QueryRow(ctx, "SELECT name,protocol,version,tag_definitions FROM device_templates WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&name, &protocol, &version, &definitions); err != nil {
		return "", 0, err
	}
	var profile string
	var pv int
	err := tx.QueryRow(ctx, "SELECT profile_id,profile_version FROM device_template_profile_versions WHERE template_id=$1 AND template_version=$2", id, version).Scan(&profile, &pv)
	if err == nil {
		return profile, pv, nil
	}
	if err != pgx.ErrNoRows {
		return "", 0, err
	}
	profile = "device-template:" + id
	pv = 1
	var previous int
	err = tx.QueryRow(ctx, "SELECT revision FROM entity_profiles WHERE id=$1 FOR UPDATE", profile).Scan(&previous)
	if err == nil {
		pv = previous + 1
	} else if err != pgx.ErrNoRows {
		return "", 0, err
	}
	metrics := []MetricDefinition{}
	reserved := map[string]bool{}
	for _, definition := range definitions {
		if key, ok := definition["key"].(string); ok && semanticKey.MatchString(key) {
			reserved[key] = true
		}
	}
	for i, definition := range definitions {
		tag, err := templateDefinition(definition, protocol)
		if err != nil {
			return "", 0, err
		}
		key := tag["key"].(string)
		sourceKey := key
		if !semanticKey.MatchString(key) {
			key = fmt.Sprintf("source_%d", i+1)
			for n := 1; reserved[key]; n++ {
				key = fmt.Sprintf("source_%d_%d", i+1, n)
			}
			reserved[key] = true
		}
		unit, _ := tag["unit"].(string)
		history := true
		if h, ok := tag["store_history"].(bool); ok {
			history = h
		}
		precision := 1
		if strings.HasPrefix(tag["data_type"].(string), "int") || strings.HasPrefix(tag["data_type"].(string), "uint") {
			precision = 0
		}
		metrics = append(metrics, MetricDefinition{Key: key, SourceKey: sourceKey, Name: signalDisplayName(tag["name"].(string), i), DataType: tag["datatype"].(string), Unit: units.Canonical(unit), Precision: precision, History: history})
	}
	if err := validateMetrics(metrics); err != nil {
		return "", 0, err
	}
	document := DefaultDeviceDashboard(metrics)
	if err := ValidateDashboardDocument(document); err != nil {
		return "", 0, err
	}
	dashboard := "device-default:" + id
	var dv int
	if err := tx.QueryRow(ctx, `INSERT INTO entity_dashboard_templates(id,name,draft,published_version) VALUES($1,$2,$3,1) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,draft=EXCLUDED.draft,revision=entity_dashboard_templates.revision+1,published_version=entity_dashboard_templates.published_version+1,updated_at=now() RETURNING published_version`, dashboard, "Giám sát · "+name, document).Scan(&dv); err != nil {
		return "", 0, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO entity_dashboard_versions(template_id,version,document) VALUES($1,$2,$3)", dashboard, dv, document); err != nil {
		return "", 0, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO entity_profiles(id,name,revision,default_template_id,default_template_version,origin_template_id,origin_template_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,revision=EXCLUDED.revision,default_template_id=EXCLUDED.default_template_id,default_template_version=EXCLUDED.default_template_version,origin_template_version=EXCLUDED.origin_template_version`, profile, "Tạo từ mẫu: "+name+fmt.Sprintf(" v%d", version), pv, dashboard, dv, id, version); err != nil {
		return "", 0, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO entity_profile_versions(profile_id,version,metrics,default_template_id,default_template_version) VALUES($1,$2,$3,$4,$5)", profile, pv, metrics, dashboard, dv); err != nil {
		return "", 0, err
	}
	_, err = tx.Exec(ctx, "INSERT INTO device_template_profile_versions(template_id,template_version,profile_id,profile_version) VALUES($1,$2,$3,$4)", id, version, profile, pv)
	return profile, pv, err
}

func (s Registry) provisionDeviceDashboard(ctx context.Context, tx pgx.Tx, deviceID string) error {
	var template string
	if err := tx.QueryRow(ctx, "SELECT COALESCE(template_id,'') FROM devices WHERE id=$1", deviceID).Scan(&template); err != nil {
		return err
	}
	if template == "" {
		return nil
	}
	profile, version, err := s.syncDeviceTemplateProfile(ctx, tx, template)
	if err != nil {
		return err
	}
	entity := "legacy:devices:" + deviceID
	updated, err := tx.Exec(ctx, "UPDATE entities SET profile_id=$2,profile_version=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND (profile_id IS NULL OR profile_id=$2)", entity, profile, version)
	if err != nil {
		return err
	}
	if updated.RowsAffected() == 0 {
		return nil
	}
	var metrics []MetricDefinition
	if err = tx.QueryRow(ctx, "SELECT metrics FROM entity_profile_versions WHERE profile_id=$1 AND version=$2", profile, version).Scan(&metrics); err != nil {
		return err
	}
	for _, m := range metrics {
		sourceKey := m.SourceKey
		if sourceKey == "" {
			sourceKey = m.Key
		}
		var tag, kind, unit string
		var history bool
		e := tx.QueryRow(ctx, "SELECT id,datatype,COALESCE(unit,''),store_history FROM tags WHERE device_id=$1 AND key=$2 AND deleted_at IS NULL", deviceID, sourceKey).Scan(&tag, &kind, &unit, &history)
		if e == pgx.ErrNoRows {
			continue
		}
		if e != nil {
			return e
		}
		if kind != m.DataType || units.Canonical(unit) != units.Canonical(m.Unit) || (m.History && !history) {
			continue
		}
		if _, e = tx.Exec(ctx, "INSERT INTO entity_metric_bindings(entity_id,metric_key,tag_id) VALUES($1,$2,$3) ON CONFLICT(entity_id,metric_key) DO NOTHING", entity, m.Key, tag); e != nil {
			return e
		}
	}
	return nil
}

func (s Registry) TemplateSemanticInfo(ctx context.Context, id string) (json.RawMessage, error) {
	return s.List(ctx, `SELECT l.*,p.name FROM device_template_profile_versions l JOIN entity_profiles p ON p.id=l.profile_id WHERE l.template_id=$1 ORDER BY template_version DESC`, id)
}

// Backfill defaults without replacing any manually configured or pinned dashboard.
func (s Registry) EnsureDeviceTemplateDefaults(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, "SELECT id FROM device_templates WHERE deleted_at IS NULL ORDER BY id")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, _, err = s.syncDeviceTemplateProfile(ctx, tx, id); err != nil {
			return err
		}
	}
	rows, err = tx.Query(ctx, "SELECT d.id FROM devices d JOIN device_templates t ON t.id=d.template_id AND t.version=d.template_version JOIN entities e ON e.id='legacy:devices:'||d.id WHERE d.deleted_at IS NULL AND t.deleted_at IS NULL AND e.profile_id IS NULL ORDER BY d.id")
	if err != nil {
		return err
	}
	ids = nil
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err = s.provisionDeviceDashboard(ctx, tx, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
