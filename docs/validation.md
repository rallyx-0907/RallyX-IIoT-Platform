# Verification record

This is an implementation baseline, not a release-candidate acceptance certificate. The mandatory local extensibility amendment is tracked separately in `local-extensibility-plan.md`.

## Verified baseline on 2026-10-23

| Check | Result |
|---|---|
| `npm test` | Go tests plus 2 simulator Node tests and 6 frontend Vitest tests pass. DB/broker integration tests skip explicitly when their environment variables are absent. |
| `npm run lint` | Go vet and TypeScript checks pass. |
| `npm run build` | Windows Core binary and production Web bundle build successfully. |
| `make test` | Passes in WSL with `NODE='/mnt/c/Program Files/nodejs/node.exe'`. |
| `bash tests/integration/run.sh` | Real TimescaleDB and Mosquitto integration tests pass in dedicated `rallyx_test` database. |
| `docker compose config --quiet` | Configuration validates using the ignored local `.env`. |
| `docker compose up --build -d --wait` | DB, broker, Node-RED, Core, Web healthy. |
| `bash tests/e2e/run.sh` | Full zero-hardware RUN/STOP, fault activation/ack/clear, runtime sessions, sampled history, user creation and authenticated WebSocket pass. |

The E2E test uses the installation admin from `.env`. On a fresh development install it changes the mandatory bootstrap password once and writes the new value back to the ignored `.env`; it does not print credentials. It creates simulator operating history and a uniquely named viewer account. Run it only against a development installation.

## Defects found by acceptance tests

- Nginx cached a removed Core container's IP after recreation. The proxy now uses Docker DNS resolution with five-second validity.
- Node-RED's broker config node ID matched its broker hostname, causing a circular config dependency. IDs are now distinct; the adapter health endpoint also checks broker connectivity.
- Independent review found MQTT ordering, mutable tag configuration, disabled-rule alarm lifecycle, and shared proxy login-throttle issues. Dedicated regression tests were observed failing, then passing after the fixes.

## Host access

Windows-to-WSL localhost forwarding is unavailable on this host. The verified development URL is `http://172.27.165.200:8080`, and the ignored development `.env` binds the WSL network. WSL IPs can change after shutdown. The committed example binds loopback by default.

## Remaining release gates

The local extensibility model, dynamic protocol workers, templates, CSV, persistent widgets, and their acceptance tests are still being implemented. Real RTU hardware, offline isolated-host installation, reboot, second-installation restore, update/rollback, multiarchitecture image bundles and hardware resource profiles remain unverified. Do not mark V1.0 complete based on the baseline checks above.
