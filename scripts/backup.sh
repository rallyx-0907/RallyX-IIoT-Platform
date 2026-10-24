#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
fail() { printf 'backup: %s\n' "$1" >&2; exit 1; }
usage() { printf 'Usage: bash scripts/backup.sh [--root DIR] [-p PROJECT] [--env-file FILE] [--output DIR]\n'; }
project=${COMPOSE_PROJECT_NAME:-rallyx}
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
root=$script_root env_file=.env output_dir=backups
while (($#)); do
  case $1 in
    --root) (($# >= 2)) || { usage >&2; exit 2; }; root=$2; shift 2 ;;
    -p|--project) (($# >= 2)) || { usage >&2; exit 2; }; project=$2; shift 2 ;;
    --env-file) (($# >= 2)) || { usage >&2; exit 2; }; env_file=$2; shift 2 ;;
    --output) (($# >= 2)) || { usage >&2; exit 2; }; output_dir=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'invalid Compose project name'
[[ -d $root ]] || fail 'deployment root does not exist'
root=$(cd -- "$root" && pwd -P)
[[ $env_file == /* ]] || env_file="$root/$env_file"
[[ $output_dir == /* ]] || output_dir="$root/$output_dir"
[[ -f $env_file && ! -L $env_file ]] || fail 'env file does not exist or is a symbolic link'
[[ -f $root/compose.yaml && -f $root/config/mosquitto/mosquitto.conf && -f $root/connectors/node-red/settings.js ]] || fail 'required deployment files are missing from root'
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required'
compose() { docker compose -f "$root/compose.yaml" --project-directory "$root" -p "$project" --env-file "$env_file" "$@"; }
compose config --quiet >/dev/null 2>&1 || fail 'Compose configuration is invalid or required settings are missing'
running=$(compose ps --status running --services) || fail 'could not inspect Compose services'
grep -qx db <<<"$running" || fail 'database service must be running'
grep -qx node-red <<<"$running" || fail 'Node-RED service must be running to capture its data volume'
mkdir -p -- "$output_dir"; chmod 700 -- "$output_dir"
out_abs=$(cd -- "$output_dir" && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/rallyx-backup.XXXXXXXX"); chmod 700 "$tmp"
cleanup() { local prefix="${TMPDIR:-/tmp}/rallyx-backup."; [[ $tmp == "$prefix"* && -d $tmp && ! -L $tmp ]] && rm -rf -- "$tmp" || printf 'backup: refusing unsafe temporary cleanup path\n' >&2; }
trap cleanup EXIT
bundle=$tmp/bundle
mkdir -m 700 -p "$bundle/config/mosquitto" "$bundle/connectors/node-red/flows" "$bundle/node-red"
compose exec -T db sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$bundle/database.dump" || fail 'database dump failed'
[[ -s $bundle/database.dump ]] || fail 'database dump is empty'
compose exec -T node-red tar -C /data --exclude=./settings.js -czf - . > "$bundle/node-red/data.tar.gz" || fail 'Node-RED data capture failed'
cp -- "$env_file" "$bundle/.env"
cp -- "$root/compose.yaml" "$bundle/compose.yaml"
cp -- "$root/config/mosquitto/mosquitto.conf" "$bundle/config/mosquitto/mosquitto.conf"
cp -- "$root/connectors/node-red/settings.js" "$bundle/connectors/node-red/settings.js"
cp -- "$root"/connectors/node-red/flows/*.json "$bundle/connectors/node-red/flows/"
db_info=$(compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SHOW server_version_num"; PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT extversion FROM pg_extension WHERE extname=chr(116)||chr(105)||chr(109)||chr(101)||chr(115)||chr(99)||chr(97)||chr(108)||chr(101)||chr(100)||chr(98)"') || fail 'could not read database version metadata'
pg_num=$(sed -n '1p' <<<"$db_info"); ts_version=$(sed -n '2p' <<<"$db_info")
[[ $pg_num =~ ^[0-9]+$ && -n $ts_version ]] || fail 'TimescaleDB extension is unavailable'
db_cid=$(compose ps -q db) || fail 'could not inspect database container'
db_image_id=$(docker inspect --format '{{.Image}}' "$db_cid") || fail 'could not inspect database image ID'
db_digests=$(docker image inspect --format '{{join .RepoDigests ","}}' "$db_image_id" 2>/dev/null || true)
[[ -n $db_digests ]] || db_digests=unavailable
{
  printf 'format=2\ncreated_utc=%s\nproject=%s\ncompose_file=compose.yaml\npostgres_server_version_num=%s\ntimescaledb_extension_version=%s\ndb_image_id=%s\ndb_image_digests=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$project" "$pg_num" "$ts_version" "$db_image_id" "$db_digests"
  for service in $(compose ps --services); do
    cid=$(compose ps -q "$service" 2>/dev/null || true); [[ -n $cid ]] || continue
    image_id=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true); [[ -n $image_id ]] || continue
    digests=$(docker image inspect --format '{{join .RepoDigests ","}}' "$image_id" 2>/dev/null || true); [[ -n $digests ]] || digests=unavailable
    printf 'image.%s.id=%s\nimage.%s.digests=%s\n' "$service" "$image_id" "$service" "$digests"
  done
} > "$bundle/metadata.txt"
(cd "$bundle" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
chmod -R go-rwx "$bundle"
archive="$out_abs/rallyx-${project}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
[[ ! -e $archive ]] || fail 'backup archive already exists'
tar -czf "$archive" -C "$bundle" .; chmod 600 "$archive"
printf 'Backup created: %s\n' "$archive"
