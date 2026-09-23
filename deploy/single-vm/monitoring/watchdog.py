#!/usr/bin/env python3
"""Five-minute production watchdog for the single Catanova VM.

    watchdog.py                run every check, write watchdog.json, ping, alert on a change
    watchdog.py --check-only   run the checks and print them; no status, ping or alert
    watchdog.py --test-alert   send one test message to ALERT_WEBHOOK_URL

Checks: public HTTPS /healthz, the game container's Docker health, the age of the newest
successful backup, data- and OS-disk use, and the TLS certificate's remaining days. Every
network call and subprocess has a short bound, so a run never hangs. Python 3.9+ stdlib only.
Exit status: 0 all checks passed, 1 a check failed, 2 the watchdog is misconfigured.
"""

import argparse
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import ssl
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlsplit


CHECK_SECONDS = 60
HTTPS_TIMEOUT_SECONDS = 10
DOCKER_TIMEOUT_SECONDS = 15
NOTIFY_TIMEOUT_SECONDS = 10
ALERT_REPEAT_SECONDS = 6 * 3600
HEALTH_STARTING_GRACE_SECONDS = 180
STATUS_SCHEMA = 1
DEFAULT_STATUS_DIRECTORY = "/srv/catanova/status"
REVISION_LABEL = "org.opencontainers.image.revision"


class WatchdogError(Exception):
    """Fixed, credential-free configuration messages."""


class CheckTimeout(Exception):
    pass


def number(environ, name, default, low, high):
    raw = environ.get(name, "")
    if raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        value = None
    if value is None or not low <= value <= high:
        raise WatchdogError(f"{name} must be a number from {low} to {high}")
    return value


def parse_notify_url(value, name):
    """HTTPS without credentials; plain HTTP is accepted only for loopback tests."""
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
        raise WatchdogError(f"{name} must be an https:// URL without credentials")
    return parts


@dataclass(frozen=True)
class Config:
    domain: str
    ping_url: str = ""
    alert_url: str = ""
    alert_kind: str = "text"
    disk_percent_max: float = 85
    certificate_days_min: float = 14
    backup_age_minutes_max: float = 35
    status_directory: Path = Path(DEFAULT_STATUS_DIRECTORY)
    state_directory: Path = None
    container: str = "catanova-game"
    data_mount: Path = Path("/srv/catanova")
    os_mount: Path = Path("/")
    https_port: int = 443
    https_cafile: str = None

    @classmethod
    def from_environment(cls, environ=None):
        environ = os.environ if environ is None else environ
        domain = environ.get("CATANOVA_DOMAIN", "")
        if not re.fullmatch(r"(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
            raise WatchdogError("CATANOVA_DOMAIN must be one public hostname, such as catanova.io")
        ping_url = environ.get("WATCHDOG_PING_URL", "")
        alert_url = environ.get("ALERT_WEBHOOK_URL", "")
        for name, value in (("WATCHDOG_PING_URL", ping_url), ("ALERT_WEBHOOK_URL", alert_url)):
            if value:
                parse_notify_url(value, name)
        alert_kind = environ.get("ALERT_WEBHOOK_KIND", "") or "text"
        if alert_kind not in ("text", "discord"):
            raise WatchdogError("ALERT_WEBHOOK_KIND must be text or discord")
        container = environ.get("WATCHDOG_CONTAINER", "") or "catanova-game"
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", container):
            raise WatchdogError("WATCHDOG_CONTAINER must be a container name")
        state = environ.get("STATE_DIRECTORY", "")  # set by systemd's StateDirectory=
        return cls(
            domain=domain,
            ping_url=ping_url,
            alert_url=alert_url,
            alert_kind=alert_kind,
            disk_percent_max=number(environ, "WATCHDOG_DISK_PERCENT_MAX", 85, 1, 99),
            certificate_days_min=number(environ, "WATCHDOG_CERT_MIN_DAYS", 14, 0, 365),
            backup_age_minutes_max=number(environ, "WATCHDOG_BACKUP_MAX_AGE_MINUTES", 35, 1, 10080),
            status_directory=Path(environ.get("CATANOVA_STATUS_DIRECTORY") or DEFAULT_STATUS_DIRECTORY),
            state_directory=Path(state.split(":")[0]) if state else None,
            container=container,
        )


@dataclass
class Check:
    name: str
    result: str  # "ok", "fail" or "skipped"
    detail: str
    data: dict = field(default_factory=dict)


def bounded(call, seconds, timed_out):
    """Run call() in a daemon thread; socket timeouts do not bound a stalled DNS lookup."""
    outcome = {}

    def run():
        try:
            outcome["value"] = call()
        except Exception as error:  # the caller's call() already maps expected errors
            outcome["value"] = timed_out(type(error).__name__)

    worker = threading.Thread(target=run, name="bounded", daemon=True)
    worker.start()
    worker.join(seconds)
    return outcome["value"] if "value" in outcome else timed_out("timed out")


def short(text, limit=160):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def probe_https(config):
    """One TLS connection: the certificate's expiry, then GET /healthz on the same connection."""

    def failed(error, certificate_error=None):
        return {"error": error, "certificateError": certificate_error}

    def attempt():
        context = ssl.create_default_context(cafile=config.https_cafile)
        connection = http.client.HTTPSConnection(
            config.domain, config.https_port, timeout=HTTPS_TIMEOUT_SECONDS, context=context
        )
        try:
            connection.connect()
            certificate = connection.sock.getpeercert()
            not_after = ssl.cert_time_to_seconds(certificate["notAfter"])
            connection.request(
                "GET", "/healthz", headers={"User-Agent": "catanova-watchdog/1", "Accept": "application/json"}
            )
            response = connection.getresponse()
            body = response.read(65536)
            return {"status": response.status, "body": body, "notAfter": not_after}
        except ssl.SSLCertVerificationError as error:
            reason = short(error.verify_message or error.reason or "verification failed")
            return failed(f"TLS certificate rejected: {reason}", reason)
        except (OSError, http.client.HTTPException, ValueError, KeyError) as error:
            return failed(f"{type(error).__name__}: {short(error)}" if str(error) else type(error).__name__)
        finally:
            connection.close()

    return bounded(attempt, HTTPS_TIMEOUT_SECONDS + 2, lambda reason: failed(reason))


def check_https(config, probe):
    url = f"https://{config.domain}/healthz"
    if "error" in probe and probe["error"]:
        return Check("https", "fail", f"{url} unreachable: {probe['error']}")
    try:
        body = json.loads(probe["body"])
    except ValueError:
        body = None
    healthy = probe["status"] == 200 and isinstance(body, dict) and body.get("status") == "ok"
    if not healthy:
        # Only fixed fields are reported; a body could hold anything.
        state = body.get("status") if isinstance(body, dict) and isinstance(body.get("status"), str) else None
        return Check("https", "fail", f"{url} returned HTTP {probe['status']}" + (f" ({short(state, 40)})" if state else ""))
    return Check("https", "ok", f"{url} returned HTTP 200 status ok")


def check_certificate(config, probe, now):
    if probe.get("certificateError"):
        return Check("certificate", "fail", f"TLS certificate for {config.domain} rejected: {probe['certificateError']}")
    if "notAfter" not in probe:
        return Check("certificate", "skipped", "not checked: no HTTPS connection")
    days = (probe["notAfter"] - now) / 86400
    expires = datetime.fromtimestamp(probe["notAfter"], timezone.utc).strftime("%Y-%m-%d")
    detail = f"TLS certificate for {config.domain} expires {expires}, in {days:.1f} days (limit {config.certificate_days_min:g})"
    return Check("certificate", "ok" if days > config.certificate_days_min else "fail", detail, {"daysLeft": round(days, 1)})


def check_container(config, now):
    docker = shutil.which("docker")
    if not docker:
        return Check("container", "fail", "docker CLI not found")
    # Only State and one label are requested: the full inspect output includes the environment.
    # Compact JSON never contains a raw newline, so it cleanly separates the two values.
    template = '{{json .State}}\n{{index .Config.Labels "' + REVISION_LABEL + '"}}'
    try:
        completed = subprocess.run(
            [docker, "inspect", "--type", "container", "--format", template, config.container],
            capture_output=True,
            timeout=DOCKER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return Check("container", "fail", f"docker inspect {config.container} timed out")
    except OSError as error:
        return Check("container", "fail", f"docker inspect could not run: {type(error).__name__}")
    if completed.returncode != 0:
        # stderr names the problem (no such container, daemon down) and holds no secrets.
        return Check("container", "fail", f"docker inspect {config.container} failed: {short(completed.stderr.decode(errors='replace'), 120)}")
    state_json, _newline, revision = completed.stdout.decode("utf-8", "replace").partition("\n")
    try:
        state = json.loads(state_json)
    except ValueError:
        state = None
    if not isinstance(state, dict):
        return Check("container", "fail", "docker inspect returned unreadable state")
    revision = revision.strip() if re.fullmatch(r"[0-9a-f]{40}", revision.strip()) else None
    status = state.get("Status")
    health = (state.get("Health") or {}).get("Status", "none")
    data = {"status": status, "health": health, "revision": revision}
    if not state.get("Running") or status != "running":
        return Check("container", "fail", f"{config.container} is {status or 'not running'}", data)
    if health == "healthy":
        return Check("container", "ok", f"{config.container} is running and healthy", data)
    if health == "starting":
        started = parse_time(state.get("StartedAt", ""))
        if started is not None and now - started < HEALTH_STARTING_GRACE_SECONDS:
            return Check("container", "ok", f"{config.container} started recently; health check starting", data)
    return Check("container", "fail", f"{config.container} health is {health}", data)


def parse_time(value):
    """RFC 3339 from Docker (nanoseconds) or our status files; seconds since the epoch, or None."""
    match = re.fullmatch(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)", value or "")
    if not match:
        return None
    try:
        moment = datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    offset = 0
    if match.group(3) != "Z":
        sign = 1 if match.group(3)[0] == "+" else -1
        offset = sign * (int(match.group(3)[1:3]) * 3600 + int(match.group(3)[4:6]) * 60)
    return moment.replace(tzinfo=timezone.utc).timestamp() - offset


def read_json(path, limit=1024 * 1024):
    try:
        with open(path, "rb") as source:
            record = json.loads(source.read(limit))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def check_backup(config, now):
    path = config.status_directory / "backup.json"
    record = read_json(path)
    if record is None:
        return Check("backup", "fail", f"no readable backup status at {path}")
    last = record.get("lastSuccess")
    moment = parse_time(last.get("timestamp", "")) if isinstance(last, dict) else None
    if moment is None:
        return Check("backup", "fail", "no successful backup recorded yet")
    age = max(0.0, (now - moment) / 60)
    detail = f"newest successful backup is {age:.0f} minutes old (limit {config.backup_age_minutes_max:g})"
    if record.get("result") == "failure" and isinstance(record.get("reason"), str):
        detail += f"; latest run failed: {short(record['reason'], 100)}"
    return Check("backup", "ok" if age < config.backup_age_minutes_max else "fail", detail, {"ageMinutes": round(age, 1)})


def disk_percent(path):
    """Used space as `df` reports it: blocks reserved for root count as unavailable."""
    stats = os.statvfs(path)
    used = (stats.f_blocks - stats.f_bfree) * stats.f_frsize
    available = stats.f_bavail * stats.f_frsize
    return 100.0 * used / (used + available) if used + available else 0.0


def check_disk(name, label, path, config, require_mount):
    if require_mount and not os.path.ismount(path):
        # Unmounted, the path is an empty folder on the OS disk: never measure that instead.
        return Check(name, "fail", f"{label} {path} is not mounted")
    try:
        percent = disk_percent(path)
    except OSError as error:
        return Check(name, "fail", f"{label} {path} cannot be measured: {type(error).__name__}")
    detail = f"{label} {path} is {percent:.1f}% used (limit {config.disk_percent_max:g}%)"
    return Check(name, "ok" if percent < config.disk_percent_max else "fail", detail, {"percent": round(percent, 1)})


def run_checks(config, now=None):
    now = time.time() if now is None else now
    probe = probe_https(config)
    return [
        check_https(config, probe),
        check_certificate(config, probe, now),
        check_container(config, now),
        check_backup(config, now),
        check_disk("data-disk", "data disk", config.data_mount, config, True),
        check_disk("os-disk", "OS disk", config.os_mount, config, False),
    ]


def summarize(config, checks):
    failed = [check for check in checks if check.result == "fail"]
    if not failed:
        return None
    return f"{config.domain}: " + "; ".join(check.detail for check in failed)


def utc_timestamp(moment):
    return datetime.fromtimestamp(moment, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def status_record(config, checks, reason, started, finished):
    data = {check.name: check.data for check in checks}
    return {
        "schema": STATUS_SCHEMA,
        "kind": "watchdog",
        "timestamp": utc_timestamp(finished),
        "result": "failure" if reason else "success",
        "reason": reason,
        "durationSeconds": round(finished - started, 1),
        "domain": config.domain,
        "revision": data.get("container", {}).get("revision"),
        "container": {key: data.get("container", {}).get(key) for key in ("status", "health")},
        "diskPercent": {"os": data.get("os-disk", {}).get("percent"), "data": data.get("data-disk", {}).get("percent")},
        "certificateDaysLeft": data.get("certificate", {}).get("daysLeft"),
        "lastBackupAgeMinutes": data.get("backup", {}).get("ageMinutes"),
        "checks": [{"name": c.name, "result": c.result, "detail": c.detail} for c in checks],
    }


def write_status(directory, name, record):
    """Atomically replace <directory>/<name>.json, 0644 for the admin console; never raises."""
    directory = Path(directory)
    temporary = directory / f".{name}.json.{os.getpid()}.tmp"
    try:
        if not directory.is_dir():
            return f"{directory} does not exist"
        payload = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o644)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, directory / f"{name}.json")
        return None
    except Exception as error:
        try:
            temporary.unlink()
        except OSError:
            pass
        return type(error).__name__


def post(url, body, headers):
    """Bounded POST; returns None when accepted (2xx), otherwise a short reason. Never raises."""
    try:
        parts = parse_notify_url(url, "URL")
    except WatchdogError as error:
        return str(error)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")

    def attempt():
        factory = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
        connection = factory(parts.hostname, parts.port, timeout=NOTIFY_TIMEOUT_SECONDS)
        try:
            connection.request("POST", path, body=body, headers={"User-Agent": "catanova-watchdog/1", **headers})
            response = connection.getresponse()
            response.read(4096)
            return None if 200 <= response.status < 300 else f"HTTP {response.status}"
        finally:
            connection.close()

    return bounded(attempt, NOTIFY_TIMEOUT_SECONDS + 1, lambda reason: reason)


def ping(url, failed, message):
    """healthchecks.io convention: POST <url> on success, <url>/fail on failure."""
    try:
        parts = parse_notify_url(url, "WATCHDOG_PING_URL")
    except WatchdogError as error:
        return str(error)
    target = parts._replace(path=(parts.path.rstrip("/") + ("/fail" if failed else "")) or "/").geturl()
    return post(target, message.encode("utf-8", "replace")[:10000], {"Content-Type": "text/plain; charset=utf-8"})


def send_alert(config, title, message, urgent):
    """Push one message to ALERT_WEBHOOK_URL: plain text (ntfy.sh and similar) or Discord JSON."""
    if config.alert_kind == "discord":
        content = f"**{title}**\n{message}"[:1900]
        body = json.dumps({"content": content, "allowed_mentions": {"parse": []}}).encode()
        return post(config.alert_url, body, {"Content-Type": "application/json"})
    # ntfy reads Title/Priority/Tags headers; other plain-text receivers ignore them.
    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        "Title": title,
        "Priority": "high" if urgent else "default",
        "Tags": "warning" if urgent else "white_check_mark",
    }
    return post(config.alert_url, message.encode("utf-8", "replace")[:4000], headers)


def alert_decision(previous, failing, now):
    """Whether to push now: a new or different failure, a six-hourly reminder, or recovery."""
    previous = previous if isinstance(previous, dict) else {}
    before = previous.get("failing") if isinstance(previous.get("failing"), list) else []
    alerted = parse_time(previous.get("alertedAt", "")) if isinstance(previous.get("alertedAt"), str) else None
    if failing:
        if failing != before:
            return "new"
        if alerted is None or now - alerted >= ALERT_REPEAT_SECONDS:
            return "reminder"
        return None
    return "recovered" if before else None


def notify(config, checks, reason, now):
    """Ping the dead-man's switch every run; push to the webhook only when something changed."""
    lines = []
    if config.ping_url:
        message = reason or f"{config.domain}: all {len(checks)} checks passed"
        problem = ping(config.ping_url, bool(reason), message)
        lines.append(("watchdog ping not delivered: " + problem) if problem else "watchdog ping delivered")
    if not config.alert_url:
        return lines
    state_path = config.state_directory / "alert-state.json" if config.state_directory else None
    previous = (read_json(state_path) if state_path else None) or {}
    failing = sorted(check.name for check in checks if check.result == "fail")
    decision = alert_decision(previous, failing, now)
    # The reminder clock keeps running while the same checks keep failing.
    state = {"failing": failing, "alertedAt": previous.get("alertedAt") if failing == previous.get("failing") else None}
    if decision:
        if decision == "recovered":
            title, message = "Catanova recovered", f"{config.domain}: all {len(checks)} checks pass again."
        else:
            title = "Catanova alert" if decision == "new" else "Catanova still failing"
            message = reason
        problem = send_alert(config, title, message, decision != "recovered")
        if problem:
            lines.append(f"watchdog alert ({decision}) not delivered: {problem}")
            # Keep the old state, so the next run sends this same message again.
            state = {"failing": previous.get("failing", []), "alertedAt": previous.get("alertedAt")}
        else:
            lines.append(f"watchdog alert ({decision}) delivered")
            state["alertedAt"] = utc_timestamp(now) if failing else None
    if state_path:
        problem = write_state(state_path, state)
        if problem:
            lines.append("watchdog alert state not saved: " + problem)
    return lines


def write_state(path, state):
    try:
        path.parent.mkdir(mode=0o700, exist_ok=True)
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(json.dumps(state) + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        return None
    except OSError as error:
        return type(error).__name__


def time_limit(_signum, _frame):
    raise CheckTimeout()


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-only", action="store_true", help="run and print the checks; no status, ping or alert")
    mode.add_argument("--test-alert", action="store_true", help="send one test message to ALERT_WEBHOOK_URL")
    return parser.parse_args(list(argv))


def main(argv=(), config=None, environ=None):
    arguments = parse_arguments(argv)
    os.umask(0o077)
    try:
        config = config or Config.from_environment(environ)
    except WatchdogError as error:
        print("watchdog misconfigured: " + str(error), file=sys.stderr)
        url = (os.environ if environ is None else environ).get("WATCHDOG_PING_URL", "")
        if url and not (arguments.check_only or arguments.test_alert):
            problem = ping(url, True, "watchdog misconfigured: " + str(error))
            print(("watchdog ping not delivered: " + problem) if problem else "watchdog ping delivered")
        return 2
    if arguments.test_alert:
        if not config.alert_url:
            print("watchdog test alert: ALERT_WEBHOOK_URL is not set", file=sys.stderr)
            return 2
        problem = send_alert(config, "Catanova test alert", f"Test message from the {config.domain} watchdog. No action needed.", False)
        print(("watchdog test alert not delivered: " + problem) if problem else "watchdog test alert delivered")
        return 1 if problem else 0
    started = time.time()
    signal.signal(signal.SIGALRM, time_limit)
    signal.alarm(CHECK_SECONDS)
    try:
        checks = run_checks(config, started)
    except CheckTimeout:
        checks = [Check("watchdog", "fail", f"checks did not finish within {CHECK_SECONDS} seconds")]
    except Exception as error:
        checks = [Check("watchdog", "fail", f"watchdog check error: {type(error).__name__}")]
    finally:
        signal.alarm(0)
    finished = time.time()
    reason = summarize(config, checks)
    for check in checks:
        print(f"watchdog {check.result:<7} {check.name:<11} {check.detail}")
    print(f"watchdog result: {'failure' if reason else 'success'} ({len(checks)} checks, {finished - started:.1f}s)")
    if not arguments.check_only:
        problem = write_status(config.status_directory, "watchdog", status_record(config, checks, reason, started, finished))
        if problem:
            print("watchdog status not written: " + problem)
        for line in notify(config, checks, reason, finished):
            print(line)
    return 1 if reason else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
