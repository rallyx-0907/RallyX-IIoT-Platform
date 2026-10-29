# RallyX: entity-driven monitoring and native dynamic dashboards

Status: approved by user on 2026-10-29: native primary runtime, optional Grafana, A–D first, preserve field data/history. Execution plan: `docs/superpowers/plans/2026-10-29-native-entity-runtime.md`.

## Intent and source

The user asked to rebuild against `IIoT Monitoring & Dynamic Dashboa.md` and reconsider Grafana. The reference is preserved at `docs/specifications/iiot-monitoring-dynamic-dashboard.source.md`. Its central contract is:

`Entity → Profile → Data Points → Dashboard Template → Runtime Binding`

This is a product architecture change, not another Grafana layout adjustment. The document describes 84 sections spanning a complete industrial platform. Examples are illustrations, not assets to seed into a customer installation. Conditional controls, cloud/tenant operations and later AI features are not instructions to enable them immediately.

Success means an engineer can configure a new equipment type, create two entities using one profile, map their real signals, assign one dashboard template, and open either entity with correct readings and no frontend change or copied point IDs. Operators navigate from factory problems to affected area, machine, device, trend and alarm.

## Current evidence and architectural gaps

| Area | Current implementation | Gap |
|---|---|---|
| Hierarchy | `storage.TreeQuery`, `Assets.tsx`, `platform.ts`: site/area/asset/device fixed levels | No arbitrary entity hierarchy, configurable entity types or entity detail runtime |
| Profiles | `configuration.go`, migration 002, `Templates.tsx`: protocol-specific tag definitions copied into devices; assigned version immutable | No protocol-independent entity profile, default dashboard or live template binding |
| Datapoints | Tags already have keys, units, types, quality, enabled/history settings; physical mapping belongs to connectivity | Keys unique per device; asset-level duplicate keys need explicit semantic resolution |
| Native boards | `dashboard.go`, `dashboard_boards.go`: per-user widgets each reference a concrete `tag_id` | No shared template, context, pages, runtime metric resolution or profile assignment |
| Grafana boards | `pointDashboard.ts`, `dashboardWorkspace.ts`, `Grafana.tsx`: persist SQL containing individual tag IDs | Does not implement the requested reusable entity/profile runtime; main UI depends on external iframe |
| Rule/runtime | Existing telemetry rules, alarms, events, history/runtime sessions and compound rule configuration | Reuse these services; configurable profile states, formula/aggregation and profile rule inheritance remain work |
| Realtime | `realtime.Hub` broadcasts changes, `usePlatform` refreshes platform snapshots | No bounded dashboard query/subscription grouped by visible entity context |

No gap listed here is marked implemented by writing this design.

## Approaches

1. Continue configuring Grafana variables and provisioning. Reuses chart widgets, but leaves entity CRUD, profile semantics, assignment, tree navigation and product permissions in another layer. A SQL/iframe workflow remains the operator surface. This does not address the user's principal goal.
2. Build native entity/profile/template runtime in existing RallyX Core and React; keep Grafana optional for engineering analysis and old saved boards. Reuses current ingestion, identity, time-series history, alarms and adapters. Requires a real semantic query service and configuration model. **Approved by user on 2026-10-29.**
3. Replace the platform wholesale with another product. Would require unverified migration of current connectors, tag identities, telemetry history and users. Not proposed for this workspace.

Use Go, PostgreSQL/TimescaleDB and React/TypeScript already in the repository. Chart/rendering libraries are an implementation choice after checking their local/offline packaging, license and accessibility. No CDN or runtime Internet dependency. Widget plugins implement a documented renderer contract; new application profiles/templates are configuration, whereas a fundamentally new visualization renderer can require a plugin release.

## Scope and compatibility decisions

- First implementation remains a single on-prem installation, following prior project authorization. Multiple factories inside that installation are supported. Tenant isolation/billing/cloud sync are separate delivery gates, not simulated by a browser filter or nullable tenant column.
- Read-only device monitoring remains in force. The reference's command/control section is conditional and does not override this boundary.
- Preserve Modbus TCP/RTU, MQTT, simulator configuration, credentials, physical tag IDs, current state, history, events, rules, alarms and existing user boards.
- Do not remove or overwrite Grafana SQLite, its boards, old native widgets or their routes. Move engineering tools out of the main operator workflow once native acceptance passes. Old board selection pointers remain readable and open their legacy viewer.
- No synthetic production totals, OEE, energy, health score or states when no corresponding data/model exists. Unsupported or unmapped capabilities have clear setup/missing-data states.
- Templates never contain fixed register addresses, MQTT topics, concrete device/tag IDs or SQL. These belong to physical mapping or explicit entity bindings.

## Domain model

### Entity hierarchy

`entity_types`: configurable stable key, display name, icon, metadata field schema, optional allowed parent types, active flag and version. Initial types can be seeded generically but are editable/configurable; no switch statement on machine/meter/customer names controls rendering.

`entities`: stable ID, code, name, type ID, parent ID, optional profile assignment, validated metadata, enabled/archive state and optimistic revision. Parent-child containment is a tree in the first release; other typed relations can be added without redefining containment. Reject cycles, self-parenting and archived parents. Serialize structural mutations in Core to prevent concurrent reparenting from creating a cycle. Bound recursion depth and paginated descendants to prevent unbounded traversal; do not impose the old five business levels.

`legacy_entity_refs`: unique `(resource_kind, resource_id)` mapped to an entity ID. Backfill site, area, asset and device rows idempotently. Never assume IDs are globally unique across old tables. Entity IDs are new identities; references preserve original IDs and ownership.

Keep physical ingestion ownership intact during migration. Initially block moving an existing physical device/asset across its original site/connection ownership boundary unless the operation can transactionally maintain old foreign-key/connection invariants. Explain this constraint in the UI. Adding logical grouping levels does not silently rewrite physical ownership. New entity CRUD and supported logical reparenting update a single authoritative entity tree; compatibility projections are maintained transactionally, not by eventual frontend copies.

Compatibility write rule: existing `/sites`, `/areas`, `/assets` and `/devices` configuration writes stay supported during A–D, using the same Core domain transaction to create/update the legacy row and its entity/reference. New entity routes call that domain service when a legacy physical identity exists; they do not issue nested HTTP requests or trigger mutually recursive synchronization. Reject an operation if both representations cannot remain valid. Logical groups have no fabricated legacy physical rows; projections preserve the nearest existing site/area/owning-asset anchors and skip grouping-only levels. A new physical device still needs an explicit valid connection and owning asset; parent selection resolves or asks for that anchor rather than guessing it from the display type. Domain tests cover legacy-created and entity-created rows and both edit directions.

Legacy `panels` are migration provenance, not active containment levels: their read-only compatibility endpoint/data remain intact and are not backfilled as duplicate entity nodes. Backfill deleted assets/devices as archived identity tombstones where needed for historical references; never make them active or infer live metric mappings from them.

Archive rule for slice A: reject archive while any non-archived descendant exists; require reparenting or explicit bottom-up archive first. Archive the target's assignment/bindings from active runtime resolution without deleting their versions, physical identities or history. Structural mutations and archive checks share the hierarchy transaction/lock. Ancestor disabled/archive state contributes to effective runtime availability; do not silently turn off physical polling as a side effect of a presentation/group edit. Archiving a physical resource retains the existing explicit Core lifecycle behavior. Later bulk subtree archive is a separate, explicit atomic operation, not a hidden cascade.

### Profiles, schema and physical mapping

`entity_profiles` and immutable `entity_profile_versions`: semantic metric schema, metadata schema, state model, default dashboard template/version and later rule/formula definitions. A profile defines metric key, label, datatype, unit, precision, optional display range, aggregation permissions and capabilities/history requirements.

Protocol adapter templates remain separate. Existing device templates are retained as physical configuration templates, not relabeled as complete entity profiles. Creating a device can select both a semantic profile and an adapter mapping.

`entity_metric_bindings`: `(entity_id, metric_key)` points to a physical tag, a supported derived metric or a structured aggregate definition. Source IDs are stored here, never in reusable widget templates. Validate type/unit/history compatibility in Core. Missing bindings remain explicitly unmapped; do not guess `hr_0` means voltage or power.

At machine level, two child devices may both expose `current`. Never choose the first matching tag. Bind a profile metric to a named child role plus that child's metric, or explicitly select the physical source in the mapping UI. A singular binding with multiple matches is an error. Users can configure group/descendant aggregation when multiple sources are intended.

Existing tag keys remain unchanged. Semantic aliases belong to entity bindings so history and connector contracts do not change.

### Dashboard templates and assignment

`dashboard_templates`: identity, title, description, applicable profile/type constraints and active/published version pointers.

`dashboard_template_versions`: immutable validated JSON document with schema version, pages, sections, widgets, variables and named responsive layouts. Published versions are immutable. Draft edits use optimistic revision checks. No physical IDs or executable script/SQL in these documents.

`entity_dashboard_assignments`: entity, template, pinned published version or explicit follow-published mode, permitted presentation overrides and revision. Assignment resolution: entity override → assigned profile default → generic entity overview. Opening an entity resolves a template; do not create a copied dashboard row for every new machine.

Pinned is the default for production assignments. Publishing a new version reports affected assignments and compatibility changes. Following the published version is explicit; incompatible versions cannot silently break existing assignments. Later template inheritance is a separate feature with validated override semantics, not unbounded recursive JSON merging.

Standalone dashboards remain possible: their root context is a saved entity selector/group, using the same runtime and widgets. Personal layout preferences do not grant access to entity data.

Example template widget:

```json
{
  "id": "load",
  "type": "value-card",
  "title": "Công suất hiện tại",
  "binding": {"scope": "current", "metric": "active_power"},
  "aggregation": "last",
  "presentation": {"precision": 1, "unit": "kW"},
  "action": {"type": "open-trend", "metric": "active_power"}
}
```

The JSON is declarative configuration, not JavaScript expression evaluation.

## Runtime binding and query service

Core accepts entity context, template/version, page, variables and time range. It validates access and configuration, resolves binding scopes (`current`, `parent`, `children`, `descendants`, selected entity/group/type), then returns widget data and binding diagnostics keyed by widget ID.

Do not send `/tags` or `/assets/tree` for the entire installation every five seconds. Lazy-load tree children/search; page tables; batch visible widget reads; query only resolved IDs/time windows with parameterized SQL. Cache resolution by hierarchy/profile/assignment revisions, and invalidate after relevant mutations.

Current values include value, datatype, unit, source time, receive time, quality, freshness, source/binding diagnostics and coverage. Disabled/archived sources, realtime-off points and stale readings are never presented as LIVE. Offline client connection changes invalidate live presentation even before source timeout. Reconnect requires resnapshot before restoring LIVE. Historical gaps remain gaps.

Aggregation is explicit and unit-aware: LAST/FIRST, SUM/AVG/MIN/MAX/COUNT/DELTA where supported. Voltage is never summed by default. Incompatible dimensions/units produce validation errors until a conversion is configured. A partial aggregate reports participating/expected sources and partial quality; zero available sources produces no value, not zero. Counter DELTA requires defined reset/rollover behavior and boundary coverage. Runtime state intervals are exclusive; unknown time is not assigned to stopped time. Reuse current runtime records until a richer configurable state model is delivered.

Formula Engine belongs in Core. Use a typed, allowlisted expression AST, dependencies with cycle rejection, bounded evaluation and explicit null/quality propagation. No browser `eval`, arbitrary SQL or user executable code. Formulas, virtual metrics and configurable state models are subsequent slices of the same semantic query contract.

Realtime: initial scoped snapshot plus authenticated subscriptions for the visible context; bounded queues, config revision events and resnapshot on gaps/reconnect. Before scoped streaming exists, bounded batch refresh is an explicit interim implementation, not a claim of completed subscription scaling.

Proposed API groups, under existing `/api/v1` auth:

- Entity type/schema CRUD; entity CRUD, children, breadcrumbs, paged search and profile assignment.
- Profile draft/publish/version/compatibility APIs; semantic binding validation and apply.
- Template draft/preview/publish/clone/import/export; assignment and rollback.
- Dashboard runtime snapshot/query and scoped live subscription.
- Existing tag history, alarms/rules and protocol diagnostics reused behind runtime APIs where appropriate.

Core validates every write, imported JSON size/schema/widget types, binding scope, aggregation/type/unit compatibility, revisions and authorization. A preview is read-only; only explicit Apply/Publish/Assign writes configuration. Template export excludes credentials and physical source mappings. Unknown renderer versions are reported, not dropped silently.

## Native operator and engineer UX

Main operator page: compact global entity selector/breadcrumb, context title and state, time range and data freshness. First viewport prioritizes state, active problems and their locations. Factory/area pages show status distribution, child entity cards/table and alarms; equipment pages show configured measurements, states, related devices, trends and alarms. Selecting a child changes context and resolves that child's assigned template automatically.

Example navigation: factory → utility → compressor group → compressor → VFD. Clicking a problem preserves entity/time context into trend and alarm history. Navigation is derived from entity relationships, not separate source-coded pages per equipment model.

Engineering setup: create entity/type → select profile → map semantic metrics to existing signals or adapter setup → choose/default template → read-only preview for one or more entities → Apply. Show type/unit/ambiguity/missing-source errors beside each metric. Creating another entity with the same profile requires new source mapping, not copying/editing widgets.

Template builder opens in a separate window/dialog: widget palette, visual drag/resize canvas, properties panel, entity selector for preview, version/publish controls. Palette initially includes value/status, gauge/progress, multi-series trend, bar, donut/status distribution, child-entity table/cards, alarm table, state timeline and navigation. Capabilities are published in a registry; UI never offers a nonfunctional renderer. Later advanced floorplan/SVG/Sankey/heatmap widgets use the same binding contract.

Properties cover metric(s), scope, aggregation, time range, unit/precision, valid range, thresholds/colors, legend/axes where applicable and click action. Add clone/copy/paste/remove and undo. Missing metrics are visible diagnostics. Desktop/tablet/mobile/wall layouts are named persisted configurations; only a responsive fallback is claimed until separate layouts are actually implemented.

Vietnamese product labels explain signals, devices and visualizations without exposing tag IDs, registers, MQTT topics or database concepts to operators. Technical source details remain in engineering diagnostics. Keep keyboard alternatives, visible focus, accessible dialog behavior, readable font sizes, labels alongside status colors and useful loading/error/no-data states.

## Migration and rollout

1. Back up both Core DB and Grafana data; record IDs/counts of devices, tags, samples, alarms and saved boards. Keep rollback images. Work against a restored isolated environment first.
2. Add new schema forward-only. Idempotently backfill entity references and containment from current models. No tag or telemetry rewrite; no guessed metric semantics or default fake process profiles.
3. Add protocol-neutral profiles, bindings and native templates through configuration APIs. User-facing mapping resolves existing real Modbus/MQTT datapoints.
4. Introduce native runtime behind an explicit feature setting and additive route. Existing routes remain available while parity is tested. No new user flow sends people through Grafana.
5. Provide import/translation for legacy native boards: keep originals; convert supported widgets to explicit bindings. For Grafana, preserve the original viewer/export; translate only recognized safe generated panels and report unsupported panels. Never promise arbitrary SQL/plugin conversion.
6. Make native the main entry only after end-to-end acceptance. Grafana remains optional engineering analysis; its failure/stoppage cannot prevent native monitoring, alarms or ingestion.
7. Test restart, restore and rollback with the new schema. Older binaries must not mutate unsupported new configuration; rollback native feature flag/routes without destructive schema downgrade. Stop/cancel work on template drafts never changes source mapping or field configuration.

## Delivery sequence and completion gates

Each slice is independently implemented, tested and logged; no broad release-complete claim from a working screenshot.

| Slice | Deliverable | Acceptance |
|---|---|---|
| A | Dynamic entity types/tree and legacy identity bridge; CRUD, metadata and breadcrumb UI | Add an intermediate line/panel/group and custom type without code; no cycles; preserve legacy tag/history identity; new-tab/restart persistence |
| B | Protocol-neutral profiles, semantic metric bindings and validation UI | Map the same metric keys to different Modbus/MQTT devices; reject ambiguous source selection and incompatible units/types |
| C | Native template/version/assignment/runtime plus visual builder | One saved template opens two entities with their own live/history values; switch context without copying template or editing frontend; preview makes no writes |
| D | Factory/area drill-down, child aggregation, problems, trends and alarms | Add a child entity after publishing; it appears automatically; correct SUM vs AVG and partial-data reporting; problem → machine → trend/alarm journey |
| E | Wider widget library, formulas/virtual metrics, profile states/rules, responsive layouts | Each renderer and calculation passes data/quality/unit/state tests; publish/rollback preserves existing assignments |
| F | Remaining platform capabilities from the reference | Separate verified gates for reports/notifications, edge buffering, protocols, maintenance, scoped permissions, SaaS isolation and capacity targets |

First end-to-end technical target is A–D, not another one-point Grafana composer. Slice E/F remain required roadmap work; the attached reference is not declared fully implemented when A–D pass.

Required regression coverage: migrations/backfill idempotence, invalid/cyclic/concurrent hierarchy changes, version conflicts, profile/type/unit validation, malicious/invalid imports, missing/ambiguous metrics, disabled/stale sources, historical gaps, aggregate coverage, unauthorized reads/writes, subscriptions/reconnect, legacy board retention, continued Modbus/MQTT ingestion, restart/restore and actual desktop/narrow/wall browser screenshots. Define dataset and measure query latency/memory/payload at each scale target before claiming 1,000 or 10,000-device support.

## Decisions for approval

Approve native RallyX as the primary entity/profile/template runtime, preserve Grafana only as optional legacy/engineering tooling, and implement A–D first while retaining the full reference as the longer product roadmap. Keep on-prem and read-only field integration for this implementation; do not silently expand into cloud/control because the reference describes those possibilities.

After approval, create the detailed test-first implementation plan, then execute with isolated migration/browser validation and a coordinated rollout. This document does not record approval or mark implementation tasks complete.

Builder check completed on 2026-10-29. Two material planning questions—legacy write coexistence/panel provenance and archive of populated entities—were resolved above as engineering choices within the current compatibility scope. No additional user-specific product choice was required for those rules.
