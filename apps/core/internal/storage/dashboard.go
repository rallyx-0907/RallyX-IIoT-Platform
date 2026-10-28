package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"unicode/utf8"

	"rallyx.local/core/internal/auth"
)

func (s Registry) ListWidgets(ctx context.Context, userID string) (json.RawMessage, error) {
	return s.List(ctx, `SELECT w.*,t.name AS tag_name,t.unit,t.data_type,t.store_history,t.realtime_enabled,(t.deleted_at IS NOT NULL OR d.deleted_at IS NOT NULL OR a.deleted_at IS NOT NULL) AS archived,t.enabled AS tag_enabled,d.name AS device_name,a.name AS asset_name,t.device_id,t.semantic,t.stale_seconds,d.enabled AS device_enabled,a.enabled AS asset_enabled,s.value,s.ts,upper(COALESCE(s.quality,t.quality)) AS quality FROM dashboard_widgets w JOIN tags t ON t.id=w.tag_id JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE w.user_id=$1 ORDER BY w.position,w.created_at,w.id`, userID)
}

func (s Registry) SaveWidget(ctx context.Context, userID, id string, body map[string]any) (json.RawMessage, error) {
	if len(body) == 0 {
		return nil, ErrValidation
	}
	for field, value := range body {
		switch field {
		case "tag_id":
			if !valid("id", value) {
				return nil, ErrValidation
			}
		case "board_id":
			if value != nil && !valid("id", value) {
				return nil, ErrValidation
			}
		case "type":
			if value != "value" && value != "status" && value != "trend" && value != "gauge" && value != "level" {
				return nil, ErrValidation
			}
		case "title":
			if !valid("text", value) || len(value.(string)) > 200 {
				return nil, ErrValidation
			}
		case "position":
			if !boundedInteger(value, 0, 100000) {
				return nil, ErrValidation
			}
		case "settings":
			if _, ok := value.(map[string]any); !ok {
				return nil, ErrValidation
			}
		default:
			return nil, fmt.Errorf("%w: unsupported widget field %s", ErrValidation, field)
		}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	tagID, kind, title, position := "", "value", "", 0
	var boardID *string
	settings := map[string]any{}
	if id != "" {
		var raw json.RawMessage
		if err := tx.QueryRow(ctx, "SELECT tag_id,type,title,position,settings,board_id FROM dashboard_widgets WHERE id=$1 AND user_id=$2 FOR UPDATE", id, userID).Scan(&tagID, &kind, &title, &position, &raw, &boardID); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &settings); err != nil {
			return nil, err
		}
	}
	if v, ok := body["tag_id"].(string); ok {
		tagID = v
	}
	if v, ok := body["type"].(string); ok {
		kind = v
	}
	if v, ok := body["title"].(string); ok {
		title = v
	}
	if v, ok := body["position"].(float64); ok {
		position = int(v)
	}
	if v, ok := body["settings"].(map[string]any); ok {
		for k, x := range v {
			settings[k] = x
		}
	}
	if v, ok := body["board_id"]; ok {
		boardID = nil
		if str, yes := v.(string); yes {
			boardID = &str
		}
	}
	if boardID != nil {
		var owned bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM dashboard_boards WHERE id=$1 AND user_id=$2)", *boardID, userID).Scan(&owned); err != nil {
			return nil, err
		}
		if !owned {
			return nil, fmt.Errorf("%w: dashboard board does not exist", ErrValidation)
		}
	}
	var datatype string
	var history bool
	if err := tx.QueryRow(ctx, "SELECT datatype,store_history FROM tags WHERE id=$1 AND deleted_at IS NULL", tagID).Scan(&datatype, &history); err != nil {
		return nil, fmt.Errorf("%w: widget tag does not exist", ErrValidation)
	}
	if (kind == "trend" || kind == "gauge" || kind == "level") && datatype != "number" {
		return nil, fmt.Errorf("%w: %s widgets require a numeric tag", ErrValidation, kind)
	}
	if kind == "trend" && !history {
		return nil, fmt.Errorf("%w: trend widgets require history enabled", ErrValidation)
	}
	if kind == "status" && datatype != "boolean" {
		return nil, fmt.Errorf("%w: status widgets require a boolean tag", ErrValidation)
	}
	if err := validateWidgetSettings(settings, kind); err != nil {
		return nil, err
	}
	var result json.RawMessage
	action := "update:dashboard"
	if id == "" {
		id = auth.RandomID()
		action = "create:dashboard"
		err = tx.QueryRow(ctx, "INSERT INTO dashboard_widgets(id,user_id,tag_id,type,title,position,settings,board_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(dashboard_widgets.*)", id, userID, tagID, kind, title, position, settings, boardID).Scan(&result)
	} else {
		err = tx.QueryRow(ctx, "UPDATE dashboard_widgets SET tag_id=$3,type=$4,title=$5,position=$6,settings=$7,board_id=$8,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING to_jsonb(dashboard_widgets.*)", id, userID, tagID, kind, title, position, settings, boardID).Scan(&result)
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,$2,$3)", userID, action, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func validateWidgetSettings(settings map[string]any, kind string) error {
	for k, v := range settings {
		switch k {
		case "range_minutes":
			if !boundedInteger(v, 1, 10080) {
				return ErrValidation
			}
		case "precision":
			if !boundedInteger(v, 0, 6) {
				return ErrValidation
			}
		case "show_unit":
			if _, ok := v.(bool); !ok {
				return ErrValidation
			}
		case "min", "max":
			n, ok := finiteNumber(v)
			if !ok {
				return ErrValidation
			}
			settings[k] = n
		case "size":
			if v != "normal" && v != "wide" {
				return ErrValidation
			}
		case "on_label", "off_label":
			if text, ok := v.(string); !ok || utf8.RuneCountInString(text) > 80 {
				return ErrValidation
			}
		default:
			return fmt.Errorf("%w: unsupported widget setting %s", ErrValidation, k)
		}
	}
	if kind == "gauge" || kind == "level" {
		min, hasMin := finiteNumber(settings["min"])
		max, hasMax := finiteNumber(settings["max"])
		if !hasMin {
			min = 0
		}
		if !hasMax {
			max = 100
		}
		if min >= max {
			return fmt.Errorf("%w: gauge minimum must be less than maximum", ErrValidation)
		}
	}
	return nil
}

func finiteNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		if !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n, true
		}
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

func (s Registry) DeleteWidget(ctx context.Context, userID, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var removed string
	if err := tx.QueryRow(ctx, "DELETE FROM dashboard_widgets WHERE id=$1 AND user_id=$2 RETURNING id", id, userID).Scan(&removed); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'delete:dashboard',$2)", userID, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
