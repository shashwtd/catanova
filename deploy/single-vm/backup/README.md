# Private game backups

This worker uses Python 3.9+ standard libraries only. It opens the existing game database **read-only**, uses SQLite's online backup API to capture a consistent snapshot including committed WAL writes, validates the copy, compresses it, and streams it to Azure Blob Storage. It never creates a missing source database. [SQLite backup API](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup)

The VM's **system-assigned managed identity** requests a storage token directly from IMDS. Uploads use HTTPS to the configured public Azure account with a `Content-MD5` transport checksum and SHA-256 metadata. No storage key, SAS token, Azure CLI, external Python package, or Supabase credential is needed by the worker. Connections do not follow redirects or use environment proxies; HTTP bodies and tokens are never logged. [VM identity endpoint](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-to-use-vm-token), [Blob uploads](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)

Each successful upload has a unique name under `game/YYYY/MM/DD/`, ending in `.sqlite.gz`. `If-None-Match: *` prevents overwriting an existing backup. Success requires HTTP 201 and Azure's returned checksum to match. A timeout after Azure accepted a request can leave a valid blob while the run reports failure; the next run creates a new name. It never deletes remote backups.

## Install on the deployed VM

These are operator instructions, not evidence that installation or cloud provisioning has happened.

1. Provision a **private** Blob container, disable public blob access, and grant the VM identity **Storage Blob Data Contributor scoped to that container only**. Configure the seven-day lifecycle rule for this container's `game/` prefix separately. Lifecycle deletion is asynchronous. The worker does not configure roles, create containers or set retention.
2. Check the real Docker volume path on this VM:

   ```sh
   docker volume inspect catanova-game-data --format '{{.Mountpoint}}'
   ```

   Append `/probe.sqlite` to that path for `CATANOVA_BACKUP_DATABASE_PATH`. Do not assume `/var/lib/docker` if Docker was moved to the managed data disk. Keep the game running for the backup check so its schema and readable WAL/SHM sidecars exist; a missing, zero-byte or unrelated database correctly makes the job fail.

3. From the reviewed repository checkout, install the worker and units:

   ```sh
   sudo install -d -m 0755 /opt/catanova-backup
   sudo install -m 0644 deploy/single-vm/backup/backup.py /opt/catanova-backup/backup.py
   sudo install -d -m 0700 /etc/catanova
   sudo install -m 0600 deploy/single-vm/backup/.env.example /etc/catanova/backup.env
   sudo install -m 0644 deploy/single-vm/backup/catanova-backup.service /etc/systemd/system/catanova-backup.service
   sudo install -m 0644 deploy/single-vm/backup/catanova-backup.timer /etc/systemd/system/catanova-backup.timer
   ```

   Set all three values in `/etc/catanova/backup.env`. This file holds the database path, account name and container name only; never put tokens or storage keys there. Preserve an existing configuration when updating the worker rather than copying the example over it again.

4. Validate and run once before enabling the schedule:

   ```sh
   sudo systemd-analyze verify /etc/systemd/system/catanova-backup.service /etc/systemd/system/catanova-backup.timer
   sudo systemctl daemon-reload
   sudo systemctl start catanova-backup.service
   sudo systemctl status catanova-backup.service --no-pager
   sudo journalctl -u catanova-backup.service -n 20 --no-pager
   sudo systemctl enable --now catanova-backup.timer
   systemctl list-timers catanova-backup.timer
   ```

An inactive oneshot service after a successful run is normal; inspect its exit result and the uploaded blob. On later releases, install the new worker/unit files, reload systemd, and run the service once to validate them.

## Schedule and operating limits

The timer runs at minutes 00, 15, 30 and 45. `Persistent=true` triggers one catch-up run after a missed schedule; it does not recreate snapshots for times when the VM was down. systemd does not start a second instance of an already-running oneshot service. Use `systemctl start catanova-backup.service` for manual runs too.

The worker has a four-minute process deadline; systemd imposes a five-minute startup limit with a ten-second stop bound. Snapshot work checks the deadline, and network calls have shorter socket timeouts. There is no unbounded retry loop: a failed run exits nonzero, retaining earlier blobs, and the next scheduled run tries again. Alert on a failed service or a latest successful backup older than 30 minutes; merely enabling the timer is not monitoring.

The root service can read Docker's private volume, but its filesystem is read-only except for systemd's private temporary directories. Intermediate files use a 0700 directory and 0600 permissions, are removed on ordinary success/failure, and remain private if a process is killed. `PrivateTmp` removes its isolated temporary files when the service fully stops. `/var/tmp` needs enough disk space for both the raw snapshot and its compressed copy. Compression/upload stream chunks; systemd caps memory at 256 MiB and lowers CPU/I/O priority. Measure backup duration and disk space as the database grows.

Run backups while the game has its database open. Read-only WAL access requires readable `-wal`/`-shm` sidecars; a clean game shutdown may remove them, and the service cannot recreate them through its read-only filesystem view. Such a run fails safely until the game opens the database again. Do not add `immutable=1` to bypass this: a live game database is mutable. [SQLite read-only WAL behavior](https://www.sqlite.org/wal.html#read_only_databases)

Fifteen-minute scheduling is a target, not a guaranteed recovery point. Failures, upload duration or VM downtime can make the last successful snapshot older. A restore loses changes made after that snapshot. These backups cover the game database only: Supabase accounts, Caddy certificate data, VM configuration and an optional wiki have separate recovery needs. Container-scoped contributor permission also permits deletion; this is versioned operational backup, not immutable protection against a compromised VM.

## Restore and verify

1. Use an authorized Azure Portal/account to download a selected private `.sqlite.gz` blob into a restricted directory on a recovery machine. Check its recorded timestamp and compare `sha256sum downloaded.sqlite.gz` with the blob's `sha256` metadata or the successful worker log. Do not post the database, its JSON state or the download credentials in public logs or this repository.
2. Decompress and verify a **new isolated file** before touching production. From that restricted directory:

   ```sh
   python3 -B - downloaded.sqlite.gz verified.sqlite <<'PY'
   import gzip, os, pathlib, shutil, sqlite3, sys
   from contextlib import closing
   os.umask(0o077)
   target = pathlib.Path(sys.argv[2]).resolve()
   with gzip.open(sys.argv[1], 'rb') as source, target.open('xb') as destination:
       shutil.copyfileobj(source, destination)
   with closing(sqlite3.connect(target.as_uri() + '?mode=ro', uri=True)) as db:
       assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
       assert not db.execute('PRAGMA foreign_key_check').fetchall()
       tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
       assert {'rooms', 'games', 'game_events', 'game_receipts'} <= tables
       print('Snapshot integrity and required tables verified.')
   PY
   ```

   Do not use a file that fails verification. This check establishes SQLite structure and core tables, not that every game rule or client reconnect has been tested.

3. Test the same reviewed game release with a copy in an **isolated data volume**. Keep it unreachable by ordinary production clients. Resume a known test room, compare its roads/houses and turn state, and retry a known accepted command to confirm its receipt still prevents a duplicate move. Use private local inspection where needed; do not print all game state.
4. For a production recovery, stop the backup timer and wait for or stop its service, then stop the sole game container. Preserve the old database, `-wal` and `-shm` files together for recovery analysis. While the game remains stopped, replace `probe.sqlite` in the actual `catanova-game-data` volume with the verified standalone snapshot; stale WAL/SHM files from the old database must not remain beside it. Restore the game's actual file owner/group and restrictive permissions, then start the same reviewed release. Never replace an open database.
5. Verify HTTPS health, reconnect a test room and inspect server errors. Run a fresh backup, then re-enable the timer. Record the snapshot used and actual recovery time/lost interval. Do not restore into the production volume merely to test the procedure.

## Local regression checks

```sh
python3 -B -m unittest discover -s deploy/single-vm/backup -v
```

The tests keep a WAL writer open and prove that committed state, events and command receipts survive as one standalone database while an uncommitted move is excluded. They stub all metadata and Blob connections, exercise integrity/error handling and private-temp cleanup, and cannot provision or contact Azure. Live role assignment, systemd isolation and off-host restoration still need verification on the deployed Linux VM.
