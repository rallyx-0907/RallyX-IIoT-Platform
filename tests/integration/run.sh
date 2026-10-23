#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
source .env
set +a
docker compose up -d --wait db broker
if ! docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='rallyx_test'" | grep -q 1; then
  docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c 'CREATE DATABASE rallyx_test'
fi
docker run --rm --network rallyx_default \
  -v "$PWD/apps/core:/app" -w /app \
  -v rallyx-go-cache:/root/.cache/go-build -v rallyx-go-mod:/go/pkg/mod \
  -e "TEST_DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/rallyx_test?sslmode=disable" \
  -e TEST_MQTT_URL=tcp://broker:1883 \
  golang:1.24.6-alpine go test -count=1 -v ./...
