# Deployment

Target: Debian/Ubuntu Linux, Docker Engine with Compose v2 (or a compatible Podman Compose implementation). Node 22+ and Go 1.24+ are development prerequisites. Use `npm.cmd` on Windows if PowerShell blocks npm scripts.

## Ports and persistence

| Service | Container port | Host exposure |
|---|---|---|
| Web | 8080 | `127.0.0.1:8080` by default |
| Core | 8081 | None; proxied by Web |
| TimescaleDB | 5432 | None |
| MQTT | 1883 | None |
| Node-RED | 1880 | None; editor disabled |

Set `HTTP_BIND` deliberately to expose Web on a LAN. Put remote access behind TLS. Browser REST and WebSocket traffic share the Web origin. Persistent named volumes hold DB, broker state, and Node-RED data. `docker compose down` preserves them; do not use `down -v` unless intentionally deleting data.

Copy `.env.example` to `.env` and replace all `CHANGE_ME` entries. Passwords in the database URL must be URL-safe; generated hexadecimal passwords are recommended. Never commit `.env`. Keep the session and Node-RED credential secrets for restore.

Validate with `docker compose config --quiet`, start with `docker compose up --build -d --wait`, and inspect `docker compose ps`. Restart policies recover services when the container engine starts after reboot. A real reboot test remains a release gate.

## Development

`npm run dev` starts the container stack. For UI iteration, run `npm --prefix apps/web run dev`; its proxy targets Core at `localhost:8081`. Run Core with `go run ./cmd/rallyx-core` from `apps/core` with `DATABASE_URL`, `MQTT_URL`, and bootstrap credentials set. Do not expose database or broker ports permanently for development.
