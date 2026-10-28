package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/rules"
	"rallyx.local/core/internal/telemetry"
)

// RulesQuery keeps legacy clients readable while new clients receive explicit conditions and runtime state.
const RulesQuery = `SELECT r.*,COALESCE(s.state,'inactive') AS state,s.pending_since,s.active_alarm_id,COALESCE(s.last_error,'') AS last_error,
 COALESCE((SELECT jsonb_agg(to_jsonb(c)-'rule_id'-'position' ORDER BY c.position) FROM rule_conditions c WHERE c.rule_id=r.id),
 CASE WHEN r.type<>'composite' THEN jsonb_build_array(jsonb_build_object('tag_id',r.tag_id,'operator',CASE r.type WHEN 'high' THEN 'gt' WHEN 'low' THEN 'lt' WHEN 'fault' THEN CASE WHEN r.condition_value='false'::jsonb THEN 'is_false' ELSE 'is_true' END ELSE 'stale_for' END,'threshold',r.threshold,'hysteresis',r.hysteresis,'duration_ms',CASE WHEN r.type='stale' THEN r.stale_seconds::bigint*1000 ELSE 0 END)) ELSE '[]'::jsonb END) AS conditions
 FROM rules r LEFT JOIN rule_evaluation_state s ON s.rule_id=r.id WHERE r.deleted_at IS NULL ORDER BY r.name,r.id`

var ruleFields = map[string]bool{"id": true, "name": true, "description": true, "enabled": true, "severity": true, "logic": true, "activation_delay_ms": true, "clear_delay_ms": true, "message_template": true, "conditions": true, "tag_id": true, "type": true, "threshold": true, "hysteresis": true, "stale_seconds": true, "condition_value": true}

func decodeRule(body map[string]any, old *rules.Rule) (rules.Rule, error) {
	definition := rules.Rule{Logic: rules.LogicAll, Severity: rules.SeverityWarning, Conditions: []rules.Condition{}}
	if old != nil {
		definition = *old
	}
	for key := range body {
		if !ruleFields[key] {
			return definition, fmt.Errorf("%w: invalid rule field %s", ErrValidation, key)
		}
	}
	if len(body) == 0 {
		return definition, ErrValidation
	}
	base, _ := json.Marshal(definition)
	var merged map[string]any
	if err := json.Unmarshal(base, &merged); err != nil {
		return definition, err
	}
	for key, value := range body {
		merged[key] = value
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return definition, ErrValidation
	}
	if err = json.Unmarshal(data, &definition); err != nil {
		return definition, fmt.Errorf("%w: invalid rule definition", ErrValidation)
	}
	// Original single-tag API remains supported and is normalized to the same evaluator.
	if _, modern := body["conditions"]; !modern && (old == nil || body["type"] != nil || body["threshold"] != nil || body["hysteresis"] != nil || body["stale_seconds"] != nil || body["condition_value"] != nil) {
		tag, _ := body["tag_id"].(string)
		if tag == "" && old != nil && len(old.Conditions) > 0 {
			tag = string(old.Conditions[0].TagID)
		}
		kind, _ := body["type"].(string)
		if kind == "" && old != nil && len(old.Conditions) == 1 {
			switch old.Conditions[0].Operator {
			case rules.OpGT:
				kind = "high"
			case rules.OpLT:
				kind = "low"
			case rules.OpIsTrue, rules.OpIsFalse:
				kind = "fault"
			case rules.OpStaleFor:
				kind = "stale"
			}
		}
		if kind != "" {
			c := rules.Condition{TagID: rules.TagID(tag)}
			if old != nil && len(old.Conditions) > 0 {
				c = old.Conditions[0]
			}
			switch kind {
			case "fault":
				c.Operator = rules.OpIsTrue
				if v, ok := body["condition_value"]; ok && v == false {
					c.Operator = rules.OpIsFalse
				}
			case "high":
				c.Operator = rules.OpGT
			case "low":
				c.Operator = rules.OpLT
			case "stale":
				c.Operator = rules.OpStaleFor
				if c.DurationMS == 0 {
					c.DurationMS = 30000
				}
			default:
				return definition, ErrValidation
			}
			if v, ok := body["threshold"].(float64); ok {
				c.Threshold = &v
			}
			if v, ok := body["hysteresis"].(float64); ok {
				c.Hysteresis = v
			}
			if v, ok := body["stale_seconds"].(float64); ok {
				if v < 1 || v > 86400 || v != float64(int64(v)) {
					return definition, ErrValidation
				}
				c.DurationMS = int64(v * 1000)
			}
			definition.Conditions = []rules.Condition{c}
			if old == nil {
				if _, ok := body["enabled"]; !ok {
					definition.Enabled = true
				}
			}
		}
	}
	definition.Name = strings.TrimSpace(definition.Name)
	if len(definition.Name) > 200 || len(definition.Description) > 4000 || len(definition.MessageTemplate) > 4000 || len(definition.Conditions) > 100 {
		return definition, fmt.Errorf("%w: rule size limit exceeded", ErrValidation)
	}
	for i := range definition.Conditions {
		definition.Conditions[i].ID = auth.RandomID()
	}
	return definition, nil
}

func (s Registry) writeRule(ctx context.Context, tx pgx.Tx, id string, body map[string]any, actor string) (json.RawMessage, error) {
	var old *rules.Rule
	var revision time.Time
	if id != "" {
		if err := tx.QueryRow(ctx, "SELECT updated_at FROM rules WHERE id=$1 AND deleted_at IS NULL", id).Scan(&revision); err != nil {
			return nil, err
		}
		if _, ok := body["id"]; ok {
			return nil, fmt.Errorf("%w: id is immutable", ErrValidation)
		}
		if _, ok := body["tag_id"]; ok {
			return nil, fmt.Errorf("%w: tag_id is immutable; edit conditions", ErrValidation)
		}
		previous, err := telemetry.LoadRule(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		old = &previous
	}
	definition, err := decodeRule(body, old)
	if err != nil {
		return nil, err
	}
	if id == "" {
		id, _ = body["id"].(string)
		if id == "" {
			id = auth.RandomID()
		}
		if !telemetry.Identifier.MatchString(id) {
			return nil, ErrValidation
		}
	}
	definition.ID = id
	tagIDs := []string{}
	for _, c := range definition.Conditions {
		tagIDs = append(tagIDs, string(c.TagID))
	}
	if old != nil {
		for _, c := range old.Conditions {
			tagIDs = append(tagIDs, string(c.TagID))
		}
	}
	// Match ingestion/configuration lock order: affected assets, then rule rows.
	if _, err = tx.Exec(ctx, "SELECT id FROM assets WHERE id IN (SELECT asset_id FROM tags WHERE id=ANY($1::text[])) ORDER BY id FOR UPDATE", tagIDs); err != nil {
		return nil, err
	}
	if old != nil {
		var current time.Time
		if err = tx.QueryRow(ctx, "SELECT updated_at FROM rules WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&current); err != nil {
			return nil, err
		}
		if !current.Equal(revision) {
			return nil, fmt.Errorf("%w: rule changed concurrently; reload before saving", ErrValidation)
		}
	}
	states, types, err := telemetry.RuleInputs(ctx, tx, definition, time.Now())
	_ = states
	if err != nil {
		return nil, err
	}
	var invalid bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tags WHERE id=ANY($1::text[]) AND deleted_at IS NOT NULL)", tagIDs).Scan(&invalid); err != nil {
		return nil, err
	}
	if invalid {
		return nil, fmt.Errorf("%w: referenced tag is archived", ErrValidation)
	}
	if err = rules.Validate(definition, types); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrValidation, err)
	}
	var primary any
	if len(definition.Conditions) > 0 {
		primary = string(definition.Conditions[0].TagID)
	}
	kind := "composite"
	var threshold any
	hysteresis := float64(0)
	staleSeconds := 30
	if len(definition.Conditions) == 1 {
		c := definition.Conditions[0]
		switch c.Operator {
		case rules.OpGT:
			kind = "high"
		case rules.OpLT:
			kind = "low"
		case rules.OpIsTrue:
			kind = "fault"
		case rules.OpStaleFor:
			kind = "stale"
		}
		threshold = c.Threshold
		hysteresis = c.Hysteresis
		if c.DurationMS >= 1000 {
			staleSeconds = int(c.DurationMS / 1000)
		}
	}
	if old == nil {
		_, err = tx.Exec(ctx, `INSERT INTO rules(id,tag_id,name,type,threshold,hysteresis,stale_seconds,severity,enabled,description,logic,activation_delay_ms,clear_delay_ms,message_template) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, id, primary, definition.Name, kind, threshold, hysteresis, staleSeconds, string(definition.Severity), definition.Enabled, definition.Description, string(definition.Logic), definition.ActivationDelayMS, definition.ClearDelayMS, definition.MessageTemplate)
	} else {
		// Row lock serializes definition edits with evaluation. Keep active alarm/ack identity.
		_, err = tx.Exec(ctx, `UPDATE rules SET tag_id=$2,name=$3,type=$4,threshold=$5,hysteresis=$6,stale_seconds=$7,severity=$8,enabled=$9,description=$10,logic=$11,activation_delay_ms=$12,clear_delay_ms=$13,message_template=$14,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, primary, definition.Name, kind, threshold, hysteresis, staleSeconds, string(definition.Severity), definition.Enabled, definition.Description, string(definition.Logic), definition.ActivationDelayMS, definition.ClearDelayMS, definition.MessageTemplate)
	}
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM rule_conditions WHERE rule_id=$1", id); err != nil {
		return nil, err
	}
	for i, c := range definition.Conditions {
		value, _ := json.Marshal(c.Value)
		if _, err = tx.Exec(ctx, `INSERT INTO rule_conditions(id,rule_id,tag_id,operator,value,threshold,duration_ms,hysteresis,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, c.ID, id, string(c.TagID), string(c.Operator), value, c.Threshold, c.DurationMS, c.Hysteresis, i); err != nil {
			return nil, err
		}
	}
	// Edits reset only pending timers. A change while active re-evaluates without duplicate activation.
	if _, err = tx.Exec(ctx, `INSERT INTO rule_evaluation_state(rule_id,state) VALUES($1,'inactive') ON CONFLICT(rule_id) DO UPDATE SET state=CASE WHEN EXISTS(SELECT 1 FROM alarms WHERE rule_id=$1 AND cleared_at IS NULL) THEN 'active' ELSE 'inactive' END,pending_since=NULL,last_evaluated_at=NULL`, id); err != nil {
		return nil, err
	}
	if _, err = telemetry.EvaluateRules(ctx, tx, []string{id}, time.Now().UTC()); err != nil {
		return nil, err
	}
	action := "create:rules"
	if old != nil {
		action = "update:rules"
	}
	if _, err = tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,$2,$3)", actor, action, id); err != nil {
		return nil, err
	}
	var raw json.RawMessage
	err = tx.QueryRow(ctx, telemetry.RuleJSON+" AND r.id=$1", id).Scan(&raw)
	return raw, err
}

func (s Registry) TestRule(ctx context.Context, body map[string]any) (rules.EvaluationResult, error) {
	definition, err := decodeRule(body, nil)
	if err != nil {
		return rules.EvaluationResult{}, err
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return rules.EvaluationResult{}, err
	}
	defer tx.Rollback(ctx)
	at := time.Now().UTC()
	states, types, err := telemetry.RuleInputs(ctx, tx, definition, at)
	if err != nil {
		return rules.EvaluationResult{}, err
	}
	if err = rules.Validate(definition, types); err != nil {
		return rules.EvaluationResult{}, fmt.Errorf("%w: %s", ErrValidation, err)
	}
	result, err := rules.EvaluateRule(definition, states, at, false)
	return result, err
}

func (s Registry) ArchiveRule(ctx context.Context, id, actor string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = s.writeRule(ctx, tx, id, map[string]any{"enabled": false}, actor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE rules SET deleted_at=now() WHERE id=$1", id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
