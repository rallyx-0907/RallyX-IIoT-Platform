#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() { printf 'Usage: SOURCE_ENV_FILE=... TARGET_ENV_FILE=... [BUILD_IMAGES=1] bash tests/integration/backup-restore.sh\n'; }
fail() { printf 'backup-restore integration: %s\n' "$1" >&2; exit 1; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ -n ${SOURCE_ENV_FILE:-} && -n ${TARGET_ENV_FILE:-} ]] || { usage >&2; exit 2; }
[[ -f $SOURCE_ENV_FILE && -f $TARGET_ENV_FILE ]] || fail 'provide two existing, dedicated test env files'
command -v docker >/dev/null && command -v python3 >/dev/null || fail 'Docker and Python 3 are required'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required'
suffix="$(date -u +%s)-$$"
source_project="rallyx-backup-test-src-$suffix"
target_project="rallyx-backup-test-dst-$suffix"
[[ $source_project == rallyx-backup-test-* && $target_project == rallyx-backup-test-* ]] || fail 'refusing unexpected project name'
tmp=$(mktemp -d "${TMPDIR:-/tmp}/rallyx-backup-test.XXXXXXXX"); chmod 700 "$tmp"
source_root="$tmp/source-deployment"; target_root="$tmp/target-deployment"
mkdir -p "$source_root" "$target_root"
for deploy in "$source_root" "$target_root"; do
  cp -- "$repo/compose.yaml" "$deploy/compose.yaml"
  cp -a -- "$repo/config" "$repo/connectors" "$deploy/"
  mkdir -p "$deploy/apps/core" "$deploy/apps/web" "$deploy/apps/connectivity"
  cp -- "$repo/apps/core/Dockerfile" "$deploy/apps/core/Dockerfile"
  cp -- "$repo/apps/connectivity/Dockerfile" "$deploy/apps/connectivity/Dockerfile"
done
cp -- "$SOURCE_ENV_FILE" "$source_root/.env"
cp -- "$TARGET_ENV_FILE" "$target_root/.env"
chmod 600 "$source_root/.env" "$target_root/.env"
# Force demo seeding and different test-only application keys while keeping
# both caller env files intact.
python3 - "$source_root/.env" "$target_root/.env" <<'PY'
import os, pathlib, secrets, sys, tempfile
keys = {"SESSION_SECRET", "NODE_RED_CREDENTIAL_SECRET"}
for index, filename in enumerate(sys.argv[1:]):
    path = pathlib.Path(filename); lines = path.read_text(encoding="utf-8").splitlines(); seen = set(); out = []
    for line in lines:
        text = line.strip(); key = text.split("=",1)[0].strip() if "=" in text else ""
        if key == "DEMO_SEED":
            if key in seen: raise SystemExit("duplicate test DEMO_SEED")
            seen.add(key); out.append("DEMO_SEED=true")
        elif index == 1 and key in keys:
            if key in seen: raise SystemExit("duplicate test secret key")
            seen.add(key); out.append(f"{key}={secrets.token_hex(32)}")
        else:
            if key in keys: seen.add(key)
            out.append(line)
    if "DEMO_SEED" not in seen: out.append("DEMO_SEED=true")
    if index == 1 and seen.intersection(keys) != keys: raise SystemExit("test env must define both application secrets")
    fd, temp = tempfile.mkstemp(prefix=".test-env-", dir=path.parent); os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f: f.write("\n".join(out)+"\n")
    os.replace(temp, path)
PY
if [[ ${BUILD_IMAGES:-0} == 1 ]]; then
  test_tag="backup-test-$suffix"
  docker build -f "$repo/apps/core/Dockerfile" -t "rallyx/core:$test_tag" "$repo/apps/core" >/dev/null || fail 'isolated Core image build failed'
  python3 - "$source_root/.env" "$target_root/.env" "$test_tag" <<'PY'
import os, pathlib, sys, tempfile
for filename in sys.argv[1:3]:
    path = pathlib.Path(filename)
    lines = path.read_text(encoding="utf-8").splitlines()
    lines = [line for line in lines if not line.startswith("RALLYX_VERSION=")]
    lines.append("RALLYX_VERSION=" + sys.argv[3])
    fd, temp = tempfile.mkstemp(prefix=".test-env-", dir=path.parent); os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f: f.write("\n".join(lines)+"\n")
    os.replace(temp, path)
PY
fi
cp -- "$target_root/.env" "$tmp/target-env-before"

compose() { local deploy=$1 project=$2; shift 2; docker compose -f "$deploy/compose.yaml" --project-directory "$deploy" -p "$project" --env-file "$deploy/.env" "$@"; }
cleanup() {
  [[ $source_project == rallyx-backup-test-* && $target_project == rallyx-backup-test-* ]] || return
  compose "$source_root" "$source_project" down -v --remove-orphans >/dev/null 2>&1 || true
  compose "$target_root" "$target_project" down -v --remove-orphans >/dev/null 2>&1 || true
  [[ $tmp == "${TMPDIR:-/tmp}/rallyx-backup-test."* && -d $tmp && ! -L $tmp ]] && rm -rf -- "$tmp"
}
trap cleanup EXIT
services=(db broker node-red core)
compose "$source_root" "$source_project" up --no-build -d --wait "${services[@]}" >/dev/null || fail 'source stack did not become healthy'
compose "$target_root" "$target_project" up --no-build -d --wait "${services[@]}" >/dev/null || fail 'target stack did not become healthy'

compose "$source_root" "$source_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' >/dev/null <<'SQL'
UPDATE assets SET name='Backup Source Motor' WHERE id='demo-motor';
INSERT INTO telemetry_samples(tag_id,ts,value,quality)
VALUES('demo-sensor-value','2026-10-23T09:00:00Z','42'::jsonb,'GOOD')
ON CONFLICT(tag_id,ts) DO UPDATE SET value=EXCLUDED.value,quality=EXCLUDED.quality;
SQL
compose "$target_root" "$target_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' >/dev/null <<'SQL'
UPDATE assets SET name='Restore Target Motor' WHERE id='demo-motor';
INSERT INTO telemetry_samples(tag_id,ts,value,quality)
VALUES('demo-sensor-value','2026-10-23T09:00:00Z','7'::jsonb,'GOOD')
ON CONFLICT(tag_id,ts) DO UPDATE SET value=EXCLUDED.value,quality=EXCLUDED.quality;
SQL
compose "$source_root" "$source_project" exec -T node-red sh -ec 'printf source-node-red-data > /data/backup-restore-marker' >/dev/null
compose "$target_root" "$target_project" exec -T node-red sh -ec 'printf target-node-red-data > /data/backup-restore-marker' >/dev/null

source_config_hash=$(find "$source_root/config" "$source_root/connectors/node-red" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
archive_dir="$tmp/archive"; mkdir -m 700 "$archive_dir"
bash "$repo/scripts/backup.sh" --root "$source_root" -p "$source_project" --env-file .env --output "$archive_dir" >/dev/null
archive=$(find "$archive_dir" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)
[[ -n $archive ]] || fail 'backup did not create an archive'

# Repack with one altered database byte and the original manifest.
tampered="$tmp/tampered.tar.gz"
python3 - "$archive" "$tampered" <<'PY'
import io, pathlib, sys, tarfile
src, dst = sys.argv[1:]
with tarfile.open(src, "r:gz") as inp, tarfile.open(dst, "w:gz") as out:
    for item in inp.getmembers():
        data = inp.extractfile(item).read() if item.isfile() else None
        if item.name in ("./database.dump", "database.dump"):
            data += b"tamper"
        if data is None: out.addfile(item)
        else:
            info = tarfile.TarInfo(item.name); info.size = len(data); info.mode = 0o600
            out.addfile(info, io.BytesIO(data))
PY
chmod 600 "$tampered"

before_target_config=$(find "$target_root/config" "$target_root/connectors/node-red" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
if bash "$repo/scripts/restore.sh" "$archive" --root "$target_root" -p "$target_project" --env-file .env --confirm >/dev/null 2>&1; then fail 'restore accepted mismatched application secrets'; fi
target_name=$(compose "$target_root" "$target_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT name FROM assets WHERE id=chr(100)||chr(101)||chr(109)||chr(111)||chr(45)||chr(109)||chr(111)||chr(116)||chr(111)||chr(114)"' | tr -d '\r')
[[ $target_name == 'Restore Target Motor' ]] || fail 'key mismatch changed target database before rejection'
target_marker=$(compose "$target_root" "$target_project" exec -T node-red cat /data/backup-restore-marker | tr -d '\r')
[[ $target_marker == target-node-red-data ]] || fail 'key mismatch changed Node-RED volume before rejection'
cmp -s "$tmp/target-env-before" "$target_root/.env" || fail 'key mismatch changed target env before rejection'
if bash "$repo/scripts/restore.sh" "$tampered" --root "$target_root" -p "$target_project" --env-file .env --confirm --restore-keys >/dev/null 2>&1; then fail 'restore accepted tampered database archive'; fi
target_name=$(compose "$target_root" "$target_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT name FROM assets WHERE id=chr(100)||chr(101)||chr(109)||chr(111)||chr(45)||chr(109)||chr(111)||chr(116)||chr(111)||chr(114)"' | tr -d '\r')
[[ $target_name == 'Restore Target Motor' ]] || fail 'tampered archive changed target database'
target_marker=$(compose "$target_root" "$target_project" exec -T node-red cat /data/backup-restore-marker | tr -d '\r')
[[ $target_marker == target-node-red-data ]] || fail 'tampered archive changed Node-RED volume'
cmp -s "$tmp/target-env-before" "$target_root/.env" || fail 'tampered archive changed target env'
after_target_config=$(find "$target_root/config" "$target_root/connectors/node-red" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
[[ $before_target_config == "$after_target_config" ]] || fail 'rejected restore changed target config'

bash "$repo/scripts/restore.sh" "$archive" --root "$target_root" -p "$target_project" --env-file .env --confirm --restore-keys >/dev/null || fail 'valid archive restore failed'
restored_asset=$(compose "$target_root" "$target_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT name FROM assets WHERE id=chr(100)||chr(101)||chr(109)||chr(111)||chr(45)||chr(109)||chr(111)||chr(116)||chr(111)||chr(114)"' | tr -d '\r')
restored_sample=$(compose "$target_root" "$target_project" exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT value::text FROM telemetry_samples WHERE tag_id=chr(100)||chr(101)||chr(109)||chr(111)||chr(45)||chr(115)||chr(101)||chr(110)||chr(115)||chr(111)||chr(114)||chr(45)||chr(118)||chr(97)||chr(108)||chr(117)||chr(101) AND ts=make_timestamptz(2026,10,23,9,0,0,chr(85)||chr(84)||chr(67))"' | tr -d '\r')
restored_marker=$(compose "$target_root" "$target_project" exec -T node-red cat /data/backup-restore-marker | tr -d '\r')
[[ $restored_asset == 'Backup Source Motor' && $restored_sample == 42 && $restored_marker == source-node-red-data ]] || fail 'asset, telemetry history, or Node-RED data did not restore'
cmp -s "$source_root/connectors/node-red/flows/device-simulator.json" "$target_root/connectors/node-red/flows/device-simulator.json" || fail 'Node-RED flow file was not restored'
[[ $(find "$source_root/config" "$source_root/connectors/node-red" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1) == "$source_config_hash" ]] || fail 'restore modified source deployment config'
python3 - "$source_root/.env" "$target_root/.env" "$tmp/target-env-before" <<'PY'
import pathlib, sys
def parse(path):
    return {line.split("=",1)[0].strip():line.split("=",1)[1].strip() for line in pathlib.Path(path).read_text().splitlines() if "=" in line and not line.lstrip().startswith("#")}
a,b,original=parse(sys.argv[1]),parse(sys.argv[2]),parse(sys.argv[3])
for key in ("SESSION_SECRET", "NODE_RED_CREDENTIAL_SECRET"):
    if a.get(key) != b.get(key): raise SystemExit("restored app keys do not match source")
for key in ("POSTGRES_PASSWORD", "CONNECTIVITY_TOKEN", "HTTP_PORT"):
    if original.get(key) != b.get(key): raise SystemExit("restore changed target non-key configuration")
for key in set(original) | set(b):
    if key not in ("SESSION_SECRET", "NODE_RED_CREDENTIAL_SECRET") and original.get(key) != b.get(key):
        raise SystemExit("restore changed a target setting outside the two app keys")
PY
printf 'Backup/restore integration passed for isolated projects %s and %s.\n' "$source_project" "$target_project"
