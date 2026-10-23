# RallyX IIoT architecture

RallyX monitors equipment state and operating history inside electrical panels. V1.0 is a local, single-installation platform, not MES, CMMS, predictive AI, or cloud billing.

## Data path and ownership

`Field device / Simulator → Node-RED → Mosquitto → RallyX Core → PostgreSQL + TimescaleDB → REST / WebSocket → RallyX Web`.

- **Node-RED:** protocol polling, raw-register mapping, normalized MQTT publication. No runtime, alarm, or OEE business logic.
- **Core (Go):** asset/tag registry, ingestion, current state, immutable events, runtime sessions, alarms/rules, authentication, API.
- **PostgreSQL:** operational configuration and durable history. **TimescaleDB:** telemetry samples, retention, aggregates.
- **Web (React + TypeScript):** product UI driven by API configuration. Demo asset names belong only in database seed data.

## Model

`Site → Area → Panel/Machine → Asset → Tag`. Devices and connectors represent connectivity separately. Use the Asset/Tag/Event/Rule model for future use cases.

## Reliability and boundaries

Field integration is read-only in V1.0: no PLC/VFD control commands. Missing values never imply zero. UTC storage and timezone-aware API timestamps preserve ordering. Unknown entities are rejected with diagnostics. Duplicate telemetry must not duplicate events or sessions. Open runtime and fault state must survive Core restarts.

Local functions must work without Internet. All production services are containerized, retain data on persistent volumes, and restart automatically. Linux Debian/Ubuntu on amd64 and arm64 is the deployment target. Minimum demo hardware is 2 CPU, 2 GB RAM, 8–16 GB storage; recommended is 2–4 CPU, 4 GB RAM, 32 GB SSD.

## Source layout

`apps/core` owns Go services and migrations; `apps/web` owns React; `connectors/node-red` owns flows; `config`, `deploy`, and `scripts` own operations; `tests/integration` and `tests/e2e` own acceptance validation. The root implementation roadmap remains the progress source of truth.
