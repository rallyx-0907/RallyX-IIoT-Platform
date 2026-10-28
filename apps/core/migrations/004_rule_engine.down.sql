-- Forward backup/restore is required once composite rules exist; never silently discard definitions/history.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM rules WHERE type='composite' OR tag_id IS NULL) THEN
  RAISE EXCEPTION 'Composite rules exist; restore the pre-upgrade backup instead of discarding rule definitions';
 END IF;
END $$;
DROP TABLE rule_conditions;
ALTER TABLE rule_evaluation_state DROP COLUMN state, DROP COLUMN active_alarm_id, DROP COLUMN last_result;
ALTER TABLE alarms DROP COLUMN message, DROP COLUMN activation_snapshot, DROP COLUMN clear_snapshot;
ALTER TABLE tag_current_state DROP COLUMN last_good_at;
DROP INDEX rules_enabled_idx;
ALTER TABLE rules DROP COLUMN description, DROP COLUMN message_template, DROP COLUMN logic, DROP COLUMN created_at, DROP COLUMN deleted_at;
ALTER TABLE rules ALTER COLUMN tag_id SET NOT NULL;
ALTER TABLE rules ALTER COLUMN type DROP DEFAULT;
ALTER TABLE rules DROP CONSTRAINT rules_type_check;
ALTER TABLE rules ADD CONSTRAINT rules_type_check CHECK(type IN ('fault','high','low','stale'));
