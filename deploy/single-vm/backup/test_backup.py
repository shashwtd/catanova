"""Run with: python3 -B -m unittest discover -s deploy/single-vm/backup -v"""

import base64
import gzip
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import stat
import tempfile
import threading
import time
import unittest
from contextlib import closing, redirect_stderr, redirect_stdout
from unittest.mock import patch

import backup


class FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status = status
        self.body = io.BytesIO(body)
        self.headers = headers or {}

    def read(self, size=-1):
        return self.body.read(size)

    def getheader(self, name, default=None):
        return self.headers.get(name, default)


class FakeNetwork:
    """Capture exact requests while prohibiting any real metadata/cloud call."""

    def __init__(self, token_status=200, upload_status=201, checksum_ok=True):
        self.token_status = token_status
        self.upload_status = upload_status
        self.checksum_ok = checksum_ok
        self.requests = []
        self.closed = 0
        self.token = "private.test.token"
        self.token_payload = json.dumps(
            {"access_token": self.token, "token_type": "Bearer", "expires_on": int(time.time()) + 3600}
        ).encode()

    def factory(self, kind):
        network = self

        class Connection:
            def __init__(self, host, timeout):
                self.host = host
                self.timeout = timeout

            def request(self, method, path, body=None, headers=None):
                if body is not None:
                    # The upload streams a private file rather than reading the DB into RAM.
                    network.archive_path = Path(body.name)
                    network.archive_mode = network.archive_path.stat().st_mode & 0o777
                    network.directory_mode = network.archive_path.parent.stat().st_mode & 0o777
                    body = body.read()
                self.call = dict(kind=kind, host=self.host, method=method, path=path, body=body, headers=headers)
                network.requests.append(self.call)

            def getresponse(self):
                if kind == "imds":
                    return FakeResponse(network.token_status, network.token_payload)
                digest = base64.b64encode(hashlib.md5(self.call["body"], usedforsecurity=False).digest()).decode()
                return FakeResponse(
                    network.upload_status,
                    b"private server diagnostics must not be printed",
                    {"Content-MD5": digest if network.checksum_ok else "incorrect"},
                )

            def close(self):
                network.closed += 1

        return Connection


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = self.root / "probe.sqlite"
        self.temp = self.root / "snapshots"
        self.temp.mkdir()
        self.config = backup.Config(self.database, "exampleaccount", "game-backups")
        self.network = FakeNetwork()
        self.http_patch = patch.object(backup.http.client, "HTTPConnection", self.network.factory("imds"))
        self.https_patch = patch.object(backup.http.client, "HTTPSConnection", self.network.factory("blob"))
        self.http_patch.start()
        self.https_patch.start()
        self.addCleanup(self.http_patch.stop)
        self.addCleanup(self.https_patch.stop)

    def make_game(self):
        writer = sqlite3.connect(self.database)
        self.addCleanup(writer.close)
        writer.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA wal_autocheckpoint=0;
            CREATE TABLE rooms (id TEXT PRIMARY KEY, revision INTEGER);
            CREATE TABLE games (room_id TEXT PRIMARY KEY, state TEXT);
            CREATE TABLE game_events (room_id TEXT, revision INTEGER, state TEXT);
            CREATE TABLE game_receipts (room_id TEXT, command_id TEXT, revision INTEGER);
        """)
        writer.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        # All of this committed state remains in the WAL, not in the main DB file.
        with writer:
            writer.execute("INSERT INTO rooms VALUES ('room-test', 7)")
            writer.execute("INSERT INTO games VALUES ('room-test', ?)", ('{"road":"kept"}',))
            writer.execute("INSERT INTO game_events VALUES ('room-test', 7, ?)", ('{"road":"kept"}',))
            writer.execute("INSERT INTO game_receipts VALUES ('room-test', 'accepted-command', 7)")
        self.assertGreater(Path(str(self.database) + "-wal").stat().st_size, 0)
        return writer

    def run_backup(self):
        return backup.run_backup(self.config, temporary_root=self.temp)

    def test_wal_state_events_and_receipts_survive_as_one_standalone_snapshot(self):
        writer = self.make_game()
        # An in-flight, uncommitted move must not enter the backup.
        writer.execute("INSERT INTO game_receipts VALUES ('room-test', 'uncommitted', 8)")
        result = self.run_backup()
        upload = self.network.requests[1]
        restored = self.root / "restored.sqlite"
        restored.write_bytes(gzip.decompress(upload["body"]))
        with closing(sqlite3.connect(restored)) as reader:
            self.assertEqual(reader.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(reader.execute("SELECT revision FROM rooms").fetchall(), [(7,)])
            self.assertEqual(reader.execute("SELECT state FROM games").fetchone(), ('{"road":"kept"}',))
            self.assertEqual(reader.execute("SELECT revision, state FROM game_events").fetchall(), [(7, '{"road":"kept"}')])
            self.assertEqual(reader.execute("SELECT command_id, revision FROM game_receipts").fetchall(), [("accepted-command", 7)])
            self.assertEqual(reader.execute("PRAGMA journal_mode").fetchone(), ("delete",))
        writer.rollback()
        self.assertEqual(upload["headers"]["x-ms-meta-sha256"], hashlib.sha256(upload["body"]).hexdigest())
        self.assertEqual(result["bytes"], len(upload["body"]))
        self.assertEqual((self.network.archive_mode, self.network.directory_mode), (0o600, 0o700))
        self.assertFalse(self.network.archive_path.exists())
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_upload_uses_scoped_storage_token_https_and_create_only_unique_names(self):
        self.make_game()
        first = self.run_backup()
        second = self.run_backup()
        token_request, upload = self.network.requests[:2]
        self.assertEqual(token_request["host"], "169.254.169.254")
        self.assertEqual(token_request["headers"], {"Metadata": "true"})
        self.assertIn("resource=https%3A%2F%2Fstorage.azure.com%2F", token_request["path"])
        self.assertEqual((upload["kind"], upload["method"], upload["host"]), ("blob", "PUT", "exampleaccount.blob.core.windows.net"))
        self.assertEqual(upload["headers"]["Authorization"], "Bearer " + self.network.token)
        self.assertEqual(upload["headers"]["If-None-Match"], "*")
        self.assertEqual(upload["headers"]["Content-Length"], str(len(upload["body"])))
        self.assertRegex(first["blob"], r"^game/\d{4}/\d{2}/\d{2}/.+\.sqlite\.gz$")
        self.assertNotEqual(first["blob"], second["blob"])
        self.assertEqual(self.network.closed, 4)

    def test_missing_database_does_not_create_a_database_or_contact_azure(self):
        with self.assertRaisesRegex(backup.BackupError, "missing or empty"):
            self.run_backup()
        self.assertFalse(self.database.exists())
        self.assertEqual(self.network.requests, [])
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_empty_or_unrelated_database_is_not_uploaded(self):
        self.database.touch()
        with self.assertRaises(backup.BackupError):
            self.run_backup()
        with closing(sqlite3.connect(self.database)) as other:
            other.execute("CREATE TABLE unrelated (value TEXT)")
        with self.assertRaisesRegex(backup.BackupError, "not a Catanova"):
            self.run_backup()
        self.assertEqual(self.network.requests, [])
        self.assertEqual(list(self.temp.iterdir()), [])

    def test_upload_failure_and_checksum_mismatch_fail_and_clean_up(self):
        self.make_game()
        for status, checksum_ok in [(503, True), (301, True), (201, False)]:
            with self.subTest(status=status, checksum_ok=checksum_ok):
                self.network.upload_status = status
                self.network.checksum_ok = checksum_ok
                with self.assertRaises(backup.BackupError) as caught:
                    self.run_backup()
                self.assertNotIn(self.network.token, str(caught.exception))
                self.assertNotIn("private server diagnostics", str(caught.exception))
                self.assertEqual(list(self.temp.iterdir()), [])

    def test_identity_errors_never_upload_or_expose_response(self):
        self.make_game()
        for status, payload in [
            (403, self.network.token.encode()),
            (302, self.network.token.encode()),
            (200, b"not-json-private-response"),
            (200, b"x" * 65537),
            (200, json.dumps({"access_token": "bad\r\nheader", "expires_on": int(time.time()) + 999, "token_type": "Bearer"}).encode()),
            (200, json.dumps({"access_token": self.network.token, "expires_on": 1, "token_type": "Bearer"}).encode()),
        ]:
            with self.subTest(status=status, size=len(payload)):
                self.network.token_status, self.network.token_payload = status, payload
                with self.assertRaises(backup.BackupError) as caught:
                    self.run_backup()
                self.assertNotIn(self.network.token, str(caught.exception))
                self.assertEqual(list(self.temp.iterdir()), [])
        self.assertTrue(all(request["kind"] == "imds" for request in self.network.requests))

    def test_account_endpoint_injection_is_rejected_before_network(self):
        for account, container in [("example.blob.evil", "valid"), ("goodaccount", "../escape"), ("goodaccount", "two--hyphens")]:
            with patch.dict(os.environ, {"CATANOVA_BACKUP_DATABASE_PATH": str(self.database), "AZURE_STORAGE_ACCOUNT": account, "AZURE_STORAGE_CONTAINER": container}):
                with self.assertRaises(backup.BackupError):
                    backup.Config.from_environment()
        self.assertEqual(self.network.requests, [])

    def test_deadline_and_unexpected_errors_are_safe(self):
        self.make_game()
        with self.assertRaisesRegex(backup.BackupError, "time limit"):
            backup.make_snapshot(self.database, self.temp / "too-late.sqlite", time.monotonic() - 1)
        stderr = io.StringIO()
        # Isolated: a test run on the VM must never overwrite real status or ping a real check.
        isolated = {"CATANOVA_STATUS_DIRECTORY": str(self.root / "status"), "BACKUP_PING_URL": ""}
        with patch.object(backup, "run_backup", side_effect=OSError("private token must not leak")), patch.object(backup.Config, "from_environment", return_value=self.config), patch.dict(os.environ, isolated), redirect_stderr(stderr), redirect_stdout(io.StringIO()):
            self.assertEqual(backup.main(), 1)
        self.assertEqual(stderr.getvalue(), "backup failed: OSError\n")


def create_game_database(path):
    """A WAL game database whose committed rows are still only in the WAL, as while the game runs."""
    writer = sqlite3.connect(path)
    writer.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        CREATE TABLE rooms (id TEXT PRIMARY KEY, revision INTEGER);
        CREATE TABLE games (room_id TEXT PRIMARY KEY, state TEXT);
        CREATE TABLE game_events (room_id TEXT, revision INTEGER, state TEXT);
        CREATE TABLE game_receipts (room_id TEXT, command_id TEXT, revision INTEGER);
    """)
    writer.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    with writer:
        writer.execute("INSERT INTO rooms VALUES ('room-test', 7)")
        writer.execute("INSERT INTO games VALUES ('room-test', '{\"road\":\"kept\"}')")
    return writer


class PingServer:
    """A loopback stand-in for a healthchecks.io-style endpoint that records every request."""

    def __init__(self, status=200, delay=0):
        self.requests = []
        self.status = status
        self.delay = delay
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                server.requests.append({"method": self.command, "path": self.path, "body": body.decode(), "type": self.headers.get("Content-Type")})
                time.sleep(server.delay)
                self.send_response(server.status)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"OK")

            do_GET = do_POST

            def log_message(self, *_args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        # A deliberately slow handler must not hold up the test, nor print the client's hang-up.
        self.httpd.block_on_close = False
        self.httpd.handle_error = lambda _request, _address: None
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exception):
        self.httpd.shutdown()
        self.httpd.server_close()

    def url(self, path="/0c9e1a52-check"):
        return f"http://127.0.0.1:{self.httpd.server_address[1]}{path}"


class FakeTransport:
    """Azure stand-in for notification tests; the upload protocol itself is tested above."""

    uploads = []
    fail = False

    def get_token(self):
        return "private.test.token"

    def upload(self, _config, archive, blob_name, _token, _md5, _sha256, _deadline):
        if FakeTransport.fail:
            raise backup.BackupError("blob upload rejected (HTTP 503)")
        FakeTransport.uploads.append((blob_name, archive.read_bytes()))


class NotificationAndLocalOutputTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = self.root / "probe.sqlite"
        self.status = self.root / "status"
        self.status.mkdir()
        self.writer = create_game_database(self.database)
        self.addCleanup(self.writer.close)
        FakeTransport.uploads, FakeTransport.fail = [], False
        self.environment = {
            "CATANOVA_BACKUP_DATABASE_PATH": str(self.database),
            "AZURE_STORAGE_ACCOUNT": "exampleaccount",
            "AZURE_STORAGE_CONTAINER": "game-backups",
            "CATANOVA_STATUS_DIRECTORY": str(self.status),
            "BACKUP_PING_URL": "",
        }
        for patcher in (patch.dict(os.environ, self.environment), patch.object(backup, "AzureBlobTransport", FakeTransport)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_main(self, *argv):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = backup.main(argv)
        return code, stdout.getvalue(), stderr.getvalue()

    def status_record(self):
        return json.loads((self.status / "backup.json").read_text())

    def test_success_pings_the_check_and_records_a_world_readable_status(self):
        with PingServer() as server:
            os.environ["BACKUP_PING_URL"] = server.url()
            code, stdout, stderr = self.run_main()
        self.assertEqual((code, stderr), (0, ""))
        self.assertIn("backup ping delivered", stdout)
        [request] = server.requests
        self.assertEqual((request["method"], request["path"]), ("POST", "/0c9e1a52-check"))
        self.assertEqual(request["type"], "text/plain; charset=utf-8")
        blob, archive = FakeTransport.uploads[0]
        self.assertIn(blob, request["body"])
        self.assertIn(hashlib.sha256(archive).hexdigest(), request["body"])
        record = self.status_record()
        self.assertEqual((record["kind"], record["result"], record["reason"], record["blob"]), ("backup", "success", None, blob))
        self.assertEqual(record["archiveBytes"], len(archive))
        self.assertEqual(record["snapshotBytes"], len(gzip.decompress(archive)))
        self.assertEqual(record["lastSuccess"]["timestamp"], record["timestamp"])
        self.assertRegex(record["timestamp"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(stat.S_IMODE((self.status / "backup.json").stat().st_mode), 0o644)
        self.assertEqual(sorted(p.name for p in self.status.iterdir()), ["backup.json"])
        self.assertNotIn("private.test.token", (self.status / "backup.json").read_text())

    def test_failure_pings_fail_with_the_reason_and_keeps_the_last_success(self):
        with PingServer() as server:
            os.environ["BACKUP_PING_URL"] = server.url()
            self.assertEqual(self.run_main()[0], 0)
            last_success = self.status_record()["lastSuccess"]
            os.environ["CATANOVA_BACKUP_DATABASE_PATH"] = str(self.root / "missing.sqlite")
            code, _stdout, stderr = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(stderr, "backup failed: game database is missing or empty; no backup uploaded\n")
        failure = server.requests[1]
        self.assertEqual(failure["path"], "/0c9e1a52-check/fail")
        self.assertEqual(failure["body"], "backup failed: game database is missing or empty; no backup uploaded")
        record = self.status_record()
        self.assertEqual((record["result"], record["blob"], record["archiveBytes"]), ("failure", None, None))
        self.assertEqual(record["reason"], "game database is missing or empty; no backup uploaded")
        self.assertEqual(record["lastSuccess"], last_success)

    def test_upload_failure_is_reported_to_the_fail_endpoint(self):
        FakeTransport.fail = True
        with PingServer() as server:
            os.environ["BACKUP_PING_URL"] = server.url("/check/")
            code, _stdout, _stderr = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(server.requests[0]["path"], "/check/fail")
        self.assertEqual(server.requests[0]["body"], "backup failed: blob upload rejected (HTTP 503)")
        self.assertIsNone(self.status_record()["lastSuccess"])

    def test_ping_problems_never_turn_a_good_backup_into_a_failure(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        cases = [
            ("rejected", 500, 0, None, r"HTTP 500"),
            ("unreachable", 200, 0, f"http://127.0.0.1:{closed_port}/check", r"ConnectionRefusedError"),
            ("slow", 200, 2, None, r"TimeoutError|timed out"),
            ("plain http elsewhere", 200, 0, "http://hc-ping.example/check", r"ping URL must be an https:// URL"),
        ]
        for name, status, delay, url, expected in cases:
            with self.subTest(name), PingServer(status, delay) as server, patch.object(backup, "PING_TIMEOUT_SECONDS", 0.3):
                os.environ["BACKUP_PING_URL"] = url or server.url()
                started = time.monotonic()
                code, stdout, stderr = self.run_main()
                self.assertEqual((code, stderr), (0, ""))
                self.assertRegex(stdout, r"backup ping not delivered: (%s)" % expected)
                self.assertLess(time.monotonic() - started, 3)
                self.assertEqual(self.status_record()["result"], "success")
                self.assertNotIn(os.environ["BACKUP_PING_URL"], stdout)

    def test_a_ping_stalled_outside_the_socket_timeout_is_still_abandoned(self):
        class Stalled:
            # Like a DNS lookup that ignores socket timeouts: only the thread bound can stop it.
            def __init__(self, *_args, **_kwargs):
                time.sleep(5)

            def close(self):
                pass

        started = time.monotonic()
        with patch.object(backup.http.client, "HTTPSConnection", Stalled):
            self.assertEqual(backup.ping("https://hc-ping.com/check", False, "ok", timeout=0.2), "timed out")
        self.assertLess(time.monotonic() - started, 2)

    def test_ping_urls_must_be_https_without_credentials(self):
        for url in ["https://hc-ping.com/5f0c-uuid", "https://hc-ping.com/key/slug?create=0", "http://127.0.0.1:8000/x"]:
            backup.parse_ping_url(url)
        for url in ["http://hc-ping.com/x", "https://user:pw@hc-ping.com/x", "https://hc-ping.com/x#y", "ftp://hc-ping.com/x", "https://hc-ping.com/a b", "https://hc-ping.com/x\n", "https:///x", "https://hc-ping.com:0/x"]:
            with self.subTest(url=url), self.assertRaises(backup.BackupError):
                backup.parse_ping_url(url)

    def test_a_missing_status_directory_is_reported_but_not_fatal(self):
        self.status.rmdir()
        code, stdout, _stderr = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("backup status not written: " + str(self.status) + " does not exist", stdout)

    def test_local_output_is_the_real_snapshot_without_azure_ping_or_status(self):
        class NoAzure:
            def __init__(self):
                raise AssertionError("a local archive must never contact Azure")

        output = self.root / "drill.sqlite.gz"
        with PingServer() as server, patch.object(backup, "AzureBlobTransport", NoAzure):
            os.environ["BACKUP_PING_URL"] = server.url()
            code, stdout, stderr = self.run_main("--local-output", str(output))
            again = self.run_main("--local-output", str(output))
            nowhere = self.run_main("--local-output", str(self.root / "absent" / "x.gz"))
        self.assertEqual((code, stderr), (0, ""))
        written = json.loads(stdout.removeprefix("backup written "))
        self.assertEqual(written["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        restored = self.root / "restored.sqlite"
        restored.write_bytes(gzip.decompress(output.read_bytes()))
        with closing(sqlite3.connect(restored)) as reader:
            # The committed rows were only in the live WAL; the archive is self-contained.
            self.assertEqual(reader.execute("SELECT revision FROM rooms").fetchall(), [(7,)])
            self.assertEqual(reader.execute("PRAGMA journal_mode").fetchone(), ("delete",))
        self.assertEqual(again[:1], (1,))
        self.assertEqual(again[2], "backup failed: local output already exists; choose a new file name\n")
        self.assertEqual(written["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(nowhere[2], "backup failed: local output directory does not exist\n")
        self.assertEqual(server.requests, [])
        self.assertEqual(list(self.status.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
