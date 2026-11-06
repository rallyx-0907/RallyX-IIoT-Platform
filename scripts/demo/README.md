# Full RallyX showcase

## Current local installation — 2026-11-06

At the user's request, the same demo fixtures have now been added through application APIs to the original `rallyx` installation on port 8080. Use the original account and select **Nhà máy Bình Minh · DEMO** in the dashboard location picker, or open **DEMO · Tủ điện nhà máy Bình Minh**. The previous separate port-8088 stack and its publisher are stopped and their automatic restart disabled; their database volumes are retained.

The original installation now has 92 GOOD points (24 original + 68 demo), seven devices, four connections, eight rules, populated synthetic history and all eight factory widgets GOOD. Original tag/device/template/legacy dashboard records were compared with the pre-import snapshot and retained. A browser check passed for Runtime and template Design/Preview on the original login. The internal `rallyx-demo-stream` container supplies only DEMO MQTT/Modbus data on the original Docker network, with automatic restart and no published field ports. It is a data-source process, not a second application installation. Existing account credentials were not changed.

Machine-local import state, publisher scripts, verification logs and a pre-import database dump are under ignored `.tools/`. The sections below describe how the original isolated showcase was produced; do not rerun its isolated seed against an operating installation without explicit authorization and a configuration/ID check.

This dataset is confined to the `rallyx-showcase` Docker project. It does not alter the operating `rallyx` database, connections, Slave ID 1 bindings or saved dashboards. Its Web port is bound to localhost:8088. MQTT and Modbus simulator ports remain private to the Docker network.

The configured scenario has one factory, two areas, three machines and one power meter; 68 datapoints; three device templates; four rules; shared analytical dashboards; and a cabinet drawing. Every entity, tag, binding, template and rule uses the normal Core APIs. Two hours of synthetic history are replayed through normal MQTT ingestion, which creates events and runtime sessions. Live MQTT payloads go through the connectivity adapter, and the meter answers read-only Modbus FC03 requests.

All names and data are marked DEMO. The scripts are configuration fixtures, not product-specific logic. Historical timestamps and values are synthetic. They must never be presented as measurements from a customer installation.

## Scripts

- `seed.mjs`: requires an already initialized administrator account and the explicit `RALLYX_SHOWCASE=1` guard. Creates demo configuration and replays history; an existing state file prevents reseeding.
- `stream.mjs`: publishes changing MQTT values every two seconds and serves an internal read-only Modbus meter on port 1502. At startup it demonstrates a brief normal window before returning to the alarm scenario, so cleared and active alarms both exist.
- `complete.mjs`: adds the Modbus meter, acknowledges one alarm if needed, normalizes the cabinet control height and records current evidence. Existing meter configuration is retained.
- `verify.mjs`: asserts connected devices, GOOD datapoints, populated templates/rules, open and cleared alarms, variable history, events, runtime sessions, native widget data and screenshot coverage.
- `cabinet.json`: reusable drawing fixture; `tagIndex` references the demo mapping in the seed script, not operating Tag IDs.

Run the seed/stream in the connectivity image, which supplies the MQTT dependency. Run verification in the browser-test image or a compatible Node runtime on the isolated network. Credentials come from the local ignored environment or `DEMO_ADMIN_PASSWORD`; scripts do not copy credentials or change passwords. Initialize an administrator through the normal application flow before seeding a fresh stack.

The current local demo uses the existing verified application images. Generated presentation files and machine-local deployment overrides are kept outside the source fixtures, under `artifacts/demo-full-2026-11-06` and `.tools` respectively.

## Verified scenario

On 2026-11-06, verification passed with four connected devices, two connected protocol sources (MQTT and Modbus TCP), 68/68 GOOD tags, three populated device templates, four rules, three open and three closed alarms, more than 100 current-history samples with more than 20 distinct values, events and runtime sessions. All eight factory dashboard widgets returned GOOD data. The operating configuration preservation check also passed.

The presentation has 28 pages, including 26 screenshots, an overview with navigation, speaker notes, a PDF and a self-contained offline HTML version. Static images do not reproduce blink, live updates or pointer interactions; those run in the demo application.
