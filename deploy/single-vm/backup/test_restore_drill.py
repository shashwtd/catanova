"""Run with: python3 -B -m unittest discover -s deploy/single-vm/backup -v

The game verifier here is a stub that honours the Node verifier's command-line contract; the
real one runs against really played games in tests/restore-drill.test.ts.
"""

import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing, redirect_stderr, redirect_stdout
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import backup
import restore_drill
from test_backup import FakeResponse, PingServer, create_game_database

NEWEST = "game/2026/09/23/20260923T101500.123456Z-" + "b" * 32 + ".sqlite.gz"
OLDER = "game/2026/09/23/20260923T100000.654321Z-" + "a" * 32 + ".sqlite.gz"

STUB_VERIFIER = """
import hashlib, json, os, sqlite3, sys, time
args = sys.argv[1:]
database, report, work = args[0], args[args.index("--report") + 1], args[args.index("--work-dir") + 1]
with open(database, "rb") as source:
    digest = hashlib.sha256(source.read()).hexdigest()
with open(os.environ["STUB_VERIFIER_LOG"], "w") as log:
    json.dump({"argv": args, "sha256": digest, "work": os.path.isdir(work)}, log)
mode = os.environ.get("STUB_VERIFIER", "pass")
if mode == "hang":
    time.sleep(30)
if mode == "crash":
    print("Verification could not run: the Store could not open the copy")
    sys.exit(2)
rooms = sqlite3.connect("file:" + database + "?mode=ro", uri=True).execute("SELECT count(*) FROM rooms").fetchone()[0]
failed = mode == "fail"
result = {
    "schema": 1, "result": "fail" if failed else "pass", "rooms": rooms, "games": 1,
    "verified": 0 if failed else 1, "failed": 1 if failed else 0, "withoutGame": rooms - 1,
    "phases": {"actions": 1}, "journalChain": "verified", "details": [],
    "failures": [{"roomId": "room-test", "problems": ["loadGame: STATE_INTEGRITY Saved game needs recovery"]}] if failed else [],
}
with open(report, "x") as output:
    json.dump(result, output)
print(("FAIL" if failed else "PASS") + " room-test")
sys.exit(1 if failed else 0)
"""


class FakeAzure:
    """The Blob endpoint: a paged listing and downloads, recording requests. The identity token
    comes from backup.py's own transport, whose IMDS request is tested in test_backup.py."""

    def __init__(self, blobs, metadata=None, page_size=2):
        self.blobs = blobs  # name -> bytes
        self.metadata = metadata or {name: hashlib.sha256(body).hexdigest() for name, body in blobs.items()}
        self.page_size = page_size
        self.requests = []
        self.tokens = 0

    def transport(self):
        azure = self

        class Transport:
            def get_token(self):
                azure.tokens += 1
                return "private.test.token"

        return Transport

    def connection(self):
        azure = self

        class Connection:
            def __init__(self, host):
                self.host = host

            def request(self, method, path, body=None, headers=None):
                self.call = {"kind": "blob", "host": self.host, "method": method, "path": path, "headers": headers}
                azure.requests.append(self.call)

            def getresponse(self):
                parts = urlsplit(self.call["path"])
                query = parse_qs(parts.query)
                if query.get("comp") == ["list"]:
                    names = sorted(azure.blobs) + ["game/notes.txt"]
                    start = int(query.get("marker", ["0"])[0])
                    page = names[start : start + azure.page_size]
                    marker = str(start + azure.page_size) if start + azure.page_size < len(names) else ""
                    blobs = "".join(
                        f"<Blob><Name>{name}</Name><Properties><Content-Length>{len(azure.blobs.get(name, b''))}</Content-Length></Properties></Blob>"
                        for name in page
                    )
                    xml = f'<?xml version="1.0" encoding="utf-8"?><EnumerationResults><Blobs>{blobs}</Blobs><NextMarker>{marker}</NextMarker></EnumerationResults>'
                    return FakeResponse(200, xml.encode())
                name = parts.path.split("/", 2)[2]
                body = azure.blobs[name]
                headers = {"Content-Length": str(len(body)), "Content-MD5": base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest()).decode()}
                if azure.metadata.get(name):
                    headers["x-ms-meta-sha256"] = azure.metadata[name]
                return FakeResponse(200, body, headers)

            def close(self):
                pass

        return Connection

    def downloads(self):
        return [r["path"] for r in self.requests if r["kind"] == "blob" and "comp=list" not in r["path"]]


class DrillFixture(unittest.TestCase):
    """A real WAL game database, its archive from backup.py, a stub verifier and isolated status."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.work = self.root / "work"
        self.work.mkdir()
        self.status = self.root / "status"
        self.status.mkdir()
        self.log = self.root / "verifier.json"
        stub = self.root / "stub_verifier.py"
        stub.write_text(STUB_VERIFIER)
        self.verifier = f"{sys.executable} -B {stub}"
        writer = create_game_database(self.root / "probe.sqlite")
        self.addCleanup(writer.close)
        self.archive = self.root / "backup.sqlite.gz"
        with redirect_stdout(io.StringIO()):
            self.written = backup.write_local_archive(self.root / "probe.sqlite", self.archive)
        self.database = gzip.decompress(self.archive.read_bytes())
        environment = {
            "CATANOVA_BACKUP_DATABASE_PATH": str(self.root / "probe.sqlite"),
            "AZURE_STORAGE_ACCOUNT": "exampleaccount",
            "AZURE_STORAGE_CONTAINER": "game-backups",
            "CATANOVA_STATUS_DIRECTORY": str(self.status),
            "DRILL_PING_URL": "",
            "STUB_VERIFIER_LOG": str(self.log),
            "STUB_VERIFIER": "pass",
        }
        patcher = patch.dict(os.environ, environment)
        patcher.start()
        self.addCleanup(patcher.stop)

    def use_azure(self, **options):
        blobs = {OLDER: b"an older backup that must not be chosen", NEWEST: self.archive.read_bytes()}
        self.azure = FakeAzure(blobs, **options)
        # Patched at the drill's own seams, so pings still use real loopback HTTP.
        connection = self.azure.connection()
        for patcher in (
            patch.object(restore_drill.BlobReader, "connect", lambda reader, _deadline: connection(f"{reader.config.account}.blob.core.windows.net")),
            patch.object(backup, "AzureBlobTransport", self.azure.transport()),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def drill(self, *argv, verifier=True):
        arguments = list(argv) + ["--work-directory", str(self.work)]
        if verifier:
            arguments += ["--verifier-command", self.verifier]
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = restore_drill.main(arguments)
        return code, stdout.getvalue(), stderr.getvalue()

    def status_record(self):
        return json.loads((self.status / "drill.json").read_text())


class DrillTests(DrillFixture):
    def test_the_newest_backup_is_downloaded_checked_verified_and_reported(self):
        self.use_azure()
        with PingServer() as server:
            os.environ["DRILL_PING_URL"] = server.url("/drill-check")
            code, stdout, stderr = self.drill()
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertEqual(self.azure.downloads(), ["/game-backups/" + NEWEST])
        listings = [r["path"] for r in self.azure.requests if "comp=list" in r["path"]]
        self.assertEqual(len(listings), 2)
        self.assertIn("prefix=game%2F", listings[0])
        self.assertIn("marker=2", listings[1])
        self.assertTrue(all(r["headers"]["Authorization"] == "Bearer private.test.token" for r in self.azure.requests))
        self.assertTrue(all(r["headers"]["x-ms-version"] == "2023-11-03" for r in self.azure.requests))
        self.assertTrue(all(r["host"] == "exampleaccount.blob.core.windows.net" for r in self.azure.requests))
        self.assertEqual(self.azure.tokens, 1)
        seen = json.loads(self.log.read_text())
        # The verifier received the decompressed snapshot, inside the private work folder.
        self.assertEqual(seen["sha256"], hashlib.sha256(self.database).hexdigest())
        self.assertTrue(seen["argv"][0].startswith(str(self.work.resolve())))
        self.assertEqual(seen["argv"][1:3], ["--report", str(Path(seen["argv"][0]).parent / "scratch" / "report.json")])
        self.assertTrue(seen["work"])
        self.assertEqual(list(self.work.iterdir()), [])
        self.assertIn("SQLite integrity_check, foreign_key_check and required tables passed", stdout)
        self.assertIn("restore drill passed: 1 games in 1 rooms verified; from " + NEWEST, stdout)
        record = self.status_record()
        self.assertEqual((record["kind"], record["result"], record["reason"], record["blob"]), ("drill", "success", None, NEWEST))
        self.assertEqual((record["sha256"], record["restoredSha256"]), (self.written["sha256"], hashlib.sha256(self.database).hexdigest()))
        self.assertEqual((record["backupTimestamp"], record["rooms"], record["journalChain"]), ("2026-09-23T10:15:00Z", 1, "verified"))
        self.assertEqual(stat.S_IMODE((self.status / "drill.json").stat().st_mode), 0o644)
        [ping] = server.requests
        self.assertEqual(ping["path"], "/drill-check")
        self.assertTrue(ping["body"].startswith("restore drill passed: 1 games in 1 rooms verified"))

    def test_a_checksum_mismatch_stops_before_anything_is_opened(self):
        self.use_azure(metadata={NEWEST: "0" * 64})
        with PingServer() as server:
            os.environ["DRILL_PING_URL"] = server.url("/drill-check")
            code, _stdout, stderr = self.drill()
        self.assertEqual(code, 1)
        self.assertEqual(stderr, "restore drill FAILED: SHA-256 mismatch: this is not the archive the backup worker uploaded\n")
        self.assertFalse(self.log.exists())
        self.assertEqual(server.requests[0]["path"], "/drill-check/fail")
        self.assertEqual(self.status_record()["result"], "failure")
        self.assertEqual(list(self.work.iterdir()), [])

    def test_a_blob_without_the_workers_checksum_is_rejected(self):
        self.use_azure(metadata={NEWEST: ""})
        code, _stdout, stderr = self.drill()
        self.assertEqual(code, 1)
        self.assertIn("backup has no sha256 metadata", stderr)

    def local(self, name, content):
        path = self.root / name
        path.write_bytes(content)
        return self.drill("--file", str(path), "--sha256", hashlib.sha256(content).hexdigest(), "--no-report")

    def test_broken_archives_and_databases_fail_with_fixed_reasons(self):
        unrelated = self.root / "unrelated.sqlite"
        with closing(sqlite3.connect(unrelated)) as db:
            db.execute("CREATE TABLE notes (text TEXT)")
            db.commit()
        damaged = bytearray(self.database)
        damaged[4096:8192] = b"\xff" * 4096  # overwrite a whole b-tree page
        cases = [
            ("truncated.gz", self.archive.read_bytes()[:-20], "backup archive is not a complete gzip file"),
            ("plain.gz", b"not gzip at all", "backup archive is not a complete gzip file"),
            ("random.gz", gzip.compress(os.urandom(4096)), "restored file is not a readable SQLite database"),
            ("unrelated.gz", gzip.compress(unrelated.read_bytes()), "restored database is missing Catanova's required tables"),
            ("damaged.gz", gzip.compress(bytes(damaged)), "restored (database failed SQLite integrity_check|file is not a readable SQLite database)"),
        ]
        for name, content, expected in cases:
            with self.subTest(name):
                code, _stdout, stderr = self.local(name, content)
                self.assertEqual(code, 1)
                self.assertRegex(stderr, "^restore drill FAILED: " + expected)
                self.assertFalse(self.log.exists())
                self.assertEqual(list(self.work.iterdir()), [])

    def test_game_failures_fail_the_drill_naming_rooms_but_never_sending_them(self):
        os.environ["STUB_VERIFIER"] = "fail"
        with PingServer() as server:
            os.environ["DRILL_PING_URL"] = server.url("/drill-check")
            code, stdout, stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"])
        self.assertEqual(code, 1)
        self.assertIn("FAIL room-test", stdout)
        self.assertEqual(
            stderr,
            "restore drill FAILED: game verification failed for 1 of 1 rooms\n"
            "  room room-test: loadGame: STATE_INTEGRITY Saved game needs recovery\n",
        )
        record = self.status_record()
        self.assertEqual(record["failures"], [{"roomId": "room-test", "problems": ["loadGame: STATE_INTEGRITY Saved game needs recovery"]}])
        self.assertEqual(server.requests[0]["body"], "restore drill failed: game verification failed for 1 of 1 rooms")

    def test_a_verifier_that_crashes_or_hangs_fails_within_its_bound(self):
        os.environ["STUB_VERIFIER"] = "crash"
        code, stdout, stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], "--no-report")
        self.assertEqual(code, 1)
        self.assertIn("Verification could not run", stdout)
        self.assertEqual(stderr, "restore drill FAILED: game verifier could not verify the database (exit 2)\n")
        os.environ["STUB_VERIFIER"] = "hang"
        started = time.monotonic()
        with patch.object(restore_drill, "VERIFIER_TIMEOUT_SECONDS", 1):
            code, _stdout, stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], "--no-report")
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual((code, stderr), (1, "restore drill FAILED: game verification did not finish within 1 seconds\n"))
        self.assertEqual(list(self.work.iterdir()), [])

    def test_offline_files_need_a_checksum_and_never_contact_azure(self):
        class NoAzure:
            def __init__(self):
                raise AssertionError("a local file drill must not contact Azure")

        for argv, message in [
            (["--file", str(self.archive)], "--file needs --sha256"),
            (["--file", str(self.archive), "--sha256", "xyz"], "--sha256 must be 64 hexadecimal characters"),
            (["--sha256", "0" * 64], "--sha256 and --no-checksum apply only to --file"),
            (["--blob", "game/../../etc/passwd"], "--blob must be a backup name"),
            (["--list", "0"], "--list needs a positive count"),
        ]:
            with self.subTest(argv=argv):
                code, _stdout, stderr = self.drill(*argv)
                self.assertEqual(code, 2)
                self.assertIn(message, stderr)
        with patch.object(backup, "AzureBlobTransport", NoAzure):
            code, stdout, _stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"].upper(), "--no-report")
            self.assertEqual(code, 0, stdout)
            code, stdout, _stderr = self.drill("--file", str(self.archive), "--no-checksum", "--no-report")
            self.assertEqual(code, 0)
            self.assertIn("SHA-256 NOT checked (--no-checksum)", stdout)
        self.assertEqual(list(self.status.iterdir()), [])

    def test_output_keeps_the_verified_database_privately_and_never_overwrites(self):
        output = self.root / "verified.sqlite"
        code, stdout, _stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], "--output", str(output), "--no-report")
        self.assertEqual(code, 0, stdout)
        self.assertEqual(output.read_bytes(), self.database)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertIn(f"verified database kept at {output} (sha256 {hashlib.sha256(self.database).hexdigest()})", stdout)
        self.log.unlink()
        code, _stdout, stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], "--output", str(output))
        self.assertEqual((code, stderr), (2, "restore drill: --output must be a new file in an existing directory\n"))
        self.assertFalse(self.log.exists())

    def test_list_shows_the_newest_backups_first(self):
        self.use_azure()
        code, stdout, _stderr = self.drill("--list", "5", verifier=False)
        self.assertEqual(code, 0)
        lines = stdout.splitlines()
        self.assertTrue(lines[0].startswith("2026-09-23T10:15:00Z") and lines[0].endswith(NEWEST))
        self.assertTrue(lines[1].endswith(OLDER))
        self.assertEqual(lines[2], "2 backups in the container")
        self.assertEqual(self.azure.downloads(), [])

    def test_reporting_problems_never_change_the_verdict(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed = probe.getsockname()[1]
        os.environ["DRILL_PING_URL"] = f"http://127.0.0.1:{closed}/drill-check"
        self.status.rmdir()
        code, stdout, stderr = self.drill("--file", str(self.archive), "--sha256", self.written["sha256"])
        self.assertEqual((code, stderr), (0, ""))
        self.assertIn("restore drill ping not delivered: ConnectionRefusedError", stdout)
        self.assertIn("restore drill status not written", stdout)

    def test_stale_work_from_a_killed_run_is_removed(self):
        stale, fresh, other = self.work / "drill-oldrun1", self.work / "drill-newrun1", self.work / "keep-me"
        for folder in (stale, fresh, other):
            folder.mkdir()
            (folder / "restored.sqlite").write_bytes(b"private")
        old = time.time() - restore_drill.STALE_WORK_SECONDS - 60
        for folder in (stale, other):
            os.utime(folder, (old, old))
        self.assertEqual(self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], "--no-report")[0], 0)
        self.assertEqual(sorted(p.name for p in self.work.iterdir()), ["drill-newrun1", "keep-me"])


class DockerRunnerTests(DrillFixture):
    """The production path: the verifier runs inside the deployed image, isolated from everything."""

    def setUp(self):
        super().setUp()
        self.calls = []
        self.chowns = []

    def fake_run(self, timeout_on_run=False):
        calls = self.calls

        def run(command, **options):
            calls.append(command)
            if command[:2] == ["docker", "inspect"]:
                return subprocess.CompletedProcess(command, 0, ("sha256:" + "c" * 64 + "\n").encode(), b"")
            if command[:3] == ["docker", "image", "inspect"]:
                return subprocess.CompletedProcess(command, 0, b"8741e4459853277b41547e8cdc2d0a5c0d689eee\n", b"")
            if command[:2] == ["docker", "rm"]:
                return subprocess.CompletedProcess(command, 0, b"", b"")
            if timeout_on_run:
                raise subprocess.TimeoutExpired(command, options["timeout"])
            scratch = next(arg for arg in command if arg.endswith("target=/drill/scratch")).split(",")[1].removeprefix("source=")
            report = {"schema": 1, "result": "pass", "rooms": 1, "games": 1, "verified": 1, "failed": 0, "withoutGame": 0, "phases": {"actions": 1}, "journalChain": "verified", "failures": [], "details": []}
            Path(scratch, "report.json").write_text(json.dumps(report))
            return subprocess.CompletedProcess(command, 0, b"RESULT: PASS - 1 games in 1 rooms verified\n", None)

        return run

    def run_drill(self, timeout_on_run=False):
        with patch.object(restore_drill.subprocess, "run", self.fake_run(timeout_on_run)), patch.object(restore_drill.os, "geteuid", return_value=0), patch.object(restore_drill.os, "chown", lambda path, uid, gid: self.chowns.append((Path(path).name, uid, gid))):
            return self.drill("--file", str(self.archive), "--sha256", self.written["sha256"], verifier=False)

    def test_the_verifier_runs_in_the_game_image_without_network_or_privileges(self):
        code, stdout, stderr = self.run_drill()
        self.assertEqual((code, stderr), (0, ""), stdout)
        run = next(command for command in self.calls if command[:2] == ["docker", "run"])
        joined = " ".join(run)
        for flag in ["--rm", "--pull never", "--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges:true", "--user 65534:65534", "--no-healthcheck", "--entrypoint node"]:
            self.assertIn(flag, joined)
        mounts = [run[i + 1] for i, arg in enumerate(run) if arg == "--mount"]
        self.assertRegex(mounts[0], r"^type=bind,source=/.+/restored\.sqlite,target=/drill/restored\.sqlite,readonly$")
        self.assertRegex(mounts[1], r"^type=bind,source=/.+/scratch,target=/drill/scratch$")
        image = run.index("sha256:" + "c" * 64)
        self.assertEqual(run[image + 1 : image + 4], ["dist/scripts/verify-restored-games.js", "/drill/restored.sqlite", "--report"])
        self.assertNotIn("--allow-missing-journal-check", run)
        # nobody may write only the scratch folder; the restored file goes back to root-only.
        self.assertEqual(self.chowns, [("scratch", 65534, 65534), ("restored.sqlite", 0, 65534), ("restored.sqlite", 0, 0)])
        record = self.status_record()
        self.assertEqual((record["verifier"], record["image"], record["revision"]), ("image", "sha256:" + "c" * 64, "8741e4459853277b41547e8cdc2d0a5c0d689eee"))
        self.assertIn("with revision 8741e4459853", stdout)

    def test_a_timed_out_container_is_removed_by_name(self):
        code, _stdout, stderr = self.run_drill(timeout_on_run=True)
        self.assertEqual(code, 1)
        self.assertIn("game verification did not finish within", stderr)
        name = next(command for command in self.calls if command[:2] == ["docker", "run"])[4]
        self.assertTrue(name.startswith("catanova-drill-"))
        self.assertEqual(self.calls[-1], ["docker", "rm", "--force", name])


if __name__ == "__main__":
    unittest.main()
