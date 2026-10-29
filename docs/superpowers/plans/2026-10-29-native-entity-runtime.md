# Native Entity Dashboard Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] Write/run failing domain integration tests for backfill, custom type/intermediate group, cycle rejection, stale revision, legacy creation and archive populated entity.
- [ ] Implement additive schema, idempotent bridge and validated metadata/parent mutation.
- [ ] Add authenticated read/admin-write API with bounded pagination and explicit errors.
- [ ] Verify isolated real DB migrations plus existing registry tests; commit independently.

### Task 2: Semantic profiles, binding and template persistence

Files: `storage/entity_profiles.go`, `entity_dashboards.go`, corresponding tests and API routes.

Interfaces: profile definitions with semantic key/type/unit/history; binding writes map entity+key to physical tag (or named child scope); templates contain versioned `pages[].widgets[]` with `binding:{scope,metric}`; assignments pin a published version. Preview accepts a validated draft without storing it. Versions use optimistic revision/publish semantics.

- [ ] Write/run failing tests for incompatible binding, duplicate metric ambiguity, forbidden concrete IDs/SQL, version conflict, clone/export/import and missing assignment.
- [ ] Implement Core profile CRUD, metric binding validation, template draft/publish/assignment and context default resolution.
- [ ] Verify same published template assigned to two entities keeps one template identity and distinct source bindings; commit.

### Task 3: Scoped runtime, descendant queries and operational views

Files: `storage/entity_runtime.go`, `entity_runtime_test.go`, API runtime routes.

Interface: `DashboardRuntime(ctx,entityID,draftOrAssignedDocument,from,to)` returns entity/breadcrumb/children/template/widgets with value, unit, quality, coverage, histories and diagnostics. Allowlisted aggregations and renderer kinds; parameterized SQL; bounded time/point/sample limits. Initial native refresh is bounded batch polling with offline/reconnect invalidation, explicitly not a completed scoped stream implementation.

- [ ] Write/run failing tests for stale/disabled members, missing sources, ambiguity, unit mismatch, partial SUM/AVG, no-data vs zero, descendants added after publish, historical BAD gaps and unauthorized writes.
- [ ] Implement single-context resolution, aggregate/group queries, paged child/status/alarms and current/history payloads.
- [ ] Verify live Modbus/MQTT tag identity/history untouched and runtime works with Grafana stopped; commit.

### Task 4: Native operator workspace and engineering setup/builder

Files: `apps/web/src/pages/EntityDashboards.tsx`, typed API/domain/renderer modules, CSS, tests; App navigation and legacy compatibility entry.

Interfaces: lazy entity navigation/breadcrumb; setup dialog creates type/entity/profile/bindings; template builder edits semantic widgets with visual drag/resize, properties, preview context then explicit publish/apply. Native widgets show operational overview, children, alarm/problem table, value/status/gauge/bar/trend/distribution/timeline as supported by Core capabilities. Unsupported registry entries are not offered.

- [ ] Write/run failing UI tests for two-context reuse, hierarchy navigation, binding errors, no writes on preview/cancel, apply/reload, duplicate keys and offline data.
- [ ] Implement native rendering and all configuration flows through Core APIs, retaining old board links and routes.
- [ ] Verify full Web tests/build and actual desktop/narrow browser screenshots; commit.

### Task 5: Acceptance, migration and rollout

Files: `tests/e2e/entity-dashboard.test.mjs`, operator docs, implementation Progress Log.

- [ ] Build isolated Core/Web candidate; restore representative existing data; verify migration and baseline histories/boards.
- [ ] Browser journey: custom entity type/group → profile/bind two sources → create shared semantic template → preview/no-write → publish/assign → switch contexts → descendant-added aggregation → trend/alarm drill-down → reload/new tab.
- [ ] Fresh independent review; fix material findings and rerun affected checks.
- [ ] Backup operating stack, deploy coordinated Core/Web only after acceptance, verify health/ingestion/old boards and rollback path; log only verified completion.

Builder decisions remain within the approved design. No additional execution-method approval is needed: the user explicitly approved proceeding and this session executes inline with a fresh final review.
