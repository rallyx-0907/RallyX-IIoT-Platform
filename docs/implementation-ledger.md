# Implementation ledger

Plan: `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md`.

## Current continuation — local extensibility

- Tracking reconciliation 2026-10-23: root local change spec now has 158 additional verified checkboxes, and the original implementation plan has 148 additional task/API checkboxes. Evidence, baseline-versus-amended scope, and deliberately open gates are mapped in `docs/checklist-evidence.md`. No application code, runtime image or database changed in this documentation group. SaaS remains superseded; UI/full scenario/physical RTU/restart/offline/restore gates remain open.

- Latest continuation 2026-10-23: runnable Node connectivity service and opt-in Compose profile added, with service-token config reload/status, generic Simulator values, MQTT mapping/FIFO subscriptions, read-only Modbus TCP and RTU adapter code, per-tag poll scheduling, configurable retry/backoff, and administrator Test Connection/Test Read proxy. Raw/decoded/scaled diagnostics never publish telemetry; credentials remain internal.
- Connectivity acceptance passes in separate test Core/worker containers and `rallyx_connectivity_test`: create a new Site/Area/Asset/Modbus Connection/Device/five Tags by API, Test Connection/Test Read, raw-to-scaled current state/history, timeout and automatic recovery, no runtime restart. Real-broker MQTT mapping and burst FIFO tests pass. Physical RTU transport and UI-driven acceptance remain outstanding.
- Independent connectivity review identified four Important issues, all fixed with regressions: asynchronous RTU close/late-open ownership; TCP half-open socket cleanup; overwritten MQTT burst messages/subset tag consumption; diagnostics lacking total deadline and caller-disconnect cancellation. Local protocol/worker/HTTP tests pass; full real-DB/broker backend suite, root test/lint/build and Linux connectivity image build pass. Logs: ignored `.tools/connectivity-backend.log`, `.tools/connectivity-acceptance.log`.
- Review grading: unit ID 0 fallback and invalid decoding metadata were promoted from minor to Important because accepted configurations could silently read another unit/bit. Nullish unit fallback and explicit bit-index/register-count validation now prevent those results, with decoder/registry/adapter coverage. No review minors remain deferred.
- Ruling: MQTT subscriptions consume FIFO messages for all mapped tags independently of poll intervals; Modbus/Simulator retain per-tag polling overrides — decimating boolean source transitions would corrupt runtime/alarm history. Cost: high-rate input is bounded at 1024 queued messages and overflows fail visibly instead of silently overwriting source data.
- Ruling: keep connectivity behind the Compose profile and leave the active baseline Core/Web/Node-RED images running until producer/UI migration acceptance — this avoids deploying an incompatible backend alone. The test Core uses its own MQTT_CLIENT_ID so shared test broker access cannot disconnect the running Core. Cost: normal stack rollout waits for the next UI/producer group.
- Current next work supersedes older next-work entries below: dynamic configuration UI (Connections/Devices/Templates/Tag editor/CSV/dashboard), migrate Node-RED producer and acceptance controls to the device contract, detailed rule engine, then coordinated deployment/operations acceptance. See `docs/connectivity.md` for configuration and test commands. Migrations 002/003 remain immutable; only test databases have been migrated by this work.
- Final continuation verification: Linux connectivity acceptance 23/23 passed with no skips; local Node connectivity/contracts 21 passed and three service-dependent cases skipped locally (covered by the Linux run); full backend DB/broker suite, root `npm test`, `npm run lint`, `npm run build`, profile Compose config and staged diff whitespace checks all pass. Test Core/worker/probe containers are cleaned up; no active baseline application image was upgraded.

- Continuation verified 2026-10-23: full real TimescaleDB/Mosquitto integration suite passes, including connectivity token/credential boundary and the newest CSV/dashboard/archive API assertions. This supersedes earlier notes that those API assertions still need rerunning.
- Connectivity foundation added: `WorkerManager` reconciles enabled device configurations, retains unchanged workers, closes changed/removed workers, prevents overlapping reads and post-removal publication, and isolates read failures with bounded exponential backoff. Adapter I/O must itself be bounded; the runnable service and protocol adapters remain next.
- Generic Simulator adapter reads connection `protocol_config.values` with per-device `metadata.simulator_values` overrides, validates configured tag types, and never fabricates missing readings. Workers publish raw typed values through shared device telemetry helpers; Core retains scale/offset ownership. External exception strings are replaced with safe diagnostics before status reporting.
- Seven connectivity/contract Node tests pass and are now included in root `npm test`. Worker tests cover independent failure/recovery, dynamic replacement/disable, unchanged-worker retention, duplicate scheduling, and removal during an in-flight read. No amended runtime image has been deployed.
- Continuation checks also pass: root `npm test` (Node, local Go and six frontend tests), frontend production build, and `git diff --check`. The real-DB/broker suite above separately exercises integrations that local Go tests skip without test-service environment variables.
- Next implementation: runnable connectivity service with authenticated configuration reload/status reporting; bounded MQTT/Modbus TCP/RTU adapters, shared serial-port serialization, Test Connection/Test Read proxy and generic simulator controls, followed by dynamic UI. Physical RTU/offline/reboot acceptance remains unverified.

- Remote `main` contains tested baseline commit `408fe5c6cfed1e162e115dfa6eb4e1c438db4cd5`; local branch remains `feat/platform-mvp`, tracking `origin/main`. Push authorization persists. GitHub CLI helper is configured only in this repository and works; older historical credential notes below are resolved.
- Mandatory scope is the local change spec, implemented via `docs/local-extensibility-plan.md` and `docs/local-extension-decisions.md`. SaaS spec is already explicitly superseded. A detailed `RallyX_FEATURE_RULE_ENGINE_AGENT_PLAN.md` is also present; read it in full before the rule-engine expansion.
- Uncommitted migration 002 has been applied successfully ONLY to `rallyx_test`; preserve its checksum now. Production/dev `rallyx` database and running images still use baseline until an intentional rebuild/restart.
- Migration 002 adds Area-owned assets, Connections, device ownership and device-key uniqueness, typed tags/flags, encrypted credential envelopes, templates, tag-scoped runtime ownership, rule/debounce fields, widgets and local settings. Historical unassigned tags are retained under disabled migration devices/connections. Legacy panel rows remain provenance only.
- New Go contracts package validates the device topic/payload (`timestamp`, `device_id`, `asset_id`, `values`, uppercase quality); MQTT subscribes through its shared constant. Ingestion resolves active Device + Asset, applies scale/offset, enforces numeric ranges, stores raw/current values and deadband/history flags, and uses tag-scoped sessions.
- Registry now validates protocol config and clones template tags atomically. AES-GCM credentials are bound to connection ID and never returned in connection records. Test creating ten devices/twenty tags and modifying the template without changing instances passes.
- Latest verification: full `tests/integration/run.sh` passes against real TimescaleDB/Mosquitto, including all baseline regression coverage plus new contracts, vault, numeric boundary, local schema and template tests.
- Next: complete metadata DELETE/disable reconciliation, CSV preview/atomic import/export, user dashboard CRUD; then restricted connectivity configuration API and independent Simulator/MQTT/Modbus TCP/RTU worker service, dynamic UI, detailed rule engine, operations and acceptance. Do not deploy the amended backend alone before updating producer/UI contracts.
- Test runner accepts optional Go package/flag arguments, e.g. `bash tests/integration/run.sh ./internal/storage -run TestDynamicConfigurationTemplatesAndWriteOnlyCredentials`.
- CSV storage/API implemented and individually verified: preview is read-only, 120-row import succeeds, invalid rows identify row/column and cannot partially commit, duplicate import does not overwrite, export is spreadsheet-safe.
- Dashboard storage/API implemented and individually verified: Value/Status/Trend definitions persist in SQL and are scoped to the authenticated user; viewers can manage their own widgets while configuration imports remain administrator-only.
- Migration 003 adds lifecycle end reasons and active-only tag key/semantic uniqueness. It has been applied to `rallyx_test`; do not edit migration checksums. Disable/archive pauses runtime, marks values stale, clears alarms with a reason and preserves history. Resume emits `runtime_resumed` instead of a fake start; its regression test passes.
- Configuration DELETE now requires administrator role plus explicit `{confirm:true,history_policy:"retain"}`; referenced connections must have devices moved/archived first. The newest API archive assertions still need their rerun.
- Current next work: token-protected connectivity config/status API, worker service, Test Connection/Test Read, generic simulator controls; update UI/producers to device contract before deploying amended backend. Running dev images and remote main still contain the verified baseline.

## Authority and execution

The user explicitly requested implementation of the supplied roadmap. Its architecture and sequence are the approved brief; implementation proceeds inline in `feat/platform-mvp`. Preserve the original root plan and AGENTS.md. The referenced architecture DOCX is not present; the Markdown contracts govern implementation.

## Pre-flight

- M0 → M1: build/test commands must work both locally and inside containers.
- M1 → M2: PostgreSQL uses TimescaleDB; migrations execute before API startup.
- M2 → M3: hierarchy IDs and tag keys must be stable and constrained in SQL.
- M3 → M4 → M5: telemetry resolves registered entities, applies atomically, rejects late/duplicate changes, and persists sessions before broadcasting.
- M5 → M6 → M8: simulator and UI use the same public model and APIs as field deployments.
- M9 → all writes: authentication must protect configuration from first deployment, even though full RBAC is a later milestone.
- M11 → M12 → M14: offline/recovery claims require real Linux/container acceptance tests; source files alone do not satisfy release gates.

## Decisions

- Ruling: work in the existing checkout on a feature branch because the repository has no commits and consists only of user-provided planning documents. Cost if wrong: relocate the feature branch later.
- Ruling: bootstrap authentication protections alongside initial APIs, then extend roles/audit at M9. Cost if wrong: earlier authentication integration work; prevents exposing configuration during intermediate deployments.
- Ruling: Make delegates to a cross-platform Node command runner, so Windows contributors can use `npm run ...` without GNU Make. Cost if wrong: Node is needed for root development commands; already required for React.

## Environment

- Windows host, Node 24.18.0, npm 11.16.0, old Git (use `checkout`, not `switch`).
- Go SDK: installing locally under ignored `.tools/`, SHA256 checked against official release metadata.
- WSL2 Ubuntu 22.04 exists; container engine availability under investigation.

## Progress

- Roadmap read in full; no milestone marked complete yet.
- Foundation: Compose configuration validated; all five services healthy in WSL. Core now runs migrations/bootstrap, MQTT ingestion, stale evaluation, REST and authenticated WebSocket.
- M2 verification: migrations apply twice, seed twice, foreign keys reject orphan tags, hypertable exists, and timestamp-range insert/query passes against a dedicated TimescaleDB test database.
- M3/M9 verification: registry CRUD validation, mapping updates, duplicate conflict, session login/logout, forced initial password change, viewer restrictions, operator acknowledgement, user creation and audit pass against PostgreSQL.
- M4/M5 verification: real QoS1 broker ingestion, duplicate suppression, atomic rejection, old timestamp handling, bad-quality transition suppression, runtime recovery, threshold hysteresis and stale-alarm recovery pass.
- Frontend: 6 Vitest tests pass (login failure, empty model, visible API failure, and quality/status badges); TypeScript and Vite production build pass.
- Simulator: generation helpers pass two Node tests; production Node-RED flow generated from the tested helpers. Full-stack simulator acceptance is next.
- Windows-to-WSL localhost forwarding is not working on this host, although WSL-local Web proxy health is healthy. An accessible development URL is still being verified.
- Remote: user authorized pushing to `main` on `https://github.com/rallyx-0907/RallyX-IIoT-Platform.git`. Git credential helper cannot authenticate; GitHub connector cannot see the private repository. User will log in locally. Do not force-push or overwrite remote history.
- Credential issue resolved: local Git 2.12's old manager helper was bypassed with a repository-scoped empty reset plus the absolute GitHub CLI helper. `gh` is logged in as CalisJI; API confirms admin/push permission; `git ls-remote origin` succeeds and returns no refs (empty repository).
- Mandatory new scope: local change spec read in full. SaaS file already says SUPERSEDED. Execute `docs/local-extensibility-plan.md` before treating baseline milestones as complete; migrate hierarchy, device-scoped tags and telemetry, add dynamic protocol configuration/templates/CSV/widgets.
- Windows access verified at `http://172.27.165.200:8080`; local ignored `.env` binds the WSL network for development. Windows localhost forwarding remains unavailable.
- E2E exposed stale upstream IP resolution after Core recreation. Nginx now uses Docker DNS with a five-second validity; rebuilt stack is healthy and acceptance rerun is in progress.
- Baseline zero-hardware E2E now passes (2026-10-23): RUN/STOP, fault activation/ack/clear, history samples, runtime, user creation, authenticated WebSocket. Another defect found: Node-RED broker config ID `broker` equalled its hostname and was treated as a circular config dependency. Renamed config ID, added broker-aware Node-RED health, and regenerated the tested flow.
- Root npm test/lint/build and WSL make test passed. Independent baseline code review requested before first push; local-extension implementation remains next, not falsely checked complete.
- Independent review found five important issues; all now have failing-then-passing regression coverage: ordered FIFO MQTT dispatch per topic; semantic edits cannot orphan open sessions; datatype edits cannot invalidate state/rules; disabling a rule clears active alarms with retained reason events; login limits are scoped to client + account and only trust forwarded addresses from the configured Web proxy.
- The full real-DB/broker backend suite passes after the review fixes. Proxy headers now overwrite forwarded client addresses; Core resolves only the configured `web` proxy before trusting `X-Real-IP`.
- Foundation: Compose configuration validated; all five services healthy in WSL. Core now runs migrations/bootstrap, MQTT ingestion, stale evaluation, REST and authenticated WebSocket.
- M2 verification: migrations apply twice, seed twice, foreign keys reject orphan tags, hypertable exists, and timestamp-range insert/query passes against a dedicated TimescaleDB test database.
- M3/M9 verification: registry CRUD validation, mapping updates, duplicate conflict, session login/logout, forced initial password change, viewer restrictions, operator acknowledgement, user creation and audit pass against PostgreSQL.
- M4/M5 verification: real QoS1 broker ingestion, duplicate suppression, atomic rejection, old timestamp handling, bad-quality transition suppression, runtime recovery, threshold hysteresis and stale-alarm recovery pass.
- Frontend: 6 Vitest tests pass (login failure, empty model, visible API failure, and quality/status badges); TypeScript and Vite production build pass.
- Simulator: generation helpers pass two Node tests; production Node-RED flow generated from the tested helpers. Full-stack simulator acceptance is next.
- Windows-to-WSL localhost forwarding is not working on this host, although WSL-local Web proxy health is healthy. An accessible development URL is still being verified.
- Remote: user authorized pushing to `main` on `https://github.com/rallyx-0907/RallyX-IIoT-Platform.git`. Git credential helper cannot authenticate; GitHub connector cannot see the private repository. User will log in locally. Do not force-push or overwrite remote history.
