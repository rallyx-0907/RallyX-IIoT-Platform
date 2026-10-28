ALTER TABLE rules ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE rules ADD COLUMN message_template text NOT NULL DEFAULT '';
ALTER TABLE rules ADD COLUMN logic text NOT NULL DEFAULT 'all' CHECK(logic IN ('all','any'));
ALTER TABLE rules ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE rules ADD COLUMN deleted_at timestamptz;
ALTER TABLE rules ALTER COLUMN tag_id DROP NOT NULL;
ALTER TABLE rules DROP CONSTRAINT rules_type_check;
ALTER TABLE rules ADD CONSTRAINT rules_type_check CHECK(type IN ('fault','high','low','stale','composite'));
ALTER TABLE rules ALTER COLUMN type SET DEFAULT 'composite';
CREATE INDEX rules_enabled_idx ON rules(id) WHERE enabled AND deleted_at IS NULL;

CREATE TABLE rule_conditions (
 id text PRIMARY KEY, rule_id text NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
 tag_id text NOT NULL REFERENCES tags(id),
 operator text NOT NULL CHECK(operator IN ('gt','gte','lt','lte','eq','neq','is_true','is_false','stale_for')),
 value jsonb NOT NULL DEFAULT 'null', threshold double precision,
 duration_ms bigint NOT NULL DEFAULT 0 CHECK(duration_ms BETWEEN 0 AND 86400000),
 hysteresis double precision NOT NULL DEFAULT 0 CHECK(hysteresis>=0),
 position integer NOT NULL CHECK(position>=0), UNIQUE(rule_id,position)
);
CREATE INDEX rule_conditions_tag_idx ON rule_conditions(tag_id,rule_id);
CREATE INDEX rule_conditions_stale_idx ON rule_conditions(rule_id) WHERE operator='stale_for';
INSERT INTO rule_conditions(id,rule_id,tag_id,operator,threshold,duration_ms,hysteresis,position)
 SELECT id||'-condition',id,tag_id,CASE type WHEN 'fault' THEN 'is_true' WHEN 'high' THEN 'gt' WHEN 'low' THEN 'lt' ELSE 'stale_for' END,
 threshold,CASE WHEN type='stale' THEN stale_seconds::bigint*1000 ELSE 0 END,hysteresis,0 FROM rules;

ALTER TABLE tag_current_state ADD COLUMN last_good_at timestamptz;
UPDATE tag_current_state s SET last_good_at=CASE WHEN upper(s.quality)='GOOD' THEN s.ts ELSE (SELECT max(ts) FROM telemetry_samples h WHERE h.tag_id=s.tag_id AND upper(h.quality)='GOOD') END;
ALTER TABLE alarms ADD COLUMN message text NOT NULL DEFAULT '';
ALTER TABLE alarms ADD COLUMN activation_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE alarms ADD COLUMN clear_snapshot jsonb;
ALTER TABLE rule_evaluation_state ADD COLUMN state text NOT NULL DEFAULT 'inactive' CHECK(state IN ('inactive','pending_active','active','pending_clear'));
ALTER TABLE rule_evaluation_state ADD COLUMN active_alarm_id bigint REFERENCES alarms(id);
ALTER TABLE rule_evaluation_state ADD COLUMN last_result boolean;
INSERT INTO rule_evaluation_state(rule_id,state,active_alarm_id)
 SELECT r.id,CASE WHEN a.id IS NULL THEN 'inactive' ELSE 'active' END,a.id FROM rules r LEFT JOIN alarms a ON a.rule_id=r.id AND a.cleared_at IS NULL
 ON CONFLICT(rule_id) DO UPDATE SET state=excluded.state,active_alarm_id=excluded.active_alarm_id;
