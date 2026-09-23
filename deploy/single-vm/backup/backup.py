#!/usr/bin/env python3
"""Consistent game SQLite backup to private Azure Blob Storage, using VM identity.

    backup.py                          snapshot, compress and upload (the systemd service)
    backup.py --local-output FILE.gz   the same snapshot and compression, written locally only
"""

import argparse
import base64
import gzip
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from urllib.parse import urlencode, urlsplit


MAX_RUN_SECONDS = 240
IO_TIMEOUT_SECONDS = 30
CHUNK_SIZE = 1024 * 1024
REQUIRED_TABLES = {"rooms", "games", "game_events", "game_receipts"}
IMDS_HOST = "169.254.169.254"
TOKEN_PATH = "/metadata/identity/oauth2/token?" + urlencode(
    {"api-version": "2018-02-01", "resource": "https://storage.azure.com/"}
)
# Dead-man's-switch pings and status files are reports about a run, never part of it.
PING_TIMEOUT_SECONDS = 10
PING_BODY_LIMIT = 10000
DEFAULT_STATUS_DIRECTORY = "/srv/catanova/status"
STATUS_SCHEMA = 1


class BackupError(Exception):
    """Only fixed, credential-free messages should be placed in this exception."""


def database_from_environment():
    database = os.environ.get("CATANOVA_BACKUP_DATABASE_PATH", "")
    if not database or not Path(database).is_absolute():
        raise BackupError("CATANOVA_BACKUP_DATABASE_PATH must be an absolute file path")
    return Path(database)


@dataclass(frozen=True)
class Config:
    database: Path
    account: str
    container: str

    @classmethod
    def from_environment(cls):
        database = database_from_environment()
        account = os.environ.get("AZURE_STORAGE_ACCOUNT", "")
        container = os.environ.get("AZURE_STORAGE_CONTAINER", "")
        if not re.fullmatch(r"[a-z0-9]{3,24}", account):
            raise BackupError("AZURE_STORAGE_ACCOUNT must be a public Azure storage account name")
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", container)
            or "--" in container
        ):
            raise BackupError("AZURE_STORAGE_CONTAINER must be a valid container name")
        return cls(database, account, container)


def check_deadline(deadline):
    if time.monotonic() >= deadline:
        raise BackupError("backup exceeded its time limit")


def make_snapshot(source_path, destination, deadline):
    # mode=ro is essential: a typo or missing volume must never create an empty DB.
    if not source_path.is_file() or source_path.stat().st_size == 0:
        raise BackupError("game database is missing or empty; no backup uploaded")
    source_uri = source_path.resolve(strict=True).as_uri() + "?mode=ro"
    destination.touch(mode=0o600, exist_ok=False)

    def progress(_status, _remaining, _total):
        check_deadline(deadline)

    check_deadline(deadline)
    with closing(sqlite3.connect(source_uri, uri=True, timeout=5)) as source:
        source.execute("PRAGMA query_only = ON")
        with closing(sqlite3.connect(destination, timeout=5)) as snapshot:
            source.backup(snapshot, pages=256, progress=progress, sleep=0.1)
            # The copy must be self-contained, including writes from the source WAL.
            snapshot.execute("PRAGMA journal_mode = DELETE")
            snapshot.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            if snapshot.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise BackupError("snapshot failed SQLite integrity verification")
            tables = {
                row[0]
                for row in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if not REQUIRED_TABLES.issubset(tables):
                raise BackupError("snapshot is not a Catanova game database")
    check_deadline(deadline)


def compress_snapshot(snapshot, archive, deadline):
    # Stream both passes; DB size must not determine peak Python memory usage.
    with snapshot.open("rb") as source, archive.open("xb") as output:
        os.chmod(archive, 0o600)
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            while chunk := source.read(CHUNK_SIZE):
                check_deadline(deadline)
                compressed.write(chunk)
    md5 = hashlib.md5(usedforsecurity=False)  # Azure transport integrity, not authentication.
    sha256 = hashlib.sha256()
    with archive.open("rb") as source:
        while chunk := source.read(CHUNK_SIZE):
            check_deadline(deadline)
            md5.update(chunk)
            sha256.update(chunk)
    return base64.b64encode(md5.digest()).decode("ascii"), sha256.hexdigest()


class AzureBlobTransport:
    """Direct connections: no environment proxies or HTTP redirect forwarding."""

    def get_token(self):
        connection = http.client.HTTPConnection(IMDS_HOST, timeout=5)
        try:
            connection.request("GET", TOKEN_PATH, headers={"Metadata": "true"})
            response = connection.getresponse()
            if response.status != 200:
                raise BackupError(f"managed identity token request rejected (HTTP {response.status})")
            payload = response.read(65537)
            if len(payload) > 65536:
                raise BackupError("managed identity token response was too large")
            try:
                token_data = json.loads(payload)
                token = token_data["access_token"]
                expires = int(token_data["expires_on"])
                valid = (
                    isinstance(token, str)
                    and re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token) is not None
                    and token_data.get("token_type", "").lower() == "bearer"
                    and expires > time.time() + 60
                )
            except (ValueError, KeyError, TypeError, AttributeError):
                valid = False
            if not valid:
                raise BackupError("managed identity returned an invalid or expiring token")
            return token
        finally:
            connection.close()

    def upload(self, config, archive, blob_name, token, md5, sha256, deadline):
        check_deadline(deadline)
        connection = http.client.HTTPSConnection(
            f"{config.account}.blob.core.windows.net",
            timeout=min(IO_TIMEOUT_SECONDS, max(1, deadline - time.monotonic())),
        )
        try:
            headers = {
                "Authorization": "Bearer " + token,
                "x-ms-version": "2023-11-03",
                "x-ms-date": formatdate(usegmt=True),
                "x-ms-blob-type": "BlockBlob",
                "x-ms-meta-sha256": sha256,
                "Content-Type": "application/gzip",
                "Content-Length": str(archive.stat().st_size),
                "Content-MD5": md5,
                "If-None-Match": "*",
            }
            with archive.open("rb") as body:
                connection.request(
                    "PUT", f"/{config.container}/{blob_name}", body=body, headers=headers
                )
                response = connection.getresponse()
                if response.status != 201:
                    raise BackupError(f"blob upload rejected (HTTP {response.status})")
                if not hmac.compare_digest(response.getheader("Content-MD5", ""), md5):
                    raise BackupError("blob upload did not return the expected content checksum")
        finally:
            connection.close()
        check_deadline(deadline)


def run_backup(config, transport=None, temporary_root=None):
    deadline = time.monotonic() + MAX_RUN_SECONDS
    started = datetime.now(timezone.utc)
    blob_name = started.strftime("game/%Y/%m/%d/%Y%m%dT%H%M%S.%fZ-") + uuid.uuid4().hex + ".sqlite.gz"
    transport = transport or AzureBlobTransport()
    with tempfile.TemporaryDirectory(prefix="snapshot-", dir=temporary_root) as directory:
        # TemporaryDirectory is 0700; snapshot/archive are also explicitly 0600.
        snapshot = Path(directory) / "game.sqlite"
        archive = Path(directory) / "game.sqlite.gz"
        make_snapshot(config.database, snapshot, deadline)
        md5, sha256 = compress_snapshot(snapshot, archive, deadline)
        check_deadline(deadline)
        token = transport.get_token()
        transport.upload(config, archive, blob_name, token, md5, sha256, deadline)
        return {
            "blob": blob_name,
            "bytes": archive.stat().st_size,
            "snapshotBytes": snapshot.stat().st_size,
            "sha256": sha256,
        }


def write_local_archive(database, output, temporary_root=None):
    """The worker's own snapshot and compression, written to a new local file instead of Azure.

    For isolated restore drills and a private copy before risky maintenance. It never contacts
    Azure, never overwrites a file, and leaves the archive 0600 like the uploaded one.
    """
    deadline = time.monotonic() + MAX_RUN_SECONDS
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise BackupError("local output already exists; choose a new file name")
    if not output.parent.is_dir():
        raise BackupError("local output directory does not exist")
    with tempfile.TemporaryDirectory(prefix="snapshot-", dir=temporary_root) as directory:
        snapshot = Path(directory) / "game.sqlite"
        make_snapshot(database, snapshot, deadline)
        try:
            _md5, sha256 = compress_snapshot(snapshot, output, deadline)
        except FileExistsError:
            raise BackupError("local output already exists; choose a new file name") from None
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        return {
            "file": str(output),
            "bytes": output.stat().st_size,
            "snapshotBytes": snapshot.stat().st_size,
            "sha256": sha256,
        }


def utc_timestamp(moment=None):
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_ping_url(value):
    """A dead-man's-switch URL: HTTPS without credentials. Plain HTTP only reaches loopback tests."""
    try:
        parts = urlsplit(value) if re.fullmatch(r"[\x21-\x7e]{1,2000}", value) else None
        valid = (
            parts is not None
            and parts.scheme in ("https", "http")
            and bool(parts.hostname)
            and not (parts.username or parts.password or parts.fragment)
            and (parts.scheme == "https" or parts.hostname in ("127.0.0.1", "::1", "localhost"))
            and (parts.port is None or parts.port > 0)
        )
    except ValueError:
        valid = False
    if not valid:
        raise BackupError("ping URL must be an https:// URL without credentials")
    return parts


def ping(url, failed, message, timeout=None):
    """Signal a healthchecks.io-style check: POST <url> on success, <url>/fail on failure.

    Best effort and bounded: returns None when delivered, otherwise a short credential-free reason.
    It never raises, so a monitoring outage cannot turn a good run into a failed one. The request
    runs in a daemon thread because socket timeouts do not bound a slow DNS lookup.
    """
    timeout = PING_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        parts = parse_ping_url(url)
    except BackupError as error:
        return str(error)
    path = (parts.path.rstrip("/") + ("/fail" if failed else "")) or "/"
    if parts.query:
        path += "?" + parts.query
    body = message.encode("utf-8", "replace")[:PING_BODY_LIMIT]
    outcome = {}

    def send():
        connection = None
        try:
            factory = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
            connection = factory(parts.hostname, parts.port, timeout=timeout)
            connection.request(
                "POST",
                path,
                body=body,
                headers={
                    "Content-Type": "text/plain; charset=utf-8",
                    "User-Agent": "catanova-ops/1",
                },
            )
            response = connection.getresponse()
            response.read(4096)
            outcome["status"] = response.status
        except Exception as error:
            outcome["error"] = type(error).__name__
        finally:
            if connection is not None:
                connection.close()

    worker = threading.Thread(target=send, name="ping", daemon=True)
    worker.start()
    worker.join(timeout + 1)
    if worker.is_alive():
        return "timed out"
    if "error" in outcome:
        return outcome["error"]
    if not 200 <= outcome["status"] < 300:
        return f"HTTP {outcome['status']}"
    return None


def status_directory(environ=None):
    environ = os.environ if environ is None else environ
    return Path(environ.get("CATANOVA_STATUS_DIRECTORY") or DEFAULT_STATUS_DIRECTORY)


def read_status(directory, name):
    try:
        with open(Path(directory) / (name + ".json"), "rb") as source:
            record = json.loads(source.read(1024 * 1024))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def write_status(directory, name, record):
    """Atomically replace <directory>/<name>.json, world-readable for the admin console.

    Status files hold timestamps, sizes, checksums and fixed reasons only, never secrets. Returns
    None when written, otherwise a short reason; it never raises.
    """
    directory = Path(directory)
    temporary = directory / f".{name}.json.{os.getpid()}.tmp"
    try:
        if not directory.is_dir():
            return f"{directory} does not exist"
        payload = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(descriptor, "wb") as output:
            # The services run with umask 0077; the console reads these as another user.
            os.fchmod(output.fileno(), 0o644)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, directory / (name + ".json"))
        return None
    except Exception as error:
        try:
            temporary.unlink()
        except OSError:
            pass
        return type(error).__name__


def report_outcome(result, reason, duration, environ=None):
    """Record the run in backup.json and ping BACKUP_PING_URL. Called after the verdict."""
    environ = os.environ if environ is None else environ
    directory = status_directory(environ)
    now = utc_timestamp()
    if reason is None:
        last_success = {
            "timestamp": now,
            "blob": result["blob"],
            "archiveBytes": result["bytes"],
            "snapshotBytes": result["snapshotBytes"],
            "sha256": result["sha256"],
        }
    else:
        previous = (read_status(directory, "backup") or {}).get("lastSuccess")
        last_success = previous if isinstance(previous, dict) and isinstance(previous.get("timestamp"), str) else None
    record = {
        "schema": STATUS_SCHEMA,
        "kind": "backup",
        "timestamp": now,
        "result": "success" if reason is None else "failure",
        "reason": reason,
        "durationSeconds": round(duration, 1),
        "blob": result["blob"] if reason is None else None,
        "archiveBytes": result["bytes"] if reason is None else None,
        "snapshotBytes": result["snapshotBytes"] if reason is None else None,
        "sha256": result["sha256"] if reason is None else None,
        "lastSuccess": last_success,
    }
    problem = write_status(directory, "backup", record)
    if problem:
        print("backup status not written: " + problem)
    url = environ.get("BACKUP_PING_URL", "")
    if url:
        if reason is None:
            message = (
                f"backup uploaded {result['blob']} ({result['bytes']} bytes compressed, "
                f"{result['snapshotBytes']} bytes uncompressed, sha256 {result['sha256']})"
            )
        else:
            message = "backup failed: " + reason
        problem = ping(url, reason is not None, message)
        # Never print the URL: anyone holding it can report on this check.
        print(("backup ping not delivered: " + problem) if problem else "backup ping delivered")


def time_limit(_signum, _frame):
    raise BackupError("backup exceeded its time limit")


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--local-output",
        metavar="FILE.gz",
        help="write the compressed snapshot to this new local file; no upload, ping or status",
    )
    return parser.parse_args(list(argv))


def main(argv=()):
    arguments = parse_arguments(argv)
    os.umask(0o077)
    started = time.monotonic()
    result, reason = None, None
    # A process-wide bound also covers stuck DNS, compression and network reads.
    signal.signal(signal.SIGALRM, time_limit)
    signal.alarm(MAX_RUN_SECONDS)
    try:
        if arguments.local_output:
            result = write_local_archive(database_from_environment(), arguments.local_output)
        else:
            result = run_backup(Config.from_environment())
    except BackupError as error:
        reason = str(error)
    except Exception as error:
        # Network/SQLite exception strings or response bodies can contain private data.
        reason = type(error).__name__
    finally:
        signal.alarm(0)
    if reason is not None:
        print("backup failed: " + reason, file=sys.stderr)
    elif arguments.local_output:
        print("backup written " + json.dumps(result, sort_keys=True))
    else:
        print("backup uploaded " + json.dumps(result, sort_keys=True))
    if not arguments.local_output:
        # Status and ping report the verdict above; neither can change it.
        try:
            report_outcome(result, reason, time.monotonic() - started)
        except Exception as error:
            print("backup report failed: " + type(error).__name__)
    return 0 if reason is None else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
