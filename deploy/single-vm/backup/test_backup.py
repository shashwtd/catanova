"""Run with: python3 -B -m unittest discover -s deploy/single-vm/backup -v"""

import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing, redirect_stderr
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
        with patch.object(backup, "run_backup", side_effect=OSError("private token must not leak")), patch.object(backup.Config, "from_environment", return_value=self.config), redirect_stderr(stderr):
            self.assertEqual(backup.main(), 1)
        self.assertEqual(stderr.getvalue(), "backup failed: OSError\n")


if __name__ == "__main__":
    unittest.main()
