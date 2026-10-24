# Backup and restore

The scripts target Linux with Docker Compose v2 and Python 3 (restore uses Python's standard library to inspect archive paths). Keep an off-host copy of each archive. The bundle contains the PostgreSQL custom-format dump, `.env`, Compose/image/version metadata, Mosquitto config, Node-RED settings and flows, and a snapshot of the Node-RED `/data` volume. Node-RED credentials are included as encrypted-by-Node-RED recovery material and the bundle contains secrets from `.env`; protect it as a secret. The archive is mode `0600`, and the working directory is private while it is assembled. Metadata records image IDs/digests, PostgreSQL version, and TimescaleDB extension version.

Create a backup while PostgreSQL and Node-RED are running:

```sh
bash scripts/backup.sh --root /srv/rallyx -p rallyx --env-file .env --output /secure/backups
```

The script resolves Compose files, bind mounts, the env file, and backup paths from `--root` (default: the checkout containing the script). It validates the Compose configuration, runs `pg_dump` from the database container, captures Node-RED persistent data, records image/version metadata, and writes a SHA-256 manifest. It needs no database port exposed on the host. Keep the archive off the installation host and test it periodically.

Restore to an already-created target installation whose database is running. Supply its project name and env file explicitly, and review that the chosen project is the intended destination:

```sh
bash scripts/restore.sh /secure/backups/rallyx-rallyx-YYYYMMDDTHHMMSSZ.tar.gz \
  --root /srv/rallyx-recovery -p rallyx-recovery --env-file .env --confirm
```

`--root` is required for restore. Compose files, bind mounts, and config writes resolve under that deployment directory; the script does not write into the checkout where the restore script lives. `--confirm` is required because restore drops and recreates only the named project's database, then replaces Node-RED data. Integrity, archive paths, links, app key compatibility, a live TCP database login, and PostgreSQL/Timescale version compatibility are checked before stopping services or changing files. PostgreSQL major versions and TimescaleDB extension versions must match the archive.

Restore uses TimescaleDB's required `timescaledb_pre_restore()` and `timescaledb_post_restore()` calls around a single-process `pg_restore --exit-on-error` into the newly created database. It stops Core, optional connectivity, and Node-RED while restoring, leaves PostgreSQL running, reloads the Mosquitto config with SIGHUP, then starts Core and Node-RED and waits for health checks. Connectivity is restarted if it was running. If restore fails, the failure is reported and application services remain stopped.

By default, `SESSION_SECRET` and `NODE_RED_CREDENTIAL_SECRET` in the target env file must match the archive. This keeps existing RallyX sessions and Node-RED credentials readable. To explicitly transfer only those two values, add `--restore-keys`; database credentials, connectivity tokens, ports, and all other target settings remain as configured in the target env file. The target env file must match the live PostgreSQL container's database name and credentials before restore.

Mosquitto configuration is restored. The broker's persistent message volume, database engine images, web files, and connectivity service configuration are not separate restore inputs. The bundle contains the Compose file for version reference, but the script does not replace the target Compose file. Review image compatibility and application migration behavior before restoring between different platform versions. Keep the target deployment's Compose file and images compatible with the archived database schema.

Run the isolated integration harness from a Linux shell with two dedicated environment files. It creates separate source and target deployment directories, uses unique project names prefixed `rallyx-backup-test-`, starts only DB/broker/Node-RED/Core (no Web port), and cleanup removes only those Compose projects and their volumes. `BUILD_IMAGES=1` builds Core before running:

```sh
SOURCE_ENV_FILE=/secure/test-source.env \
TARGET_ENV_FILE=/secure/test-target.env \
BUILD_IMAGES=1 bash tests/integration/backup-restore.sh
```

The harness copies only runtime Compose/configuration/connectors into two temporary deployment roots and uses `--no-build`, so by default the required test images must already exist. Set `BUILD_IMAGES=1` to build Core from the repository with a temporary test-only image tag before startup. It verifies key mismatch and archive tampering rejection before effects, then restores an asset, a `telemetry_samples` history row, Node-RED flow/data, and source app keys while preserving all other target env settings. It checks source config remains unchanged. It does not replace a recovery rehearsal on a second machine.

The TimescaleDB restore sequence follows the [logical backup guide](https://docs.timescale.com/self-hosted/latest/backup-and-restore/logical-backup/) and [administrative restore functions](https://docs.tigerdata.com/api/latest/administration).
