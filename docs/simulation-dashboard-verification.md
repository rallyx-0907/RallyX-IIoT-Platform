# Simulation Dashboard V1 — verification, 2026-11-02

Implemented from RallyX_FEATURE_SIMULATION_DASHBOARD_AGENT_PLAN.md. The native analytical workspace remains available; Simulation Dashboard adds a persisted generic canvas, seven controls, typed Tag bindings and shared Design / Preview / Live rendering.

## Executed checks

- Root test task, node scripts/tasks.mjs test: passed. This is the implementation invoked by make test. It covers Node-RED simulator, contracts, connectivity, Go and Web.
- Final Web suite: 149 tests across 34 files passed. TypeScript lint and production build passed.
- Full Core suite with an isolated PostgreSQL database and MQTT broker: passed, including dashboard CRUD, strict validation, missing references, revision conflicts, all role boundaries, actor audit and real websocket notifications.
- Node simulator/contracts/connectivity: 27 passed, 4 environment-dependent integration tests skipped in the host-only run. Actual TCP Modbus/browser and simulator-to-MQTT-to-Core paths are covered separately below; physical PLC/RTU commissioning is not claimed.
- Broad existing Chromium regression: 11/11 passed, including Modbus reads, rules, CSV, history and legacy read-only Value / Trend / Status widgets.
- Existing native entity/profile/template E2E: passed, including pointer editing, shared templates, scoped values, aggregation, drill-down, reload/new tab and permissions.
- Baseline platform E2E: passed, including MQTT ingestion, runtime, history, alarm activation/acknowledgement/clear and authenticated websocket. Its alarm assertion now targets the configured fault rule, so unrelated rules on the same machine do not cause false failures.
- Simulation browser acceptance: passed. Test configuration creates GRID / GENERATOR / LOAD from generic shapes/labels, nine lamps, three current gauges, one voltage gauge and a numeric value. Sources are registered simulator Tags ingested through the normal connectivity → MQTT → Core path. Browser checks actual pointer movement/resize, numeric edits, explicit save, shared local preview without mutation requests, live values, network loss/recovery, reload/new tab, narrow viewport and UI creation/binding of another dashboard.
- Core/Web restart: passed. The stored document's layout is compared with the pre-restart layout before the browser opens it again in Live mode.

The cabinet arrangement exists only in tests/e2e/simulation-dashboard.test.mjs. Product code contains generic controls and configuration handling. There is no built-in production cabinet, field command API, arbitrary expression execution or alternate telemetry channel per control.

## Review fixes

Independent review found unsaved workspace navigation, save responses replacing newer edits and gauge scales above one million being clipped. Each was corrected, with regression tests for the underlying behavior. Follow-up review found no remaining important issue. Additional tests reject null/object/array/nonfinite values as unavailable rather than crashing or showing OFF.

## Operating rollout

Backed up the operating stack before applying additive migration 012. Deployed Core image ce279f265b84 and final Web image 8555090cc8a8; connectivity was retained. Pre/post configuration comparison confirms the same 14 Tags, 3 devices, 5 legacy widgets and 1 named legacy board. Operating Chromium verifies the user's saved native layout, actual source quality, semantic titles, retained history, direct-link/new-tab restoration and the original four-widget board.

Four simulator Tags are GOOD. The ten points from the existing Windows Modbus Slave remain STALE because that source is unavailable. The UI preserves this distinction; no healthy readings were invented for the diagram.

## Deliberate V1 limits

Images reference installed local raster assets; no upload UI. Single selection, at most 1,000 controls, bounded coordinates and explicit save. New Standard selection opens the existing shared native analytical workspace. Specialized electrical symbols, multi-selection, undo/redo, custom component templates and field commands remain deferred. This feature acceptance does not certify the broader pilot/offline release gates.

Usage and document contract: [Simulation Dashboard guide](simulation-dashboards.md).
