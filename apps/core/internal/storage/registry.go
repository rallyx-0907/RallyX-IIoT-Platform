package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/telemetry"
)

var ErrValidation = errors.New("validation failed")

type Registry struct{ Pool *pgxpool.Pool }
type definition struct {
	Fields   map[string]string
	Required []string
}

var resources = map[string]definition{
	"sites":      {map[string]string{"id": "id", "name": "name"}, []string{"name"}},
	"areas":      {map[string]string{"id": "id", "site_id": "id", "name": "name"}, []string{"site_id", "name"}},
	"panels":     {map[string]string{"id": "id", "area_id": "id", "name": "name"}, []string{"area_id", "name"}},
	"assets":     {map[string]string{"id": "id", "panel_id": "id", "name": "name", "type": "name", "enabled": "bool"}, []string{"panel_id", "name"}},
	"connectors": {map[string]string{"id": "id", "site_id": "id", "name": "name", "type": "connector", "config": "object"}, []string{"site_id", "name", "type"}},
	"devices":    {map[string]string{"id": "id", "connector_id": "id", "asset_id": "id", "name": "name", "config": "object"}, []string{"connector_id", "name"}},
	"tags":       {map[string]string{"id": "id", "asset_id": "id", "device_id": "id", "key": "id", "name": "name", "datatype": "datatype", "unit": "unit", "scale": "number", "semantic": "semantic", "mapping": "object", "sample_policy": "sample", "stale_seconds": "seconds"}, []string{"asset_id", "key", "name", "datatype"}},
	"rules":      {map[string]string{"id": "id", "tag_id": "id", "name": "name", "type": "rule", "threshold": "number", "hysteresis": "nonnegative", "stale_seconds": "seconds", "severity": "severity", "enabled": "bool"}, []string{"tag_id", "name", "type"}},
}

func (s Registry) Write(ctx context.Context, resource, id string, body map[string]any, actor string) (json.RawMessage, error) {
	def, ok := resources[resource]
	if !ok {
		return nil, ErrValidation
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("%w: empty body", ErrValidation)
	}
	if id == "" {
		for _, key := range def.Required {
			if _, ok := body[key]; !ok {
				return nil, fmt.Errorf("%w: %s is required", ErrValidation, key)
			}
		}
		if _, ok := body["id"]; !ok {
			body["id"] = auth.RandomID()
		}
	} else {
		for _, key := range []string{"id", "asset_id", "device_id", "tag_id"} {
			if _, ok := body[key]; ok {
				return nil, fmt.Errorf("%w: %s is immutable", ErrValidation, key)
			}
		}
	}
	keys := make([]string, 0, len(body))
	for key, value := range body {
		kind, exists := def.Fields[key]
		if !exists || !valid(kind, value) {
			return nil, fmt.Errorf("%w: invalid %s", ErrValidation, key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if resource == "tags" && id != "" {
		var assetID, oldSemantic, oldDatatype string
		if err := tx.QueryRow(ctx, "SELECT asset_id FROM tags WHERE id=$1", id).Scan(&assetID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "SELECT id FROM assets WHERE id=$1 FOR UPDATE", assetID); err != nil {
			return nil, err
		}
		if err := tx.QueryRow(ctx, "SELECT semantic,datatype FROM tags WHERE id=$1 FOR UPDATE", id).Scan(&oldSemantic, &oldDatatype); err != nil {
			return nil, err
		}
		if semantic, ok := body["semantic"].(string); ok && semantic != oldSemantic {
			var open bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM runtime_sessions WHERE asset_id=$1 AND kind=$2 AND ended_at IS NULL)", assetID, oldSemantic).Scan(&open); err != nil {
				return nil, err
			}
			if open {
				return nil, fmt.Errorf("%w: stop the active source before changing its semantic", ErrValidation)
			}
		}
		if datatype, ok := body["datatype"].(string); ok && datatype != oldDatatype {
			var incompatible bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tag_current_state WHERE tag_id=$1) OR EXISTS(SELECT 1 FROM rules WHERE tag_id=$1 AND ((type='fault' AND $2<>'boolean') OR (type IN ('high','low') AND $2<>'number')))`, id, datatype).Scan(&incompatible); err != nil {
				return nil, err
			}
			if incompatible {
				return nil, fmt.Errorf("%w: datatype change would invalidate recorded state or attached rules; create a new tag", ErrValidation)
			}
		}
	}
	if resource == "rules" && id != "" {
		var assetID string
		if err := tx.QueryRow(ctx, "SELECT t.asset_id FROM tags t JOIN rules r ON r.tag_id=t.id WHERE r.id=$1", id).Scan(&assetID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "SELECT id FROM assets WHERE id=$1 FOR UPDATE", assetID); err != nil {
			return nil, err
		}
	}
	if resource == "rules" {
		if ruleType, _ := body["type"].(string); ruleType == "high" || ruleType == "low" || ruleType == "fault" {
			var datatype string
			if id == "" {
				err = tx.QueryRow(ctx, "SELECT datatype FROM tags WHERE id=$1", body["tag_id"]).Scan(&datatype)
			} else {
				err = tx.QueryRow(ctx, "SELECT t.datatype FROM tags t JOIN rules r ON r.tag_id=t.id WHERE r.id=$1", id).Scan(&datatype)
			}
			if err != nil || (ruleType == "fault" && datatype != "boolean") || (ruleType != "fault" && datatype != "number") {
				return nil, fmt.Errorf("%w: rule/tag datatype mismatch", ErrValidation)
			}
		}
	}
	args := make([]any, 0, len(keys)+1)
	slots := make([]string, 0, len(keys))
	sets := make([]string, 0, len(keys))
	for i, key := range keys {
		args = append(args, body[key])
		slot := fmt.Sprintf("$%d", i+1)
		slots = append(slots, slot)
		sets = append(sets, key+"="+slot)
	}
	var query, action string
	if id == "" {
		query = "INSERT INTO " + resource + " (" + strings.Join(keys, ",") + ") VALUES (" + strings.Join(slots, ",") + ") RETURNING to_jsonb(" + resource + ".*)"
		action = "create:" + resource
	} else {
		args = append(args, id)
		query = "UPDATE " + resource + " SET " + strings.Join(sets, ",") + fmt.Sprintf(" WHERE id=$%d RETURNING to_jsonb(%s.*)", len(args), resource)
		action = "update:" + resource
	}
	var result json.RawMessage
	if err := tx.QueryRow(ctx, query, args...).Scan(&result); err != nil {
		return nil, err
	}
	var returned struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(result, &returned); err != nil {
		return nil, err
	}
	if resource == "rules" && id != "" {
		if enabled, ok := body["enabled"].(bool); ok && !enabled {
			rows, err := tx.Query(ctx, "UPDATE alarms SET cleared_at=now() WHERE rule_id=$1 AND cleared_at IS NULL RETURNING id,asset_id", id)
			if err != nil {
				return nil, err
			}
			type cleared struct {
				ID    int64
				Asset string
			}
			var alarms []cleared
			for rows.Next() {
				var alarm cleared
				if err := rows.Scan(&alarm.ID, &alarm.Asset); err != nil {
					rows.Close()
					return nil, err
				}
				alarms = append(alarms, alarm)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return nil, err
			}
			for _, alarm := range alarms {
				if _, err := tx.Exec(ctx, "INSERT INTO events(asset_id,kind,ts,detail) VALUES($1,'alarm_cleared',now(),jsonb_build_object('alarm_id',$2::bigint,'reason','rule_disabled'))", alarm.Asset, alarm.ID); err != nil {
					return nil, err
				}
			}
		}
	}
	if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,$2,$3)", actor, action, returned.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func valid(kind string, value any) bool {
	s, str := value.(string)
	switch kind {
	case "id":
		return str && telemetry.Identifier.MatchString(s)
	case "name":
		return str && len(strings.TrimSpace(s)) > 0 && len(s) <= 200
	case "unit":
		return str && len(s) <= 32
	case "bool":
		_, ok := value.(bool)
		return ok
	case "number", "nonnegative", "seconds":
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return false
		}
		if kind == "seconds" {
			return n >= 1 && n <= 86400 && math.Trunc(n) == n
		}
		return kind != "nonnegative" || n >= 0
	case "object":
		_, ok := value.(map[string]any)
		return ok && !containsSecrets(value)
	case "datatype":
		return str && (s == "boolean" || s == "number" || s == "string")
	case "semantic":
		return str && (s == "" || s == "run" || s == "fault")
	case "sample":
		return str && (s == "all" || s == "on_change" || s == "none")
	case "connector":
		return str && (s == "simulator" || s == "mqtt" || s == "modbus-tcp" || s == "modbus-rtu")
	case "rule":
		return str && (s == "fault" || s == "high" || s == "low" || s == "stale")
	case "severity":
		return str && (s == "info" || s == "warning" || s == "critical")
	}
	return false
}

func containsSecrets(value any) bool {
	switch v := value.(type) {
	case map[string]any:
		for k, child := range v {
			key := strings.ToLower(k)
			if strings.Contains(key, "password") || strings.Contains(key, "secret") || strings.Contains(key, "token") || containsSecrets(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if containsSecrets(child) {
				return true
			}
		}
	}
	return false
}

func (s Registry) List(ctx context.Context, query string, args ...any) (json.RawMessage, error) {
	var result json.RawMessage
	err := s.Pool.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(to_jsonb(result)),'[]'::jsonb) FROM ("+query+") result", args...).Scan(&result)
	return result, err
}

const TreeQuery = `SELECT s.id,s.name,COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'panels',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'assets',COALESCE((
   SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name,x.id) FROM assets x WHERE x.panel_id=p.id
  ),'[]'::jsonb)) ORDER BY p.name,p.id) FROM panels p WHERE p.area_id=a.id
 ),'[]'::jsonb)) ORDER BY a.name,a.id) FROM areas a WHERE a.site_id=s.id
),'[]'::jsonb) AS areas FROM sites s ORDER BY s.name,s.id`

const AssetSummaryQuery = `SELECT a.*,ar.site_id,ar.name AS area_name,p.name AS panel_name,
 CASE
 WHEN EXISTS(SELECT 1 FROM tags t JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.semantic='fault' AND s.quality='good' AND s.value='true'::jsonb) THEN 'FAULT'
 WHEN EXISTS(SELECT 1 FROM tags t LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.semantic IN ('run','fault') AND (s.quality IS NULL OR s.quality<>'good')) THEN 'UNKNOWN'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.semantic='run' AND s.quality='good' AND s.value='true'::jsonb) THEN 'RUN'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.semantic='run' AND s.quality='good' AND s.value='false'::jsonb) THEN 'STOP'
 ELSE 'UNKNOWN' END AS operating_state,
 (SELECT count(*) FROM events e WHERE e.asset_id=a.id AND e.kind='start') AS start_count,
 (SELECT count(*) FROM events e WHERE e.asset_id=a.id AND e.kind='fault') AS fault_count,
 COALESCE((SELECT sum(extract(epoch FROM LEAST(COALESCE(rs.ended_at,now()),now())-GREATEST(rs.started_at,date_trunc('day',now())))) FROM runtime_sessions rs WHERE rs.asset_id=a.id AND rs.kind='run' AND rs.started_at<now() AND (rs.ended_at IS NULL OR rs.ended_at>date_trunc('day',now()))),0)::float8 AS runtime_today_seconds,
 (SELECT max(s.ts) FROM tags t JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id) AS last_telemetry
 FROM assets a JOIN panels p ON p.id=a.panel_id JOIN areas ar ON ar.id=p.area_id ORDER BY a.name,a.id`
