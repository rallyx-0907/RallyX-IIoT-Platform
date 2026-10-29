# Native Entity Dashboard Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver approved A–D: configurable entities, semantic profiles and bindings, shared native dashboard templates and context-driven drill-down/aggregation while preserving existing field data.

**Architecture:** Add an additive Core domain and migrations with a transactional legacy bridge. Resolve semantic widgets in Core and render declarative templates in React, with separate preview/apply configuration and scoped queries. Keep old native/Grafana routes available for compatibility.

**Tech Stack:** Existing Go/pgx/PostgreSQL/TimescaleDB, React/TypeScript, native SVG/CSS for initial renderers; no new external runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-29-entity-driven-platform-design.md` (approved by user 2026-10-29).

## Global Constraints

- Read-only device monitoring remains in force.
- Preserve Modbus TCP/RTU, MQTT, simulator configuration, credentials, physical tag IDs, current state, history, events, rules, alarms and existing user boards.
- Templates never contain fixed register addresses, MQTT topics, concrete device/tag IDs or SQL.
- First implementation remains a single on-prem installation.
- First end-to-end technical target is A–D; E/F are tracked separately, never claimed complete.

## Review Focus

- Concurrent hierarchy edits cannot create cycles; legacy writes remain represented.
- Duplicate child metric keys must not select an arbitrary source.
- Stale, disabled or missing members cannot produce a misleading aggregate zero or LIVE value.
- Preview/cancel must not persist drafts; saved versions/context must survive reload and restart.
- Two entities with one template must resolve different mapped sources, including after new children are added.

### Task 1: Entity schema, bridge and domain

Files: migration `008_entity_dashboards.up.sql`; `storage/entities.go`, `entities_test.go`; API `entity_platform.go`; register in `server.go`.

Interfaces: `Registry.ListEntityTypes`, `SaveEntityType`; `ListEntities(parent,search,limit,offset)`, `SaveEntity(ctx,id,body)`, `EntityContext(ctx,id)`. IDs remain stable, edits require revisions; archived descendants prevent implicit cascade. Core advisory lock serializes structural mutations. Legacy table writes synchronize references inside the same DB transaction; old panels remain provenance.

- [x] Write/run failing domain integration tests for backfill, custom type/intermediate group, cycle rejection, stale revision, legacy creation and archive populated entity.
- [x] Implement additive schema, idempotent bridge and validated metadata/parent mutation.
- [x] Add authenticated read/admin-write API with bounded pagination and explicit errors.
- [x] Verify isolated real DB migrations plus existing registry tests; commit independently.

### Task 2: Semantic profiles, binding and template persistence

Files: `storage/entity_profiles.go`, `entity_dashboards.go`, corresponding tests and API routes.

Interfaces: profile definitions with semantic key/type/unit/history; binding writes map entity+key to physical tag (or named child scope); templates contain versioned `pages[].widgets[]` with `binding:{scope,metric}`; assignments pin a published version. Preview accepts a validated draft without storing it. Versions use optimistic revision/publish semantics.

- [x] Write/run failing tests for incompatible binding, duplicate metric ambiguity, forbidden concrete IDs/SQL, version conflict, clone/export/import and missing assignment.
- [x] Implement Core profile CRUD, metric binding validation, template draft/publish/assignment and context default resolution.
- [x] Verify same published template assigned to two entities keeps one template identity and distinct source bindings; commit.

### Task 3: Scoped runtime, descendant queries and operational views

Files: `storage/entity_runtime.go`, `entity_runtime_test.go`, API runtime routes.

Interface: `DashboardRuntime(ctx,entityID,draftOrAssignedDocument,from,to)` returns entity/breadcrumb/children/template/widgets with value, unit, quality, coverage, histories and diagnostics. Allowlisted aggregations and renderer kinds; parameterized SQL; bounded time/point/sample limits. Initial native refresh is bounded batch polling with offline/reconnect invalidation, explicitly not a completed scoped stream implementation.

- [x] Write/run failing tests for stale/disabled members, missing sources, ambiguity, unit mismatch, partial SUM/AVG, no-data vs zero, descendants added after publish, historical BAD gaps and unauthorized writes.
- [x] Implement single-context resolution, aggregate/group queries, paged child/status/alarms and current/history payloads.
- [x] Verify live Modbus/MQTT tag identity/history untouched and runtime works with Grafana stopped; commit.

### Task 4: Native operator workspace and engineering setup/builder

Files: `apps/web/src/pages/EntityDashboards.tsx`, typed API/domain/renderer modules, CSS, tests; App navigation and legacy compatibility entry.

Interfaces: lazy entity navigation/breadcrumb; setup dialog creates type/entity/profile/bindings; template builder edits semantic widgets with visual drag/resize, properties, preview context then explicit publish/apply. Native widgets show operational overview, children, alarm/problem table, value/status/gauge/bar/trend/distribution/timeline as supported by Core capabilities. Unsupported registry entries are not offered.

- [x] Write/run failing UI tests for two-context reuse, hierarchy navigation, binding errors, no writes on preview/cancel, apply/reload, duplicate keys and offline data.
- [x] Implement native rendering and all configuration flows through Core APIs, retaining old board links and routes.
- [x] Verify full Web tests/build and actual desktop/narrow browser screenshots; commit.

### Task 5: Acceptance, migration and rollout

Files: `tests/e2e/entity-dashboard.test.mjs`, operator docs, implementation Progress Log.

- [x] Build isolated Core/Web candidate against the existing restored representative preview data; verify additive migration and baseline histories/boards.
- [x] Browser journey: custom entity type/group → profile/bind two sources → create shared semantic template → preview/no-write → publish/assign → switch contexts → descendant-added aggregation → trend/alarm drill-down → reload/new tab.
- [x] Fresh independent review; fix material findings and rerun affected checks.
- [x] Backup operating stack, deploy coordinated Core/Web only after acceptance, verify health/ingestion/old boards and rollback path; log only verified completion.

Builder decisions remain within the approved design. No additional execution-method approval is needed: the user explicitly approved proceeding and this session executes inline with a fresh final review.

## Verified delivery — 2026-10-29

Core full suite passed with real isolated TimescaleDB/Mosquitto (.tools/entity-all-tests.log); Web 110/110 passed in 24 files and tsc/Vite passed. Chromium release acceptance covers custom types/profiles, real mapped sources, shared templates, preview/no-write, pointer resize/undo, export/import/clone cancellation, inherited defaults, partial totals, Rule Engine alarm drill-down, reload/new tab and narrow layout. Native snapshots/history/mapping/old boards survive restart and Grafana stop. Fresh review findings have regressions.

Operating Core image b680e2901c87 and Web 6791e0b2b7ed deployed after backup. Existing 14 tags / 3 devices / 1 old board / 5 old widgets preserved; native profiles/templates mapped to the registered sources. Windows Modbus TCP Slave ID1 has 10 GOOD point panels; all 14 sources GOOD. Operating Chromium verified real history, no iframe, direct-link context restored in a new tab and original Bàn thử Modbus Slave with 4 widgets (.tools/native-operating-browser.log). Backup: .tools/pre-native-backup/rallyx-rallyx-20261029T074914Z.tar.gz; prior Core/Web images tagged pre-native-20261029. See docs/native-entity-dashboards.md for usage and E/F follow-up scope. Initial A–D delivery does not certify all 84 reference sections or a V1 release.
