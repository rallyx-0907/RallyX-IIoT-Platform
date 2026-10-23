# Local device extensibility implementation plan

**Authority:** the mandatory [local change spec](../RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md) supersedes conflicting original assumptions. Execute inline in the existing authorized development branch. No SaaS abstractions.

## 1. Forward migration and normalized contract

- Add migration 002: flatten active hierarchy to `Site → Area → Asset → Device → Tag`; preserve existing history, IDs, and legacy panel metadata without retaining a panel layer in new APIs.
- Rename connector configuration to Connection; add timing, retry, protocol config, status and timestamps. Require device ownership for new tags; enforce `(device_id,key)` uniqueness.
- Add typed tag decoding/mapping metadata, offset, deadband, history/realtime switches and enabled flags. Add templates, dashboard widgets, debounce state and counter-reset audit metadata.
- Switch normalized telemetry to `rallyx/v1/device/{deviceId}/telemetry` with timestamp/device_id/asset_id/values and uppercase quality. Shared topic builders and contract tests prevent connector drift.
- Verify migration from the current schema, duplicate tag keys on distinct devices, rejected cross-device telemetry, and preserved runtime/history.

## 2. Metadata and configuration APIs

- CRUD `/connections`, `/devices`, `/tags`, `/templates`; soft-delete/disable preserves history. Validate protocol-specific config and all tag fields.
- Encrypt write-only connection credentials with the installation secret; provide a restricted service-token endpoint for connectivity config/status. Never return credentials in browser payloads or logs.
- Instantiate template tags in one transaction; changing a template never mutates existing instances. Verify ten instances and overrides.
- Add CSV preview/commit/export using one validator. Preview returns row/column errors; commit revalidates and is atomic. Verify 100+ tags and rollback on any invalid row.
- Add per-user dashboard widget CRUD, generic tag counter reset with audit, and digital/threshold/stale rules with persisted debounce.

## 3. Dynamic connectivity

- Add an independent containerized connectivity service. It periodically reloads Core configuration, reconciles isolated device workers, and supports Simulator, MQTT, Modbus TCP, and RTU.
- Workers share a protocol interface; publish only normalized telemetry and status. No business rules or direct business-database access.
- Add authenticated Test Connection and Test Read (raw + decoded values) through Core. Explicit timeouts/backoff isolate failures and allow automatic recovery.
- Provide a read-only Modbus TCP simulator and a documented RTU container device mapping. Verify runtime configuration changes without recompilation or full-stack restart.

## 4. Dynamic product UI

- Replace the engineering-only Connections page with Connection configuration/test workflow, Device wizard/template selector, complete Tag editor/test-read, Templates and CSV preview/import/export.
- Render the local hierarchy and metadata generically. Live/history follow tag switches; pin Value/Status/Trend widgets from tags and persist dashboard configuration.
- Keep login, error/empty/stale states, role restrictions, history and alarm flows working during migration.

## 5. Operations and acceptance

- Implement local retention/aggregation, backup/restore with integrity metadata, versioned updates and rollback, online/offline installation and diagnostic bundles.
- Run clean-model acceptance with no demo dependence; new Modbus connection/device/five tags/rule created via UI; two independently polled template instances; 100-tag CSV; per-device failure/recovery; full-stack restart retaining configuration, widgets, runtime and history.
- Re-run baseline backend/frontend/build and full-stack tests. Record verified checkboxes in both source plans; leave hardware/offline/reboot gates unchecked until actually exercised.
- Commit tested groups and push `main` to the user-provided remote without force. Local Git now uses the authenticated `gh` helper, and remote push permission is verified.
