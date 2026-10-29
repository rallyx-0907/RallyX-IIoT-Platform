# RallyX IIoT Platform — Agent Implementation Plan

> **Purpose:** This file is the execution source of truth for agents implementing the RallyX IIoT Platform MVP. Work top-to-bottom. Tick a checkbox only after the code/configuration is implemented, tested, and verified.
>
> **Source architecture:** `RallyX_IIoT_Platform_Kien_Truc_MVP.docx`
>
> **Created:** 2026-10-23

> **V1 scope amendment:** `RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md` is mandatory and takes precedence over the original roadmap wherever they differ. The SaaS change spec is superseded. V1 is a single local/on-prem installation; do not implement tenants, edge registries, cloud sync, fleets, or billing. Existing baseline work must migrate forward without deleting history.

> **Tracking reconciled 2026-10-23 against implementation `3896305`:** Verified task-level checkboxes are now marked in their original milestone/API sections; see [evidence and remaining gaps](docs/checklist-evidence.md). A checked backend/API item does not certify its Web UI or coordinated rollout. Baseline stack/browser checks are historical baseline evidence; the amended backend/connectivity have separate test-container evidence. Full restart, physical RTU, offline install, restore/rollback and release gates remain open unless separately verified.

## Agent operating rules

- [x] Read this entire file before changing code.
- [ ] Do not mark a task complete until its tests and verification steps pass.
- [ ] After completing a task, change `- [ ]` to `- [x]` in this file and add a short note to **Progress Log**.
- [ ] Commit after each independently testable task or tightly related task group.
- [ ] Keep Node-RED limited to **connectivity / protocol adaptation / mapping**. Business logic belongs in RallyX Core.
- [ ] Keep MVP field integration **read-only by default**. No control/write commands to PLC/VFD in V1.0.
- [ ] Do not hard-code demo asset names in backend or frontend logic. Demo data must be seeded through the same Asset/Tag model used by real deployments.
- [ ] A new use case must build on Asset / Tag / Event / Rule APIs instead of creating a separate data silo.
- [ ] Local operation must continue when Internet is unavailable.
- [ ] All runtime services must be containerized and restart automatically after reboot.

---

# 1. Product definition

## Product name

**RallyX IIoT Platform**

## MVP use case

**Use Case #1 — Giám sát trạng thái & ghi lịch sử hoạt động thiết bị trong tủ điện**

Typical monitored assets:

- Motor
- Pump
- Fan
- VFD / Servo
- Contactor / Relay
- Heater
- Valve
- Sensor / Transmitter
- PLC / Remote I/O / Meter

Typical tags:

- `run`
- `fault`
- `auto_manual`
- `current`
- `level`
- `temperature`
- `frequency`
- `fault_code`

Derived values handled by RallyX Core:

- Runtime
- Start Count
- Fault Count
- Fault Duration
- Communication Health
- Alarm state

## MVP success flow

```text
Field Device / Simulator
        ↓
Node-RED Connector
        ↓ normalized MQTT
Mosquitto
        ↓
RallyX Core
        ↓
PostgreSQL + TimescaleDB
        ↓
REST / WebSocket
        ↓
RallyX Web
```

## Explicit non-goals for MVP

- Full MES
- Full CMMS
- Predictive AI model
- High-availability cluster
- Multi-tenant cloud billing
- Default control/write to PLC/VFD
- Complex workflow designer

---

# 2. Architecture contract

## Component responsibilities

| Component | Responsibility | Must NOT own |
|---|---|---|
| Node-RED | Modbus RTU/TCP, MQTT input, connector experiments, raw-to-normalized mapping | Runtime/OEE/alarm business logic |
| Mosquitto | MQTT message bus | Asset model or business rules |
| RallyX Core | Asset/tag registry, current state, runtime/event/alarm/rule engine, auth, API | Vendor-specific protocol polling where Node-RED is sufficient |
| PostgreSQL | Relational/configuration data | Frontend-only state |
| TimescaleDB | Time-series samples, aggregates, retention | User/session logic |
| RallyX Web | Product UI | Business logic duplicated from Core |
| Grafana (optional) | Engineering/ad-hoc analytics | Required end-user UI |

## Local asset hierarchy

```text
SITE
└── AREA
    └── ASSET
        ├── DEVICE (Connection + optional Device Template)
        │   ├── TAG
        │   └── TAG
        └── DEVICE
            └── TAG
```

Adding any device using a supported protocol must require configuration only: no source edit, rebuild, or full-platform restart. Runtime and alarm rules reference tag IDs and configuration, never device models. Tag keys are unique within a device. Every telemetry value resolves to Device + Tag + Asset.

Connectivity workers implement a common contract for configuration reload, test connection, test read, polling/subscription, status, and close. A separate connectivity service owns Simulator/MQTT/Modbus TCP/RTU adapters and publishes normalized data to the bus; Core retains metadata and business logic. Node-RED remains available for engineering adapters and does not own domain state.

## MQTT contract

Telemetry topic:

```text
rallyx/v1/device/{deviceId}/telemetry
```

Event topic:

```text
rallyx/v1/device/{deviceId}/event
rallyx/v1/device/{deviceId}/status
```

Telemetry payload baseline:

```json
{
  "timestamp": "2026-10-23T09:00:00.000Z",
  "device_id": "vfd-01",
  "asset_id": "conveyor-01",
  "values": {
    "run": true,
    "fault": false,
    "current": 7.42
  },
  "quality": "GOOD"
}
```

Rules:

- `timestamp` must be ISO-8601 with timezone; retain a separate server receive timestamp.
- `quality` values: `GOOD`, `BAD`, `UNCERTAIN`, `STALE`.
- Missing tag values do not implicitly become zero.
- Topic device ID must match the payload and resolve to the configured device/asset/tag hierarchy.
- Unknown asset/tag input must be rejected or quarantined with a visible diagnostic; never silently create production assets.

---

# 3. Target repository structure

```text
rallyx-iiot-platform/
├── README.md
├── Makefile
├── .env.example
├── compose.yaml
├── docs/
│   ├── architecture.md
│   ├── mqtt-contract.md
│   ├── deployment.md
│   └── agent-plan.md                  # copy of this file
├── apps/
│   ├── core/
│   │   ├── cmd/rallyx-core/main.go
│   │   ├── internal/
│   │   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── assets/
│   │   │   ├── mqtt/
│   │   │   ├── state/
│   │   │   ├── events/
│   │   │   ├── runtime/
│   │   │   ├── alarms/
│   │   │   ├── rules/
│   │   │   ├── telemetry/
│   │   │   └── storage/
│   │   ├── migrations/
│   │   ├── Dockerfile
│   │   └── go.mod
│   └── web/
│       ├── src/
│       │   ├── api/
│       │   ├── components/
│       │   ├── layouts/
│       │   ├── pages/
│       │   ├── stores/
│       │   └── types/
│       ├── Dockerfile
│       └── package.json
├── connectors/
│   └── node-red/
│       ├── flows/
│       │   ├── simulator.json
│       │   ├── modbus-tcp-example.json
│       │   └── modbus-rtu-example.json
│       └── settings.js
├── config/
│   ├── mosquitto/mosquitto.conf
│   └── rallyx/
├── deploy/
│   ├── online/
│   └── offline/
├── scripts/
│   ├── install.sh
│   ├── uninstall.sh
│   ├── update.sh
│   ├── backup.sh
│   ├── restore.sh
│   └── healthcheck.sh
├── tests/
│   ├── integration/
│   └── e2e/
└── dist/
```

---

# 4. Technology decisions

- **Core Backend:** Go
- **Web Frontend:** React + TypeScript
- **Broker:** Eclipse Mosquitto
- **Connectivity:** Node-RED
- **Database:** PostgreSQL + TimescaleDB
- **Deployment:** Docker Compose / Podman Compose
- **API:** REST + WebSocket
- **Bootstrap config:** `.env` + YAML where needed
- **Operational config:** stored in DB and managed from RallyX Web
- **Architectures:** x86_64 / amd64 and ARM64
- **OS target:** Debian/Ubuntu Server or equivalent Linux without desktop dependency

---

# 5. Milestone checklist

## Milestone 0 — Repository, build system, conventions

Tracking note: backup/offline Make target declarations exist, but their implementation scripts do not; those targets and this milestone's overall completion remain unchecked. The architecture document also still needs the amended hierarchy/worker boundary.

**Goal:** A new developer/agent can clone the repo, understand the layout, run lint/test commands, and start the local stack.

### Tasks

- [ ] Create repository tree from **Target repository structure**.
- [x] Add root `README.md` explaining architecture, quick start, and component ownership.
- [x] Add root `.env.example` with database, MQTT, ports, initial admin, and timezone placeholders.
- [ ] Add root `Makefile` with at least:
  - [x] `make dev`
  - [x] `make up`
  - [x] `make down`
  - [x] `make logs`
  - [x] `make test`
  - [x] `make e2e`
  - [x] `make backup`
  - [ ] `make package-offline`
- [ ] Create `docs/architecture.md` from Sections 1–4 of this plan.
- [x] Create `docs/mqtt-contract.md` containing the exact MQTT contract above.
- [x] Add formatting/lint config for Go and TypeScript.
- [x] Add `.gitignore` for generated data, secrets, build artifacts, Node-RED credentials, and DB volumes.

### Verification

- [x] `make test` executes successfully even if only placeholder tests exist.
- [x] `docker compose config` or equivalent validates without syntax errors.
- [x] No secret/password is committed to the repository.

### Definition of Done

- [ ] Milestone 0 complete: repo skeleton, commands, docs, and conventions are usable by another agent without explanation.

---

## Milestone 1 — Container runtime stack

**Goal:** Start the base RallyX stack with one command.

### Files

- `compose.yaml`
- `.env.example`
- `config/mosquitto/mosquitto.conf`
- `connectors/node-red/settings.js`
- `apps/core/Dockerfile`
- `apps/web/Dockerfile`

### Tasks

- [x] Add PostgreSQL + TimescaleDB service with persistent volume.
- [x] Add Mosquitto service with persistent config/data/log volumes.
- [x] Add Node-RED service with persistent flows volume.
- [x] Add placeholder RallyX Core service exposing `/health`.
- [x] Add placeholder RallyX Web service exposing port `8080` through the selected routing strategy.
- [x] Add healthchecks to DB, broker, Core, Web, and Node-RED.
- [x] Configure service restart policy for reboot recovery.
- [x] Keep internal-only ports off the host unless needed for engineering.
- [x] Document port map in `docs/deployment.md`.

### Verification

- [x] `docker compose up -d` starts all services.
- [x] `docker compose ps` reports healthy services.
- [ ] Reboot/restart test confirms services recover automatically.
- [x] Browser can reach RallyX Web entry URL.
- [x] RallyX Core `/health` reports broker and database status separately.

### Definition of Done

- [ ] Milestone 1 complete: a fresh Linux host can run the empty platform stack with one compose command.

---

## Milestone 2 — Database schema and migrations

**Goal:** Create the stable data foundation for all later use cases.

### Required tables

- `sites`
- `areas`
- `assets`
- `devices`
- `connections`
- `device_templates`
- `dashboard_widgets`
- `tags`
- `tag_current_state`
- `telemetry_samples` — Timescale hypertable
- `events`
- `runtime_sessions`
- `alarms`
- `rules`
- `users`
- `roles`
- `audit_log`

### Tasks

- [x] Add migration framework to RallyX Core.
- [x] Create initial schema migration for asset hierarchy.
- [x] Create device/connector/tag schema.
- [x] Create current-state table with value, quality, and timestamp.
- [x] Create TimescaleDB telemetry hypertable.
- [x] Create events and runtime session tables.
- [x] Create alarms and rules tables.
- [x] Create users, roles, and audit log tables.
- [x] Add indexes for common lookups by site, asset, tag, and time.
- [x] Add schema seed migration for one demo Site/Area/Panel/Assets/Tags.
- [ ] Add migration rollback where safe.

### Required tests

- [x] Migration applies on an empty database.
- [x] Migration is idempotent through the normal migration tool.
- [x] Demo seed creates hierarchy without hard-coded application dependencies.
- [x] Time-series insert/query works across a time range.
- [x] Foreign keys prevent orphan tag/asset records.

### Definition of Done

- [ ] Milestone 2 complete: database can be recreated from migrations and contains the complete MVP model.

---

## Milestone 3 — RallyX Core: Asset and Tag Registry

**Goal:** All UI and telemetry processing resolve through configured assets and tags.

### Core interfaces

Implement domain services with equivalent capabilities:

- `CreateSite`
- `CreateArea`
- `CreateConnection`
- `CreateAsset`
- `CreateDevice`
- `CreateConnector`
- `CreateDeviceTemplate`
- `CreateTag`
- `GetAssetTree`
- `GetAsset`
- `ListTagsByAsset`
- `UpdateTagMapping`

### API baseline

- [x] `GET /api/v1/sites`
- [x] `GET /api/v1/assets/tree`
- [x] `GET /api/v1/assets/{asset_id}`
- [x] `GET /api/v1/assets/{asset_id}/tags`
- [x] `POST /api/v1/assets`
- [x] `POST /api/v1/tags`
- [x] `PATCH /api/v1/tags/{tag_id}`

### Tasks

- [x] Implement repository/storage layer using PostgreSQL.
- [x] Implement Asset/Tag domain validation.
- [x] Implement REST handlers.
- [x] Add API error envelope and validation error format.
- [x] Add audit entries for configuration changes.
- [x] Ensure asset/tag names are data, not code constants.

### Required tests

- [x] Cannot create a tag for a nonexistent asset.
- [x] Duplicate identifiers in the same scope are rejected cleanly.
- [ ] Asset tree returns stable hierarchy ordering.
- [ ] Invalid datatype/unit/mapping returns validation error, not server error.

### Definition of Done

- [ ] Milestone 3 complete: assets/tags can be created, queried, and modified only through the RallyX model/API.

---

## Milestone 4 — MQTT ingestion and current state

**Goal:** RallyX Core receives normalized telemetry from Mosquitto and updates state/history safely.

### Tasks

- [x] Implement MQTT client lifecycle in RallyX Core.
- [x] Subscribe to `rallyx/v1/device/+/telemetry`.
- [x] Parse timestamp, device_id, asset_id, values, and quality.
- [x] Resolve device/asset IDs against configuration, not demo constants.
- [x] Resolve incoming tag keys to configured RallyX tags.
- [x] Update `tag_current_state` transactionally.
- [x] Store selected samples in `telemetry_samples` according to sample policy.
- [x] Quarantine/log unknown asset or unknown tag input.
- [ ] Handle broker reconnect without duplicate state corruption.
- [x] Publish/emit WebSocket update for changed current values.

### Required tests

- [x] Valid telemetry updates current state.
- [x] Missing tag is not converted to zero.
- [x] Bad timestamp is rejected with diagnostic.
- [x] Unknown asset is not silently created.
- [x] Duplicate MQTT delivery does not create invalid duplicate transitions.
- [ ] Broker disconnect/reconnect resumes processing.
- [ ] Quality `bad/stale/unknown` persists correctly.

### Definition of Done

- [ ] Milestone 4 complete: normalized MQTT telemetry flows into current state and time-series storage reliably.

---

## Milestone 5 — State, Runtime, Event, Alarm and Rule Engine

Tracking note: the existing engine has tested transitions, SQL-backed sessions, fault/high/stale lifecycle and hysteresis. Persisted debounce fields alone do not complete debounce evaluation; digital OFF, counter reset and detailed rule-engine work remain open. Engine reconstruction tests are not full-process restart acceptance.

**Goal:** Turn raw telemetry into useful IIoT operating history.

### State behavior

For a configured `run` boolean tag:

- `false → true` = start event + open runtime session + increment start count.
- `true → false` = stop event + close runtime session + calculate duration.

For a configured `fault` boolean tag:

- `false → true` = fault event + increment fault count + open fault alarm/session.
- `true → false` = clear/close fault state and calculate fault duration.

### Rule types required in MVP

- Boolean fault alarm
- Analog high threshold
- Analog low threshold
- Communication stale / no fresh telemetry

### Tasks

- [x] Implement state transition detector.
- [x] Implement immutable event records for relevant transitions.
- [x] Implement runtime session open/close logic.
- [x] Implement start/fault counters as derived query or maintained aggregate.
- [x] Implement alarm lifecycle: active → acknowledged → cleared/history.
- [x] Implement threshold rule evaluator.
- [x] Implement stale-data rule evaluator.
- [x] Ensure rule configuration lives in DB.
- [ ] Emit live alarm/event updates through WebSocket.
- [ ] Add recovery logic for a Core restart while an asset is RUN or FAULT.

### Required tests

- [x] Run transition produces exactly one start event.
- [x] Stop transition closes the correct runtime session.
- [x] Repeated identical values do not create duplicate events.
- [x] Core restart does not lose or duplicate an open runtime session.
- [x] Fault alarm activates, can be acknowledged, and clears correctly.
- [ ] Threshold alarm follows configured hysteresis/debounce if implemented.
- [x] Stale communication creates a visible alarm and clears after valid telemetry resumes.

### Definition of Done

- [ ] Milestone 5 complete: RallyX converts live tags into history, runtime, events, and alarms with deterministic behavior.

---

## Milestone 6 — Zero-hardware Simulator and demo seed

Tracking note: the historical baseline Node-RED demo passed, but its producer/UI must migrate to the amended device contract. Do not mark the current device-contract simulator scenario complete from the earlier site/asset-contract E2E result.

**Goal:** A fresh RallyX installation demonstrates the entire pipeline without PLC hardware.

### Demo hierarchy

```text
Demo Site
└── Demo Area
    └── Electrical Panel 01
        ├── Motor 01
        │   ├── run
        │   ├── fault
        │   └── current
        └── Analog Sensor 01
            └── value
```

### Tasks

- [ ] Build Node-RED simulator flow using the production MQTT contract.
- [ ] Provide controls for RUN ON/OFF.
- [ ] Provide controls for FAULT ON/OFF.
- [ ] Provide controllable analog value.
- [ ] Publish with timestamp and `quality=GOOD` using the device topic contract.
- [ ] Add simulator enable/disable setting.
- [x] Seed default fault and analog threshold rules.
- [ ] Verify data survives Core restart and browser refresh.

### End-to-end acceptance

- [ ] RUN ON creates current state + start event + runtime session.
- [ ] RUN OFF closes runtime session.
- [ ] FAULT ON creates active alarm and history entry.
- [ ] FAULT OFF clears alarm and records duration.
- [ ] Analog threshold creates and clears alarm.
- [ ] All values/history are visible through API before frontend work is considered complete.

### Definition of Done

- [ ] Milestone 6 complete: zero-hardware demo proves MQTT → Core → DB → API end-to-end.

---

## Milestone 7 — Field connectivity through Node-RED

Local amendment execution note: current dynamic field connectivity is implemented in the independent connectivity service; Node-RED remains an optional engineering adapter. Checked mapping/status/timeout tasks below refer to the tested service in `docs/connectivity.md`; Node-RED sample-flow and legacy demo-tag requirements remain unverified.

**Goal:** Replace Simulator with a real Modbus source without changing RallyX Core or dashboard definitions.

### Deliverables

- Node-RED Modbus TCP example flow
- Node-RED Modbus RTU example flow
- Mapping template from raw register → RallyX tag
- Connector health status convention

### Tasks

- [ ] Add Modbus TCP sample connector flow.
- [ ] Add Modbus RTU sample connector flow.
- [x] Define register mapping fields: address, function, datatype, byte order, scale, unit, poll interval.
- [x] Normalize real values into the existing MQTT contract.
- [x] Publish connector/communication health.
- [x] Document serial device mapping into container for RS485 USB adapter.
- [x] Add test source using a Modbus simulator before real PLC hardware.
- [ ] Verify at least one real or simulated Modbus RTU/TCP source maps into existing demo tags.

### Required tests

- [x] Connector can recover from Modbus timeout.
- [ ] Invalid register does not crash flow or Core.
- [x] Communication loss produces stale/bad quality.
- [x] Switching source from Simulator to Modbus does not require changing Core business logic.

### Definition of Done

- [ ] Milestone 7 complete: at least one Modbus source drives the same RallyX asset/tags used by the simulator.

---

## Milestone 8 — RallyX Web MVP

Tracking note: baseline screens and generic error/empty-state tests exist. Device-aware hierarchy, full Connection/Device/Template/Tag/CSV workflows and persistent widget rendering still require UI migration; unchanged baseline UI tests do not complete those new screens.

**Goal:** Deliver the product UI required for Use Case #1 and platform configuration.

### Required screens

#### Overview

- [ ] Site health
- [ ] Asset RUN/STOP/FAULT cards
- [x] Active alarms
- [ ] Runtime today
- [ ] Recent events

#### Assets

- [x] Site → Area → Asset → Device → Tag tree
- [ ] Asset metadata
- [x] Current tag values
- [x] Derived runtime/start/fault metrics

#### Live Data

- [x] Tag
- [x] Value
- [x] Unit
- [x] Quality
- [x] Timestamp
- [x] Filter by asset/device

#### History & Trends

- [x] Time range selector
- [x] Analog trend
- [x] Event timeline
- [x] Runtime sessions
- [x] CSV export

#### Alarms

- [x] Active alarms
- [x] Alarm history
- [x] Severity
- [x] Acknowledge action
- [x] Filter by asset

#### Connections

- [ ] MQTT health
- [ ] Core/DB health
- [ ] Node-RED/connector health summary
- [x] Connection test feedback

#### Tag Configuration

- [x] Address/topic mapping
- [x] Datatype
- [x] Scale
- [x] Unit
- [x] Sample policy

#### System

- [ ] Version
- [ ] Service health
- [ ] Backup/restore entry point
- [ ] Logs/diagnostics link or view
- [ ] User management entry point

### Realtime behavior

- [ ] Use WebSocket for current values, alarms, and recent events.
- [ ] Reconnect cleanly after network interruption.
- [ ] Show stale/unknown quality instead of silently displaying old values as live.

### Required tests

- [ ] Frontend unit/component tests for status and alarm states.
- [x] API error state is visible to user.
- [x] Empty data state does not break page.
- [x] Browser refresh preserves correct server-derived state.
- [x] Asset names come from API, not hard-coded demo constants.

### Definition of Done

- [ ] Milestone 8 complete: Use Case #1 can be demonstrated entirely from RallyX Web.

---

## Milestone 9 — Authentication, authorization and audit

**Goal:** Provide minimum product-grade access control without overbuilding enterprise IAM.

### Tasks

- [x] Seed initial admin account through install/bootstrap flow.
- [x] Force/change initial password according to chosen bootstrap policy.
- [x] Implement login/logout/session or token strategy.
- [x] Implement minimum roles: `admin`, `operator`, `viewer`.
- [x] Protect configuration endpoints by role.
- [x] Allow viewers to read dashboards/history without configuration writes.
- [x] Record configuration and alarm acknowledge actions in `audit_log`.
- [x] Ensure secrets are not exposed in frontend payloads or logs.

### Required tests

- [x] Unauthenticated request to protected config endpoint is rejected.
- [x] Viewer cannot modify tags/rules.
- [x] Operator can acknowledge alarm if policy allows.
- [x] Admin configuration change creates audit record.

### Definition of Done

- [x] Milestone 9 complete: RallyX is not deployed with an open unauthenticated configuration surface.

---

## Milestone 10 — Retention, aggregation and time-series operations

**Goal:** Keep history useful without unbounded storage growth.

### Tasks

- [x] Add per-tag sample policy or category defaults.
- [ ] Add Timescale retention policy configuration.
- [ ] Add aggregate/downsample policy for analog trends where appropriate.
- [x] Keep events/runtime/alarm history separate from disposable high-frequency raw samples.
- [ ] Expose storage/retention settings in System or configuration API.
- [ ] Add database size/health diagnostic.

### Required tests

- [ ] Retention removes eligible old telemetry without removing event/runtime records unexpectedly.
- [x] History API can query a large time range without loading all samples into memory.
- [ ] Aggregated trend returns stable ordered timestamps.

### Definition of Done

- [ ] Milestone 10 complete: time-series storage has explicit retention and query behavior suitable for an edge device.

---

## Milestone 11 — Backup, restore, update and rollback

**Goal:** A RallyX edge installation can be recovered or moved to another machine.

### Backup scope

- Database dump
- RallyX configuration
- Node-RED flows/credentials as permitted
- Mosquitto configuration
- Version metadata

### Tasks

- [x] Implement `scripts/backup.sh`.
- [x] Implement `scripts/restore.sh`.
- [x] Include integrity/version metadata in backup bundle.
- [x] Restore to a clean second installation in test.
- [ ] Implement versioned update script.
- [ ] Run DB migrations during update.
- [ ] Preserve previous package/image set for rollback.
- [x] Document recovery procedure.

### Required tests

- [x] Backup completes while system is in a supported operating state.
- [x] Restored system retains asset config and required history.
- [ ] Update failure can roll back to previous version.
- [x] Node-RED flows survive backup/restore.

### Definition of Done

- [ ] Milestone 11 complete: platform can be backed up, restored, updated, and rolled back with documented scripts.

---

## Milestone 12 — Plug-and-play online/offline installer

**Goal:** Install RallyX on Linux without manually installing each service.

### Target package

```text
rallyx-iiot-platform/
├── install.sh
├── uninstall.sh
├── update.sh
├── backup.sh
├── restore.sh
├── compose.yaml
├── .env.example
├── config/
├── images/
│   ├── rallyx-core.tar
│   ├── rallyx-web.tar
│   ├── mosquitto.tar
│   ├── node-red.tar
│   └── timescaledb.tar
└── data/
```

### Tasks

- [ ] Detect supported container engine: Docker or Podman.
- [ ] Online mode: pull version-pinned images.
- [ ] Offline mode: load bundled `*.tar` images with no Internet.
- [ ] Generate `.env` and first-boot secret values.
- [ ] Initialize DB schema and demo seed.
- [ ] Install/start stack.
- [ ] Enable auto-start after reboot.
- [ ] Print access URL after successful install.
- [ ] Provide `healthcheck.sh` for field diagnostics.
- [ ] Provide clean uninstall with explicit option to preserve or delete data.
- [ ] Build packages for amd64 and arm64.

### Supported target baseline

| Level | Target |
|---|---|
| Minimum demo | 2 CPU, 2 GB RAM, 8–16 GB storage |
| Recommended | 2–4 CPU, 4 GB RAM, 32 GB SSD |
| CPU | amd64/x86_64 and arm64 |
| OS | Debian/Ubuntu Server or equivalent Linux |

### Required tests

- [ ] Fresh supported Linux VM installs from online package.
- [ ] Fresh isolated Linux VM installs from offline package with network disabled.
- [ ] Reboot restores full stack automatically.
- [ ] Local platform remains usable with Internet disconnected.

### Definition of Done

- [ ] Milestone 12 complete: RallyX is genuinely plug-and-play for the supported Linux baseline.

---

## Milestone 13 — System diagnostics and field support

**Goal:** A technician can determine why data is missing without shell-level debugging first.

### Tasks

- [x] Expose version/build information.
- [x] Expose Core ↔ DB health.
- [x] Expose Core ↔ MQTT health.
- [ ] Expose Node-RED connector health summary.
- [x] Expose last telemetry timestamp per asset/device.
- [ ] Expose stale/quality state clearly.
- [ ] Add downloadable diagnostic bundle excluding secrets.
- [x] Add log rotation/size limits.

### Definition of Done

- [ ] Milestone 13 complete: common “không có dữ liệu” cases are diagnosable from RallyX System/Connections screens and the diagnostic bundle.

---

## Milestone 14 — Full MVP integration test and release candidate

**Goal:** Validate all acceptance criteria from the architecture spec before tagging V1.0.

### Architecture acceptance checklist

- [ ] **Install:** A new Linux host can install/start RallyX using the package without manually installing each service.
- [ ] **Demo zero-hardware:** Simulator produces RUN/FAULT/analog; data flows MQTT → Core → DB → Web and survives restart.
- [ ] **Field integration:** At least one Modbus RTU or Modbus TCP source maps through Node-RED into RallyX tags.
- [ ] **History:** RUN/STOP/FAULT events, runtime sessions, and selected analog samples are queryable by time.
- [ ] **Alarm:** Fault, analog threshold, and communication stale alarms activate/clear correctly.
- [ ] **Asset model:** Dashboard/use case reads asset/tag configuration from DB; device names are not hard-coded.
- [ ] **Backup/Restore:** Backup restores onto a clean machine while retaining required configuration/history.
- [ ] **Offline operation:** Internet loss does not stop local platform functions; reboot restores the stack.

### Release tasks

- [x] Run backend unit tests.
- [x] Run frontend tests.
- [ ] Run integration tests against full compose stack.
- [x] Run zero-hardware E2E scenario.
- [x] Run Modbus E2E scenario.
- [ ] Run offline installer E2E scenario.
- [ ] Run backup/restore E2E scenario.
- [ ] Record CPU/RAM/disk usage on minimum and recommended hardware profile.
- [ ] Fix all release-blocking errors and diagnostics gaps.
- [ ] Tag release `v1.0.0-rc1`.
- [ ] Produce amd64 offline package.
- [ ] Produce arm64 offline package.
- [ ] Produce release notes.

### Definition of Done

- [ ] Milestone 14 complete: all architecture acceptance criteria pass and RallyX V1.0 release candidate packages are reproducible.

---

# 6. Recommended implementation sequence

Agents should not parallelize tasks that share unstable interfaces too early.

```text
M0  Repository
 ↓
M1  Container stack
 ↓
M2  Database
 ↓
M3  Asset/Tag API
 ↓
M4  MQTT ingestion
 ↓
M5  Runtime/Event/Alarm
 ↓
M6  Simulator + zero-hardware E2E
 ↓
M7  Modbus/Node-RED field integration
 ↓
M8  RallyX Web MVP
 ↓
M9  Auth/Audit
 ↓
M10 Retention
 ↓
M11 Backup/Update
 ↓
M12 Installer/Offline package
 ↓
M13 Diagnostics
 ↓
M14 Release candidate
```

Safe parallel work after interfaces stabilize:

- Frontend components can proceed in parallel with backend internals after M3 API contracts are fixed.
- Offline packaging can begin after M1 but final validation waits for M11–M13.
- Node-RED Modbus examples can be developed in parallel after the MQTT contract is frozen.

---

# 7. MVP API checklist

This is the minimum API surface the agent should stabilize before V1.0. Exact pagination/filter parameters may be refined, but resource boundaries should remain stable.

## Health/System

- [x] `GET /health`
- [x] `GET /api/v1/system/status`
- [x] `GET /api/v1/system/version`

## Asset model

- [x] `GET /api/v1/sites`
- [x] `GET /api/v1/assets/tree`
- [x] `GET /api/v1/assets/{asset_id}`
- [x] `POST /api/v1/assets`
- [x] `GET /api/v1/assets/{asset_id}/tags`
- [x] `POST /api/v1/tags`
- [x] `PATCH /api/v1/tags/{tag_id}`

## Live/history

- [x] `GET /api/v1/tags/{tag_id}/current`
- [x] `GET /api/v1/tags/{tag_id}/history?from=&to=`
- [x] `GET /api/v1/assets/{asset_id}/events?from=&to=`
- [x] `GET /api/v1/assets/{asset_id}/runtime?from=&to=`

## Alarms

- [x] `GET /api/v1/alarms`
- [x] `GET /api/v1/alarms/history`
- [x] `POST /api/v1/alarms/{alarm_id}/ack`

## Rules

- [x] `GET /api/v1/rules`
- [x] `POST /api/v1/rules`
- [x] `PATCH /api/v1/rules/{rule_id}`

## Realtime

- [x] WebSocket endpoint for tag state changes.
- [x] WebSocket endpoint/channel for alarms/events, or a unified event stream.

---

# 8. Release gates — never skip

An agent must not declare the MVP complete until all gates below are checked.

## Data integrity

- [x] No missing value is silently turned into zero.
- [x] Time is stored consistently and returned with timezone-aware timestamps.
- [x] Duplicate MQTT delivery does not produce duplicate state transitions.
- [ ] Open runtime/fault sessions recover correctly after Core restart.

## Field reliability

- [ ] MQTT reconnect tested.
- [x] Modbus timeout tested.
- [ ] Serial device unavailable tested.
- [ ] Node-RED restart tested.
- [ ] Database restart tested.

## User-visible quality

- [ ] Stale data is visibly stale.
- [ ] Alarm acknowledge state is clear.
- [ ] API/connector errors are visible rather than silently ignored.
- [ ] Dashboard works with no data, partial data, and bad-quality data.

## Deployment

- [ ] Online install tested.
- [ ] Offline install tested.
- [ ] Reboot tested.
- [ ] Backup/restore tested.
- [ ] Upgrade/rollback tested.

---

# 9. Post-MVP roadmap — do not implement before V1.0 gates pass

- [ ] **V1.1 Energy Monitoring** — power meter tags, kWh, kWh/unit, idle consumption, tariff mapping.
- [ ] **V1.2 Downtime / OEE** — reason codes, planned/unplanned stop, production count, Availability/Performance/Quality.
- [ ] **V1.3 Condition Monitoring** — vibration/temperature/current trends, baseline, threshold, health score.
- [ ] **V1.4 Maintenance Workflow** — alarm → ticket/work-order integration, asset maintenance history.
- [ ] **V2 Advanced Analytics** — cross-asset analytics, predictive models, cloud sync, multi-site.

---

# 10. Progress Log

2026-10-29 product target realignment (design only, awaiting approval): preserved the user's 84-section IIoT reference byte-for-byte with matching SHA-256; added full-section gap/delivery map and reviewed native Entity → Profile → Data Points → Dashboard Template → Runtime Binding design. Recommends optional engineering/legacy Grafana rather than the primary operator runtime; defines compatibility writes, history/ID preservation, profile metric resolution, template versioning, hierarchy/drill-down, scoped queries and phased acceptance. Builder questions on old API coexistence and populated-entity archive resolved in design. No product code, runtime, connectors or database schema changed, and no new implementation milestone marked complete. See `docs/superpowers/specs/2026-10-29-entity-driven-platform-design.md` and `docs/specifications/iiot-target-gap-map.md`.

- [x] 2026-10-29 visual dashboard workspace: replaced the management-first page with compact scrolling saved-dashboard tabs and an immediately visible dark Grafana viewport. Separate configuration dialog supports site → area → asset → device filtering, multi-device selection (up to 24 points), individual visualization/range choices, real-data preview and explicit Apply; cancel/preview never save. Compact mixed Grafana layouts include colored summary cards, device-qualified chart titles and Boolean state mappings. Existing drag editor now opens separately and previews real values/history. Preserved server dashboards, per-user selection identity and native boards. Preview rejects disabled/realtime-off/stale values and breaks history paths at invalid samples; shared polling avoids one catalog request per card. Verified 102-test Web suite, additional mapping/limit regression, production image build, independent review, isolated Chromium preview/no-write, Apply, SQL queries, new-tab/reload, pointer resize/move/add/save/reopen and actual screenshots. Web-only rollout with backup/rollback image; operating read-only acceptance retains “Bàn thử Modbus Slave” with 4 widgets, continued ingestion, seven healthy services and Windows health 200. See `docs/dashboard-visual-workspace-plan.md` and `docs/point-dashboard-workflow.md`.

- [x] 2026-10-29 saved dashboard reopening/discovery: verified existing Grafana dashboards and native “Bàn thử Modbus Slave” data remained server-backed. Added per-user last-selection pointers, identity-bearing new-tab links and authenticated root landing restoration; resolve missing search entries directly by Grafana UID and never silently replace a requested saved dashboard. Unified native/Grafana discovery under Dashboards, removed the ambiguous duplicate “Ô dữ liệu” navigation and Overview creator, preserving native data and old routes. Dashboard rendering no longer waits for full platform snapshots or slow point configuration; lightweight alarms/realtime remain active and canceled loads cannot overwrite newer contexts. All97 Web tests/build, independent review, genuine new-tab/reload, native-widget count and drag-layout acceptance pass; operating verification confirms “Bàn thử Modbus Slave” retains4 widgets. Web-only rollout with backup/rollback image. See `docs/superpowers/plans/2026-10-29-dashboard-discovery.md`.

- [x] 2026-10-29 flexible Grafana dashboard editor: added Vietnamese in-app multi-point panel insertion, pointer/touch grid movement and resizing, keyboard alternatives, title/size editing, removal, undo and explicit version-aware save. Preserves existing Grafana panel fields and rejects provisioned/advanced row layouts with an advanced-editor fallback. Finite grid bounds and collision pushdown verified. All 87 Web tests pass sequentially; production build, independent review and real Chromium pointer resize/move, second-point gauge insertion, save and reopen pass in isolated Grafana and the operating demo. Created the saved “Giám sát linh hoạt” demonstration dashboard. Web-only rollout with pre-update backup/rollback image retained. See `docs/superpowers/plans/2026-10-29-flexible-dashboard.md` and `docs/point-dashboard-workflow.md`.

- [x] 2026-10-28 guided Grafana point dashboards: replaced the automatic crowded gallery with saved dashboard selection and a Vietnamese device → point → visualization → name creation form. Saves real Grafana dashboards with one-point read-only queries and a quality/timestamp table; supports trends, stat, gauge, bar gauge and table. Fixed Grafana subpath URL handling and its 50-character tag limit for real long point identifiers. Verified 83 Web tests, production build, independent review, isolated Chromium creation/query/rendering and operating HR40001 dashboard creation with GOOD value/timestamp rendering. Web-only rollout, pre-update backup and rollback image retained; Windows health endpoint returns 200. See `docs/point-dashboard-workflow.md`.

2026-10-28 approved Grafana integration: added local Grafana13.3.0 with RallyX-session auth proxy, restricted reporting-only PostgreSQL reader, dynamic native panel gallery and retained legacy widgets. No ingestion or Rule Engine dependency on Grafana. Complete real-DB/broker suite,78 Web tests/build, platform Chromium11/11, native Grafana query/editor/viewer/logout tests and actual embedded chart rendering pass. Tested continued accepted telemetry while Grafana is stopped, SQLite/dashboard backup+restore and legacy recovery safeguards. Deployed seven-service demo; Windows health200, unauthorized Grafana401 and14 GOOD live datapoints verified. See `docs/grafana.md` and `docs/superpowers/plans/2026-10-28-grafana-integration.md`. SaaS/tenant isolation and sustained-load/full-release gates remain open.

2026-10-28: added named per-user dashboards with typed value/status/trend/gauge/level widgets, edit/order/width/settings controls and a dedicated navigation entry. Added device-scoped tag filtering, name/key/address search, datatype filter and 25-row paging. Migration006 preserves legacy default-board widgets. Complete real-DB suite, 76 Web tests/build, independent review and Chromium Modbus/configuration/dashboard workflows 11/11 pass. Review regression prevents unavailable signals silently retargeting edited widgets. See `docs/dashboard-guide.vi.md` and `docs/superpowers/plans/2026-10-28-dashboard-and-tag-scope.md`; full release/hardware/load gates remain separate.

2026-10-28: integrated durable multi-condition Rule Engine, snapshot Test API and Vietnamese/English editor; validated with complete Go/real-DB suites, 68 frontend tests/build, two live MQTT broker checks and Chromium Modbus/CSV/rule lifecycle 9/9. Restart tests preserve pending activation, active alarm identity and pending clear. Generic Modbus TCP/MQTT point mappings remain the integration boundary. See `RallyX_FEATURE_RULE_ENGINE_AGENT_PLAN.md`, `docs/rule-engine.md`, and `docs/demo-technical-status.vi.md`; sustained load, physical hardware and release gates remain open. Retention-policy work deferred by user.

2026-10-28 Vietnamese/hierarchy: fixed concatenated tag metadata and hierarchy layout, added Vietnamese default plus persistent English/Vietnamese selection across login and all existing pages. Configured names and API values remain intact. 65 frontend tests, TypeScript/build, independent review, isolated Chromium Modbus 9/9 and operating bilingual/responsive smoke pass. Web-only image deployed with rollback tag; six services healthy, Windows new bundle HTTP 200, preview stopped. Evidence: `docs/vi-hierarchy-plan.md`.

2026-10-28 UI readability: corrected small shared typography, native form controls/fieldset layout and legacy text encoding; Live Data now groups devices with large measurements and labelled semantic colour states, with stale/offline protection. 57 frontend tests, TypeScript/build, isolated Chromium Modbus workflows 9/9 and operating read-only responsive smoke pass. Web-only update deployed; previous image retained, six services healthy and Windows new bundle HTTP 200. See `docs/ui-readability-plan.md`; V1 release/hardware gates remain open.

2026-10-28 demo readiness: fixed npm dev/up and quick-start instructions to enable the required connectivity profile. Added `docs/demo.md`. Operating stack six services healthy, four GOOD tags and Windows Web health HTTP 200; read-only Chromium login/API/eleven-page smoke passes. Separate preview Simulator API E2E and Chromium Modbus TCP fixture workflows pass (9/9); preview stopped afterward. Root tests (47 frontend), lint/build and real DB/broker backend integration pass. Physical hardware/offline/reboot and remaining V1 gates stay open.

2026-10-24 approved operating upgrade: deployed the exact rehearsed Core/Web/connectivity images to the existing port 8080 after explicit user approval. All six services healthy; unchanged admin credentials pass real Chromium login, six configuration APIs and eleven pages pass read-only smoke. Windows URL returns HTTP 200. Migrations 001/002/003 applied; 26,167 historical samples and seven runtime sessions present, four current tags GOOD. Pre-upgrade checksummed snapshot and old images retained. Full V1 release gates remain open.

2026-10-24 backup/restore: secure versioned/checksummed bundles and explicit-root confirmed restore verified on two independent copied installations. Key mismatch and tampered payloads reject before effects; asset metadata, Timescale telemetry and Node-RED volume/flows recover while target DB credentials/source config remain intact. Timescale pre/post hooks and strict restore errors are enforced. Update/rollback/offline/physical-host gates remain open; see `docs/backup-restore.md`.

2026-10-24 verified continuation: dynamic configuration UI and device producer, Chromium 9/9, API zero-hardware scenario, real DB/broker integration and separate full-stack restart retaining the same open runtime session/config/dashboard/history. Existing-demo simulator defaults now migrate without overwriting configured metadata. A pre-upgrade snapshot restores into a separate database. No physical RTU/offline/release completion is claimed. See `docs/ui-configuration.md`.

2026-10-24 continuation: dynamic Connections UI now implements create/edit/disable/archive with history retention, protocol forms and Test Connection. Component verification covers request payloads, credential retention, diagnostic/error feedback, viewer restrictions and confirmation. Coordinated browser acceptance and remaining Device/Template/Tag/CSV/dashboard workflows remain open. The baseline UI login is verified from Windows via the WSL address; no amended application image was deployed. See `docs/connections-ui.md` and the implementation ledger for exact verification.

Connectivity foundation continuation (local amendment):

- [x] Shared JavaScript device topic/payload helpers and typed scalar/register decoder verified with Node tests.
- [x] Device worker reconciliation, isolated failure/recovery, disabled-worker shutdown and in-flight removal verified with Node tests.
- [x] Configuration-driven Simulator read adapter verified; missing readings are rejected and scaling remains in Core.
- [x] Runnable connectivity service, authenticated dynamic config/status, MQTT and Modbus TCP adapters verified in Linux containers.
- [x] Administrator Test Connection/Test Read, five-tag API configuration, history and automatic Modbus recovery verified without runtime restart.
- [x] RTU serial ownership/late-open, TCP timeout cleanup, MQTT FIFO bursts and diagnostic cancellation covered by regressions.
- [ ] Physical RTU transport acceptance and complete configuration UI/producer migration before coordinated rollout.

Add one line after each completed task group. Keep notes short and factual.

| Date | Agent | Milestone / Task | Status | Verification / Notes |
|---|---|---|---|---|
| 2026-10-23 | — | Plan created | ✅ | Architecture converted to agent-executable checklist. |
| 2026-10-23 | Codex | Local extensibility amendment | In progress | Local change spec read in full; hierarchy, telemetry and active V1 scope updated. Existing baseline unit/integration tests and Web build pass; migration to amended model is required before declaring the changed milestones complete. |
| 2026-10-23 | Codex | Connectivity worker foundation | In progress | Seven Node connectivity/contract tests pass. Full real TimescaleDB/Mosquitto backend suite passes, including service-token credential boundary and CSV/dashboard/archive API regression. Runtime service and remaining adapters are pending; development images remain baseline. |
| 2026-10-23 | Codex | Dynamic connectivity service and diagnostics | Backend verified | Separate Linux test Core/worker verifies dynamic Modbus connection/device/five tags, raw/decoded/scaled Test Read, history and timeout/recovery; real-broker MQTT mapping/FIFO passes. Independent review fixes have regressions. Physical RTU/UI acceptance and coordinated rollout remain open. |
| 2026-10-23 | Codex | Reconcile milestone/API checkboxes | Verified tracking | Marked 148 previously unticked task/API items against implementation `3896305`, source/tests and recorded results. Added `docs/checklist-evidence.md`; original scenario, hardware, operations and release gates remain open. No application code or running images changed. |
| | | | | |
| | | | | |
| | | | | |

---

# 11. Final completion checklist

- [ ] All Milestones 0–14 are checked complete.
- [ ] All release gates pass.
- [ ] `README.md` quick start matches the actual install process.
- [ ] Architecture documentation matches the shipped implementation.
- [x] MQTT contract is versioned and documented.
- [x] DB migrations reproduce a clean install.
- [ ] Offline installer is verified without Internet.
- [x] Demo works with Simulator.
- [ ] Demo works with at least one Modbus source.
- [ ] Backup/restore works on a second clean machine.
- [ ] Release packages exist for amd64 and arm64.
- [ ] RallyX IIoT Platform V1.0 is ready for pilot use.
