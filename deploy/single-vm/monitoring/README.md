# Production watchdog

A systemd timer runs [`watchdog.py`](watchdog.py) on the VM every five minutes. It uses Python 3.9+ standard libraries only, like the backup worker, and checks six things:

| Check         | Passes when                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `https`       | `https://$CATANOVA_DOMAIN/healthz` returns HTTP 200 with `"status":"ok"`, over a normally verified TLS connection              |
| `certificate` | the certificate served on that connection expires in **more than 14 days** (Caddy normally renews about 30 days before expiry) |
| `container`   | `docker inspect catanova-game` reports it running with Docker health `healthy` (`starting` is allowed for three minutes)       |
| `backup`      | `lastSuccess` in `/srv/catanova/status/backup.json` is **under 35 minutes** old: one missed fifteen-minute run is tolerated    |
| `data-disk`   | `/srv/catanova` is a mountpoint and **under 85%** used; an unmounted path is a failure, never measured as the OS disk          |
| `os-disk`     | `/` is under 85% used, counted as `df` does                                                                                    |

On success it posts to `WATCHDOG_PING_URL`; on any failure it posts to `WATCHDOG_PING_URL/fail` with one plain-text line naming every failed check. The dead-man's-switch service alerts on `/fail` and also when pings stop, which covers a VM that is down, deallocated or unable to reach the internet. That is the only way a VM outage can be noticed, because the VM cannot report its own absence.

Optionally, the same text also goes to `ALERT_WEBHOOK_URL`: a plain-text POST (an [ntfy](https://docs.ntfy.sh/publish/) topic URL, with ntfy's `Title`, `Priority` and `Tags` headers) or, with `ALERT_WEBHOOK_KIND=discord`, a Discord channel webhook message. Pushes are de-duplicated: one when the set of failing checks changes, a reminder every six hours while it persists, and one `Catanova recovered` message. An undelivered push is retried on the next run. That state lives in `/var/lib/catanova-watchdog/alert-state.json`.

Every run replaces `/srv/catanova/status/watchdog.json` (mode 0644): `timestamp`, `result`, `reason`, `durationSeconds`, `domain`, the running image's `revision` label, `container` status and health, `diskPercent` (`os`, `data`), `certificateDaysLeft`, `lastBackupAgeMinutes` and each check's result and detail. It holds no URLs, tokens or game data.

Bounds: the HTTPS probe and each notification have ten-second limits enforced by a daemon thread (a socket timeout does not bound a stalled DNS lookup), `docker inspect` has fifteen seconds, all checks together sixty, and systemd two minutes. Only the container's `State` and revision label are requested from Docker; the full inspect output would include the container's environment. Exit status is 0 when every check passed, 1 when a check failed (the unit then shows as failed until a clean run), and 2 when the configuration is invalid, which is also reported to `WATCHDOG_PING_URL/fail` when that URL is usable.

## Install on the deployed VM

These are operator instructions, not evidence that installation has happened. The owner's account setup (what to click on healthchecks.io, ntfy or Discord) is in [the operations runbook](../OPERATIONS.md). From the reviewed repository checkout:

```sh
sudo install -d -m 0755 /opt/catanova-watchdog
sudo install -m 0644 deploy/single-vm/monitoring/watchdog.py /opt/catanova-watchdog/watchdog.py
sudo install -d -m 0700 /etc/catanova
sudo install -m 0600 deploy/single-vm/monitoring/.env.example /etc/catanova/watchdog.env
sudo install -d -m 0755 /srv/catanova/status
sudo install -m 0644 deploy/single-vm/monitoring/catanova-watchdog.service /etc/systemd/system/catanova-watchdog.service
sudo install -m 0644 deploy/single-vm/monitoring/catanova-watchdog.timer /etc/systemd/system/catanova-watchdog.timer
```

Edit `/etc/catanova/watchdog.env`: keep `CATANOVA_DOMAIN` identical to the one in `/etc/catanova/production.env`, and paste the ping and optional webhook URLs. Preserve an existing file on later updates. Then validate and run it once before enabling the schedule:

```sh
sudo systemd-analyze verify /etc/systemd/system/catanova-watchdog.service /etc/systemd/system/catanova-watchdog.timer
sudo systemctl daemon-reload
sudo systemctl start catanova-watchdog.service
sudo journalctl -u catanova-watchdog.service -n 20 --no-pager
sudo python3 -m json.tool /srv/catanova/status/watchdog.json
sudo systemctl enable --now catanova-watchdog.timer
systemctl list-timers catanova-watchdog.timer
```

The backup check needs the backup worker's `backup.json`; install or update [the backup worker](../backup/README.md) first, or the first run correctly reports no recorded backup. When changing the domain, update `watchdog.env` together with `production.env`.

For a manual look without pinging or pushing anything, run the checks with the same environment file, parsed by systemd exactly as for the service:

```sh
sudo systemd-run --quiet --wait --pipe -p EnvironmentFile=/etc/catanova/watchdog.env \
  /usr/bin/python3 -B /opt/catanova-watchdog/watchdog.py --check-only
```

Replace `--check-only` with `--test-alert` to send one test push and see it arrive on a phone or channel. Use `systemctl start catanova-watchdog.service` for a full manual run: only the service provides the state directory that de-duplicates pushes.

## Limits

The watchdog runs on the machine it watches. It can only report what the VM sees: a VM outage, a network partition or a stopped timer is detected by the dead-man's-switch service noticing missing pings, after its grace period. HTTPS is checked from the VM through its own public address, which proves DNS, Caddy, the certificate and the game answer that request; it cannot prove every client network can reach the site. A burstable VM out of CPU credits can pass every check while playing slowly. Thresholds are environment settings; lower `WATCHDOG_CERT_MIN_DAYS` only if Caddy is moved to short-lived certificates.

## Local regression checks

```sh
python3 -B -m unittest discover -s deploy/single-vm/monitoring -v
```

The tests use a fake `docker` on `PATH`, loopback HTTP stubs for pings and webhooks, and, when `openssl` is available, a throwaway self-signed certificate for a real TLS probe. They cover each check's pass and fail cases, the recorded status, `/fail` bodies, alert de-duplication and retry, Discord and ntfy formats, stalled connections and the run deadline. A contract test writes `backup.json` with the real backup worker's code and reads it back. They cannot contact healthchecks.io, ntfy, Discord, Docker or the VM.
