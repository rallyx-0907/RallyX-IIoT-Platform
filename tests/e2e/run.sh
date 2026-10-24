#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if grep -q '^SIMULATOR_ENABLED=true' .env; then
  echo 'Disable the optional Node-RED producer (SIMULATOR_ENABLED=false) before running the connectivity-owned simulator scenario.' >&2
  exit 1
fi
docker compose --profile connectivity up -d --build --wait
docker run --rm --network host -v "$PWD:/workspace" -w /workspace \
  node:22.16.0-alpine node --test tests/e2e/platform.test.mjs
