# RallyX IIoT Platform — Agent Implementation Plan

> **Purpose:** This file is the execution source of truth for agents implementing the RallyX IIoT Platform MVP. Work top-to-bottom. Tick a checkbox only after the code/configuration is implemented, tested, and verified.
>
> **Source architecture:** `RallyX_IIoT_Platform_Kien_Truc_MVP.docx`
>
> **Created:** 2026-10-23

> **V1 scope amendment:** `RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md` is mandatory and takes precedence over the original roadmap wherever they differ. The SaaS change spec is superseded. V1 is a single local/on-prem installation; do not implement tenants, edge registries, cloud sync, fleets, or billing. Existing baseline work must migrate forward without deleting history.

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

**Goal:** A new developer/agent can clone the repo, understand the layout, run lint/test commands, and start the local stack.

### Tasks

- [ ] Create repository tree from **Target repository structure**.
- [ ] Add root `README.md` explaining architecture, quick start, and component ownership.
- [ ] Add root `.env.example` with database, MQTT, ports, initial admin, and timezone placeholders.
- [ ] Add root `Makefile` with at least:
  - [ ] `make dev`
  - [ ] `make up`
  - [ ] `make down`
  - [ ] `make logs`
  - [ ] `make test`
  - [ ] `make e2e`
  - [ ] `make backup`
  - [ ] `make package-offline`
- [ ] Create `docs/architecture.md` from Sections 1–4 of this plan.
- [ ] Create `docs/mqtt-contract.md` containing the exact MQTT contract above.
- [ ] Add formatting/lint config for Go and TypeScript.
- [ ] Add `.gitignore` for generated data, secrets, build artifacts, Node-RED credentials, and DB volumes.

### Verification

- [ ] `make test` executes successfully even if only placeholder tests exist.
- [ ] `docker compose config` or equivalent validates without syntax errors.
- [ ] No secret/password is committed to the repository.

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

- [ ] Add PostgreSQL + TimescaleDB service with persistent volume.
- [ ] Add Mosquitto service with persistent config/data/log volumes.
- [ ] Add Node-RED service with persistent flows volume.
- [ ] Add placeholder RallyX Core service exposing `/health`.
- [ ] Add placeholder RallyX Web service exposing port `8080` through the selected routing strategy.
- [ ] Add healthchecks to DB, broker, Core, Web, and Node-RED.
- [ ] Configure service restart policy for reboot recovery.
- [ ] Keep internal-only ports off the host unless needed for engineering.
- [ ] Document port map in `docs/deployment.md`.

### Verification

- [ ] `docker compose up -d` starts all services.
- [ ] `docker compose ps` reports healthy services.
- [ ] Reboot/restart test confirms services recover automatically.
- [ ] Browser can reach RallyX Web entry URL.
- [ ] RallyX Core `/health` reports broker and database status separately.

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

- [ ] Add migration framework to RallyX Core.
- [ ] Create initial schema migration for asset hierarchy.
- [ ] Create device/connector/tag schema.
- [ ] Create current-state table with value, quality, and timestamp.
- [ ] Create TimescaleDB telemetry hypertable.
- [ ] Create events and runtime session tables.
- [ ] Create alarms and rules tables.
- [ ] Create users, roles, and audit log tables.
- [ ] Add indexes for common lookups by site, asset, tag, and time.
- [ ] Add schema seed migration for one demo Site/Area/Panel/Assets/Tags.
- [ ] Add migration rollback where safe.

### Required tests

- [ ] Migration applies on an empty database.
- [ ] Migration is idempotent through the normal migration tool.
- [ ] Demo seed creates hierarchy without hard-coded application dependencies.
- [ ] Time-series insert/query works across a time range.
- [ ] Foreign keys prevent orphan tag/asset records.

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

- [ ] `GET /api/v1/sites`
- [ ] `GET /api/v1/assets/tree`
- [ ] `GET /api/v1/assets/{asset_id}`
- [ ] `GET /api/v1/assets/{asset_id}/tags`
- [ ] `POST /api/v1/assets`
- [ ] `POST /api/v1/tags`
- [ ] `PATCH /api/v1/tags/{tag_id}`

### Tasks

- [ ] Implement repository/storage layer using PostgreSQL.
- [ ] Implement Asset/Tag domain validation.
- [ ] Implement REST handlers.
- [ ] Add API error envelope and validation error format.
- [ ] Add audit entries for configuration changes.
- [ ] Ensure asset/tag names are data, not code constants.

### Required tests

- [ ] Cannot create a tag for a nonexistent asset.
- [ ] Duplicate identifiers in the same scope are rejected cleanly.
- [ ] Asset tree returns stable hierarchy ordering.
- [ ] Invalid datatype/unit/mapping returns validation error, not server error.

### Definition of Done

- [ ] Milestone 3 complete: assets/tags can be created, queried, and modified only through the RallyX model/API.

---

## Milestone 4 — MQTT ingestion and current state

**Goal:** RallyX Core receives normalized telemetry from Mosquitto and updates state/history safely.

### Tasks

- [ ] Implement MQTT client lifecycle in RallyX Core.
- [ ] Subscribe to `rallyx/v1/device/+/telemetry`.
- [ ] Parse timestamp, device_id, asset_id, values, and quality.
- [ ] Resolve device/asset IDs against configuration, not demo constants.
- [ ] Resolve incoming tag keys to configured RallyX tags.
- [ ] Update `tag_current_state` transactionally.
- [ ] Store selected samples in `telemetry_samples` according to sample policy.
- [ ] Quarantine/log unknown asset or unknown tag input.
- [ ] Handle broker reconnect without duplicate state corruption.
- [ ] Publish/emit WebSocket update for changed current values.

### Required tests

- [ ] Valid telemetry updates current state.
- [ ] Missing tag is not converted to zero.
- [ ] Bad timestamp is rejected with diagnostic.
- [ ] Unknown asset is not silently created.
- [ ] Duplicate MQTT delivery does not create invalid duplicate transitions.
- [ ] Broker disconnect/reconnect resumes processing.
- [ ] Quality `bad/stale/unknown` persists correctly.

### Definition of Done

- [ ] Milestone 4 complete: normalized MQTT telemetry flows into current state and time-series storage reliably.

---

## Milestone 5 — State, Runtime, Event, Alarm and Rule Engine

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

- [ ] Implement state transition detector.
- [ ] Implement immutable event records for relevant transitions.
- [ ] Implement runtime session open/close logic.
- [ ] Implement start/fault counters as derived query or maintained aggregate.
- [ ] Implement alarm lifecycle: active → acknowledged → cleared/history.
- [ ] Implement threshold rule evaluator.
- [ ] Implement stale-data rule evaluator.
- [ ] Ensure rule configuration lives in DB.
- [ ] Emit live alarm/event updates through WebSocket.
- [ ] Add recovery logic for a Core restart while an asset is RUN or FAULT.

### Required tests

- [ ] Run transition produces exactly one start event.
- [ ] Stop transition closes the correct runtime session.
- [ ] Repeated identical values do not create duplicate events.
- [ ] Core restart does not lose or duplicate an open runtime session.
- [ ] Fault alarm activates, can be acknowledged, and clears correctly.
- [ ] Threshold alarm follows configured hysteresis/debounce if implemented.
- [ ] Stale communication creates a visible alarm and clears after valid telemetry resumes.

### Definition of Done

- [ ] Milestone 5 complete: RallyX converts live tags into history, runtime, events, and alarms with deterministic behavior.

---

## Milestone 6 — Zero-hardware Simulator and demo seed

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
- [ ] Seed default fault and analog threshold rules.
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

**Goal:** Replace Simulator with a real Modbus source without changing RallyX Core or dashboard definitions.

### Deliverables

- Node-RED Modbus TCP example flow
- Node-RED Modbus RTU example flow
- Mapping template from raw register → RallyX tag
- Connector health status convention

### Tasks

- [ ] Add Modbus TCP sample connector flow.
- [ ] Add Modbus RTU sample connector flow.
- [ ] Define register mapping fields: address, function, datatype, byte order, scale, unit, poll interval.
- [ ] Normalize real values into the existing MQTT contract.
- [ ] Publish connector/communication health.
- [ ] Document serial device mapping into container for RS485 USB adapter.
- [ ] Add test source using a Modbus simulator before real PLC hardware.
- [ ] Verify at least one real or simulated Modbus RTU/TCP source maps into existing demo tags.

### Required tests

- [ ] Connector can recover from Modbus timeout.
- [ ] Invalid register does not crash flow or Core.
- [ ] Communication loss produces stale/bad quality.
- [ ] Switching source from Simulator to Modbus does not require changing Core business logic.

### Definition of Done

- [ ] Milestone 7 complete: at least one Modbus source drives the same RallyX asset/tags used by the simulator.

---

## Milestone 8 — RallyX Web MVP

**Goal:** Deliver the product UI required for Use Case #1 and platform configuration.

### Required screens

#### Overview

- [ ] Site health
- [ ] Asset RUN/STOP/FAULT cards
- [ ] Active alarms
- [ ] Runtime today
- [ ] Recent events

#### Assets

- [ ] Site → Area → Asset → Device → Tag tree
- [ ] Asset metadata
- [ ] Current tag values
- [ ] Derived runtime/start/fault metrics

#### Live Data

- [ ] Tag
- [ ] Value
- [ ] Unit
- [ ] Quality
- [ ] Timestamp
- [ ] Filter by asset/device

#### History & Trends

- [ ] Time range selector
- [ ] Analog trend
- [ ] Event timeline
- [ ] Runtime sessions
- [ ] CSV export

#### Alarms

- [ ] Active alarms
- [ ] Alarm history
- [ ] Severity
- [ ] Acknowledge action
- [ ] Filter by asset

#### Connections

- [ ] MQTT health
- [ ] Core/DB health
- [ ] Node-RED/connector health summary
- [ ] Connection test feedback

#### Tag Configuration

- [ ] Address/topic mapping
- [ ] Datatype
- [ ] Scale
- [ ] Unit
- [ ] Sample policy

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
- [ ] API error state is visible to user.
- [ ] Empty data state does not break page.
- [ ] Browser refresh preserves correct server-derived state.
- [ ] Asset names come from API, not hard-coded demo constants.

### Definition of Done

- [ ] Milestone 8 complete: Use Case #1 can be demonstrated entirely from RallyX Web.

---

## Milestone 9 — Authentication, authorization and audit

**Goal:** Provide minimum product-grade access control without overbuilding enterprise IAM.

### Tasks

- [ ] Seed initial admin account through install/bootstrap flow.
- [ ] Force/change initial password according to chosen bootstrap policy.
- [ ] Implement login/logout/session or token strategy.
- [ ] Implement minimum roles: `admin`, `operator`, `viewer`.
- [ ] Protect configuration endpoints by role.
- [ ] Allow viewers to read dashboards/history without configuration writes.
- [ ] Record configuration and alarm acknowledge actions in `audit_log`.
- [ ] Ensure secrets are not exposed in frontend payloads or logs.

### Required tests

- [ ] Unauthenticated request to protected config endpoint is rejected.
- [ ] Viewer cannot modify tags/rules.
- [ ] Operator can acknowledge alarm if policy allows.
- [ ] Admin configuration change creates audit record.

### Definition of Done

- [ ] Milestone 9 complete: RallyX is not deployed with an open unauthenticated configuration surface.

---

## Milestone 10 — Retention, aggregation and time-series operations

**Goal:** Keep history useful without unbounded storage growth.

### Tasks

- [ ] Add per-tag sample policy or category defaults.
- [ ] Add Timescale retention policy configuration.
- [ ] Add aggregate/downsample policy for analog trends where appropriate.
- [ ] Keep events/runtime/alarm history separate from disposable high-frequency raw samples.
- [ ] Expose storage/retention settings in System or configuration API.
- [ ] Add database size/health diagnostic.

### Required tests

- [ ] Retention removes eligible old telemetry without removing event/runtime records unexpectedly.
- [ ] History API can query a large time range without loading all samples into memory.
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

- [ ] Implement `scripts/backup.sh`.
- [ ] Implement `scripts/restore.sh`.
- [ ] Include integrity/version metadata in backup bundle.
- [ ] Restore to a clean second installation in test.
- [ ] Implement versioned update script.
- [ ] Run DB migrations during update.
- [ ] Preserve previous package/image set for rollback.
- [ ] Document recovery procedure.

### Required tests

- [ ] Backup completes while system is in a supported operating state.
- [ ] Restored system retains asset config and required history.
- [ ] Update failure can roll back to previous version.
- [ ] Node-RED flows survive backup/restore.

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

- [ ] Expose version/build information.
- [ ] Expose Core ↔ DB health.
- [ ] Expose Core ↔ MQTT health.
- [ ] Expose Node-RED connector health summary.
- [ ] Expose last telemetry timestamp per asset/device.
- [ ] Expose stale/quality state clearly.
- [ ] Add downloadable diagnostic bundle excluding secrets.
- [ ] Add log rotation/size limits.

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

- [ ] Run backend unit tests.
- [ ] Run frontend tests.
- [ ] Run integration tests against full compose stack.
- [ ] Run zero-hardware E2E scenario.
- [ ] Run Modbus E2E scenario.
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

- [ ] `GET /health`
- [ ] `GET /api/v1/system/status`
- [ ] `GET /api/v1/system/version`

## Asset model

- [ ] `GET /api/v1/sites`
- [ ] `GET /api/v1/assets/tree`
- [ ] `GET /api/v1/assets/{asset_id}`
- [ ] `POST /api/v1/assets`
- [ ] `GET /api/v1/assets/{asset_id}/tags`
- [ ] `POST /api/v1/tags`
- [ ] `PATCH /api/v1/tags/{tag_id}`

## Live/history

- [ ] `GET /api/v1/tags/{tag_id}/current`
- [ ] `GET /api/v1/tags/{tag_id}/history?from=&to=`
- [ ] `GET /api/v1/assets/{asset_id}/events?from=&to=`
- [ ] `GET /api/v1/assets/{asset_id}/runtime?from=&to=`

## Alarms

- [ ] `GET /api/v1/alarms`
- [ ] `GET /api/v1/alarms/history`
- [ ] `POST /api/v1/alarms/{alarm_id}/ack`

## Rules

- [ ] `GET /api/v1/rules`
- [ ] `POST /api/v1/rules`
- [ ] `PATCH /api/v1/rules/{rule_id}`

## Realtime

- [ ] WebSocket endpoint for tag state changes.
- [ ] WebSocket endpoint/channel for alarms/events, or a unified event stream.

---

# 8. Release gates — never skip

An agent must not declare the MVP complete until all gates below are checked.

## Data integrity

- [ ] No missing value is silently turned into zero.
- [ ] Time is stored consistently and returned with timezone-aware timestamps.
- [ ] Duplicate MQTT delivery does not produce duplicate state transitions.
- [ ] Open runtime/fault sessions recover correctly after Core restart.

## Field reliability

- [ ] MQTT reconnect tested.
- [ ] Modbus timeout tested.
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

Add one line after each completed task group. Keep notes short and factual.

| Date | Agent | Milestone / Task | Status | Verification / Notes |
|---|---|---|---|---|
| 2026-10-23 | — | Plan created | ✅ | Architecture converted to agent-executable checklist. |
| 2026-10-23 | Codex | Local extensibility amendment | In progress | Local change spec read in full; hierarchy, telemetry and active V1 scope updated. Existing baseline unit/integration tests and Web build pass; migration to amended model is required before declaring the changed milestones complete. |
| | | | | |
| | | | | |
| | | | | |

---

# 11. Final completion checklist

- [ ] All Milestones 0–14 are checked complete.
- [ ] All release gates pass.
- [ ] `README.md` quick start matches the actual install process.
- [ ] Architecture documentation matches the shipped implementation.
- [ ] MQTT contract is versioned and documented.
- [ ] DB migrations reproduce a clean install.
- [ ] Offline installer is verified without Internet.
- [ ] Demo works with Simulator.
- [ ] Demo works with at least one Modbus source.
- [ ] Backup/restore works on a second clean machine.
- [ ] Release packages exist for amd64 and arm64.
- [ ] RallyX IIoT Platform V1.0 is ready for pilot use.
