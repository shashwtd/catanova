"""Run with: python3 -B -m unittest discover -s deploy/single-vm/monitoring -v"""

import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from unittest.mock import patch

import watchdog

HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc).timestamp()
REVISION = "8741e4459853277b41547e8cdc2d0a5c0d689eee"


def iso(moment):
    return datetime.fromtimestamp(moment, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Stub:
    """Loopback receiver for pings and webhooks that records method, path, headers and body."""

    def __init__(self, status=200):
        self.requests = []
        self.status = status
        stub = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                stub.requests.append({"path": self.path, "headers": dict(self.headers), "body": body.decode()})
                self.send_response(stub.status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exception):
        self.httpd.shutdown()
        self.httpd.server_close()

    def url(self, path):
        return f"http://127.0.0.1:{self.httpd.server_address[1]}{path}"

    def paths(self):
        return [request["path"] for request in self.requests]


class FakeDocker:
    """A `docker` executable on PATH that replays a canned answer and records its arguments."""

    def __init__(self, root):
        self.bin = root / "bin"
        self.bin.mkdir()
        self.spec = root / "docker.json"
        script = self.bin / "docker"
        script.write_text(
            f"#!{sys.executable}\n"
            "import json, os, sys, time\n"
            "spec_path = os.environ['FAKE_DOCKER_SPEC']\n"
            "spec = json.load(open(spec_path))\n"
            "json.dump(sys.argv[1:], open(spec_path + '.argv', 'w'))\n"
            "time.sleep(spec.get('sleep', 0))\n"
            "sys.stdout.write(spec.get('stdout', ''))\n"
            "sys.stderr.write(spec.get('stderr', ''))\n"
            "sys.exit(spec.get('code', 0))\n"
        )
        script.chmod(0o755)

    def answer(self, state=None, revision=REVISION, **spec):
        if state is not None:
            spec["stdout"] = json.dumps(state, separators=(",", ":")) + "\n" + revision + "\n"
        self.spec.write_text(json.dumps(spec))

    def argv(self):
        return json.loads(Path(str(self.spec) + ".argv").read_text())


def healthy_state(**overrides):
    state = {
        "Status": "running",
        "Running": True,
        "StartedAt": "2026-09-20T08:00:00.123456789Z",
        "Health": {"Status": "healthy", "Log": [{"Output": "health output with spaces"}]},
    }
    state.update(overrides)
    return state


def good_probe(days=60):
    return {"status": 200, "body": b'{"status":"ok","service":"catanova-connectivity"}', "notAfter": NOW + days * 86400}


class WatchdogTestCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.status = self.root / "status"
        self.status.mkdir()
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.docker = FakeDocker(self.root)
        self.docker.answer(healthy_state())
        environment = {"PATH": f"{self.docker.bin}{os.pathsep}{os.environ.get('PATH', '')}", "FAKE_DOCKER_SPEC": str(self.docker.spec)}
        patcher = patch.dict(os.environ, environment)
        patcher.start()
        self.addCleanup(patcher.stop)

    def config(self, **overrides):
        values = dict(domain="catanova.io", status_directory=self.status, state_directory=self.state, data_mount=Path("/"), os_mount=Path("/"))
        values.update(overrides)
        return watchdog.Config(**values)

    def write_backup_status(self, minutes_ago, result="success", reason=None):
        last = {"timestamp": iso(NOW - minutes_ago * 60), "blob": "game/x.sqlite.gz"} if minutes_ago is not None else None
        record = {"schema": 1, "kind": "backup", "timestamp": iso(NOW), "result": result, "reason": reason, "lastSuccess": last}
        (self.status / "backup.json").write_text(json.dumps(record))


class ConfigurationTests(unittest.TestCase):
    def test_environment_is_validated_before_anything_runs(self):
        config = watchdog.Config.from_environment(
            {"CATANOVA_DOMAIN": "catanova.io", "WATCHDOG_PING_URL": "https://hc-ping.com/uuid", "ALERT_WEBHOOK_URL": "https://ntfy.sh/catanova-a1b2", "ALERT_WEBHOOK_KIND": "discord", "WATCHDOG_DISK_PERCENT_MAX": "80", "STATE_DIRECTORY": "/var/lib/catanova-watchdog"}
        )
        self.assertEqual((config.domain, config.alert_kind, config.disk_percent_max, config.certificate_days_min, config.backup_age_minutes_max), ("catanova.io", "discord", 80, 14, 35))
        self.assertEqual((config.state_directory, config.status_directory), (Path("/var/lib/catanova-watchdog"), Path("/srv/catanova/status")))
        for bad in [
            {"CATANOVA_DOMAIN": "https://catanova.io"},
            {"CATANOVA_DOMAIN": "catanova.io/healthz"},
            {"CATANOVA_DOMAIN": ""},
            {"CATANOVA_DOMAIN": "catanova.io", "WATCHDOG_PING_URL": "http://hc-ping.com/uuid"},
            {"CATANOVA_DOMAIN": "catanova.io", "ALERT_WEBHOOK_URL": "https://user:secret@ntfy.sh/topic"},
            {"CATANOVA_DOMAIN": "catanova.io", "ALERT_WEBHOOK_KIND": "slack"},
            {"CATANOVA_DOMAIN": "catanova.io", "WATCHDOG_DISK_PERCENT_MAX": "100"},
            {"CATANOVA_DOMAIN": "catanova.io", "WATCHDOG_CERT_MIN_DAYS": "two weeks"},
        ]:
            with self.subTest(bad=bad), self.assertRaises(watchdog.WatchdogError):
                watchdog.Config.from_environment(bad)


class HttpsAndCertificateTests(WatchdogTestCase):
    def test_health_body_and_certificate_expiry_are_both_required(self):
        config = self.config()
        cases = [
            (good_probe(), ("ok", "ok")),
            ({"status": 503, "body": b'{"status":"draining"}', "notAfter": NOW + 90 * 86400}, ("fail", "ok")),
            ({"status": 200, "body": b"<html>proxy page</html>", "notAfter": NOW + 90 * 86400}, ("fail", "ok")),
            (good_probe(days=14), ("ok", "fail")),
            (good_probe(days=9.5), ("ok", "fail")),
            ({"error": "ConnectionRefusedError: [Errno 111] Connection refused", "certificateError": None}, ("fail", "skipped")),
            ({"error": "TLS certificate rejected: certificate has expired", "certificateError": "certificate has expired"}, ("fail", "fail")),
        ]
        for probe, expected in cases:
            with self.subTest(probe=probe):
                https = watchdog.check_https(config, probe)
                certificate = watchdog.check_certificate(config, probe, NOW)
                self.assertEqual((https.result, certificate.result), expected)
        draining = watchdog.check_https(config, cases[1][0])
        self.assertEqual(draining.detail, "https://catanova.io/healthz returned HTTP 503 (draining)")
        self.assertIn("in 9.5 days (limit 14)", watchdog.check_certificate(config, good_probe(9.5), NOW).detail)

    @unittest.skipUnless(shutil.which("openssl"), "openssl is needed to make a throwaway test certificate")
    def test_real_tls_probe_reads_the_served_certificate_and_health(self):
        cert, key = self.root / "cert.pem", self.root / "key.pem"
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
            check=True,
            capture_output=True,
        )

        class Health(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'{"status":"ok"}' if self.path == "/healthz" else b"{}"
                self.send_response(200 if self.path == "/healthz" else 404)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Health)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        config = self.config(domain="localhost", https_port=server.server_address[1], https_cafile=str(cert))
        probe = watchdog.probe_https(config)
        now = time.time()
        self.assertEqual(watchdog.check_https(config, probe).result, "ok")
        certificate = watchdog.check_certificate(config, probe, now)
        self.assertEqual(certificate.result, "ok")
        self.assertAlmostEqual(certificate.data["daysLeft"], 30, delta=1.1)
        self.assertEqual(watchdog.check_certificate(self.config(certificate_days_min=45), probe, now).result, "fail")
        # Without trusting the test CA the same server is rejected, as an expired certificate would be.
        untrusted = watchdog.probe_https(self.config(domain="localhost", https_port=server.server_address[1]))
        self.assertEqual(watchdog.check_certificate(config, untrusted, now).result, "fail")
        self.assertIn("TLS certificate rejected", watchdog.check_https(config, untrusted).detail)

    def test_a_stalled_connection_is_abandoned_within_the_bound(self):
        class Stalled:
            def __init__(self, *_args, **_kwargs):
                time.sleep(5)  # like DNS that ignores socket timeouts

        started = time.monotonic()
        with patch.object(watchdog.http.client, "HTTPSConnection", Stalled), patch.object(watchdog, "HTTPS_TIMEOUT_SECONDS", 0.1):
            probe = watchdog.probe_https(self.config())
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(watchdog.check_https(self.config(), probe).detail, "https://catanova.io/healthz unreachable: timed out")


class ContainerTests(WatchdogTestCase):
    def test_container_must_be_running_and_healthy(self):
        config = self.config()
        cases = [
            (healthy_state(), "ok", "catanova-game is running and healthy"),
            (healthy_state(Health={"Status": "unhealthy"}), "fail", "catanova-game health is unhealthy"),
            (healthy_state(Status="exited", Running=False), "fail", "catanova-game is exited"),
            (healthy_state(Status="restarting", Running=True), "fail", "catanova-game is restarting"),
            (healthy_state(Health={"Status": "starting"}, StartedAt=iso(NOW - 60)), "ok", "catanova-game started recently; health check starting"),
            (healthy_state(Health={"Status": "starting"}, StartedAt=iso(NOW - 600)), "fail", "catanova-game health is starting"),
            (healthy_state(Health=None), "fail", "catanova-game health is none"),
        ]
        for state, result, detail in cases:
            with self.subTest(detail=detail):
                self.docker.answer(state)
                check = watchdog.check_container(config, NOW)
                self.assertEqual((check.result, check.detail), (result, detail))
        self.docker.answer(healthy_state())
        check = watchdog.check_container(config, NOW)
        self.assertEqual(check.data, {"status": "running", "health": "healthy", "revision": REVISION})
        # Only the state and one label are requested: full inspect output includes the environment.
        self.assertEqual(
            self.docker.argv(),
            ["inspect", "--type", "container", "--format", '{{json .State}}\n{{index .Config.Labels "org.opencontainers.image.revision"}}', "catanova-game"],
        )

    def test_docker_errors_timeouts_and_absence_fail_the_check(self):
        config = self.config()
        self.docker.answer(code=1, stderr="Error response from daemon: No such container: catanova-game\n")
        self.assertEqual(watchdog.check_container(config, NOW).detail, "docker inspect catanova-game failed: Error response from daemon: No such container: catanova-game")
        self.docker.answer(stdout="not json\n")
        self.assertEqual(watchdog.check_container(config, NOW).detail, "docker inspect returned unreadable state")
        self.docker.answer(healthy_state(), revision="")
        self.assertEqual(watchdog.check_container(config, NOW).data["revision"], None)
        self.docker.answer(healthy_state(), sleep=5)
        with patch.object(watchdog, "DOCKER_TIMEOUT_SECONDS", 0.5):
            self.assertEqual(watchdog.check_container(config, NOW).detail, "docker inspect catanova-game timed out")
        with patch.dict(os.environ, {"PATH": str(self.root / "empty")}):
            self.assertEqual(watchdog.check_container(config, NOW).detail, "docker CLI not found")


class BackupAndDiskTests(WatchdogTestCase):
    def test_backup_age_uses_the_newest_success_even_after_a_failed_run(self):
        config = self.config()
        self.write_backup_status(10)
        self.assertEqual(watchdog.check_backup(config, NOW).result, "ok")
        self.write_backup_status(20, result="failure", reason="blob upload rejected (HTTP 503)")
        check = watchdog.check_backup(config, NOW)
        self.assertEqual((check.result, check.data), ("ok", {"ageMinutes": 20.0}))
        self.assertIn("latest run failed: blob upload rejected (HTTP 503)", check.detail)
        self.write_backup_status(50, result="failure", reason="backup exceeded its time limit")
        self.assertEqual(watchdog.check_backup(config, NOW).detail.split(";")[0], "newest successful backup is 50 minutes old (limit 35)")
        self.assertEqual(watchdog.check_backup(config, NOW).result, "fail")
        self.write_backup_status(None, result="failure", reason="x")
        self.assertEqual(watchdog.check_backup(config, NOW).detail, "no successful backup recorded yet")
        (self.status / "backup.json").unlink()
        self.assertEqual(watchdog.check_backup(config, NOW).result, "fail")

    def test_the_watchdog_reads_what_the_real_backup_worker_writes(self):
        spec = importlib.util.spec_from_file_location("catanova_backup", HERE.parent / "backup" / "backup.py")
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        result = {"blob": "game/2026/09/23/x.sqlite.gz", "bytes": 10, "snapshotBytes": 40, "sha256": "0" * 64}
        with redirect_stdout(io.StringIO()):
            backup.report_outcome(result, None, 1.0, {"CATANOVA_STATUS_DIRECTORY": str(self.status)})
            backup.report_outcome(None, "blob upload rejected (HTTP 503)", 1.0, {"CATANOVA_STATUS_DIRECTORY": str(self.status)})
        check = watchdog.check_backup(self.config(), time.time())
        self.assertEqual(check.result, "ok")
        self.assertLess(check.data["ageMinutes"], 1)
        self.assertIn("latest run failed: blob upload rejected (HTTP 503)", check.detail)

    def test_disk_use_matches_df_and_an_unmounted_data_disk_is_a_failure(self):
        class Stats:
            f_blocks, f_bfree, f_bavail, f_frsize = 1000, 300, 250, 4096

        with patch.object(watchdog.os, "statvfs", return_value=Stats()):
            self.assertAlmostEqual(watchdog.disk_percent("/"), 100 * 700 / 950)
        config = self.config()
        with patch.object(watchdog, "disk_percent", return_value=91.24):
            check = watchdog.check_disk("os-disk", "OS disk", Path("/"), config, False)
        self.assertEqual((check.result, check.detail, check.data), ("fail", "OS disk / is 91.2% used (limit 85%)", {"percent": 91.2}))
        with patch.object(watchdog, "disk_percent", return_value=40.0):
            self.assertEqual(watchdog.check_disk("data-disk", "data disk", Path("/"), config, True).result, "ok")
        # A plain folder is what /srv/catanova looks like when the managed disk did not mount.
        check = watchdog.check_disk("data-disk", "data disk", self.root, config, True)
        self.assertEqual((check.result, check.detail), ("fail", f"data disk {self.root} is not mounted"))


class AlertTests(WatchdogTestCase):
    def test_alert_decisions_follow_changes_with_six_hourly_reminders(self):
        decide = watchdog.alert_decision
        self.assertEqual(decide({}, ["backup"], NOW), "new")
        self.assertEqual(decide({"failing": ["backup"], "alertedAt": iso(NOW - 3600)}, ["backup"], NOW), None)
        self.assertEqual(decide({"failing": ["backup"], "alertedAt": iso(NOW - 6 * 3600)}, ["backup"], NOW), "reminder")
        self.assertEqual(decide({"failing": ["backup"], "alertedAt": iso(NOW - 60)}, ["backup", "https"], NOW), "new")
        self.assertEqual(decide({"failing": ["backup"], "alertedAt": iso(NOW)}, [], NOW), "recovered")
        self.assertEqual(decide({"failing": [], "alertedAt": None}, [], NOW), None)

    def test_pings_every_run_and_pushes_only_changes_in_text_and_discord_form(self):
        failing = [watchdog.Check("backup", "fail", "newest successful backup is 50 minutes old (limit 35)")]
        passing = [watchdog.Check("backup", "ok", "fine")]
        reason = "catanova.io: newest successful backup is 50 minutes old (limit 35)"
        with Stub() as stub:
            config = self.config(ping_url=stub.url("/uuid"), alert_url=stub.url("/catanova-topic"))
            with redirect_stdout(io.StringIO()):
                first = watchdog.notify(config, failing, reason, NOW)
                watchdog.notify(config, failing, reason, NOW + 300)
                watchdog.notify(config, passing, None, NOW + 600)
                watchdog.notify(config, passing, None, NOW + 900)
            self.assertEqual(first, ["watchdog ping delivered", "watchdog alert (new) delivered"])
            self.assertEqual(stub.paths(), ["/uuid/fail", "/catanova-topic", "/uuid/fail", "/uuid", "/catanova-topic", "/uuid"])
            alert, recovered = stub.requests[1], stub.requests[4]
            self.assertEqual((alert["headers"]["Title"], alert["headers"]["Priority"], alert["body"]), ("Catanova alert", "high", reason))
            self.assertEqual((recovered["headers"]["Title"], recovered["body"]), ("Catanova recovered", "catanova.io: all 1 checks pass again."))
            self.assertEqual(stub.requests[0]["body"], reason)
            self.assertEqual(json.loads((self.state / "alert-state.json").read_text()), {"failing": [], "alertedAt": None})
        with Stub() as stub:
            config = self.config(alert_url=stub.url("/api/webhooks/1/token"), alert_kind="discord", state_directory=None)
            with redirect_stdout(io.StringIO()):
                watchdog.notify(config, failing, reason, NOW)
            payload = json.loads(stub.requests[0]["body"])
            self.assertEqual(payload, {"content": "**Catanova alert**\n" + reason, "allowed_mentions": {"parse": []}})
            self.assertEqual(stub.requests[0]["headers"]["Content-Type"], "application/json")

    def test_an_undelivered_alert_is_sent_again_on_the_next_run(self):
        failing = [watchdog.Check("https", "fail", "down")]
        with Stub(status=500) as stub:
            config = self.config(alert_url=stub.url("/topic"))
            lines = watchdog.notify(config, failing, "catanova.io: down", NOW)
            self.assertEqual(lines, ["watchdog alert (new) not delivered: HTTP 500"])
            stub.status = 200
            self.assertEqual(watchdog.notify(config, failing, "catanova.io: down", NOW + 300), ["watchdog alert (new) delivered"])
            self.assertEqual(watchdog.notify(config, failing, "catanova.io: down", NOW + 600), [])
        self.assertEqual(stat.S_IMODE((self.state / "alert-state.json").stat().st_mode), 0o600)


class MainTests(WatchdogTestCase):
    def run_main(self, config, *argv, environ=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = watchdog.main(argv, config=config, environ=environ)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_a_healthy_run_writes_status_and_pings_success(self):
        self.write_backup_status(7)
        with Stub() as stub, patch.object(watchdog, "probe_https", return_value=good_probe(61)), patch.object(watchdog, "disk_percent", side_effect=[23.4, 41.6]), patch.object(watchdog.time, "time", return_value=NOW):
            code, stdout, _stderr = self.run_main(self.config(ping_url=stub.url("/uuid"), alert_url=stub.url("/topic")))
        self.assertEqual(code, 0, stdout)
        self.assertIn("watchdog result: success (6 checks", stdout)
        self.assertEqual(stub.paths(), ["/uuid"])
        self.assertEqual(stub.requests[0]["body"], "catanova.io: all 6 checks passed")
        record = json.loads((self.status / "watchdog.json").read_text())
        self.assertEqual(
            {key: record[key] for key in ("kind", "result", "reason", "domain", "revision", "diskPercent", "certificateDaysLeft", "lastBackupAgeMinutes", "container")},
            {"kind": "watchdog", "result": "success", "reason": None, "domain": "catanova.io", "revision": REVISION, "diskPercent": {"data": 23.4, "os": 41.6}, "certificateDaysLeft": 61.0, "lastBackupAgeMinutes": 7.0, "container": {"status": "running", "health": "healthy"}},
        )
        self.assertEqual([check["result"] for check in record["checks"]], ["ok"] * 6)
        self.assertEqual(stat.S_IMODE((self.status / "watchdog.json").stat().st_mode), 0o644)

    def test_a_failing_run_pings_fail_with_every_reason_and_alerts(self):
        self.write_backup_status(52)
        self.docker.answer(healthy_state(Health={"Status": "unhealthy"}))
        with Stub() as stub, patch.object(watchdog, "probe_https", return_value=good_probe(9)), patch.object(watchdog, "disk_percent", return_value=30.0), patch.object(watchdog.time, "time", return_value=NOW):
            code, stdout, _stderr = self.run_main(self.config(ping_url=stub.url("/uuid"), alert_url=stub.url("/topic")))
        self.assertEqual(code, 1)
        reason = "catanova.io: TLS certificate for catanova.io expires 2026-10-02, in 9.0 days (limit 14); catanova-game health is unhealthy; newest successful backup is 52 minutes old (limit 35)"
        self.assertEqual([(r["path"], r["body"]) for r in stub.requests], [("/uuid/fail", reason), ("/topic", reason)])
        record = json.loads((self.status / "watchdog.json").read_text())
        self.assertEqual((record["result"], record["reason"]), ("failure", reason))
        self.assertIn("watchdog fail    backup", stdout)

    def test_check_only_and_test_alert_send_nothing_unexpected(self):
        self.write_backup_status(7)
        # The backup and certificate are dated from NOW, so the check must run at NOW too.
        with Stub() as stub, patch.object(watchdog, "probe_https", return_value=good_probe()), patch.object(watchdog, "disk_percent", return_value=30.0), patch.object(watchdog.time, "time", return_value=NOW):
            config = self.config(ping_url=stub.url("/uuid"), alert_url=stub.url("/topic"))
            self.assertEqual(self.run_main(config, "--check-only")[0], 0)
            self.assertEqual(stub.requests, [])
            self.assertFalse((self.status / "watchdog.json").exists())
            code, stdout, _stderr = self.run_main(config, "--test-alert")
        self.assertEqual((code, stdout), (0, "watchdog test alert delivered\n"))
        self.assertEqual(stub.paths(), ["/topic"])
        self.assertEqual(stub.requests[0]["headers"]["Title"], "Catanova test alert")

    def test_misconfiguration_is_reported_to_the_check_itself(self):
        with Stub() as stub:
            code, _stdout, stderr = self.run_main(None, environ={"CATANOVA_DOMAIN": "https://catanova.io", "WATCHDOG_PING_URL": stub.url("/uuid")})
        self.assertEqual(code, 2)
        self.assertEqual(stderr, "watchdog misconfigured: CATANOVA_DOMAIN must be one public hostname, such as catanova.io\n")
        self.assertEqual(stub.paths(), ["/uuid/fail"])

    def test_the_whole_run_has_a_deadline(self):
        def slow(_config, _now):
            time.sleep(5)

        with patch.object(watchdog, "CHECK_SECONDS", 1), patch.object(watchdog, "run_checks", slow):
            started = time.monotonic()
            code, stdout, _stderr = self.run_main(self.config())
        self.assertEqual(code, 1)
        self.assertLess(time.monotonic() - started, 3)
        self.assertIn("checks did not finish within 1 seconds", stdout)


if __name__ == "__main__":
    unittest.main()
