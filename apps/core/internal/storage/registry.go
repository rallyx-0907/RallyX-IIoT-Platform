package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/secrets"
	"rallyx.local/core/internal/telemetry"
)

var ErrValidation = errors.New("validation failed")

type Registry struct {
	Pool  *pgxpool.Pool
	Vault *secrets.Vault
}
type definition struct {
	Fields   map[string]string
	Required []string
}

var resources = map[string]definition{
	"sites":            {map[string]string{"id": "id", "name": "name"}, []string{"name"}},
	"areas":            {map[string]string{"id": "id", "site_id": "id", "name": "name"}, []string{"site_id", "name"}},
	"panels":           {map[string]string{"id": "id", "area_id": "id", "name": "name"}, []string{"area_id", "name"}},
	"assets":           {map[string]string{"id": "id", "area_id": "id", "name": "name", "type": "name", "enabled": "bool", "metadata": "object"}, []string{"area_id", "name"}},
	"connections":      {map[string]string{"id": "id", "site_id": "id", "name": "name", "protocol": "connector", "enabled": "bool", "polling_interval_ms": "milliseconds", "timeout_ms": "timeout", "retry_policy": "object", "protocol_config": "object", "updated_at": "timestamp"}, []string{"site_id", "name", "protocol"}},
	"devices":          {map[string]string{"id": "id", "asset_id": "id", "area_id": "id", "connection_id": "id", "template_id": "id", "template_version": "integer", "name": "name", "manufacturer": "text", "model": "text", "serial_number": "text", "protocol_device_address": "text", "enabled": "bool", "metadata": "object", "updated_at": "timestamp"}, []string{"asset_id", "connection_id", "name"}},
	"device_templates": {map[string]string{"id": "id", "name": "name", "manufacturer": "text", "model": "text", "protocol": "connector", "version": "integer", "description": "text", "tag_definitions": "definitions", "updated_at": "timestamp"}, []string{"name", "protocol", "tag_definitions"}},
	"tags":             {map[string]string{"id": "id", "asset_id": "id", "device_id": "id", "key": "id", "name": "name", "datatype": "datatype", "data_type": "data_type", "source_type": "connector", "address": "text", "function_code": "function_code", "byte_order": "order", "word_order": "order", "unit": "unit", "scale": "number", "offset": "number", "deadband": "nonnegative", "poll_interval_ms": "nullable_milliseconds", "semantic": "semantic", "mapping": "object", "metadata": "object", "sample_policy": "sample", "stale_seconds": "seconds", "store_history": "bool", "realtime_enabled": "bool", "enabled": "bool", "updated_at": "timestamp"}, []string{"device_id", "key", "name"}},
	"rules":            {map[string]string{"id": "id", "tag_id": "id", "name": "name", "type": "rule", "threshold": "number", "hysteresis": "nonnegative", "stale_seconds": "seconds", "severity": "severity", "enabled": "bool", "condition_value": "scalar", "activation_delay_ms": "delay", "clear_delay_ms": "delay", "updated_at": "timestamp"}, []string{"tag_id", "name", "type"}},
}

func (s Registry) Write(ctx context.Context, resource, id string, body map[string]any, actor string) (json.RawMessage, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	result, err := s.write(ctx, tx, resource, id, body, actor)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (s Registry) write(ctx context.Context, tx pgx.Tx, resource, id string, body map[string]any, actor string) (json.RawMessage, error) {
	if resource == "rules" {
		return s.writeRule(ctx, tx, id, body, actor)
	}
	var err error
	copyBody := make(map[string]any, len(body))
	for key, value := range body {
		copyBody[key] = value
	}
	body = copyBody
	if len(body) == 0 {
		return nil, fmt.Errorf("%w: empty body", ErrValidation)
	}
	credentialInput, credentialsPresent := body["credentials"]
	delete(body, "credentials")
	if credentialsPresent && resource != "connections" {
		return nil, ErrValidation
	}
	overrideInput, overridesPresent := body["tag_overrides"]
	overrides, overridesOK := overrideInput.(map[string]any)
	delete(body, "tag_overrides")
	if overridesPresent && (resource != "devices" || !overridesOK) {
		return nil, fmt.Errorf("%w: invalid tag overrides", ErrValidation)
	}
	var normalizeErr error
	body, normalizeErr = normalizeConfiguration(resource, id, body)
	if normalizeErr != nil {
		return nil, normalizeErr
	}
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
	if err := lockConfigurationAssets(ctx, tx, resource, id, body); err != nil {
		return nil, err
	}
	if err := prepareConfiguration(ctx, tx, resource, id, body); err != nil {
		return nil, err
	}
	keys = keys[:0]
	for key, value := range body {
		kind, ok := def.Fields[key]
		if !ok || !valid(kind, value) {
			return nil, fmt.Errorf("%w: invalid %s", ErrValidation, key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
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
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM runtime_sessions WHERE tag_id=$1 AND kind=$2 AND ended_at IS NULL)", id, oldSemantic).Scan(&open); err != nil {
				return nil, err
			}
			if open {
				return nil, fmt.Errorf("%w: stop the active source before changing its semantic", ErrValidation)
			}
		}
		if datatype, ok := body["datatype"].(string); ok && datatype != oldDatatype {
			var incompatible bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tag_current_state WHERE tag_id=$1) OR EXISTS(SELECT 1 FROM rules WHERE tag_id=$1 AND ((type='fault' AND $2<>'boolean') OR (type IN ('high','low') AND $2<>'number'))) OR EXISTS(SELECT 1 FROM rule_conditions WHERE tag_id=$1)`, id, datatype).Scan(&incompatible); err != nil {
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
		sets = append(sets, "\""+key+"\"="+slot)
	}
	var query, action string
	if id == "" {
		quoted := make([]string, len(keys))
		for i, key := range keys {
			quoted[i] = "\"" + key + "\""
		}
		query = "INSERT INTO " + resource + " (" + strings.Join(quoted, ",") + ") VALUES (" + strings.Join(slots, ",") + ") RETURNING to_jsonb(" + resource + ".*)"
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
	if credentialsPresent {
		if credentialInput == nil {
			if _, err := tx.Exec(ctx, "DELETE FROM connection_credentials WHERE connection_id=$1", returned.ID); err != nil {
				return nil, err
			}
		} else {
			input, ok := credentialInput.(map[string]any)
			if !ok || len(input) > 2 || s.Vault == nil {
				return nil, fmt.Errorf("%w: credential storage unavailable or invalid credentials", ErrValidation)
			}
			username, userOK := input["username"].(string)
			password, passOK := input["password"].(string)
			if !userOK || !passOK || len(username) > 1024 || len(password) > 4096 {
				return nil, ErrValidation
			}
			nonce, ciphertext, err := s.Vault.Seal(returned.ID, secrets.Credentials{Username: username, Password: password})
			if err != nil {
				return nil, err
			}
			if _, err := tx.Exec(ctx, "INSERT INTO connection_credentials(connection_id,nonce,ciphertext) VALUES($1,$2,$3) ON CONFLICT(connection_id) DO UPDATE SET nonce=excluded.nonce,ciphertext=excluded.ciphertext,updated_at=now()", returned.ID, nonce, ciphertext); err != nil {
				return nil, err
			}
		}
	}
	if resource == "devices" && id == "" {
		if err := cloneDeviceTemplate(ctx, tx, returned.ID, body, overrides, actor); err != nil {
			return nil, err
		}
	}
	if err := configurationLifecycle(ctx, tx, resource, returned.ID, body); err != nil {
		return nil, err
	}
	if resource == "rules" && id != "" {
		if enabled, ok := body["enabled"].(bool); ok && !enabled {
			rows, err := tx.Query(ctx, "UPDATE alarms SET cleared_at=GREATEST(activated_at,now()),clear_reason='rule_disabled' WHERE rule_id=$1 AND cleared_at IS NULL RETURNING id,asset_id", id)
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
	return result, nil
}

func valid(kind string, value any) bool {
	if kind == "nullable_milliseconds" {
		return value == nil || valid("milliseconds", value)
	}
	s, str := value.(string)
	switch kind {
	case "id":
		return str && telemetry.Identifier.MatchString(s)
	case "name":
		return str && len(strings.TrimSpace(s)) > 0 && len(s) <= 200
	case "unit":
		return str && len(s) <= 32
	case "text":
		return str && len(s) <= 4000
	case "timestamp":
		_, ok := value.(time.Time)
		return ok
	case "integer", "milliseconds", "timeout", "delay", "function_code":
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n {
			return false
		}
		switch kind {
		case "milliseconds":
			return n >= 100 && n <= 86400000
		case "timeout":
			return n >= 100 && n <= 60000
		case "delay":
			return n >= 0 && n <= 86400000
		case "function_code":
			return n >= 1 && n <= 4
		default:
			return n >= 1 && n <= 2147483647
		}
	case "data_type":
		return str && (s == "bool" || s == "int16" || s == "uint16" || s == "int32" || s == "uint32" || s == "float32" || s == "float64" || s == "string")
	case "order":
		return str && (s == "BE" || s == "LE")
	case "definitions":
		values, ok := value.([]any)
		return ok && len(values) > 0 && len(values) <= 1000
	case "scalar":
		switch value.(type) {
		case bool, float64, string:
			return true
		}
		return false
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
 SELECT jsonb_agg(jsonb_build_object('id',ar.id,'name',ar.name,'assets',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'type',a.type,'enabled',a.enabled,'devices',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'connection_id',d.connection_id,'status',d.status,'enabled',d.enabled,'tags',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',t.id,'key',t.key,'name',t.name,'data_type',t.data_type,'unit',t.unit,'enabled',t.enabled,'realtime_enabled',t.realtime_enabled,'store_history',t.store_history) ORDER BY t.name,t.id) FROM tags t WHERE t.device_id=d.id AND t.deleted_at IS NULL
   ),'[]'::jsonb)) ORDER BY d.name,d.id) FROM devices d WHERE d.asset_id=a.id AND d.deleted_at IS NULL
  ),'[]'::jsonb)) ORDER BY a.name,a.id) FROM assets a WHERE a.area_id=ar.id AND a.deleted_at IS NULL
 ),'[]'::jsonb)) ORDER BY ar.name,ar.id) FROM areas ar WHERE ar.site_id=s.id
),'[]'::jsonb) AS areas FROM sites s ORDER BY s.name,s.id`

const AssetSummaryQuery = `SELECT a.*,ar.site_id,ar.name AS area_name,''::text AS panel_name,
 CASE
 WHEN NOT a.enabled THEN 'DISABLED'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN devices d ON d.id=t.device_id JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.enabled AND d.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND t.semantic='fault' AND upper(s.quality)='GOOD' AND s.value='true'::jsonb) THEN 'FAULT'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN devices d ON d.id=t.device_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.enabled AND d.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND t.semantic IN ('run','fault') AND (s.quality IS NULL OR upper(s.quality)<>'GOOD')) THEN 'UNKNOWN'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN devices d ON d.id=t.device_id JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.enabled AND d.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND t.semantic='run' AND upper(s.quality)='GOOD' AND s.value='true'::jsonb) THEN 'RUN'
 WHEN EXISTS(SELECT 1 FROM tags t JOIN devices d ON d.id=t.device_id JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id AND t.enabled AND d.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND t.semantic='run' AND upper(s.quality)='GOOD' AND s.value='false'::jsonb) THEN 'STOP'
 ELSE 'UNKNOWN' END AS operating_state,
 (SELECT count(*) FROM events e WHERE e.asset_id=a.id AND e.kind='start') AS start_count,
 (SELECT count(*) FROM events e WHERE e.asset_id=a.id AND e.kind='fault') AS fault_count,
 COALESCE((SELECT sum(extract(epoch FROM LEAST(COALESCE(rs.ended_at,now()),now())-GREATEST(rs.started_at,date_trunc('day',now())))) FROM runtime_sessions rs WHERE rs.asset_id=a.id AND rs.kind='run' AND rs.started_at<now() AND (rs.ended_at IS NULL OR rs.ended_at>date_trunc('day',now()))),0)::float8 AS runtime_today_seconds,
 (SELECT max(s.ts) FROM tags t JOIN tag_current_state s ON s.tag_id=t.id WHERE t.asset_id=a.id) AS last_telemetry
 FROM assets a JOIN areas ar ON ar.id=a.area_id WHERE a.deleted_at IS NULL ORDER BY a.name,a.id`
