# Implementation ledger

Plan: `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md`.

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
