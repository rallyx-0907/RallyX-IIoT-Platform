# IIoT reference: scope and current gaps

Reference: [original product document](iiot-monitoring-dynamic-dashboard.source.md). Preserved byte-for-byte; SHA-256 `79EECB3964474727F192EB17C3DF5DC13E87D629C8EF038BCDC7BD9D3A6D0C8A`.

Design proposal: [entity/profile/template runtime](../superpowers/specs/2026-10-29-entity-driven-platform-design.md). This map records targets, not completed implementation. Current evidence comes from repository source; prior test results do not certify unimplemented requirements.

| Reference sections | Target | Existing foundation / missing work | Delivery |
|---|---|---|---|
| 1–3 | Dynamic entities, types, hierarchy, metadata | Fixed site/area/asset/device tree and JSON metadata exist; configurable types, schema-driven custom fields and arbitrary containment need implementation | A |
| 4–5 | Profiles and semantic datapoints | Device template cloning, tags, units, quality and protocol mapping exist; protocol-neutral profile schema and entity metric bindings need implementation | B |
| 6–8 | Dashboard object, reusable templates, automatic entity dashboard | Native boards and Grafana persistence exist, both bind fixed sources; new template/version/assignment/runtime needed | C |
| 9–10 | Status overview and configurable factory health/states | Basic run/stop/fault/unknown asset state exists; descendant views, configurable state definitions and transparent health calculations need implementation | D/E |
| 11–12 | Energy overview and flow | Numeric telemetry/history exist; semantic unit-aware aggregates, energy counter handling and flow widgets need implementation | D/E |
| 13–14 | Runtime/downtime and state timelines | Runtime sessions/history exist for run/fault; exclusive profile states, shifts/reasons/notes and richer timeline need implementation | D/E/F |
| 15–19 | Alarm identity, severity/lifecycle, compound rules/history analytics | Core rules, alarm records, acknowledge/clear and events exist; profile alarm inheritance, configurable lifecycle/severity and full analytical views require extension | D/E/F |
| 20 | Notification routes and escalation | Do not claim external notification delivery from local alarm rendering; channel integration and verified retry/escalation are separate work | F |
| 21 | Scoped live monitoring with freshness | Authenticated realtime broadcast/reconnect exists; dashboard-scoped subscriptions and bounded runtime snapshots needed | C/D |
| 22–23 | Historical aggregation and comparison | Tag history exists; profile/entity-aware multi-series comparison, period alignment and full aggregation selection need extension | D/E |
| 24–26 | Widget library, GUI builder, separate responsive layouts | Existing concrete-point widgets and Grafana drag layout are not the target native builder; implement renderer registry and persisted template layouts | C/E |
| 27–29 | Drill-down, global filters, search | Fixed asset navigation/filtering exists; arbitrary entity context, lazy tree, breadcrumbs and scoped search needed | A/D |
| 30–32 | Formulas, hierarchical aggregation, virtual metrics | Runtime calculations exist for specific operational semantics; generic typed formula/dependency/query engine needed | D/E |
| 33–35 | Communication health, gateway health, edge offline | Connection/device diagnostics, quality and local operation exist; gateway registry/health and durable store-forward/sync need separate verification/implementation | D/F |
| 36–38 | Protocol adapters, canonical mapping, provisioning | Modbus TCP/RTU, MQTT and simulator foundation exists with mapping/templates/CSV; do not claim other protocols/discovery without implemented adapters and acceptance | B/F |
| 39–44 | Automatic and application-specific device/area/factory dashboards | No profile-bound runtime currently; deliver configuration through the same native engine, not source-coded pages for each example application | B/C/D/E |
| 45–46 | Maps, floorplans, electrical single-line mimic | Native image/SVG placement, safe assets and bound overlays require dedicated renderer/editor work | E/F |
| 47 | Command/control with interlocks and feedback | Conditional in source; outside current read-only V1 authorization. No PLC writes as part of dashboard replacement | Separate approved scope |
| 48–50 | Roles, entity-scoped permissions, multi-tenant isolation | RallyX auth and local admin/operator/viewer roles exist; do not equate Grafana roles or UI filters with scoped/tenant isolation | F; SaaS separate gate |
| 51–53 | Reports, schedules and exports | Existing CSV/config/history routes are only a foundation; report designer, scheduling/PDF/Excel/delivery require implementation | F |
| 54–57 | Events, audit, maintenance and annotations | Event/audit records exist; maintenance scheduling/state accounting and contextual operator annotations need extension | E/F |
| 58–60 | Variables, entity context and runtime scope bindings | Missing semantic dashboard runtime; concrete tag SQL is not equivalent | C/D |
| 61–64 | Inheritance, versions and configuration JSON | Existing device versions do not implement reusable dashboard versions/inheritance; first implement immutable publication/pinned assignment, then controlled inheritance | B/C/E |
| 65–69 | Navigation and operator factory/machine/panel UX | Current product pages exist; rework around entity context, problem location, child navigation and appropriate capabilities | A/C/D/E |
| 70 | Configurable retention/downsampling | Existing retention/settings infrastructure must be checked against full tiered retention targets; no full retention compliance claim yet | F |
| 71 | 10–10,000+ device performance | Existing tests do not prove capacity. Scoped queries, pagination, aggregates, downsampling and measured datasets required | C/D/F |
| 72–74 | System health, APIs and business integration | Current health, diagnostics, REST/WebSocket/MQTT exist; complete platform metrics and verified external integrations remain work | D/F |
| 75 | Later AI/advanced analytics | Explicitly later in source; do not invent model outputs or make this a prerequisite for monitoring | Later |
| 76–78 | Operator priorities, layered architecture and first-class entities | Use Core business logic + semantic domain + native presentation; preserve connector separation and existing history | A–F architecture |
| 79–84 | Configure new factories/device types; semantic templates and reusable widgets | End-to-end acceptance: add entities/profiles/mappings/templates from UI; same template resolves distinct contexts; no application-specific frontend code | A–D first; E/F continue |

## First demonstrable acceptance scenario

1. Keep the current configured Modbus/MQTT sources and telemetry IDs unchanged.
2. Create a custom entity type and an intermediate group between area and machine from UI.
3. Create a protocol-neutral profile with generic metric keys and a native template using current-entity bindings.
4. Map two entities to different physical source points; show correct value/unit/quality and historical samples for each using the same template/version ID.
5. Open factory, drill into group/machine/device, preserve breadcrumb/time range and open related alarms/trends.
6. Add a new child after publishing: it appears in descendants/child widgets without editing the template.
7. Prove ambiguous keys, missing mappings, incompatible units and stale/disabled sources are surfaced explicitly.
8. Preview/cancel makes no writes; Apply persists; reload, new tab and restart keep entity/profile/template assignments. Existing native/Grafana boards and physical histories remain recoverable.
9. Stop Grafana: native monitoring, Core rules and device ingestion still operate.

The full 84-section product target is retained. Passing this scenario certifies the architectural foundation and native dashboard path, not completion of reporting, SaaS, control, AI or every industrial widget.
