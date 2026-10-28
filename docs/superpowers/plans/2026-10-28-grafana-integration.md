# Approved Grafana integration

User approved real local Grafana, one RallyX login, read-only data access and a future SaaS path without implementing tenancy now. Execute inline using existing Go/React/Compose stack.

## Architecture and choices

- Keep ingestion/Rule Engine independent of Grafana. Grafana is an optional Compose profile with no public port and persistent local storage.
- Browser /grafana/ is proxied through Core's existing RallyX session validation. Replace untrusted identity headers with stable RallyX user ID and a mapped Grafana role: RallyX admin -> Editor, others -> Viewer. Do not create Grafana server admins from browser roles. No anonymous/basic authentication or second session that outlives RallyX logout.
- Add reporting-schema views without credentials/session data; dedicated database reader has SELECT only, bounded connections and query/lock/idle timeouts. Configure credentials at Core startup from private environment; never embed secrets in migrations/config files.
- Provision a dynamic example dashboard from metadata with device/tag selectors and multiple native Grafana panel types. All SQL queries use the reporting schema, typed values and bounded time ranges/series. No hard-coded physical asset/tag IDs.
- Main Dashboard navigation embeds local Grafana; retain prior native widgets under a separate Data widgets page. Authenticated users can open full Grafana. Editors can create/save custom dashboards. Grafana auth proxy is a local integration boundary, not SaaS tenant isolation.
- Include Grafana configuration/data in operational backup handling; keep business DB ingestion running while validating Grafana outage independence. User approved rollout after concrete verification; no additional design checkpoint needed.

## Implementation sequence and evidence

1. RED tests for authenticated proxy identity/role/header stripping, denied anonymous/expired/disabled/forced-password sessions, same-origin writes, unavailable upstream. Implement proxy and status route, Nginx subpath and same-origin framing policy.
2. RED real-DB tests for reporting views/reader permissions and bounded role settings. Add migration007 and startup reader provisioning. Test forbidden telemetry/user writes and no reads of credentials/sessions.
3. Compose profile/config, pinned Grafana image, read-only datasource and provisioned panel gallery; setup-generated private secrets. Frontend Grafana page with explicit outage state and legacy widgets route, tests/localization.
4. Build isolated candidate, rehearse migration/service startup; Chromium no-extra-login, real queries, editor save/reload, viewer restrictions, logout/header-spoof rejection, live ingestion during queries/outage. Fresh review, fix important findings, backup and deploy, verify current slave and Windows access, update Progress Logs.

## Open limits

Do not claim SaaS readiness, sustained load acceptance, or full translation of third-party Grafana UI. Local reporting users share installation data; actual SaaS requires authenticated tenant-aware data isolation beyond dashboard filters.
