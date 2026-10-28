package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/rules"
	"strings"
	"time"
)

// applyAlarmTransition owns alarm identity, history and lifecycle events within the caller's transaction.
func applyAlarmTransition(ctx context.Context, tx pgx.Tx, definition rules.Rule, evaluation rules.EvaluationResult, next rules.Transition, at time.Time, alarm *int64) (*int64, error) {
	id := definition.ID
	var err error
	if next.Action == rules.ActionActivate {
		if len(definition.Conditions) == 0 {
			return nil, fmt.Errorf("rule %s has no activation context", id)
		}
		var asset, tagName, assetName string
		var value json.RawMessage
		tag := definition.Conditions[0].TagID
		if err = tx.QueryRow(ctx, "SELECT t.asset_id,t.name,a.name,COALESCE(s.value,'null'::jsonb) FROM tags t JOIN assets a ON a.id=t.asset_id LEFT JOIN tag_current_state s ON s.tag_id=t.id WHERE t.id=$1", string(tag)).Scan(&asset, &tagName, &assetName, &value); err != nil {
			return nil, err
		}
		snapshot, _ := json.Marshal(evaluation.Snapshot)
		message := definition.MessageTemplate
		if message == "" {
			message = definition.Name
		}
		message = strings.NewReplacer("{rule}", definition.Name, "{tag}", tagName, "{asset}", assetName, "{value}", string(value)).Replace(message)
		var newID int64
		err = tx.QueryRow(ctx, `INSERT INTO alarms(rule_id,asset_id,severity,value,activated_at,message,activation_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(rule_id) WHERE cleared_at IS NULL DO UPDATE SET rule_id=excluded.rule_id RETURNING id`, id, asset, string(definition.Severity), value, at, message, snapshot).Scan(&newID)
		if err != nil {
			return nil, err
		}
		alarm = &newID
		if _, err = tx.Exec(ctx, "INSERT INTO events(asset_id,tag_id,kind,ts,detail) VALUES($1,$2,'alarm_activated',$3,jsonb_build_object('alarm_id',$4::bigint,'rule_id',$5::text))", asset, string(tag), at, newID, id); err != nil {
			return nil, err
		}
	}
	if next.Action == rules.ActionClear && alarm != nil {
		snapshot, _ := json.Marshal(evaluation.Snapshot)
		var asset string
		if err = tx.QueryRow(ctx, "UPDATE alarms SET cleared_at=GREATEST(activated_at,$2),clear_reason=$3,clear_snapshot=$4 WHERE id=$1 AND cleared_at IS NULL RETURNING asset_id", *alarm, at, next.Reason, snapshot).Scan(&asset); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO events(asset_id,kind,ts,detail) VALUES($1,'alarm_cleared',$2,jsonb_build_object('alarm_id',$3::bigint,'reason',$4::text))", asset, at, *alarm, next.Reason); err != nil {
			return nil, err
		}
		alarm = nil
	}

	return alarm, nil
}
