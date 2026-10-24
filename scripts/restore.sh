#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage: bash scripts/restore.sh ARCHIVE --root DIR -p PROJECT --env-file FILE --confirm [--restore-keys]

The explicit deployment root contains compose.yaml and receives restored config.
--confirm replaces only that project's database and Node-RED data. App secrets
must match the source archive, or be explicitly transferred with --restore-keys.
USAGE
}
fail() { printf 'restore: %s\n' "$1" >&2; exit 1; }
project= env_file= root= archive= confirm=false restore_keys=false
while (($#)); do
  case $1 in
    -p|--project) (($# >= 2)) || { usage >&2; exit 2; }; project=$2; shift 2 ;;
    --env-file) (($# >= 2)) || { usage >&2; exit 2; }; env_file=$2; shift 2 ;;
    --root) (($# >= 2)) || { usage >&2; exit 2; }; root=$2; shift 2 ;;
    --confirm) confirm=true; shift ;;
    --restore-keys) restore_keys=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) usage >&2; exit 2 ;;
    *) [[ -z $archive ]] || { usage >&2; exit 2; }; archive=$1; shift ;;
  esac
done
[[ -n $project && -n $env_file && -n $root && -n $archive ]] || { usage >&2; exit 2; }
[[ $confirm == true ]] || fail '--confirm is required'
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'invalid Compose project name'
[[ -d $root ]] || fail 'target deployment root does not exist'
root=$(cd -- "$root" && pwd -P)
if [[ $env_file != /* ]]; then env_file="$root/$env_file"; fi
[[ -f $env_file && ! -L $env_file ]] || fail 'target env file does not exist or is a symbolic link'
[[ -f $root/compose.yaml && -f $root/config/mosquitto/mosquitto.conf && -f $root/connectors/node-red/settings.js ]] || fail 'required target deployment files are missing'
python3 - "$root" "$env_file" <<'PY'
import os, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve(); env = pathlib.Path(sys.argv[2])
paths = [env, root/"compose.yaml", root/"config", root/"config/mosquitto", root/"config/mosquitto/mosquitto.conf", root/"connectors", root/"connectors/node-red", root/"connectors/node-red/settings.js", root/"connectors/node-red/flows"]
try:
    for path in paths:
        rel = path.relative_to(root)
        current = root
        for part in rel.parts:
            current = current / part
            if current.is_symlink(): raise ValueError
        current.resolve(strict=True).relative_to(root)
    if any(path.is_symlink() for path in (root/"connectors/node-red/flows").glob("*.json")): raise ValueError
except (OSError, ValueError):
    print("restore: target config paths must stay inside --root and contain no symbolic links", file=sys.stderr)
    sys.exit(1)
PY
[[ $? -eq 0 ]] || fail 'target config paths must stay inside --root'
[[ -f $archive && ! -L $archive ]] || fail 'archive does not exist or is a symbolic link'
archive=$(cd -- "$(dirname -- "$archive")" && printf '%s/%s' "$PWD" "$(basename -- "$archive")")
command -v docker >/dev/null && command -v python3 >/dev/null || fail 'Docker and Python 3 are required'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required'
compose() { docker compose -f "$root/compose.yaml" --project-directory "$root" -p "$project" --env-file "$env_file" "$@"; }
compose config --quiet >/dev/null 2>&1 || fail 'target Compose configuration is invalid or required settings are missing'

tmp=$(mktemp -d "${TMPDIR:-/tmp}/rallyx-restore.XXXXXXXX"); chmod 700 "$tmp"
cleanup() { local prefix="${TMPDIR:-/tmp}/rallyx-restore."; [[ $tmp == "$prefix"* && -d $tmp && ! -L $tmp ]] && rm -rf -- "$tmp" || printf 'restore: refusing unsafe temporary cleanup path\n' >&2; }
trap cleanup EXIT
python3 - "$archive" "$tmp/unpacked" <<'PY'
import hashlib, pathlib, sys, tarfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination); root.mkdir(mode=0o700)
seen = set()
try:
    with tarfile.open(archive, "r:gz") as tf:
        for member in tf.getmembers():
            name = member.name
            while name.startswith("./"): name = name[2:]
            path = pathlib.PurePosixPath(name)
            if path.is_absolute() or any(part in ("", "..") for part in path.parts): raise ValueError
            if name and name != "." and name in seen: raise ValueError
            if name and name != ".": seen.add(name)
            if member.isdir():
                if name and name != ".": root.joinpath(*path.parts).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile(): raise ValueError
            target = root.joinpath(*path.parts); target.parent.mkdir(parents=True, exist_ok=True)
            source = tf.extractfile(member)
            if source is None: raise ValueError
            with source, target.open("xb") as out:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk: break
                    out.write(chunk)
except (tarfile.TarError, OSError, ValueError):
    print("restore: archive rejected during safe extraction", file=sys.stderr); sys.exit(1)
root.chmod(0o700)
manifest, metadata = root / "SHA256SUMS", root / "metadata.txt"
if not manifest.is_file() or not metadata.is_file():
    print("restore: archive is missing integrity metadata", file=sys.stderr); sys.exit(1)
expected = set()
for line in manifest.read_text(encoding="utf-8").splitlines():
    try: digest, filename = line.split("  ", 1)
    except ValueError: print("restore: malformed integrity manifest", file=sys.stderr); sys.exit(1)
    filename = filename.removeprefix("./"); rel = pathlib.PurePosixPath(filename)
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest) or rel.is_absolute() or any(p in ("", ".", "..") for p in rel.parts):
        print("restore: unsafe integrity manifest entry", file=sys.stderr); sys.exit(1)
    path = root.joinpath(*rel.parts)
    if filename in expected or not path.is_file(): print("restore: invalid integrity manifest entry", file=sys.stderr); sys.exit(1)
    expected.add(filename)
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk: break
            hasher.update(chunk)
    if hasher.hexdigest() != digest:
        print("restore: archive integrity check failed", file=sys.stderr); sys.exit(1)
actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.relative_to(root).as_posix() != "SHA256SUMS"}
if expected != actual: print("restore: archive has missing or untracked files", file=sys.stderr); sys.exit(1)
try:
    with tarfile.open(root / "node-red/data.tar.gz", "r:gz") as nested:
        names = set()
        for member in nested.getmembers():
            name = member.name
            while name.startswith("./"): name = name[2:]
            rel = pathlib.PurePosixPath(name)
            if rel.is_absolute() or any(p in ("", "..") for p in rel.parts) or name in names or not (member.isfile() or member.isdir()): raise ValueError
            names.add(name)
except (tarfile.TarError, OSError, ValueError):
    print("restore: Node-RED archive has unsafe paths or links", file=sys.stderr); sys.exit(1)
PY
bundle=$tmp/unpacked
[[ -s $bundle/database.dump && -s $bundle/node-red/data.tar.gz && -f $bundle/.env && -f $bundle/compose.yaml && -f $bundle/config/mosquitto/mosquitto.conf && -f $bundle/connectors/node-red/settings.js ]] || fail 'archive is missing required recovery files'
compgen -G "$bundle/connectors/node-red/flows/*.json" >/dev/null || fail 'archive contains no Node-RED flow files'
[[ $(grep -cx 'format=2' "$bundle/metadata.txt") -eq 1 ]] || fail 'unsupported archive metadata format'
source_pg=$(sed -n 's/^postgres_server_version_num=//p' "$bundle/metadata.txt")
source_ts=$(sed -n 's/^timescaledb_extension_version=//p' "$bundle/metadata.txt")
[[ $source_pg =~ ^[0-9]+$ && -n $source_ts ]] || fail 'archive database compatibility metadata is invalid'

check_keys() {
  python3 - "$bundle/.env" "$env_file" <<'PY'
import pathlib, sys
keys = ("SESSION_SECRET", "NODE_RED_CREDENTIAL_SECRET")
def read(path):
    found = {}
    for raw in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        key, value = line.split("=", 1); key = key.strip()
        if key in keys:
            if key in found: raise ValueError
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'": value = value[1:-1]
            found[key] = (value, raw)
    if any(k not in found or not found[k][0] for k in keys): raise ValueError
    return found
try:
    a, b = read(sys.argv[1]), read(sys.argv[2])
    sys.exit(0 if all(a[k][0] == b[k][0] for k in keys) else 2)
except (OSError, UnicodeError, ValueError): sys.exit(3)
PY
}
if check_keys; then keys_match=true; else
  key_rc=$?
  [[ $key_rc -eq 2 ]] || fail 'could not safely read required app secrets from env files'
  [[ $restore_keys == true ]] || fail 'source session/Node-RED keys differ; use --restore-keys after reviewing the target'
  keys_match=false
fi

# A real TCP login verifies that the running target DB is accessible before any
# service, config, env file, or database is changed.
running=$(compose ps --status running --services) || fail 'could not inspect target services'
grep -qx db <<<"$running" || fail 'target database must be running'
grep -qx broker <<<"$running" || fail 'target broker must be running before config restore'
compose config --format json > "$tmp/resolved-compose.json" 2>/dev/null || fail 'could not resolve target Compose settings'
python3 - "$tmp/resolved-compose.json" "$root/compose.yaml" "$root" "$project" "$env_file" <<'PY'
import json, subprocess, sys
resolved, compose_file, root, project, env_file = sys.argv[1:]
try:
    cfg = json.load(open(resolved, encoding="utf-8"))
    configured = cfg["services"]["db"]["environment"]
    prefix = ["docker", "compose", "-f", compose_file, "--project-directory", root, "-p", project, "--env-file", env_file]
    for key in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"):
        result = subprocess.run(prefix + ["exec", "-T", "db", "printenv", key], capture_output=True, check=True)
        actual = result.stdout.decode("utf-8").rstrip("\r\n")
        expected = str(configured[key])
        if actual != expected: raise ValueError
except (OSError, KeyError, ValueError, subprocess.SubprocessError, UnicodeError):
    print("restore: target env does not match the running database credentials", file=sys.stderr)
    sys.exit(1)
PY
[[ $? -eq 0 ]] || fail 'target env does not match the running database credentials'
target_info=$(compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SHOW server_version_num"; PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT extversion FROM pg_extension WHERE extname=chr(116)||chr(105)||chr(109)||chr(101)||chr(115)||chr(99)||chr(97)||chr(108)||chr(101)||chr(100)||chr(98)"') || fail 'target database TCP login or TimescaleDB check failed'
target_pg=$(sed -n '1p' <<<"$target_info"); target_ts=$(sed -n '2p' <<<"$target_info")
[[ $target_pg =~ ^[0-9]+$ && -n $target_ts ]] || fail 'target TimescaleDB extension is unavailable'
[[ $((source_pg / 10000)) -eq $((target_pg / 10000)) ]] || fail 'PostgreSQL major versions differ; restore refused'
[[ $source_ts == "$target_ts" ]] || fail 'TimescaleDB extension versions differ; restore refused'

if [[ $keys_match == false ]]; then
  python3 - "$bundle/.env" "$env_file" <<'PY'
import os, pathlib, sys, tempfile
keys = ("SESSION_SECRET", "NODE_RED_CREDENTIAL_SECRET")
def assignments(path):
    out = {}
    for raw in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key = line.split("=", 1)[0].strip()
            if key in keys:
                if key in out: raise ValueError
                out[key] = raw
    if any(k not in out for k in keys): raise ValueError
    return out
try:
    src, dst = assignments(sys.argv[1]), assignments(sys.argv[2])
    path = pathlib.Path(sys.argv[2]); lines = path.read_text(encoding="utf-8").splitlines()
    rewritten, seen = [], set()
    for line in lines:
        stripped = line.strip(); key = stripped.split("=",1)[0].strip() if "=" in stripped else ""
        if key in keys:
            if key in seen: raise ValueError
            rewritten.append(src[key]); seen.add(key)
        else: rewritten.append(line)
    for key in keys:
        if key not in seen: rewritten.append(src[key])
    fd, temp = tempfile.mkstemp(prefix=".rallyx-env-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out: out.write("\n".join(rewritten)+"\n")
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)
except (OSError, UnicodeError, ValueError):
    print("restore: could not transfer app keys safely", file=sys.stderr); sys.exit(1)
PY
fi

was_connectivity=false; grep -qx connectivity <<<"$running" && was_connectivity=true || true
to_stop=()
for service in core connectivity node-red; do grep -qx "$service" <<<"$running" && to_stop+=("$service") || true; done
if ((${#to_stop[@]})); then compose stop "${to_stop[@]}" >/dev/null || fail 'could not stop application services cleanly'; fi

mkdir -p "$root/config/mosquitto" "$root/connectors/node-red/flows"
cp -- "$bundle/config/mosquitto/mosquitto.conf" "$root/config/mosquitto/mosquitto.conf"
cp -- "$bundle/connectors/node-red/settings.js" "$root/connectors/node-red/settings.js"
find "$root/connectors/node-red/flows" -maxdepth 1 -type f -name '*.json' -delete
cp -- "$bundle"/connectors/node-red/flows/*.json "$root/connectors/node-red/flows/"
compose exec -T broker kill -HUP 1 >/dev/null || fail 'Mosquitto did not accept the config reload signal'

# Recreate only this project's confirmed database. A fresh database avoids
# dropping Timescale's extension during --clean restore.
compose exec -T db sh -ec 'dropdb --if-exists --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" --owner="$POSTGRES_USER" "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS timescaledb" && PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT timescaledb_pre_restore()"' >/dev/null || fail 'could not prepare the target database for Timescale restore'
restore_ok=false
if compose exec -T db sh -ec 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$bundle/database.dump"; then restore_ok=true; fi
post_ok=false
if compose exec -T db sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT timescaledb_post_restore()"' >/dev/null; then post_ok=true; fi
[[ $restore_ok == true && $post_ok == true ]] || fail 'PostgreSQL restore or Timescale post_restore failed; application services remain stopped'

# Attach the selected Compose project's named volume through a one-off
# container while Node-RED is stopped. settings.js is a read-only bind mount.
compose run --entrypoint sh --no-deps --rm -T node-red -ec 'find /data -mindepth 1 -maxdepth 1 ! -name settings.js -exec rm -rf -- {} +; tar -C /data -xzf -' < "$bundle/node-red/data.tar.gz" || fail 'Node-RED volume restore failed; application services remain stopped'

compose up -d --wait db core node-red >/dev/null || fail 'restored database/Core/Node-RED did not become healthy'
if [[ $was_connectivity == true ]]; then
  compose --profile connectivity up -d --wait connectivity >/dev/null || fail 'restored connectivity service did not become healthy'
fi
compose ps --format json > "$tmp/final-services.json" 2>/dev/null || fail 'could not verify final service health'
python3 - "$tmp/final-services.json" <<'PY'
import json, sys
try:
    raw = open(sys.argv[1], encoding="utf-8").read().strip()
    if not raw: raise ValueError
    try: rows = json.loads(raw)
    except json.JSONDecodeError: rows = [json.loads(line) for line in raw.splitlines()]
    if isinstance(rows, dict): rows = [rows]
    for row in rows:
        if str(row.get("State", "")).lower() == "running" and row.get("Health") and str(row["Health"]).lower() != "healthy": raise ValueError
except (OSError, ValueError, json.JSONDecodeError):
    print("restore: a running Compose service is unhealthy", file=sys.stderr); sys.exit(1)
PY
[[ $? -eq 0 ]] || fail 'a running Compose service is unhealthy'
printf 'Restore completed and services are healthy for project %s under %s.\n' "$project" "$root"
