package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/rules"
)

// RuleJSON preserves the original fields for API clients while exposing the new definition/state.
const RuleJSON = `SELECT to_jsonb(r)||jsonb_build_object('conditions',COALESCE((SELECT jsonb_agg(to_jsonb(c)-'rule_id'-'position' ORDER BY c.position) FROM rule_conditions c WHERE c.rule_id=r.id),'[]'::jsonb),'state',COALESCE(s.state,'inactive'),'pending_since',s.pending_since,'active_alarm_id',s.active_alarm_id,'last_error',COALESCE(s.last_error,'')) FROM rules r LEFT JOIN rule_evaluation_state s ON s.rule_id=r.id WHERE r.deleted_at IS NULL`

func LoadRule(ctx context.Context, tx pgx.Tx, id string) (rules.Rule, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, RuleJSON+" AND r.id=$1", id).Scan(&raw)
	if err != nil {
		return rules.Rule{}, err
	}
	var definition rules.Rule
	if err = json.Unmarshal(raw, &definition); err != nil {
		return definition, err
	}
	if len(definition.Conditions) == 0 {
		var legacy struct {
			TagID        string   `json:"tag_id"`
			Type         string   `json:"type"`
			Threshold    *float64 `json:"threshold"`
			Hysteresis   float64  `json:"hysteresis"`
			StaleSeconds int64    `json:"stale_seconds"`
			Value        any      `json:"condition_value"`
		}
		if err = json.Unmarshal(raw, &legacy); err != nil {
			return definition, err
		}
		c := rules.Condition{ID: id + "-legacy", TagID: rules.TagID(legacy.TagID), Threshold: legacy.Threshold, Hysteresis: legacy.Hysteresis}
		switch legacy.Type {
		case "high":
			c.Operator = rules.OpGT
		case "low":
			c.Operator = rules.OpLT
		case "fault":
			c.Operator = rules.OpIsTrue
			if legacy.Value == false {
				c.Operator = rules.OpIsFalse
			}
		case "stale":
			c.Operator = rules.OpStaleFor
			c.DurationMS = legacy.StaleSeconds * 1000
		}
		if c.Operator != "" {
			definition.Conditions = []rules.Condition{c}
		}
	}
	return definition, nil
}

func RuleInputs(ctx context.Context, tx pgx.Tx, definition rules.Rule, at time.Time) (map[rules.TagID]rules.TagState, map[rules.TagID]string, error) {
	ids := make([]string, 0, len(definition.Conditions))
	for _, c := range definition.Conditions {
		ids = append(ids, string(c.TagID))
	}
	rows, err := tx.Query(ctx, `SELECT t.id,t.datatype,t.created_at,t.stale_seconds,s.value,COALESCE(s.quality,'UNKNOWN'),s.ts,s.last_good_at,
 t.enabled AND d.enabled AND a.enabled AND c.enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL AND c.deleted_at IS NULL
 FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id JOIN connections c ON c.id=d.connection_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.id=ANY($1::text[])`, ids)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	states := map[rules.TagID]rules.TagState{}
	types := map[rules.TagID]string{}
	for rows.Next() {
		var id rules.TagID
		var dtype, quality string
		var created time.Time
		var seconds int
		var raw []byte
		var stamp, good *time.Time
		var enabled bool
		if err := rows.Scan(&id, &dtype, &created, &seconds, &raw, &quality, &stamp, &good, &enabled); err != nil {
			return nil, nil, err
		}
		types[id] = dtype
		state := rules.TagState{Quality: strings.ToUpper(quality)}
		if enabled {
			state.MonitoringSince = created
			if stamp != nil {
				state.Timestamp = *stamp
			}
			if good != nil {
				state.LastGoodAt = *good
			}
			if len(raw) > 0 && string(raw) != "null" {
				if err := json.Unmarshal(raw, &state.Value); err != nil {
					return nil, nil, err
				}
				state.Present = true
			}
			if stamp != nil && at.After(stamp.Add(time.Duration(seconds)*time.Second)) {
				state.Quality = "STALE"
			}
		}
		states[id] = state
	}
	return states, types, rows.Err()
}

// EvaluateRules is called inside the same transaction as accepted current-state updates.
// Row locks are acquired in rule-ID order; snapshots read all committed cross-asset inputs.
func EvaluateRules(ctx context.Context, tx pgx.Tx, ids []string, at time.Time) (bool, error) {
	rows, err := tx.Query(ctx, "SELECT id FROM rules WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE", ids)
	if err != nil {
		return false, err
	}
	var locked []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		locked = append(locked, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, err
	}
	changed := false
	for _, id := range locked {
		update, err := evaluatePersistedRule(ctx, tx, id, at)
		if err != nil {
			return false, err
		}
		changed = changed || update
	}
	return changed, nil
}

func evaluatePersistedRule(ctx context.Context, tx pgx.Tx, id string, at time.Time) (bool, error) {
	definition, err := LoadRule(ctx, tx, id)
	if err != nil {
		return false, err
	}
	var previous rules.RuntimeState
	previous.State = rules.StateInactive
	var since, last *time.Time
	var state string
	err = tx.QueryRow(ctx, "SELECT state,pending_since,last_evaluated_at FROM rule_evaluation_state WHERE rule_id=$1", id).Scan(&state, &since, &last)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil {
		previous.State = rules.RuleStateName(state)
		if since != nil {
			previous.PendingSince = *since
		}
		if last != nil {
			previous.LastEvaluatedAt = *last
		}
	}
	var alarm *int64
	if err = tx.QueryRow(ctx, "SELECT (SELECT id FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL)", id).Scan(&alarm); err != nil {
		return false, err
	}
	active := alarm != nil
	if active && previous.State != rules.StatePendingClear {
		previous.State = rules.StateActive
	}
	if !active && (previous.State == rules.StateActive || previous.State == rules.StatePendingClear) {
		previous.State = rules.StateInactive
		previous.PendingSince = time.Time{}
	}
	states, types, err := RuleInputs(ctx, tx, definition, at)
	if err != nil {
		return false, err
	}
	evaluation := rules.EvaluationResult{}
	diagnostic := ""
	if err = rules.Validate(definition, types); err != nil {
		diagnostic = err.Error()
	} else {
		evaluation, err = rules.EvaluateRule(definition, states, at, active)
		if err != nil {
			diagnostic = err.Error()
		}
	}
	if diagnostic != "" {
		evaluation = rules.EvaluationResult{}
	}
	next, err := rules.Advance(definition, previous, evaluation, at)
	if err != nil {
		return false, err
	}
	alarm, err = applyAlarmTransition(ctx, tx, definition, evaluation, next, at, alarm)
	if err != nil {
		return false, err
	}
	var pending any
	if !next.State.PendingSince.IsZero() {
		pending = next.State.PendingSince
	}
	var result any
	if evaluation.Known {
		result = evaluation.Matched
	}
	_, err = tx.Exec(ctx, `INSERT INTO rule_evaluation_state(rule_id,state,pending_since,last_evaluated_at,active_alarm_id,last_result,last_error) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(rule_id) DO UPDATE SET state=excluded.state,pending_since=excluded.pending_since,last_evaluated_at=excluded.last_evaluated_at,active_alarm_id=excluded.active_alarm_id,last_result=excluded.last_result,last_error=excluded.last_error`, id, string(next.State.State), pending, next.State.LastEvaluatedAt, alarm, result, diagnostic)
	return previous.State != next.State.State || next.Action != rules.ActionNone, err
}

func (e *Engine) ruleTime() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

func (e *Engine) RecoverRules(ctx context.Context) error {
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT id FROM rules WHERE enabled AND deleted_at IS NULL ORDER BY id")
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
	return tx.Commit(ctx)
}
