# RallyX IIoT Platform

Local equipment monitoring for electrical panels: live tags, operating history, runtime, alarms, and field diagnostics. V1.0 field connectivity is **read-only**.

## Architecture

Node-RED maps simulator/field data to MQTT. Mosquitto delivers it to Go Core, which owns business rules and persists data in PostgreSQL + TimescaleDB. React displays the configured asset model through REST and WebSocket. Runtime operation must not require Internet.

See [architecture](docs/architecture.md), [MQTT contract](docs/mqtt-contract.md), [deployment](docs/deployment.md), and the [implementation roadmap](RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md).

The mandatory [local device extensibility spec](RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md) now governs V1. See its [execution plan](docs/local-extensibility-plan.md). The existing runtime is a tested implementation baseline; migration to the device-oriented contract and dynamic protocol configuration is in progress. SaaS, tenants, cloud sync and fleet management are outside V1.

## Quick start

Requires Docker Engine + Compose v2 on Linux. Build-time dependency downloads require Internet; offline packages are a later release deliverable.

```sh
cp .env.example .env
# Replace every CHANGE_ME value with a strong, unique value.
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Open `http://localhost:8080`. Keep the default loopback binding until remote access is configured deliberately. This repository is under implementation; consult the roadmap and [ledger](docs/implementation-ledger.md) for verified status. It is not yet a validated V1.0 release.

## Development commands

Install Node 22+ and Go 1.24+, then `npm --prefix apps/web ci`, `npm --prefix apps/connectivity ci --ignore-scripts`, and `go mod download` in `apps/core`.

| Command | Purpose |
|---|---|
| `npm run dev` / `make dev` | Build and start containers |
| `npm run up`, `down`, `logs` | Manage the stack; down preserves volumes |
| `npm test` / `make test` | Backend and frontend tests |
| `npm run lint` | Go vet and TypeScript checks |
| `npm run build` | Core binary and production Web bundle |
| `npm run e2e` | Acceptance tests against a running stack |
| `npm run backup` | Operational backup |
| `npm run package-offline` | Produce an offline distribution |

Operational scripts and acceptance commands are implemented incrementally; an unavailable prerequisite must fail explicitly rather than report a false pass.

## Ownership

- `apps/core`: Go domain services, API, ingestion, migrations, security.
- `apps/web`: React/TypeScript product UI.
- `apps/connectivity`: dynamic Simulator/MQTT/Modbus read adapters and diagnostics; see [connectivity setup and verification](docs/connectivity.md).
- `connectors/node-red`: simulator and protocol mapping flows; no business rules.
- `config`, `deploy`, `scripts`: service configuration and Linux operations.
- `tests/integration`, `tests/e2e`: database and full-stack acceptance.

Follow [AGENTS.md](AGENTS.md). Update roadmap checkboxes only after the corresponding verification passes.

See [validation evidence and remaining gates](docs/validation.md). For full-stack development acceptance on Linux, run `bash tests/integration/run.sh` and `bash tests/e2e/run.sh` against the local Docker stack.
