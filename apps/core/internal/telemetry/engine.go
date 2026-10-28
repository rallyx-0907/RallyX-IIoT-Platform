package telemetry

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
)

var ErrRejected = errors.New("telemetry rejected")

type Engine struct {
	Pool      *pgxpool.Pool
	Broadcast func(any)
	Now       func() time.Time
}
type tagConfig struct {
	ID, Key, Datatype, DataType, Semantic, SamplePolicy string
	Scale, Offset, Deadband                             float64
	StoreHistory, Realtime                              bool
}
type rule struct {
	ID, Type, Severity string
	Threshold          *float64
	Hysteresis         float64
}

func (e *Engine) Process(ctx context.Context, message Message) error {
	message.Quality = strings.ToUpper(message.Quality)
	if message.Quality == "UNKNOWN" {
		message.Quality = "UNCERTAIN"
	}
	switch message.Quality {
	case "GOOD", "BAD", "UNCERTAIN", "STALE":
	default:
		return fmt.Errorf("%w: invalid quality", ErrRejected)
	}
	if message.Timestamp.After(time.Now().Add(5 * time.Minute)) {
		return fmt.Errorf("%w: timestamp too far in future", ErrRejected)
	}
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var asset string
	err = tx.QueryRow(ctx, `SELECT a.id FROM devices d JOIN assets a ON a.id=d.asset_id JOIN connections c ON c.id=d.connection_id WHERE d.id=$1 AND a.id=$2 AND a.enabled AND d.enabled AND c.enabled AND a.deleted_at IS NULL AND d.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE OF a`, message.DeviceID, message.AssetID).Scan(&asset)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: unknown, disabled or mismatched device/asset", ErrRejected)
	}
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, "SELECT id,key,datatype,data_type,semantic,sample_policy,scale,\"offset\",deadband,store_history,realtime_enabled FROM tags WHERE device_id=$1 AND enabled AND deleted_at IS NULL", message.DeviceID)
	if err != nil {
		return err
	}
	configs := map[string]tagConfig{}
	for rows.Next() {
		var tag tagConfig
		if err := rows.Scan(&tag.ID, &tag.Key, &tag.Datatype, &tag.DataType, &tag.Semantic, &tag.SamplePolicy, &tag.Scale, &tag.Offset, &tag.Deadband, &tag.StoreHistory, &tag.Realtime); err != nil {
			rows.Close()
			return err
		}
		configs[tag.Key] = tag
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(message.Tags))
	values := map[string]json.RawMessage{}
	for key, raw := range message.Tags {
		config, ok := configs[key]
		if !ok {
			return fmt.Errorf("%w: unknown tag %s", ErrRejected, key)
		}
		var scalar any
		if err := json.Unmarshal(raw, &scalar); err != nil {
			return fmt.Errorf("%w: invalid value", ErrRejected)
		}
		switch config.Datatype {
		case "boolean":
			if _, ok := scalar.(bool); !ok {
				return fmt.Errorf("%w: %s requires boolean", ErrRejected, key)
			}
		case "number":
			value, ok := scalar.(float64)
			if !ok {
				return fmt.Errorf("%w: %s requires number", ErrRejected, key)
			}
			if !numberMatchesType(config.DataType, value) {
				return fmt.Errorf("%w: %s is outside %s range", ErrRejected, key, config.DataType)
			}
			value = value*config.Scale + config.Offset
			if math.IsInf(value, 0) || math.IsNaN(value) {
				return fmt.Errorf("%w: invalid scaled number", ErrRejected)
			}
			raw, _ = json.Marshal(value)
		case "string":
			if _, ok := scalar.(string); !ok {
				return fmt.Errorf("%w: %s requires string", ErrRejected, key)
			}
		}
		keys = append(keys, key)
		values[key] = raw
	}
	sort.Strings(keys)
	changed := false
	accepted := []string{}
	for _, key := range keys {
		tag := configs[key]
		raw := values[key]
		var previous time.Time
		var previousValue json.RawMessage
		var same bool
		err = tx.QueryRow(ctx, "SELECT ts,(value=$2::jsonb AND upper(quality)=$3),value FROM tag_current_state WHERE tag_id=$1", tag.ID, raw, message.Quality).Scan(&previous, &same, &previousValue)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && !message.Timestamp.After(previous) {
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO tag_current_state(tag_id,value,quality,ts,raw_value,last_good_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $3='GOOD' THEN $4::timestamptz ELSE NULL END) ON CONFLICT(tag_id) DO UPDATE SET value=excluded.value,quality=excluded.quality,ts=excluded.ts,raw_value=excluded.raw_value,received_at=now(),last_good_at=COALESCE(excluded.last_good_at,tag_current_state.last_good_at)`, tag.ID, raw, message.Quality, message.Timestamp, message.Tags[key])
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE tags SET quality=$2,last_read=$3,last_error='' WHERE id=$1", tag.ID, message.Quality, message.Timestamp); err != nil {
			return err
		}
		storeSample := tag.StoreHistory && (tag.SamplePolicy == "all" || (tag.SamplePolicy == "on_change" && !same))
		if storeSample && tag.Deadband > 0 && tag.Datatype == "number" {
			var oldValue json.RawMessage
			var oldQuality string
			sampleErr := tx.QueryRow(ctx, "SELECT value,quality FROM telemetry_samples WHERE tag_id=$1 ORDER BY ts DESC LIMIT 1", tag.ID).Scan(&oldValue, &oldQuality)
			if sampleErr != nil && !errors.Is(sampleErr, pgx.ErrNoRows) {
				return sampleErr
			}
			if sampleErr == nil && strings.ToUpper(oldQuality) == message.Quality {
				var oldNumber, newNumber float64
				if json.Unmarshal(oldValue, &oldNumber) == nil && json.Unmarshal(raw, &newNumber) == nil && math.Abs(newNumber-oldNumber) < tag.Deadband {
					storeSample = false
				}
			}
		}
		if storeSample {
			if _, err = tx.Exec(ctx, "INSERT INTO telemetry_samples(tag_id,ts,value,quality) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", tag.ID, message.Timestamp, raw, message.Quality); err != nil {
				return err
			}
		}
		if message.Quality == "GOOD" {
			if tag.Semantic != "" {
				var value bool
				_ = json.Unmarshal(raw, &value)
				if err = e.transition(ctx, tx, asset, tag.ID, tag.Semantic, value, message.Timestamp, previousValue); err != nil {
					return err
				}
			}
		}
		accepted = append(accepted, tag.ID)
		changed = true
	}
	if len(accepted) > 0 {
		rows, err := tx.Query(ctx, `SELECT id FROM rules WHERE enabled AND deleted_at IS NULL AND (tag_id=ANY($1::text[]) OR id IN (SELECT rule_id FROM rule_conditions WHERE tag_id=ANY($1::text[]))) ORDER BY id`, accepted)
		if err != nil {
			return err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
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
		if _, err = EvaluateRules(ctx, tx, ids, e.ruleTime()); err != nil {
			return err
		}
	}
	if changed {
		if _, err = tx.Exec(ctx, `UPDATE connections SET last_seen=now(),quality=$2,status='CONNECTED',last_successful_poll=CASE WHEN $2='GOOD' THEN now() ELSE last_successful_poll END WHERE id IN (SELECT d.connection_id FROM devices d WHERE d.id=$1)`, message.DeviceID, message.Quality); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE devices SET last_seen=now(),status='CONNECTED',last_successful_poll=CASE WHEN $2='GOOD' THEN now() ELSE last_successful_poll END WHERE id=$1", message.DeviceID, message.Quality); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if changed && e.Broadcast != nil {
		liveValues := map[string]json.RawMessage{}
		for key, value := range values {
			if configs[key].Realtime {
				liveValues[key] = value
			}
		}
		e.Broadcast(map[string]any{"type": "telemetry", "device_id": message.DeviceID, "asset_id": asset, "timestamp": message.Timestamp, "values": liveValues, "quality": message.Quality})
	}
	return nil
}

func (e *Engine) transition(ctx context.Context, tx pgx.Tx, asset, tag, semantic string, value bool, ts time.Time, previousValue json.RawMessage) error {
	var open bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM runtime_sessions WHERE tag_id=$1 AND kind=$2 AND ended_at IS NULL)", tag, semantic).Scan(&open); err != nil {
		return err
	}
	if open == value {
		return nil
	}
	kind := "stop"
	if semantic == "fault" {
		kind = "fault_clear"
	}
	if value {
		if semantic == "run" {
			kind = "start"
		} else {
			kind = "fault"
		}
	}
	if value {
		var previouslyTrue bool
		if json.Unmarshal(previousValue, &previouslyTrue) == nil && previouslyTrue {
			var reason string
			var ended *time.Time
			err := tx.QueryRow(ctx, "SELECT end_reason,ended_at FROM runtime_sessions WHERE tag_id=$1 AND kind=$2 ORDER BY started_at DESC,id DESC LIMIT 1", tag, semantic).Scan(&reason, &ended)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if err == nil && reason == "configuration_disabled" {
				kind = "runtime_resumed"
				if semantic == "fault" {
					kind = "fault_resumed"
				}
				if ended != nil && ts.Before(*ended) {
					ts = *ended
				}
			}
		}
		if _, err := tx.Exec(ctx, "INSERT INTO runtime_sessions(asset_id,tag_id,kind,started_at) VALUES($1,$4,$2,$3)", asset, semantic, ts, tag); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, "UPDATE runtime_sessions SET ended_at=GREATEST(started_at,$3) WHERE tag_id=$1 AND kind=$2 AND ended_at IS NULL", tag, semantic, ts); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, "INSERT INTO events(asset_id,tag_id,kind,ts) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", asset, tag, kind, ts)
	return err
}

func (e *Engine) Sweep(ctx context.Context, now time.Time) error {
	rows, err := e.Pool.Query(ctx, "SELECT id FROM assets WHERE enabled ORDER BY id")
	if err != nil {
		return err
	}
	var assets []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		assets = append(assets, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	changed := false
	for _, asset := range assets {
		change, err := e.sweepAsset(ctx, asset, now)
		if err != nil {
			return err
		}
		changed = changed || change
	}
	if changed && e.Broadcast != nil {
		e.Broadcast(map[string]any{"type": "quality", "ts": now})
	}
	return nil
}

func (e *Engine) sweepAsset(ctx context.Context, asset string, now time.Time) (bool, error) {
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err := tx.QueryRow(ctx, "SELECT id FROM assets WHERE id=$1 FOR UPDATE", asset).Scan(&locked); err != nil {
		return false, err
	}
	command, err := tx.Exec(ctx, `UPDATE tag_current_state s SET quality='STALE' FROM tags t JOIN devices d ON d.id=t.device_id JOIN connections c ON c.id=d.connection_id WHERE t.id=s.tag_id AND t.asset_id=$1 AND t.enabled AND d.enabled AND c.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND s.ts<$2::timestamptz-make_interval(secs=>t.stale_seconds) AND upper(s.quality)<>'STALE'`, asset, now)
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, "UPDATE tags t SET quality='STALE' FROM tag_current_state s WHERE t.id=s.tag_id AND t.asset_id=$1 AND upper(s.quality)='STALE'", asset); err != nil {
		return false, err
	}
	rows, err := tx.Query(ctx, `SELECT r.id FROM rules r LEFT JOIN rule_evaluation_state s ON s.rule_id=r.id JOIN tags t ON t.id=r.tag_id WHERE t.asset_id=$1 AND r.enabled AND r.deleted_at IS NULL AND (s.state IN ('pending_active','pending_clear') OR r.type='stale' OR EXISTS(SELECT 1 FROM rule_conditions c WHERE c.rule_id=r.id AND c.operator='stale_for')) ORDER BY r.id`, asset)
	if err != nil {
		return false, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, err
	}
	ruleChanged, err := EvaluateRules(ctx, tx, ids, now)
	if err != nil {
		return false, err
	}

	err = tx.Commit(ctx)
	return command.RowsAffected() > 0 || ruleChanged, err
}
