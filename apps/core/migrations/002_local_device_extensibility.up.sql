-- Forward-only ownership migration. Legacy panel rows remain as provenance;
-- the active hierarchy and configuration APIs use Site/Area/Asset/Device/Tag.
ALTER TABLE assets ADD COLUMN area_id text REFERENCES areas(id);
UPDATE assets a SET area_id=p.area_id FROM panels p WHERE p.id=a.panel_id;
ALTER TABLE assets ALTER COLUMN area_id SET NOT NULL;
ALTER TABLE assets ALTER COLUMN panel_id DROP NOT NULL;
ALTER TABLE assets ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object');
ALTER TABLE assets ADD COLUMN deleted_at timestamptz;
CREATE INDEX assets_area_idx ON assets(area_id);

ALTER TABLE connectors RENAME TO connections;
ALTER TABLE connections RENAME COLUMN type TO protocol;
ALTER TABLE connections RENAME COLUMN config TO protocol_config;
ALTER TABLE connections ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE connections ADD COLUMN polling_interval_ms integer NOT NULL DEFAULT 2000 CHECK(polling_interval_ms BETWEEN 100 AND 86400000);
ALTER TABLE connections ADD COLUMN timeout_ms integer NOT NULL DEFAULT 3000 CHECK(timeout_ms BETWEEN 100 AND 60000);
ALTER TABLE connections ADD COLUMN retry_policy jsonb NOT NULL DEFAULT '{"max_attempts":3,"backoff_ms":1000}' CHECK(jsonb_typeof(retry_policy)='object');
ALTER TABLE connections ADD COLUMN status text NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('CONNECTED','DISCONNECTED','ERROR','DISABLED'));
ALTER TABLE connections ADD COLUMN last_successful_poll timestamptz;
ALTER TABLE connections ADD COLUMN last_error text NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE connections ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE connections ADD COLUMN deleted_at timestamptz;
ALTER TABLE connections ADD CONSTRAINT connection_config_object CHECK(jsonb_typeof(protocol_config)='object');
CREATE TABLE connection_credentials (
  connection_id text PRIMARY KEY REFERENCES connections(id),
  nonce bytea NOT NULL, ciphertext bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_templates (
  id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  manufacturer text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '',
  protocol text NOT NULL CHECK(protocol IN ('simulator','mqtt','modbus-tcp','modbus-rtu')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), description text NOT NULL DEFAULT '',
  tag_definitions jsonb NOT NULL CHECK(jsonb_typeof(tag_definitions)='array' AND jsonb_array_length(tag_definitions) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
ALTER TABLE devices RENAME COLUMN connector_id TO connection_id;
ALTER TABLE devices ALTER COLUMN asset_id SET NOT NULL;
ALTER TABLE devices ADD COLUMN area_id text REFERENCES areas(id);
ALTER TABLE devices ADD COLUMN template_id text REFERENCES device_templates(id);
ALTER TABLE devices ADD COLUMN template_version integer;
ALTER TABLE devices ADD COLUMN manufacturer text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN model text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN serial_number text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN protocol_device_address text NOT NULL DEFAULT '1';
ALTER TABLE devices ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE devices ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object');
ALTER TABLE devices ADD COLUMN status text NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('CONNECTED','DISCONNECTED','ERROR','DISABLED'));
ALTER TABLE devices ADD COLUMN last_seen timestamptz;
ALTER TABLE devices ADD COLUMN last_successful_poll timestamptz;
ALTER TABLE devices ADD COLUMN last_error text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE devices ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE devices ADD COLUMN deleted_at timestamptz;
ALTER TABLE devices ADD CONSTRAINT devices_identity_asset_unique UNIQUE(id,asset_id);
CREATE INDEX devices_connection_idx ON devices(connection_id);
CREATE INDEX devices_asset_idx ON devices(asset_id);

-- Older installations could contain asset-owned tags without a device. Retain
-- them under explicitly disabled migration adapters, never a hidden live source.
INSERT INTO connections(id,site_id,name,protocol,enabled,status)
 SELECT DISTINCT 'migration_'||md5(ar.site_id),ar.site_id,'Migrated unassigned signals','simulator',false,'DISABLED'
 FROM tags t JOIN assets a ON a.id=t.asset_id JOIN areas ar ON ar.id=a.area_id
 WHERE t.device_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO devices(id,connection_id,asset_id,name,enabled,status,metadata)
 SELECT DISTINCT 'migration_'||md5(a.id),'migration_'||md5(ar.site_id),a.id,'Migrated unassigned signals',false,'DISABLED','{"migration":true}'::jsonb
 FROM tags t JOIN assets a ON a.id=t.asset_id JOIN areas ar ON ar.id=a.area_id
 WHERE t.device_id IS NULL ON CONFLICT DO NOTHING;
UPDATE tags SET device_id='migration_'||md5(asset_id) WHERE device_id IS NULL;
ALTER TABLE tags ALTER COLUMN device_id SET NOT NULL;
ALTER TABLE tags DROP CONSTRAINT tags_asset_id_key_key;
ALTER TABLE tags ADD CONSTRAINT tags_device_key_unique UNIQUE(device_id,key);
ALTER TABLE tags ADD CONSTRAINT tags_device_asset_fk FOREIGN KEY(device_id,asset_id) REFERENCES devices(id,asset_id);
DROP INDEX tags_semantic_idx;
CREATE UNIQUE INDEX tags_device_semantic_idx ON tags(device_id,semantic) WHERE semantic<>'';
ALTER TABLE tags ADD COLUMN data_type text;
UPDATE tags SET data_type=CASE datatype WHEN 'boolean' THEN 'bool' WHEN 'number' THEN 'float64' ELSE 'string' END;
ALTER TABLE tags ALTER COLUMN data_type SET NOT NULL;
ALTER TABLE tags ALTER COLUMN data_type SET DEFAULT 'float64';
ALTER TABLE tags ADD CONSTRAINT tags_data_type_check CHECK(data_type IN ('bool','int16','uint16','int32','uint32','float32','float64','string'));
ALTER TABLE tags ADD COLUMN source_type text NOT NULL DEFAULT 'mqtt' CHECK(source_type IN ('simulator','mqtt','modbus-tcp','modbus-rtu'));
UPDATE tags t SET source_type=c.protocol FROM devices d JOIN connections c ON c.id=d.connection_id WHERE d.id=t.device_id;
ALTER TABLE tags ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE tags ADD COLUMN function_code integer CHECK(function_code IN (1,2,3,4));
ALTER TABLE tags ADD COLUMN byte_order text NOT NULL DEFAULT 'BE' CHECK(byte_order IN ('BE','LE'));
ALTER TABLE tags ADD COLUMN word_order text NOT NULL DEFAULT 'BE' CHECK(word_order IN ('BE','LE'));
ALTER TABLE tags ADD COLUMN "offset" double precision NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN poll_interval_ms integer CHECK(poll_interval_ms BETWEEN 100 AND 86400000);
ALTER TABLE tags ADD COLUMN deadband double precision NOT NULL DEFAULT 0 CHECK(deadband>=0);
ALTER TABLE tags ADD COLUMN store_history boolean NOT NULL DEFAULT true;
UPDATE tags SET store_history=false WHERE sample_policy='none';
ALTER TABLE tags ADD COLUMN realtime_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tags ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tags ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object');
ALTER TABLE tags ADD COLUMN quality text NOT NULL DEFAULT 'UNCERTAIN' CHECK(quality IN ('GOOD','BAD','UNCERTAIN','STALE'));
ALTER TABLE tags ADD COLUMN last_read timestamptz;
ALTER TABLE tags ADD COLUMN last_error text NOT NULL DEFAULT '';
ALTER TABLE tags ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tags ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tags ADD COLUMN deleted_at timestamptz;
ALTER TABLE tag_current_state DROP CONSTRAINT tag_current_state_quality_check;
ALTER TABLE tag_current_state ADD CONSTRAINT tag_current_state_quality_check CHECK(quality IN ('GOOD','BAD','UNCERTAIN','STALE','good','bad','unknown','stale'));
ALTER TABLE telemetry_samples DROP CONSTRAINT telemetry_samples_quality_check;
ALTER TABLE telemetry_samples ADD CONSTRAINT telemetry_samples_quality_check CHECK(quality IN ('GOOD','BAD','UNCERTAIN','STALE','good','bad','unknown','stale'));
ALTER TABLE tag_current_state ADD COLUMN raw_value jsonb;

ALTER TABLE runtime_sessions ADD COLUMN tag_id text REFERENCES tags(id);
UPDATE runtime_sessions rs SET tag_id=COALESCE(
 (SELECT e.tag_id FROM events e WHERE e.asset_id=rs.asset_id AND e.ts=rs.started_at AND e.kind=CASE rs.kind WHEN 'run' THEN 'start' ELSE 'fault' END ORDER BY e.id LIMIT 1),
 (SELECT t.id FROM tags t WHERE t.asset_id=rs.asset_id AND t.semantic=rs.kind ORDER BY t.id LIMIT 1)
);
-- If an old configuration edit removed the semantic, an immutable start event
-- remains the historical source of truth. Rows are retained even if unknowable.
DROP INDEX runtime_open_idx;
CREATE UNIQUE INDEX runtime_open_tag_idx ON runtime_sessions(tag_id,kind) WHERE ended_at IS NULL;
CREATE INDEX runtime_tag_time_idx ON runtime_sessions(tag_id,started_at DESC);
CREATE TABLE counter_resets (
  id bigserial PRIMARY KEY, tag_id text NOT NULL REFERENCES tags(id),
  reset_at timestamptz NOT NULL DEFAULT now(), user_id text NOT NULL REFERENCES users(id), reason text NOT NULL
);
ALTER TABLE rules ADD COLUMN condition_value jsonb NOT NULL DEFAULT 'true';
ALTER TABLE rules ADD COLUMN activation_delay_ms integer NOT NULL DEFAULT 0 CHECK(activation_delay_ms BETWEEN 0 AND 86400000);
ALTER TABLE rules ADD COLUMN clear_delay_ms integer NOT NULL DEFAULT 0 CHECK(clear_delay_ms BETWEEN 0 AND 86400000);
ALTER TABLE rules ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE rule_evaluation_state (
  rule_id text PRIMARY KEY REFERENCES rules(id), pending_since timestamptz,
  pending_active boolean, last_evaluated_at timestamptz, last_error text NOT NULL DEFAULT ''
);
ALTER TABLE alarms ADD COLUMN clear_reason text NOT NULL DEFAULT '';
CREATE TABLE dashboard_widgets (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), tag_id text NOT NULL REFERENCES tags(id),
  type text NOT NULL CHECK(type IN ('value','status','trend')), title text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0, settings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(settings)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,tag_id,type)
);
CREATE TABLE platform_settings (key text PRIMARY KEY,value jsonb NOT NULL);
INSERT INTO platform_settings(key,value) VALUES('telemetry_retention_days','90');
