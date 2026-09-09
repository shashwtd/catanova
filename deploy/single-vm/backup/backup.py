#!/usr/bin/env python3
"""Consistent game SQLite backup to private Azure Blob Storage, using VM identity."""

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
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from urllib.parse import urlencode


MAX_RUN_SECONDS = 240
IO_TIMEOUT_SECONDS = 30
CHUNK_SIZE = 1024 * 1024
REQUIRED_TABLES = {"rooms", "games", "game_events", "game_receipts"}
IMDS_HOST = "169.254.169.254"
TOKEN_PATH = "/metadata/identity/oauth2/token?" + urlencode(
    {"api-version": "2018-02-01", "resource": "https://storage.azure.com/"}
)


class BackupError(Exception):
    """Only fixed, credential-free messages should be placed in this exception."""


@dataclass(frozen=True)
class Config:
    database: Path
    account: str
    container: str

    @classmethod
    def from_environment(cls):
        database = os.environ.get("CATANOVA_BACKUP_DATABASE_PATH", "")
        account = os.environ.get("AZURE_STORAGE_ACCOUNT", "")
        container = os.environ.get("AZURE_STORAGE_CONTAINER", "")
        if not database or not Path(database).is_absolute():
            raise BackupError("CATANOVA_BACKUP_DATABASE_PATH must be an absolute file path")
        if not re.fullmatch(r"[a-z0-9]{3,24}", account):
            raise BackupError("AZURE_STORAGE_ACCOUNT must be a public Azure storage account name")
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", container)
            or "--" in container
        ):
            raise BackupError("AZURE_STORAGE_CONTAINER must be a valid container name")
        return cls(Path(database), account, container)


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
        return {"blob": blob_name, "bytes": archive.stat().st_size, "sha256": sha256}


def time_limit(_signum, _frame):
    raise BackupError("backup exceeded its time limit")


def main():
    os.umask(0o077)
    # A process-wide bound also covers stuck DNS, compression and network reads.
    signal.signal(signal.SIGALRM, time_limit)
    signal.alarm(MAX_RUN_SECONDS)
    try:
        result = run_backup(Config.from_environment())
        print("backup uploaded " + json.dumps(result, sort_keys=True))
        return 0
    except BackupError as error:
        print("backup failed: " + str(error), file=sys.stderr)
        return 1
    except Exception as error:
        # Network/SQLite exception strings or response bodies can contain private data.
        print("backup failed: " + type(error).__name__, file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    sys.exit(main())
