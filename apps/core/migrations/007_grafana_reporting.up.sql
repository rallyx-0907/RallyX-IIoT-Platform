CREATE SCHEMA rallyx_reporting;
CREATE VIEW rallyx_reporting.tag_catalog WITH (security_barrier=true) AS
 SELECT t.id AS tag_id,t.key AS tag_key,t.name AS tag_name,t.datatype,t.data_type,t.unit,t.semantic,t.stale_seconds,
 t.enabled AND d.enabled AND a.enabled AND c.enabled AS enabled,
 t.deleted_at IS NOT NULL OR d.deleted_at IS NOT NULL OR a.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL AS archived,
 d.id AS device_id,d.name AS device_name,a.id AS asset_id,a.name AS asset_name,ar.id AS area_id,ar.name AS area_name,si.id AS site_id,si.name AS site_name
 FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=t.asset_id
 JOIN connections c ON c.id=d.connection_id JOIN areas ar ON ar.id=a.area_id JOIN sites si ON si.id=ar.site_id;
CREATE VIEW rallyx_reporting.current_values WITH (security_barrier=true) AS
 SELECT m.*,s.ts AS sampled_at,s.received_at,
 CASE WHEN m.archived OR NOT m.enabled THEN 'DISABLED' WHEN s.ts IS NULL THEN 'UNKNOWN'
 WHEN s.ts < now()-make_interval(secs=>m.stale_seconds) THEN 'STALE' ELSE upper(s.quality) END AS quality,
 CASE WHEN jsonb_typeof(s.value)='number' THEN (s.value#>>'{}')::double precision END AS numeric_value,
 CASE WHEN jsonb_typeof(s.value)='boolean' THEN (s.value#>>'{}')::boolean END AS boolean_value,
 s.value#>>'{}' AS value_text
 FROM rallyx_reporting.tag_catalog m LEFT JOIN tag_current_state s ON s.tag_id=m.tag_id;
CREATE VIEW rallyx_reporting.samples WITH (security_barrier=true) AS
 SELECT h.tag_id,h.ts AS sampled_at,upper(h.quality) AS quality,
 CASE WHEN jsonb_typeof(h.value)='number' THEN (h.value#>>'{}')::double precision END AS numeric_value,
 CASE WHEN jsonb_typeof(h.value)='boolean' THEN (h.value#>>'{}')::boolean END AS boolean_value,
 h.value#>>'{}' AS value_text,m.tag_name,m.unit,m.semantic,m.device_id,m.device_name,m.asset_id,m.asset_name
 FROM telemetry_samples h JOIN rallyx_reporting.tag_catalog m ON m.tag_id=h.tag_id;
CREATE VIEW rallyx_reporting.alarms WITH (security_barrier=true) AS
 SELECT al.id,al.rule_id,r.name AS rule_name,al.asset_id,a.name AS asset_name,al.severity,al.message,
 al.activated_at,al.acknowledged_at,al.cleared_at,al.clear_reason
 FROM alarms al LEFT JOIN rules r ON r.id=al.rule_id JOIN assets a ON a.id=al.asset_id;
CREATE VIEW rallyx_reporting.events WITH (security_barrier=true) AS
 SELECT e.id,e.ts,e.kind,e.asset_id,a.name AS asset_name,e.tag_id,t.name AS tag_name
 FROM events e JOIN assets a ON a.id=e.asset_id LEFT JOIN tags t ON t.id=e.tag_id;
REVOKE ALL ON SCHEMA rallyx_reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA rallyx_reporting FROM PUBLIC;
