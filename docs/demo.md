# Running the demo

Start the stack using `npm run up` (existing images) or `npm run dev` (build images). On Linux, the equivalent is `docker compose --profile connectivity up --build -d --wait`. All six services must be healthy. Use the installation's existing administrator account; credentials are private in its local `.env` and are never included in this guide.

For a fresh installation, follow README first and leave `DEMO_SEED=true`, `SIMULATOR_ENABLED=false`. Connectivity owns simulator data. The optional Node-RED producer must stay disabled while connectivity owns the same devices.

## Presentation walkthrough

1. Open the configured Web address, sign in, and open Connections. Verify that the seeded Simulator connection is enabled and diagnostics succeed.
2. Open Devices and edit the motor simulator. Set its typed values to `run=false`, `fault=false`, `current=0`. Save, then check Live Data for fresh GOOD values. Preserve the device's other settings.
3. Set `run=true` and `current=12`. Show the updated Live Data and runtime on the asset. Leave it running briefly so History has multiple samples.
4. Set `fault=true`. Show the active fault alarm, acknowledge it, then set `fault=false`. Show the cleared alarm in alarm history. Acknowledgement alone does not clear the source fault.
5. Set `run=false` and `current=0`. Show the stop event, runtime interval and numeric History with a range covering the demonstration.
6. Pin Value, Status and Trend widgets on Overview; refresh to demonstrate persistence. Trend requires a numeric tag with history enabled.

Changing simulator values writes application configuration only. V1 field integrations remain read-only. After the walkthrough, leave simulator run/fault false and current zero unless another presenter needs a different initial state.

## Real equipment

Create a read-only Modbus TCP connection with the actual equipment host, port and unit address; add a Device under its Asset and configure its Tags. Use Test Connection and Test Read before presenting. Verify register address convention, data type, byte/word order, scale and offset against the equipment documentation. Diagnostics show raw, decoded and scaled values. Physical RTU acceptance requires a serial adapter and equipment and is still an open gate.

## Windows with WSL

Docker runs inside WSL on this workstation. Keep a WSL terminal open during a presentation so the distribution remains running. In that terminal run `cd /mnt/f/VISUAL_PROJECT/RallyX-IIoT` and the Compose command above. Use `wsl hostname -I` from PowerShell to find the current WSL address if localhost forwarding is unavailable. The Web binding must allow the intended address; do not change a loopback binding to a LAN listener implicitly. WSL addresses can change after shutdown.

## Before presenting

- Check `docker compose ps` and Web `/health`; confirm that tag timestamps continue advancing, rather than relying on container health alone.
- Confirm the browser's clock/range and tag history settings when History looks empty.
- Review Connections/Devices diagnostics for missing or BAD/STALE values. Do not present stale values as current readings.
- Use the existing read-only browser smoke documented in `ui-configuration.md` on an operating installation. Full E2E tests create accounts/configuration and change simulator values; reserve them for a dedicated acceptance installation.

The demo is not a V1 release certificate. Offline installation, physical RTU, reboot and remaining release gates must be verified separately.
