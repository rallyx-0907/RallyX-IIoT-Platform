# Local Grafana integration

Grafana 13.3.0 is a separate optional service. Core continues collecting telemetry, calculating runtime and evaluating rules when Grafana is stopped. No field protocol connections move into Grafana.

## Start and use

1. Run `node scripts/setup-grafana.mjs --root-url http://YOUR_HOST:8080/grafana/`. This generates separate private reader/encryption secrets in `.env` and retains existing values on repeat runs.
2. Run `npm run up`, or `docker compose --profile connectivity --profile grafana up -d --wait` after building the amended Core/Web images. The npm dev/up commands enable both profiles. The pinned official Grafana image must be present locally for an offline installation.
3. Sign in to RallyX and open **Bảng điều khiển**. Grafana uses the existing RallyX session. The full editor opens through **Mở trình biên tập Grafana**. Grafana has no published port; all browser access uses `/grafana/` on the Web origin.

RallyX admin maps to Grafana Editor; operator/viewer map to Viewer. No browser role maps to Grafana server administrator. Identity uses the stable RallyX user ID, with the display name supplied by Core. Proxy headers from the browser are replaced; basic/anonymous authentication and separate Grafana login cookies are disabled. Each HTTP request revalidates the RallyX session. PostgreSQL dashboards refresh by HTTP; Grafana Live WebSocket streaming is intentionally disabled so it cannot outlive RallyX logout.

The native panel editor supports Grafana's built-in visualization types and layout tools. Provisioned Vietnamese examples include Stat, multi-series time series, gauge, bar gauge, donut, table, Boolean timeline and alarm table. Asset/device/tag filters resolve metadata rather than fixed device IDs. Time range and refresh are shared dashboard controls. Save a copy of the supplied example for customization: provisioning can overwrite changes to the supplied definition after a file update. Existing native RallyX widgets remain under **Ô dữ liệu** (`#widgets`). Third-party Grafana menus may remain English; RallyX navigation and supplied panel titles are Vietnamese.

## Reporting access and query limits

Migration007 creates `rallyx_reporting.tag_catalog`, `current_values`, `samples`, `alarms` and `events`. These views omit authentication/session/connection secrets. Typed numeric/Boolean/text fields allow queries across protocol types. Current quality accounts for stale timestamps, archived and disabled monitoring; a last value is not proof of a fresh measurement.

Core provisions `rallyx_grafana_reader` only when its private password is configured. It has SELECT on reporting views, no business-table grants or inherited roles, no superuser/role/database creation privileges, three connections, a default five-second statement timeout, one-second lock timeout, read-only transactions and bounded work/temp memory. Grafana also limits its pool to three connections. These are local operational safeguards, not a sandbox for hostile SQL or SaaS tenant isolation.

Sample historical charts cap selected series and result rows. Custom panels should always use `$__timeFilter`, suitable time buckets and bounded selections. Panel display ranges are not alarm thresholds; Core remains the alarm authority. No datasource credentials are sent to the browser.

## Persistence, recovery and deployment

Grafana dashboards/preferences live in the `grafana-data` volume. Backup captures that volume, its SQLite WAL and private encryption key in the normal archive. A running Grafana is briefly paused for a consistent filesystem snapshot; Core/DB ingestion keeps running. Stopped Grafana data is captured without restarting it. Restore checks archive paths, verifies/transfers the relevant app keys using the existing explicit `--restore-keys` flow, restores the selected project's Grafana volume and starts it after Core has restored reader grants. Use the pinned matching Grafana version for recovery.

The optional service remains outside Core health dependencies. If unavailable, RallyX shows a retry state and device configuration remains accessible. Reconfigure the public root URL if this workstation's WSL address changes; production installations should use stable DNS and HTTPS.

This release is still a single local installation. SaaS requires authenticated tenant-aware datasource/database isolation, membership mapping and per-tenant resource limits. Folders, dashboard variables or SQL `tenant_id` filters alone do not provide that isolation.

Official references: [Auth proxy](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/auth-proxy/), [PostgreSQL datasource](https://grafana.com/docs/grafana/latest/datasources/postgres/configure/), [provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/).
