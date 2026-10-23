# Repository Guidelines

## Project Structure & Module Organization

This repository is at the planning stage. Its only project file is `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md`, the implementation source of truth. Read it before implementing changes; the following layout is planned, not yet scaffolded:

- `apps/core/`: Go backend; entry point in `cmd/rallyx-core/`, domain packages in `internal/`, SQL migrations in `migrations/`.
- `apps/web/src/`: React and TypeScript UI, organized into API clients, components, layouts, pages, stores, and types.
- `connectors/node-red/`: protocol adapters and simulator flows.
- `config/`, `deploy/`, `scripts/`: service configuration, deployment assets, and operational scripts.
- `tests/integration/` and `tests/e2e/`: cross-service and end-to-end checks; `docs/` holds architecture and operational documentation.

## Build, Test, and Development Commands

No build scripts, dependency manifests, or Compose configuration exist yet. Milestone 0 calls for these Make targets:

- `make dev`: local development.
- `make up`, `make down`, `make logs`: start, stop, and inspect services.
- `make test`, `make e2e`: automated tests and end-to-end validation.
- `make backup`, `make package-offline`: backup and offline distribution.

Once implemented, validate service configuration with `docker compose config`. Document actual prerequisites and command behavior when adding tooling.

## Coding Style & Naming Conventions

Formatting and lint configurations remain to be selected. Use `gofmt` for Go, including tab indentation; prefer two-space indentation for TypeScript. Use lowercase Go package names, PascalCase React components, and camelCase TypeScript functions. Treat these as initial conventions until repository configuration establishes them.

## Testing Guidelines

No test framework or coverage threshold is configured. Use Go's standard testing package with `*_test.go` files; choose and document frontend tooling during scaffolding. Cover state transitions, runtime calculations, alarms, MQTT validation, and reconnect behavior. Validate integrations with simulators before real hardware.

## Commit & Pull Request Guidelines

There is no Git history establishing commit conventions. Use concise imperative subjects, such as `Add MQTT payload validation`, and keep commits independently testable. PRs should describe scope, linked tasks or issues, verification results, and UI screenshots when applicable.

## Architecture & Configuration Rules

Keep business logic in Core and Node-RED limited to connectivity and mapping. Field integration is read-only in V1.0. Preserve offline operation; never commit secrets or hard-code demo assets. Mark implementation-plan tasks complete only after verification and add a Progress Log note.