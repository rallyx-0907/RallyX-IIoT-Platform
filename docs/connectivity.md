# Dynamic connectivity

Core owns metadata, credentials, scale/offset, runtime and alarms. The Node connectivity service reads supported protocols and sends raw typed values to the shared device telemetry topic. It never writes to field equipment or accesses the business database.

The service reloads configuration from Core every two seconds with a separate `CONNECTIVITY_TOKEN` (at least 32 random characters). Core exposes configuration and accepts status only with that token. Browser sessions cannot use these internal routes. Diagnostic browser routes require an administrator:

- `POST /api/v1/connections/{id}/test` with `{}` or `{ "device_id": "..." }`.
- `POST /api/v1/connections/{id}/test-read` with `{ "device_id": "...", "tag_id": "..." }`.

Test Read returns `tag_id`, `raw`, `decoded`, and `scaled`. It does not publish telemetry or change runtime/history. Save configuration first; diagnostics fetch current metadata immediately. Protocol failures return a safe error rather than upstream exception text that could include credentials.

## Protocol configuration

- Simulator: connection `protocol_config.values` maps tag keys to values. Device `metadata.simulator_values` overrides them. Tag `metadata.simulator_value` is the fallback used by seed data. Missing values fail instead of becoming zero. Change these fields through the existing configuration APIs for generic simulator controls.
- Modbus TCP: `protocol_config` contains `host`, `port` (502 by default), optional `unit_id`. Device `protocol_device_address` overrides the unit. Tag `address` is zero-based; functions 1–4 are supported, functions 1–2 require bool tags. Byte/word order and typed decoding apply before publication. Core applies scale/offset once.
- Modbus RTU: use `serial_port`, `baudrate`, `data_bits`, `parity`, `stop_bits`, optional `unit_id`. The service serializes access by physical serial path across connections, devices and diagnostic reads. Each transaction opens and closes the port while holding that queue. Physical RTU hardware acceptance remains outstanding.
- MQTT: use `broker_url`, `topic`, optional `ca` and `payload_mapping` (tag key to dot-separated JSON path). Credentials are separate write-only connection inputs. Tag `mapping.path` overrides connection mapping, followed by tag `address` and key. `{device}` in the subscription resolves to the device address or ID. Wildcard subscriptions require matching payload `device_id`; a different explicit device ID is always rejected. Retained messages are ignored, received samples use a FIFO queue of up to 1024 messages, and each sample is decoded for all configured tags. MQTT subscriptions consume new samples independently of polling intervals so short transitions are preserved. Overflow fails visibly rather than silently overwriting samples; missing/new-data timeout is also visible. A source `timestamp` is preserved and must meet the shared contract; quality defaults to GOOD.

Each read attempt has a total timeout from the connection configuration; individual protocol requests are also bounded. Per-tag `poll_interval_ms` overrides the connection polling interval. Device failures use capped exponential backoff and do not stop other devices. `retry_policy.max_attempts` is the total attempts per cycle (0 or absent means one), `backoff_ms` is the first failed-cycle delay and `max_backoff_ms` caps subsequent exponential delays. Later cycles continue attempting recovery. Configuration removal closes pending I/O and suppresses publication from the retired worker.

## Container rollout

The service is under the `connectivity` Compose profile while the existing UI and Node-RED producers are migrated. Generate a distinct local token and set it in `.env`; preserve it with the installation configuration. Build with `docker compose --profile connectivity build connectivity`. Enable with `docker compose --profile connectivity up -d` only after the amended Core, UI and producer contracts are ready together. This implementation does not upgrade the active development stack.

For RTU, add a local Compose override:

```yaml
services:
  connectivity:
    devices:
      - /dev/serial/by-id/YOUR_ADAPTER:/dev/ttyUSB0
    group_add:
      - "${SERIAL_GID}"
```

Set `SERIAL_GID` to the host serial device group ID; the container runs as the non-root `node` user. Configure `/dev/ttyUSB0` as the connection path. Do not run privileged containers for serial access.

## Verification

Install dependencies with `npm --prefix apps/connectivity ci --ignore-scripts`, then run `npm test`. Local tests use a real TCP socket for Modbus and an HTTP Core fixture. Broker-dependent checks are skipped without their test environment.

Run `bash tests/integration/connectivity.sh` from WSL/Linux for full acceptance. It builds separate test images, creates/uses `rallyx_connectivity_test`, and starts named temporary Core/worker/probe containers on the existing service network. It does not migrate the active `rallyx` database. Core's unique `MQTT_CLIENT_ID` prevents it disconnecting the running Core. The script refuses to replace existing named test containers and stops its Core/worker on exit; test records remain available for inspection. It verifies dynamic Modbus configuration, five tags, raw/decoded/scaled diagnostics, history, failure/recovery, MQTT mapping and all worker tests. Physical RTU and full UI acceptance are separate gates.
