ALTER TABLE runtime_sessions ADD COLUMN end_reason text NOT NULL DEFAULT '';
ALTER TABLE tags DROP CONSTRAINT tags_device_key_unique;
CREATE UNIQUE INDEX tags_active_device_key_idx ON tags(device_id,key) WHERE deleted_at IS NULL;
DROP INDEX tags_device_semantic_idx;
CREATE UNIQUE INDEX tags_device_semantic_idx ON tags(device_id,semantic) WHERE semantic<>'' AND deleted_at IS NULL;
CREATE INDEX counter_resets_tag_time_idx ON counter_resets(tag_id,reset_at DESC);
