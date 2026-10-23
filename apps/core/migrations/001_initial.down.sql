-- Destructive: run only against a disposable installation after a verified backup.
DROP TABLE IF EXISTS ingestion_diagnostics, audit_log, sessions, users, roles, alarms, rules,
  runtime_sessions, events, telemetry_samples, tag_current_state, tags, devices, connectors,
  assets, panels, areas, sites CASCADE;
