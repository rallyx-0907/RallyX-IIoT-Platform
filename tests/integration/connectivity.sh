#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
source .env
set +a
docker compose up -d --wait db broker
if ! docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='rallyx_connectivity_test'" | grep -q 1; then
  docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c 'CREATE DATABASE rallyx_connectivity_test'
fi
for name in rallyx-connectivity-core-test rallyx-connectivity-worker-test rallyx-connectivity-probe-test; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Test container already exists: $name; refusing to replace it" >&2
    exit 1
  fi
done
cleanup() {
  docker logs rallyx-connectivity-core-test 2>&1 | tail -8 || true
  docker logs rallyx-connectivity-worker-test 2>&1 | tail -8 || true
  docker stop rallyx-connectivity-worker-test rallyx-connectivity-core-test >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build -q -t rallyx/core-connectivity-test apps/core
docker compose --profile connectivity build connectivity
export CONNECTIVITY_TOKEN=fixture-connectivity-service-token-at-least-32
export CONNECTIVITY_TEST_USERNAME="connectivity-test-$(date +%s)"
docker run --rm -d --name rallyx-connectivity-core-test --network rallyx_default \
  -e "DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/rallyx_connectivity_test?sslmode=disable" \
  -e MQTT_URL=tcp://broker:1883 -e MQTT_CLIENT_ID=rallyx-connectivity-core-test \
  -e "ADMIN_USERNAME=$CONNECTIVITY_TEST_USERNAME" -e ADMIN_PASSWORD=fixture-connectivity-password-123 \
  -e SESSION_SECRET=fixture-installation-key-for-connectivity-test-32 \
  -e CONNECTIVITY_TOKEN -e CONNECTIVITY_URL=http://rallyx-connectivity-worker-test:8090 \
  rallyx/core-connectivity-test >/dev/null
docker run --rm -d --name rallyx-connectivity-worker-test --network rallyx_default \
  -e CONNECTIVITY_TOKEN -e CORE_URL=http://rallyx-connectivity-core-test:8081 -e MQTT_URL=mqtt://broker:1883 \
  "rallyx/connectivity:${RALLYX_VERSION:-0.1.0}" >/dev/null
docker run --rm --name rallyx-connectivity-probe-test --network rallyx_default \
  -e CONNECTIVITY_TEST_USERNAME -e TEST_MQTT_URL=mqtt://broker:1883 -e RALLYX_TEST_CORE_URL=http://rallyx-connectivity-core-test:8081 \
  "rallyx/connectivity:${RALLYX_VERSION:-0.1.0}" node --test src/*.test.mjs
