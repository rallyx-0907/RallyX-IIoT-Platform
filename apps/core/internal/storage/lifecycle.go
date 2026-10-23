package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func monitoringScope(resource string) string {
	switch resource {
	case "assets":
		return "t.asset_id=$1"
	case "devices":
		return "t.device_id=$1"
	case "tags":
		return "t.id=$1"
	case "connections":
		return "d.connection_id=$1"
	}
	return "false"
}

func lockConfigurationAssets(ctx context.Context, tx pgx.Tx, resource, id string, body map[string]any) error {
	if resource != "assets" && resource != "devices" && resource != "tags" && resource != "connections" {
		return nil
	}
	var query string
	var identity any = id
	if id == "" {
		switch resource {
		case "assets":
			return nil
		case "devices":
			query = "SELECT id FROM assets WHERE id=$1 FOR UPDATE"
			identity = body["asset_id"]
		case "tags":
			query = "SELECT a.id FROM assets a JOIN devices d ON d.asset_id=a.id WHERE d.id=$1 FOR UPDATE OF a"
			identity = body["device_id"]
		default:
			return nil
		}
	} else if resource == "assets" {
		query = "SELECT id FROM assets WHERE id=$1 FOR UPDATE"
	} else {
		query = "SELECT id FROM assets WHERE id IN (SELECT t.asset_id FROM tags t JOIN devices d ON d.id=t.device_id WHERE " + monitoringScope(resource) + ") ORDER BY id FOR UPDATE"
		if resource == "devices" {
			query = "SELECT a.id FROM assets a JOIN devices d ON d.asset_id=a.id WHERE d.id=$1 FOR UPDATE OF a"
		}
	}
	_, err := tx.Exec(ctx, query, identity)
	return err
}

func pauseMonitoring(ctx context.Context, tx pgx.Tx, resource, id, reason string) error {
	if monitoringScope(resource) == "false" {
		return nil
	}
	rows, err := tx.Query(ctx, "SELECT t.id FROM tags t JOIN devices d ON d.id=t.device_id WHERE "+monitoringScope(resource)+" ORDER BY t.id", id)
	if err != nil {
		return err
	}
	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			rows.Close()
			return err
		}
		tags = append(tags, tag)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(tags) == 0 {
		return nil
	}
	rows, err = tx.Query(ctx, "UPDATE runtime_sessions SET ended_at=GREATEST(started_at,now()),end_reason=$2 WHERE tag_id=ANY($1::text[]) AND ended_at IS NULL RETURNING asset_id,tag_id,kind,ended_at", tags, reason)
	if err != nil {
		return err
	}
	type paused struct {
		Asset, Tag, Kind string
		At               time.Time
	}
	var sessions []paused
	for rows.Next() {
		var session paused
		if err := rows.Scan(&session.Asset, &session.Tag, &session.Kind, &session.At); err != nil {
			rows.Close()
			return err
		}
		sessions = append(sessions, session)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, session := range sessions {
		if _, err := tx.Exec(ctx, "INSERT INTO events(asset_id,tag_id,kind,ts,detail) VALUES($1,$2,'monitoring_paused',$3,jsonb_build_object('reason',$4::text,'source_kind',$5::text)) ON CONFLICT DO NOTHING", session.Asset, session.Tag, session.At, reason, session.Kind); err != nil {
			return err
		}
	}
	rows, err = tx.Query(ctx, "UPDATE alarms SET cleared_at=GREATEST(activated_at,now()),clear_reason=$2 WHERE cleared_at IS NULL AND rule_id IN (SELECT id FROM rules WHERE tag_id=ANY($1::text[])) RETURNING id,asset_id,cleared_at", tags, reason)
	if err != nil {
		return err
	}
	type cleared struct {
		ID    int64
		Asset string
		At    time.Time
	}
	var alarms []cleared
	for rows.Next() {
		var alarm cleared
		if err := rows.Scan(&alarm.ID, &alarm.Asset, &alarm.At); err != nil {
			rows.Close()
			return err
		}
		alarms = append(alarms, alarm)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, alarm := range alarms {
		if _, err := tx.Exec(ctx, "INSERT INTO events(asset_id,kind,ts,detail) VALUES($1,'alarm_cleared',$2,jsonb_build_object('alarm_id',$3::bigint,'reason',$4::text))", alarm.Asset, alarm.At, alarm.ID, reason); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE tag_current_state SET quality='STALE' WHERE tag_id=ANY($1::text[])", tags); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE tags SET quality='STALE' WHERE id=ANY($1::text[])", tags)
	return err
}

func configurationLifecycle(ctx context.Context, tx pgx.Tx, resource, id string, body map[string]any) error {
	if enabled, present := body["enabled"].(bool); present {
		if !enabled {
			if err := pauseMonitoring(ctx, tx, resource, id, "configuration_disabled"); err != nil {
				return err
			}
		}
		switch resource {
		case "connections":
			if _, err := tx.Exec(ctx, "UPDATE connections SET status=CASE WHEN enabled THEN 'DISCONNECTED' ELSE 'DISABLED' END WHERE id=$1", id); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "UPDATE devices SET status=CASE WHEN enabled AND $2 THEN 'DISCONNECTED' ELSE 'DISABLED' END WHERE connection_id=$1 AND deleted_at IS NULL", id, enabled); err != nil {
				return err
			}
		case "devices":
			if _, err := tx.Exec(ctx, "UPDATE devices SET status=CASE WHEN enabled THEN 'DISCONNECTED' ELSE 'DISABLED' END WHERE id=$1", id); err != nil {
				return err
			}
		case "assets":
			if _, err := tx.Exec(ctx, "UPDATE devices SET status=CASE WHEN enabled AND $2 THEN 'DISCONNECTED' ELSE 'DISABLED' END WHERE asset_id=$1 AND deleted_at IS NULL", id, enabled); err != nil {
				return err
			}
		}
	}
	if resource == "devices" {
		if _, changed := body["connection_id"]; changed {
			if _, err := tx.Exec(ctx, "UPDATE tags t SET source_type=c.protocol,updated_at=now() FROM devices d JOIN connections c ON c.id=d.connection_id WHERE d.id=$1 AND t.device_id=d.id", id); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "UPDATE devices d SET status=CASE WHEN d.enabled AND c.enabled AND a.enabled THEN 'DISCONNECTED' ELSE 'DISABLED' END FROM connections c,assets a WHERE d.id=$1 AND c.id=d.connection_id AND a.id=d.asset_id", id)
			return err
		}
	}
	return nil
}

func (s Registry) Archive(ctx context.Context, resource, id, actor string) error {
	if resource != "connections" && resource != "devices" && resource != "tags" && resource != "device_templates" && resource != "assets" {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockConfigurationAssets(ctx, tx, resource, id, nil); err != nil {
		return err
	}
	if resource == "connections" {
		var locked string
		if err := tx.QueryRow(ctx, "SELECT id FROM connections WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&locked); err != nil {
			return err
		}
		var referenced bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM devices WHERE connection_id=$1 AND deleted_at IS NULL)", id).Scan(&referenced); err != nil {
			return err
		}
		if referenced {
			return fmt.Errorf("%w: move or archive associated devices before deleting a connection", ErrValidation)
		}
	}
	query := "UPDATE " + resource + " SET deleted_at=now()"
	if resource != "device_templates" {
		query += ",enabled=false"
	}
	query += " WHERE id=$1 AND deleted_at IS NULL RETURNING id"
	var archived string
	if err := tx.QueryRow(ctx, query, id).Scan(&archived); err != nil {
		return err
	}
	if err := pauseMonitoring(ctx, tx, resource, id, "configuration_archived"); err != nil {
		return err
	}
	if resource == "devices" {
		if _, err := tx.Exec(ctx, "UPDATE devices SET status='DISABLED' WHERE id=$1", id); err != nil {
			return err
		}
	}
	if resource == "connections" {
		if _, err := tx.Exec(ctx, "DELETE FROM connection_credentials WHERE connection_id=$1", id); err != nil {
			return err
		}
	}
	if resource == "assets" {
		if _, err := tx.Exec(ctx, "UPDATE devices SET enabled=false,status='DISABLED',deleted_at=now() WHERE asset_id=$1 AND deleted_at IS NULL", id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource,detail) VALUES($1,$2,$3,'{\"history_policy\":\"retain\"}')", actor, "archive:"+resource, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
