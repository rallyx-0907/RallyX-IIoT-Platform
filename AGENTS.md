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

## Mandatory UI Verification Rules

Read and follow [UI quality gates](docs/ui-quality-gates.md) for every UI/layout change and screenshot/slide export.

- Reserve independent layout regions for titles, drawings, values, legends and status/footer text. SVG, canvas and charts must fit the remaining space; preserve aspect ratio and border/stroke padding.
- Test resized controls and the actual saved layout, not only the default size. Do not solve overlap solely by increasing default height, reducing text to an unreadable size, hiding overflow or editing screenshots.
- Define a deliberate small-size fallback: remove secondary decoration, provide an accessible full title when truncating, and use bounded internal scrolling for long legends/tables. Essential values, alarm/quality states and counts must remain accessible.
- Check Vietnamese long labels, multiple states/series, large values, GOOD/OFF/FAULT/unavailable and empty data. Check runtime, Design and Preview wherever the renderer is shared.
- Before completion, run appropriate unit/build checks AND browser geometry checks for affected regions at desktop, 1024px, 720px and 390px, plus browser zoom/large-text coverage. A passing DOM/structure test alone is insufficient for clipping or overlap bugs.
- Capture and visually inspect the affected screen after the fix. For presentations, recapture the app, regenerate all affected exports and inspect their final rendered pages; do not conceal an application defect by cropping or painting over it.
- Add a regression that fails on the previous layout for every confirmed clipping/overlap bug. Record tested modes/sizes, evidence and any remaining limitation in the change summary.
