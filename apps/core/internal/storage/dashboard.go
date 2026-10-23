package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"rallyx.local/core/internal/auth"
)

func (s Registry) ListWidgets(ctx context.Context, userID string) (json.RawMessage, error) {
	return s.List(ctx, `SELECT w.*,t.name AS tag_name,t.unit,t.data_type,t.store_history,t.realtime_enabled,(t.deleted_at IS NOT NULL OR d.deleted_at IS NOT NULL OR a.deleted_at IS NOT NULL) AS archived,t.enabled AS tag_enabled,d.name AS device_name,a.name AS asset_name,s.value,s.ts,upper(COALESCE(s.quality,t.quality)) AS quality FROM dashboard_widgets w JOIN tags t ON t.id=w.tag_id JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE w.user_id=$1 ORDER BY w.position,w.created_at,w.id`, userID)
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
		case "type":
			if value != "value" && value != "status" && value != "trend" {
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
			settings, ok := value.(map[string]any)
			if !ok {
				return nil, ErrValidation
			}
			for key, option := range settings {
				switch key {
				case "range_minutes":
					if !boundedInteger(option, 1, 10080) {
						return nil, ErrValidation
					}
				case "precision":
					if !boundedInteger(option, 0, 6) {
						return nil, ErrValidation
					}
				case "show_unit":
					if _, ok := option.(bool); !ok {
						return nil, ErrValidation
					}
				default:
					return nil, fmt.Errorf("%w: unsupported widget setting %s", ErrValidation, key)
				}
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
	tagID, kind, title, position, settings := "", "value", "", 0, map[string]any{}
	if id != "" {
		var raw json.RawMessage
		if err := tx.QueryRow(ctx, "SELECT tag_id,type,title,position,settings FROM dashboard_widgets WHERE id=$1 AND user_id=$2 FOR UPDATE", id, userID).Scan(&tagID, &kind, &title, &position, &raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &settings); err != nil {
			return nil, err
		}
	}
	if value, ok := body["tag_id"].(string); ok {
		tagID = value
	}
	if value, ok := body["type"].(string); ok {
		kind = value
	}
	if value, ok := body["title"].(string); ok {
		title = value
	}
	if value, ok := body["position"].(float64); ok {
		position = int(value)
	}
	if value, ok := body["settings"].(map[string]any); ok {
		settings = value
	}
	var datatype string
	var history bool
	if err := tx.QueryRow(ctx, "SELECT datatype,store_history FROM tags WHERE id=$1 AND deleted_at IS NULL", tagID).Scan(&datatype, &history); err != nil {
		return nil, fmt.Errorf("%w: widget tag does not exist", ErrValidation)
	}
	if kind == "trend" && (datatype != "number" || !history) {
		return nil, fmt.Errorf("%w: trend widgets require a numeric tag with history enabled", ErrValidation)
	}
	if kind == "status" && datatype != "boolean" {
		return nil, fmt.Errorf("%w: status widgets require a boolean tag", ErrValidation)
	}
	var result json.RawMessage
	action := "update:dashboard"
	if id == "" {
		id = auth.RandomID()
		action = "create:dashboard"
		err = tx.QueryRow(ctx, "INSERT INTO dashboard_widgets(id,user_id,tag_id,type,title,position,settings) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING to_jsonb(dashboard_widgets.*)", id, userID, tagID, kind, title, position, settings).Scan(&result)
	} else {
		err = tx.QueryRow(ctx, "UPDATE dashboard_widgets SET tag_id=$3,type=$4,title=$5,position=$6,settings=$7,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING to_jsonb(dashboard_widgets.*)", id, userID, tagID, kind, title, position, settings).Scan(&result)
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
