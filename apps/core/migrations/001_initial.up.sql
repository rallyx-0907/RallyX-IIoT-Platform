CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE sites (
  id text PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200)
);
CREATE TABLE areas (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), name text NOT NULL,
  UNIQUE(site_id, name)
);
CREATE TABLE panels (
  id text PRIMARY KEY, area_id text NOT NULL REFERENCES areas(id), name text NOT NULL,
  UNIQUE(area_id, name)
);
CREATE TABLE assets (
  id text PRIMARY KEY, panel_id text NOT NULL REFERENCES panels(id), name text NOT NULL,
  type text NOT NULL DEFAULT 'equipment', enabled boolean NOT NULL DEFAULT true,
  UNIQUE(panel_id, name)
);
CREATE INDEX assets_panel_idx ON assets(panel_id);
CREATE TABLE connectors (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), name text NOT NULL,
  type text NOT NULL CHECK(type IN ('simulator','mqtt','modbus-tcp','modbus-rtu')),
  config jsonb NOT NULL DEFAULT '{}', last_seen timestamptz, quality text NOT NULL DEFAULT 'unknown'
);
CREATE TABLE devices (
  id text PRIMARY KEY, connector_id text NOT NULL REFERENCES connectors(id),
  asset_id text REFERENCES assets(id), name text NOT NULL, config jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE tags (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), device_id text REFERENCES devices(id),
  key text NOT NULL, name text NOT NULL,
  datatype text NOT NULL CHECK(datatype IN ('boolean','number','string')),
  unit text NOT NULL DEFAULT '' CHECK(length(unit) <= 32),
  scale double precision NOT NULL DEFAULT 1,
  semantic text NOT NULL DEFAULT '' CHECK(semantic IN ('','run','fault')),
  mapping jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(mapping)='object'),
  sample_policy text NOT NULL DEFAULT 'all' CHECK(sample_policy IN ('all','on_change','none')),
  stale_seconds integer NOT NULL DEFAULT 30 CHECK(stale_seconds BETWEEN 1 AND 86400),
  UNIQUE(asset_id, key),
  CHECK(semantic='' OR datatype='boolean')
);
CREATE UNIQUE INDEX tags_semantic_idx ON tags(asset_id, semantic) WHERE semantic <> '';
CREATE TABLE tag_current_state (
  tag_id text PRIMARY KEY REFERENCES tags(id), value jsonb NOT NULL,
  quality text NOT NULL CHECK(quality IN ('good','bad','stale','unknown')),
  ts timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telemetry_samples (
  tag_id text NOT NULL REFERENCES tags(id), ts timestamptz NOT NULL,
  value jsonb NOT NULL, quality text NOT NULL CHECK(quality IN ('good','bad','stale','unknown')),
  PRIMARY KEY(tag_id, ts)
);
SELECT create_hypertable('telemetry_samples', by_range('ts'), if_not_exists => true);
CREATE TABLE events (
  id bigserial PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), tag_id text REFERENCES tags(id),
  kind text NOT NULL, ts timestamptz NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  UNIQUE(tag_id, kind, ts)
);
CREATE INDEX events_asset_time_idx ON events(asset_id, ts DESC);
CREATE TABLE runtime_sessions (
  id bigserial PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id),
  kind text NOT NULL CHECK(kind IN ('run','fault')), started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK(ended_at >= started_at)
);
CREATE UNIQUE INDEX runtime_open_idx ON runtime_sessions(asset_id,kind) WHERE ended_at IS NULL;
CREATE INDEX runtime_asset_time_idx ON runtime_sessions(asset_id,started_at DESC);
CREATE TABLE rules (
  id text PRIMARY KEY, tag_id text NOT NULL REFERENCES tags(id), name text NOT NULL,
  type text NOT NULL CHECK(type IN ('fault','high','low','stale')),
  threshold double precision, hysteresis double precision NOT NULL DEFAULT 0 CHECK(hysteresis >= 0),
  stale_seconds integer NOT NULL DEFAULT 30 CHECK(stale_seconds > 0),
  severity text NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  CHECK(type NOT IN ('high','low') OR threshold IS NOT NULL)
);
CREATE TABLE alarms (
  id bigserial PRIMARY KEY, rule_id text NOT NULL REFERENCES rules(id), asset_id text NOT NULL REFERENCES assets(id),
  activated_at timestamptz NOT NULL, acknowledged_at timestamptz, acknowledged_by text,
  cleared_at timestamptz, severity text NOT NULL, value jsonb NOT NULL DEFAULT 'null',
  CHECK(cleared_at IS NULL OR cleared_at >= activated_at)
);
CREATE UNIQUE INDEX alarms_active_rule_idx ON alarms(rule_id) WHERE cleared_at IS NULL;
CREATE INDEX alarms_asset_time_idx ON alarms(asset_id, activated_at DESC);
CREATE TABLE roles (id text PRIMARY KEY CHECK(id IN ('admin','operator','viewer')));
INSERT INTO roles(id) VALUES('admin'),('operator'),('viewer');
CREATE TABLE users (
  id text PRIMARY KEY, username text NOT NULL UNIQUE,
  password_hash text NOT NULL, role_id text NOT NULL REFERENCES roles(id),
  must_change_password boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, user_id text REFERENCES users(id), action text NOT NULL,
  resource text NOT NULL, ts timestamptz NOT NULL DEFAULT now(), detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_time_idx ON audit_log(ts DESC);
CREATE TABLE ingestion_diagnostics (
  id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), topic text NOT NULL, reason text NOT NULL
);
