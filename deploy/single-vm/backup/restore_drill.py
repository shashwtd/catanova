#!/usr/bin/env python3
"""Restore drill: prove a private backup restores into verified, playable games.

    restore_drill.py                        weekly service: the newest backup, verified in the image
    restore_drill.py --list                 the newest backups, newest first
    restore_drill.py --blob NAME --output FILE
                                            verify one chosen backup and keep the verified database
    restore_drill.py --file X.sqlite.gz --sha256 HEX --verifier-command "node dist/scripts/verify-restored-games.js"
                                            an offline drill of a downloaded archive, from a checkout

It downloads through the VM's managed identity (backup.py's own token path), or reads --file;
checks the SHA-256 against the blob's sha256 metadata (or --sha256), as the restore procedure
does; decompresses into a private folder; runs SQLite integrity_check, foreign_key_check and the
required-table check; then runs scripts/verify-restored-games.ts from the deployed game image
against a private copy: every room through the real Store, the journal hash chain, rules
invariants and one safe move per game. It never touches the live database or its volume.
Python 3.9+ standard libraries only; it imports backup.py from the same folder.
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
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ElementTree
import zlib
from contextlib import closing
from datetime import datetime, timezone
from email.utils import formatdate
from urllib.parse import quote, urlencode

import backup


MAX_RUN_SECONDS = 1800
VERIFIER_TIMEOUT_SECONDS = 1200
DOCKER_TIMEOUT_SECONDS = 60
MAX_ARCHIVE_BYTES = 4 * 1024**3
MAX_DATABASE_BYTES = 16 * 1024**3
MAX_LISTING_PAGES = 50
STALE_WORK_SECONDS = 6 * 3600
GAME_CONTAINER = "catanova-game"
VERIFIER_SCRIPT = "dist/scripts/verify-restored-games.js"
REVISION_LABEL = "org.opencontainers.image.revision"
BLOB_NAME = re.compile(r"game/\d{4}/\d{2}/\d{2}/(\d{8}T\d{6})\.\d{6}Z-[0-9a-f]{32}\.sqlite\.gz")
CONTAINER_USER = (65534, 65534)  # nobody:nogroup in the Debian-based game image


class DrillError(Exception):
    """Fixed, credential-free messages: they reach the journal, drill.json and the ping."""


class UsageError(Exception):
    pass


def check_deadline(deadline):
    if time.monotonic() >= deadline:
        raise DrillError("restore drill exceeded its time limit")


def blob_time(name):
    """The UTC moment a backup was taken, from the name backup.py gave it."""
    match = BLOB_NAME.fullmatch(name)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)


class BlobReader:
    """Private blob listing and download with the VM's identity; no proxies, redirects or keys."""

    def __init__(self, config, token):
        self.config = config
        self.token = token

    def connect(self, deadline):
        return http.client.HTTPSConnection(
            f"{self.config.account}.blob.core.windows.net",
            timeout=min(backup.IO_TIMEOUT_SECONDS, max(1, deadline - time.monotonic())),
        )

    def headers(self):
        return {
            "Authorization": "Bearer " + self.token,
            "x-ms-version": "2023-11-03",
            "x-ms-date": formatdate(usegmt=True),
        }

    def list(self, deadline):
        """Every backup name and size under game/, oldest first (names sort by time)."""
        found, marker = [], ""
        for _page in range(MAX_LISTING_PAGES):
            check_deadline(deadline)
            query = {"restype": "container", "comp": "list", "prefix": "game/", "maxresults": "5000"}
            if marker:
                query["marker"] = marker
            connection = self.connect(deadline)
            try:
                connection.request("GET", f"/{self.config.container}?{urlencode(query)}", headers=self.headers())
                response = connection.getresponse()
                if response.status != 200:
                    raise DrillError(f"backup listing rejected (HTTP {response.status})")
                body = response.read(32 * 1024 * 1024 + 1)
            finally:
                connection.close()
            if len(body) > 32 * 1024 * 1024:
                raise DrillError("backup listing response was too large")
            try:
                root = ElementTree.fromstring(body)
            except ElementTree.ParseError:
                raise DrillError("backup listing was not readable") from None
            for blob in root.iter("Blob"):
                name = blob.findtext("Name") or ""
                size = blob.findtext("Properties/Content-Length") or "0"
                if BLOB_NAME.fullmatch(name) and size.isdigit():
                    found.append((name, int(size)))
            marker = root.findtext("NextMarker") or ""
            if not marker:
                return sorted(found)
        raise DrillError("backup listing has too many pages")

    def download(self, name, destination, deadline):
        """Stream one blob to a new 0600 file; returns (bytes, sha256, sha256 metadata)."""
        check_deadline(deadline)
        connection = self.connect(deadline)
        sha256 = hashlib.sha256()
        md5 = hashlib.md5(usedforsecurity=False)  # Azure's transport checksum, not authentication.
        received = 0
        try:
            connection.request("GET", f"/{self.config.container}/{quote(name)}", headers=self.headers())
            response = connection.getresponse()
            if response.status != 200:
                raise DrillError(f"backup download rejected (HTTP {response.status})")
            length = response.getheader("Content-Length", "")
            if not length.isdigit() or int(length) > MAX_ARCHIVE_BYTES:
                raise DrillError("backup download has no acceptable length")
            recorded = (response.getheader("x-ms-meta-sha256", "") or "").lower()
            transport = response.getheader("Content-MD5", "")
            with open(destination, "xb") as output:
                while chunk := response.read(backup.CHUNK_SIZE):
                    check_deadline(deadline)
                    output.write(chunk)
                    sha256.update(chunk)
                    md5.update(chunk)
                    received += len(chunk)
        finally:
            connection.close()
        if received != int(length):
            raise DrillError("backup download was truncated")
        if transport and not hmac.compare_digest(base64.b64encode(md5.digest()).decode(), transport):
            raise DrillError("backup download failed its transport checksum")
        return received, sha256.hexdigest(), recorded


def file_digest(path, deadline):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(backup.CHUNK_SIZE):
            check_deadline(deadline)
            digest.update(chunk)
    return digest.hexdigest()


def decompress(archive, destination, deadline):
    """gunzip into a new 0600 file with a size bound; returns (bytes, sha256 of the database)."""
    digest = hashlib.sha256()
    written = 0
    with gzip.open(archive, "rb") as source, open(destination, "xb") as output:
        while True:
            try:
                chunk = source.read(backup.CHUNK_SIZE)
            except (EOFError, zlib.error, gzip.BadGzipFile):
                # Truncated, corrupt, or not gzip at all; a bad CRC is reported the same way.
                raise DrillError("backup archive is not a complete gzip file") from None
            if not chunk:
                break
            check_deadline(deadline)
            written += len(chunk)
            if written > MAX_DATABASE_BYTES:
                raise DrillError("restored database exceeds the drill's size limit")
            output.write(chunk)
            digest.update(chunk)
    return written, digest.hexdigest()


def check_sqlite(path, deadline):
    """The checks from the README's restore procedure, on a read-only connection."""
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as db:
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise DrillError("restored database failed SQLite integrity_check")
            if db.execute("PRAGMA foreign_key_check").fetchall():
                raise DrillError("restored database failed SQLite foreign_key_check")
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.DatabaseError:
        check_deadline(deadline)
        raise DrillError("restored file is not a readable SQLite database") from None
    if not backup.REQUIRED_TABLES.issubset(tables):
        raise DrillError("restored database is missing Catanova's required tables")


def docker(arguments, timeout=DOCKER_TIMEOUT_SECONDS):
    try:
        return subprocess.run(["docker", *arguments], capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError:
        raise DrillError("docker CLI not found") from None
    except subprocess.TimeoutExpired:
        raise DrillError(f"docker {arguments[0]} timed out") from None


def image_for_verifier(requested):
    """The given image, or the one the production game container runs: the reviewed release."""
    image = requested or os.environ.get("CATANOVA_DRILL_IMAGE", "")
    if not image:
        found = docker(["inspect", "--type", "container", "--format", "{{.Image}}", GAME_CONTAINER])
        image = found.stdout.decode("utf-8", "replace").strip()
        if found.returncode != 0 or not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            raise DrillError(f"cannot find the {GAME_CONTAINER} container's image; pass --image")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]{0,254}", image):
        raise DrillError("verifier image name is not valid")
    labelled = docker(["image", "inspect", "--format", '{{index .Config.Labels "' + REVISION_LABEL + '"}}', image])
    if labelled.returncode != 0:
        raise DrillError("verifier image is not available locally")
    revision = labelled.stdout.decode("utf-8", "replace").strip()
    return image, revision if re.fullmatch(r"[0-9a-f]{40}", revision) else None


def verifier_command(arguments, restored, scratch, report):
    """The verifier's argv and working directory, for the image (default) or a local command."""
    extra = ["--allow-missing-journal-check"] if arguments.allow_missing_journal_check else []
    if arguments.verifier_command:
        command = shlex.split(arguments.verifier_command)
        return command + [str(restored), "--report", str(report), "--work-dir", str(scratch), *extra], None, None
    image, revision = image_for_verifier(arguments.image)
    if os.geteuid() == 0:
        # The container runs as nobody: it may read the restored file and write only scratch/.
        os.chown(scratch, *CONTAINER_USER)
        os.chown(restored, 0, CONTAINER_USER[1])
        os.chmod(restored, 0o640)
        user = "%d:%d" % CONTAINER_USER
    else:
        user = f"{os.getuid()}:{os.getgid()}"
    name = "catanova-drill-" + uuid.uuid4().hex[:12]
    command = [
        "docker", "run", "--rm", "--name", name, "--pull", "never", "--network", "none",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--user", user, "--memory", "768m", "--cpus", "1", "--pids-limit", "256", "--no-healthcheck",
        "--tmpfs", "/tmp:size=64m,mode=1777",
        "--mount", f"type=bind,source={restored},target=/drill/restored.sqlite,readonly",
        "--mount", f"type=bind,source={scratch},target=/drill/scratch",
        "--workdir", "/app", "--entrypoint", "node", image, VERIFIER_SCRIPT, "/drill/restored.sqlite",
        "--report", "/drill/scratch/report.json", "--work-dir", "/drill/scratch", *extra,
    ]  # fmt: skip
    return command, name, {"image": image, "revision": revision}


def run_verifier(arguments, restored, scratch, facts, deadline):
    report = scratch / "report.json"
    command, container, image = verifier_command(arguments, restored, scratch, report)
    facts["verifier"] = "image" if image else "command"
    if image:
        facts.update(image)
        print(f"restore drill: verifying games with image {image['image']} (revision {image['revision'] or 'unknown'})")
    timeout = max(1, min(VERIFIER_TIMEOUT_SECONDS, deadline - time.monotonic()))
    try:
        completed = subprocess.run(
            command,
            cwd=arguments.app_directory,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        if container:
            # Stopping the CLI does not stop a container; remove it by name.
            try:
                docker(["rm", "--force", container])
            except DrillError:
                pass
        raise DrillError(f"game verification did not finish within {int(timeout)} seconds") from None
    except OSError:
        raise DrillError("game verifier could not be started") from None
    finally:
        if image and os.geteuid() == 0:
            os.chown(restored, 0, 0)
            os.chmod(restored, 0o600)
    sys.stdout.write(completed.stdout[-1024 * 1024 :].decode("utf-8", "replace"))
    sys.stdout.flush()
    result = None
    if report.is_file():
        try:
            with report.open("rb") as source:
                result = json.loads(source.read(16 * 1024 * 1024))
        except (OSError, ValueError):
            result = None
    if isinstance(result, dict):
        for key in ("rooms", "games", "verified", "failed", "withoutGame", "phases", "journalChain"):
            facts[key] = result.get(key)
        failures = result.get("failures") if isinstance(result.get("failures"), list) else []
        facts["failures"] = [
            {
                "roomId": str(failure.get("roomId")),
                "problems": [str(p) for p in failure.get("problems") or [] if isinstance(p, str)][:3],
            }
            for failure in failures[:20]
            if isinstance(failure, dict)
        ]
    if completed.returncode == 1 and isinstance(result, dict) and result.get("result") == "fail":
        raise DrillError(f"game verification failed for {result.get('failed')} of {result.get('rooms')} rooms")
    if completed.returncode != 0 or not isinstance(result, dict) or result.get("result") != "pass":
        raise DrillError(f"game verifier could not verify the database (exit {completed.returncode})")


def work_root(arguments):
    root = arguments.work_directory or os.environ.get("DRILL_WORK_DIRECTORY") or os.environ.get("STATE_DIRECTORY")
    # Absolute: Docker resolves bind-mount sources itself, outside this process.
    root = (Path(root.split(":")[0]) if root else Path(tempfile.gettempdir())).resolve()
    if not root.is_dir():
        raise DrillError(f"work directory {root} does not exist")
    return root


def remove_stale_work(root):
    """A killed run can leave a private copy behind; remove our own old drill folders."""
    for entry in root.glob("drill-*"):
        try:
            info = entry.lstat()
            if entry.is_dir() and not entry.is_symlink() and info.st_uid == os.geteuid() and time.time() - info.st_mtime > STALE_WORK_SECONDS:
                shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            pass


def keep_output(restored, output):
    with open(restored, "rb") as source, open(output, "xb") as destination:
        os.chmod(output, 0o600)
        shutil.copyfileobj(source, destination, backup.CHUNK_SIZE)
        destination.flush()
        os.fsync(destination.fileno())


def run_drill(arguments, facts):
    deadline = time.monotonic() + MAX_RUN_SECONDS
    root = work_root(arguments)
    remove_stale_work(root)
    work = Path(tempfile.mkdtemp(prefix="drill-", dir=root))
    try:
        os.chmod(work, 0o700)
        if arguments.file:
            archive = Path(arguments.file)
            if not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
                raise DrillError("backup file is missing or too large")
            facts.update(source="file", archiveBytes=archive.stat().st_size)
            actual = file_digest(archive, deadline)
            expected = arguments.sha256
            print(f"restore drill: using local file {archive.name} ({facts['archiveBytes']} bytes)")
        else:
            config = backup.Config.from_environment()
            reader = BlobReader(config, backup.AzureBlobTransport().get_token())
            name = arguments.blob
            if not name:
                backups = reader.list(deadline)
                if not backups:
                    raise DrillError("no backups found in the container")
                name = backups[-1][0]
            archive = work / "backup.sqlite.gz"
            size, actual, expected = reader.download(name, archive, deadline)
            if not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise DrillError("backup has no sha256 metadata; it was not written by backup.py")
            taken = blob_time(name)
            facts.update(source="azure", blob=name, archiveBytes=size)
            if taken:
                facts["backupTimestamp"] = backup.utc_timestamp(taken)
                facts["backupAgeMinutes"] = round((datetime.now(timezone.utc) - taken).total_seconds() / 60, 1)
            print(f"restore drill: downloaded {name} ({size} bytes, taken {facts.get('backupTimestamp', 'at an unknown time')})")
        facts["sha256"] = actual
        if expected is None:
            print("restore drill: SHA-256 NOT checked (--no-checksum)")
        elif not hmac.compare_digest(actual, expected):
            raise DrillError("SHA-256 mismatch: this is not the archive the backup worker uploaded")
        else:
            print(f"restore drill: SHA-256 {actual} matches the recorded checksum")
        restored = work / "restored.sqlite"
        facts["databaseBytes"], facts["restoredSha256"] = decompress(archive, restored, deadline)
        print(f"restore drill: decompressed {facts['databaseBytes']} bytes into a private folder")
        check_sqlite(restored, deadline)
        print("restore drill: SQLite integrity_check, foreign_key_check and required tables passed")
        scratch = work / "scratch"
        scratch.mkdir(mode=0o700)
        run_verifier(arguments, restored, scratch, facts, deadline)
        if arguments.output:
            keep_output(restored, arguments.output)
            facts["output"] = str(arguments.output)
            print(f"restore drill: verified database kept at {arguments.output} (sha256 {facts['restoredSha256']})")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def summary(facts):
    parts = [f"{facts.get('verified')} games in {facts.get('rooms')} rooms verified"]
    if facts.get("blob"):
        age = facts.get("backupAgeMinutes")
        parts.append(f"from {facts['blob']}" + (f" ({age:.0f} minutes old)" if isinstance(age, (int, float)) else ""))
    if facts.get("revision"):
        parts.append(f"with revision {facts['revision'][:12]}")
    parts.append("journal chain " + ("verified" if facts.get("journalChain") == "verified" else "NOT checked"))
    return "restore drill passed: " + "; ".join(parts)


def report_outcome(facts, reason, duration):
    """drill.json and DRILL_PING_URL, after the verdict. Room ids stay out of the ping."""
    record = {
        "schema": backup.STATUS_SCHEMA,
        "kind": "drill",
        "timestamp": backup.utc_timestamp(),
        "result": "success" if reason is None else "failure",
        "reason": reason,
        "durationSeconds": round(duration, 1),
    }
    for key in (
        "source", "blob", "backupTimestamp", "backupAgeMinutes", "archiveBytes", "sha256",
        "databaseBytes", "restoredSha256", "verifier", "image", "revision", "rooms", "games",
        "verified", "failed", "withoutGame", "phases", "journalChain", "failures",
    ):  # fmt: skip
        record[key] = facts.get(key)
    problem = backup.write_status(backup.status_directory(), "drill", record)
    if problem:
        print("restore drill status not written: " + problem)
    url = os.environ.get("DRILL_PING_URL", "")
    if url:
        message = summary(facts) if reason is None else "restore drill failed: " + reason
        problem = backup.ping(url, reason is not None, message)
        print(("restore drill ping not delivered: " + problem) if problem else "restore drill ping delivered")


def list_backups(arguments):
    deadline = time.monotonic() + 120
    reader = BlobReader(backup.Config.from_environment(), backup.AzureBlobTransport().get_token())
    backups = reader.list(deadline)
    for name, size in reversed(backups[-arguments.list :]):
        print(f"{backup.utc_timestamp(blob_time(name))}  {size:>12}  {name}")
    print(f"{len(backups)} backups in the container")
    return 0


def time_limit(_signum, _frame):
    raise DrillError("restore drill exceeded its time limit")


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--list", nargs="?", const=20, type=int, metavar="N", help="list the N newest backups and exit")
    source.add_argument("--blob", help="verify this backup instead of the newest")
    source.add_argument("--file", help="verify a local .sqlite.gz instead of downloading")
    parser.add_argument("--sha256", help="expected SHA-256 of --file (the blob's sha256 metadata)")
    parser.add_argument("--no-checksum", action="store_true", help="accept --file without a checksum (reported)")
    parser.add_argument("--output", help="keep the verified database at this new path (0600)")
    parser.add_argument("--image", help="game image to verify with (default: the running catanova-game's)")
    parser.add_argument("--verifier-command", help="run the verifier locally instead, e.g. 'node dist/scripts/verify-restored-games.js'")
    parser.add_argument("--app-directory", help="working directory for --verifier-command (a built checkout)")
    parser.add_argument("--work-directory", help="where the private work folder is made")
    parser.add_argument("--allow-missing-journal-check", action="store_true", help="accept a release whose Store has no verifyJournal")
    parser.add_argument("--no-report", action="store_true", help="do not write drill.json or ping DRILL_PING_URL")
    arguments = parser.parse_args(list(argv))
    if arguments.list is not None and arguments.list < 1:
        raise UsageError("--list needs a positive count")
    if arguments.blob and not BLOB_NAME.fullmatch(arguments.blob):
        raise UsageError("--blob must be a backup name such as game/2026/09/23/20260923T101500.123456Z-<32 hex>.sqlite.gz")
    if arguments.file:
        if arguments.sha256:
            arguments.sha256 = arguments.sha256.strip().lower()
            if not re.fullmatch(r"[0-9a-f]{64}", arguments.sha256):
                raise UsageError("--sha256 must be 64 hexadecimal characters")
        elif not arguments.no_checksum:
            raise UsageError("--file needs --sha256 (the blob's sha256 metadata) or an explicit --no-checksum")
    elif arguments.sha256 or arguments.no_checksum:
        raise UsageError("--sha256 and --no-checksum apply only to --file")
    if arguments.output:
        arguments.output = Path(arguments.output).absolute()
        if arguments.output.exists() or arguments.output.is_symlink() or not arguments.output.parent.is_dir():
            raise UsageError("--output must be a new file in an existing directory")
    if arguments.image and arguments.verifier_command:
        raise UsageError("use either --image or --verifier-command")
    return arguments


def main(argv=()):
    os.umask(0o077)
    try:
        arguments = parse_arguments(argv)
    except UsageError as error:
        print("restore drill: " + str(error), file=sys.stderr)
        return 2
    if arguments.list is not None:
        try:
            return list_backups(arguments)
        except (DrillError, backup.BackupError) as error:
            print("restore drill: " + str(error), file=sys.stderr)
            return 1
    started = time.monotonic()
    facts, reason = {}, None
    signal.signal(signal.SIGALRM, time_limit)
    signal.alarm(MAX_RUN_SECONDS + 60)
    try:
        run_drill(arguments, facts)
    except (DrillError, backup.BackupError) as error:
        reason = str(error)
    except Exception as error:
        # Exception text from networking or SQLite could carry private details.
        reason = type(error).__name__
    finally:
        signal.alarm(0)
    if reason is None:
        print(summary(facts))
    else:
        print("restore drill FAILED: " + reason, file=sys.stderr)
        for failure in facts.get("failures") or []:
            print(f"  room {failure['roomId']}: " + "; ".join(failure["problems"]), file=sys.stderr)
    if not arguments.no_report:
        try:
            report_outcome(facts, reason, time.monotonic() - started)
        except Exception as error:
            print("restore drill report failed: " + type(error).__name__)
    return 0 if reason is None else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
