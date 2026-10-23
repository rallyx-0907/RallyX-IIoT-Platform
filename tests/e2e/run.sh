#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose up -d --wait
docker run --rm --network host -v "$PWD:/workspace" -w /workspace \
  node:22.16.0-alpine node --test tests/e2e/platform.test.mjs
