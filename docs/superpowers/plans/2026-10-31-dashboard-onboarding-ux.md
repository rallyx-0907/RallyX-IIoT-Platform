# Dashboard onboarding UX fixes

> Execute inline using superpowers:executing-plans; the user requested implementation of the supplied review, not another approval round.

**Goal:** A novice connects a device, chooses/discovers signals, sets its location/name and lands on a working native dashboard in three screens.
**Spec:** `RallyX_UX_FIX_SPEC_Dashboard_Onboarding.md` (user-provided review; preserve original).
**Architecture:** Keep protocol operations in connectivity and transactions/business configuration in Core. Generate semantic profiles and native dashboards from adapter templates, keeping pinned versions and existing source/history IDs. Preview/discovery are transient, read-only operations; only Finish writes configuration atomically. Existing engineering APIs remain available.
**Stack:** Go/pgx, React/TypeScript, existing Node connectivity adapters, PostgreSQL/TimescaleDB.

## Constraints and decisions

- Implement P0/P1/P2; P3 is explicitly later work, except guided empty states and useful connection errors needed by the wizard.
- Unit aliases share a fixture between Go and Web. Trim/case aliases such as kw/kW; preserve distinct SI prefixes mW/MW. No numeric unit conversion.
- Infer physical roles from the wizard's explicit factory/area/machine choices, never from a logical node's depth. Preserve ownership guards.
- Never invent a signal meaning from register content. Discovered registers get editable neutral labels; technical addresses stay in engineering views/tooltips.
- Cancellation and preview do not leave connections/devices/tags/profile/template drafts behind. Existing connection credentials remain private.
- Whole request authenticated; admin-only diagnostics/configuration, viewer/operator native view mode. MQTT listen is bounded 10–30s, Modbus scan <=50 registers; neither writes to field devices.

## Tasks

- [x] P0: shared unit normalization across binding/current/aggregate/presentation; disabled source choices with reasons and tag links; hide redundant 1/1 coverage; semantic widget names. Verify Go + Web regressions.
- [x] P1-2/3/5: transactional template→profile/default dashboard generation, provenance/version links, automatic key mapping on provisioning and manual suggestion preview. Verify ten-key mapping, defaults, version pinning and rollback.
- [x] P1-4: authenticated transient diagnostics with connection/template preview, bounded Modbus scan and MQTT topic/JSON sampling. Verify no saved config, no telemetry publication, cancellation and transport cleanup.
- [x] P1-1: QuickDeviceWizard with connection/test, template/read-preview or discovery, location/name/create-inline, atomic Finish and direct native navigation. Add Dashboard/Overview entry and same-device shortcut. Verify real three-screen simulator/Modbus/MQTT journeys and cancellation.
- [x] P2: grouped sidebar, admin edit menu, consistent light theme, collapsible/small hierarchy selector, useful generated hierarchy of widgets, single native main entry, advanced reports/legacy migration, Vietnamese terminology and advanced-only physical role controls.
- [x] Acceptance: full Core/DB/MQTT/Web/worker tests and build; isolated browser journey before operating rollout, backup, preserve legacy boards/config/history, screenshots and Progress Log. Remote review is published after this verified delivery commit under the existing review authorization.

## Review focus

Atomic failure/retry; draft connection credentials; ambiguous mapping candidates; mismatched units/history/type explanations; MQTT wildcard topics and nested JSON values; Modbus timeouts/partial scans; existing pinned templates/profiles and physical ownership; role boundaries and genuine new-tab persistence.
