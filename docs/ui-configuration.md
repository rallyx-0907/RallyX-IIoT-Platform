# Local configuration UI

The local workflow is Assets → Connections → Templates (optional) → Devices → Tag Configuration → Live Data / History / Rules / Overview. Configuration actions require an administrator. Operators and viewers can inspect configuration; operators can acknowledge alarms. Each user can manage their own dashboard widgets.

Create a Site, Area and Asset from Assets, including on an installation with no configured hierarchy. Connections provides protocol fields and a diagnostic against the saved configuration. Devices connects an Asset to a Connection, can clone a compatible Template, and accepts typed per-tag simulator values. A template change creates a new version without changing existing device instances.

Tag Configuration owns device-scoped keys and typed mappings, scaling/offset, polling override, sampling, history/realtime switches, stale timeout and enabled state. Blank polling override returns to the connection interval. Test Read displays raw, decoded and scaled values without writing to field equipment. Archive confirmation retains history.

CSV accepts file upload or pasted content. Preview shows row/column errors and validated rows. Editing the CSV invalidates the preview; import revalidates all rows transactionally. Export downloads the registered tag configuration.

Live Data filters by Asset and Device and excludes disabled/realtime-off tags. History offers history-enabled tags, preserves seconds in the selected range, and gaps bad-quality data. Overview's dashboard pins Value, Status and numeric-history Trend widgets. Widgets persist per user; stale/offline/archived values are identified rather than presented as fresh readings.

## Simulator ownership

The independent connectivity service owns Simulator/MQTT/Modbus device workers. Enable its Compose profile during normal operation. For simulator controls, edit a simulator Device's typed values in Devices; this uses the same registry/configuration APIs as field devices.

`SIMULATOR_ENABLED=false` disables the optional Node-RED engineering producer. Its generated `device-simulator.json` also uses the shared device topic/payload contract, but do not enable it for devices concurrently owned by connectivity. The old Overview's equipment-specific demo buttons have been replaced by generic Device configuration.

## Verified acceptance — 2026-10-24

- Frontend component tests cover forms, role restrictions, errors, CSV invalidation, credentials, archival and quality. Backend integration passes against real TimescaleDB and Mosquitto, including clearing optional tag polling back to SQL NULL.
- The connectivity-owned zero-hardware API scenario passes: run/stop, fault activation/acknowledgement/clear, history, runtime, authentication and WebSocket delivery.
- Chromium acceptance on an independent `rallyx-preview` stack passes all eight workflow steps (nine reported tests): create Site/Area/Asset and Modbus TCP Connection; create a six-tag Template; instantiate two differently addressed Devices; manually create a boolean runtime Tag; Test Connection/Test Read; Live Data and numeric History; reject an invalid CSV and import/read 100 tags; create/activate/acknowledge/clear a new rule; pin Value/Status/Trend and retain the selected tag identity across browser refresh.
- Browser verification uses a real read-only Modbus TCP fixture in the test container, not a browser API mock. Evidence screenshots are ignored under `.tools/browser-evidence/`.
- Full preview stack stop/start retains configuration, widgets, history and the same open runtime session without an invented start. Root frontend tests now pass 47/47; lint and production build pass.

The detailed multi-condition/debounce Rule Engine, physical RTU, full offline/restore/update/release acceptance remain separate gates. A passed preview is not a V1 release declaration.

## Acceptance commands

Run `npm --prefix apps/web test -- --run --minWorkers=1 --maxWorkers=1`, `npm run lint` and `npm run build`. Windows PowerShell installations may need `npm.cmd`.

The browser fixture is for a dedicated acceptance stack: it creates configuration, changes a bootstrap password if needed, and stores that changed password in the specified ignored test env file. Build the test image with `docker build -f tests/e2e/browser.Dockerfile -t rallyx/browser-test .`; run it on the acceptance network as container `rallyx-ui-browser` with the workspace mounted at `/workspace` and `RALLYX_ENV_FILE` naming the dedicated env file. `RALLYX_BROWSER_BASE_URL` defaults to `http://web:8080`. It publishes no host port. Keep the acceptance stack and its credentials separate from an operating installation.

`tests/e2e/restart.mjs prepare|verify` brackets an externally performed restart and checks configuration, dashboard, history, same open runtime session, and no invented start. Set `RALLYX_BASE_URL` and `RALLYX_ENV_FILE` explicitly for that dedicated stack.
