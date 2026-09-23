# Catanova operations

Operator runbook for the deployed Azure layout, updated **10 September 2026**; monitoring and restore-drill tooling added **23 September 2026**. Direct HTTPS, routing and unauthenticated-access checks passed. A full VM reboot preserved storage, restarted healthy services and passed isolated two-client game recovery. Private backup upload, authenticated download, checksum and isolated SQLite structure were verified; the fifteen-minute timer remained active and a post-reboot upload succeeded. Real Google/Turnstile sessions remain untested.

The watchdog, the backup and drill pings and the weekly restore drill are in the repository and passed their local tests. The drill has recovered really played test games through backup, verification and a real server restart, but **none of this is installed on the VM yet**: follow [Alerts](#alerts) to switch it on. Recovery of a played match from a real production backup is pending that first drill. See the [deployment record](AZURE.md#launch-verification) for the exact scope of verification.

| Item                            | Location                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Azure VM / resource group       | `catanova-game-01` / `catanova-prod-centralindia`                               |
| Public IPv4 / game origin       | `74.225.248.124` / `https://catanova.io`                                        |
| Release checkout                | `/opt/catanova/app`                                                             |
| Initial pinned release          | `8741e4459853277b41547e8cdc2d0a5c0d689eee`                                      |
| Production configuration        | `/etc/catanova/production.env`, root-owned, mode `0600`, outside Git            |
| Managed data-disk mount         | `/srv/catanova`, retained Azure LUN0                                            |
| Persistent container storage    | `/srv/catanova/docker` and `/srv/catanova/containerd`                           |
| Backup worker / configuration   | `/opt/catanova-backup` / `/etc/catanova/backup.env`                             |
| Restore drill / configuration   | `/opt/catanova-backup/restore_drill.py` / `/etc/catanova/drill.env`             |
| Watchdog / configuration        | `/opt/catanova-watchdog` / `/etc/catanova/watchdog.env`                         |
| Status files for the admin view | `/srv/catanova/status/backup.json`, `watchdog.json`, `drill.json` (mode `0644`) |

## Connect and inspect

From the operator's computer, use the private key stored outside the repository. Replace the example key path. SSH must remain restricted to the operator's public IP/CIDR in Azure's network security group; update that restriction if the operator's address changes.

```sh
ssh -i /absolute/path/to/your/private-key catanovaadmin@74.225.248.124
sudo -i
```

The following host commands run in that root shell. Define this helper again in each new session. It selects the external production configuration explicitly and prevents exported shell variables from overriding it.

```sh
catanova_compose() {
  env -u CATANOVA_DOMAIN -u CATANOVA_REVISION \
    -u SUPABASE_URL -u SUPABASE_PUBLISHABLE_KEY -u TURNSTILE_SITE_KEY \
    -u TUNNEL_TOKEN -u ADMIN_ACCESS_TEAM_DOMAIN -u ADMIN_ACCESS_AUD -u ADMIN_EMAILS -u ADMIN_ORIGIN \
    docker compose \
      --env-file /etc/catanova/production.env \
      -f /opt/catanova/app/deploy/single-vm/compose.yaml "$@"
}

git -C /opt/catanova/app rev-parse HEAD
catanova_compose config --quiet
catanova_compose ps
catanova_compose logs --tail=100 game caddy cloudflared
findmnt --mountpoint /srv/catanova
df -h / /srv/catanova
docker volume inspect catanova-game-data --format '{{.Mountpoint}}'
curl --fail --show-error https://catanova.io/healthz
```

Health confirms the HTTP/database check only. Also verify login, guest verification, room joining, and reconnect after a release. Keep full environment files and private game snapshots out of issue reports and Git.

The admin console at `https://admin.catanova.io` runs inside the game container on port 3100 and is reached only through the `cloudflared` service and Cloudflare Access; it has no published port and Caddy never routes to it. Its setup, verification and the host status files it reads from `/srv/catanova/status` are in [the admin console guide](../../docs/ADMIN.md).

The [isolated recovery check](verify-recovery.mjs) prepares a two-client fixture, then verifies it after restarting its test container or the VM. It checks seats, one settlement and road, private views, history and duplicate-command receipts. It targets loopback port 3001, refuses authenticated/Supabase servers, and requires a separate test database and private proof file. It passed across the first VM reboot; its disposable container, volume and proof files have been removed. It is not a public-account or backup-restore test. Keep future proof files, which contain test seat tokens and state, outside Git and remove disposable test resources separately from production volumes.

## Deploy a reviewed update

Merging a pull request into `main` does **not** deploy it. There is no Azure deployment job or server auto-pull. A merge already updates `main`, so no second push is needed. Deploy the reviewed merge commit with the process below.

**GitHub Actions has not run since 20 September 2026** (the account is locked over billing), so no merge since then was checked automatically. The gate is now local: before merging and before every deploy, check out the exact commit and run `npm run ci` on the operator's computer. It runs everything the old workflow ran and prints a pass/fail summary; see [the contributing guide](../../CONTRIBUTING.md#the-merge-gate-npm-run-ci). Deploy only a commit whose run ended in `RESULT: PASS` without uncommitted changes. Where Docker is available, `npm run ci -- --docker` also starts the built image and probes it. The VM itself has no Node toolchain; it validates Compose again during the update below.

Finish active games where possible and record the current commit and image ID before updating. Confirm a recent successful off-VM backup; a manual run uses `systemctl start catanova-backup.service`. Check its result before proceeding.

Enter the **reviewed full commit hash** below. This subshell stops on failure, refuses a dirty checkout, fetches the source, updates only the revision in the external environment file, builds the new game image, and replaces the container. The database and certificate volumes remain in place.

```sh
(
  set -euo pipefail
  cd /opt/catanova/app
  test -z "$(git status --porcelain)"
  git rev-parse HEAD
  docker inspect catanova-game --format '{{.Image}}'
  read -r -p 'Reviewed full commit hash: ' catanova_next_revision
  [[ $catanova_next_revision =~ ^[0-9a-f]{40}$ ]]
  git fetch origin
  git cat-file -e "$catanova_next_revision^{commit}"
  git checkout --detach "$catanova_next_revision"
  test "$(grep -c '^CATANOVA_REVISION=' /etc/catanova/production.env)" -eq 1
  sed -i "s/^CATANOVA_REVISION=.*/CATANOVA_REVISION=$catanova_next_revision/" /etc/catanova/production.env
  chmod 0600 /etc/catanova/production.env
  catanova_compose config --quiet
  catanova_compose build --pull game
  catanova_compose up -d --no-build
  catanova_compose ps
)
```

Then inspect logs and HTTPS health and reconnect a test room. If the release changed anything under `deploy/single-vm/backup` or `deploy/single-vm/monitoring`, reinstall those files as their guides describe (keeping the existing `/etc/catanova/*.env`), reload systemd and run each changed service once. Then run `systemctl start catanova-watchdog.service` and confirm it passes against the new release. If only restarting the existing game process, use `catanova_compose restart game`; this also interrupts active connections. A code rollback uses the previous reviewed commit and its matching revision, provided it remains compatible with the current database. Preserve the old image until the new release is verified.

Never use `down -v`, volume pruning, or volume deletion for redeployment. Preserve **`catanova-game-data`**, **`catanova-caddy-data`**, and **`catanova-caddy-config`**. Do not start another game container against the same SQLite volume. See the [deployment details](README.md) for Caddy configuration changes and domain switching.

## If the data disk does not mount

Docker and containerd depend on `srv-catanova.mount`. Their mount conditions and `BindsTo` relationship deliberately stop them from writing into an empty directory on the OS disk. Inspect the fault before starting containers:

```sh
systemctl status srv-catanova.mount docker containerd --no-pager
journalctl -b -u srv-catanova.mount -u docker -u containerd -n 80 --no-pager
lsblk -o NAME,SIZE,FSTYPE,UUID,MOUNTPOINTS
cat /etc/catanova/data-disk.uuid
blkid /dev/disk/azure/scsi1/lun0
```

Compare the recorded UUID, the attached disk, and `/etc/fstab`. Recover the original disk attachment or resolve its filesystem/mount fault. Do not format it, delete its data, remove the service guards, or rerun first-time initialization to get past this error. If the unmounted `/srv/catanova` directory contains files, investigate them before mounting over them.

Once the correct disk is available, mount it and require the UUID check to pass before restarting services:

```sh
mount /srv/catanova
test "$(findmnt -nro UUID --mountpoint /srv/catanova)" = "$(cat /etc/catanova/data-disk.uuid)" && \
  systemctl reset-failed srv-catanova.mount containerd docker && \
  systemctl start containerd docker
catanova_compose ps
```

## Backups and restore

The installed worker uploads consistent SQLite snapshots through the VM's managed identity to a private container. A live run, private access enforcement, authenticated download and isolated snapshot integrity checks passed; the fifteen-minute timer is active. Verify retention and monitor ongoing results, then test recovery of a played match. Use [the backup guide](backup/README.md) for replacement-host installation and restore procedures. No storage key or SAS token belongs in `backup.env`.

These commands inspect or request a backup:

```sh
systemctl list-timers catanova-backup.timer
systemctl show catanova-backup.service -p Result -p ExecMainStatus
journalctl -u catanova-backup.service -n 30 --no-pager
systemctl start catanova-backup.service
systemctl show catanova-backup.service -p Result -p ExecMainStatus
```

Verify the upload and latest successful timestamp; an inactive successful oneshot is normal. For recovery, follow [Restore production from a backup](#restore-production-from-a-backup). Never copy a live SQLite file as a backup or overwrite an open database. These snapshots cover matches; Supabase accounts, Caddy certificates, and VM configuration have separate recovery needs.

## Alerts

Three jobs on the VM report to a free dead-man's-switch service. Each posts to its own check after every run, and to that check's `/fail` URL with a one-line reason when something is wrong. The service alerts on a `/fail`, and also when posts stop arriving. Stopped posts are how a VM that is down, deallocated or offline gets noticed: the VM cannot report its own absence.

| Check                    | Job and schedule                                                                  | healthchecks.io schedule        | URL goes in                                       |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| `catanova-watchdog`      | [watchdog](monitoring/README.md): HTTPS, container, backup age, disks, TLS; 5 min | Period 5 minutes, grace 10 min  | `WATCHDOG_PING_URL`, `/etc/catanova/watchdog.env` |
| `catanova-backup`        | [backup worker](backup/README.md), every 15 minutes                               | Period 15 minutes, grace 20 min | `BACKUP_PING_URL`, `/etc/catanova/backup.env`     |
| `catanova-restore-drill` | [restore drill](backup/README.md#restore-drill), Wednesdays 21:40 UTC             | Period 7 days, grace 1 day      | `DRILL_PING_URL`, `/etc/catanova/drill.env`       |

**Switching it on**, in this order:

1. Deploy a reviewed release that contains this tooling. The drill runs the game verifier from the deployed image and requires its `Store.verifyJournal`.
2. From that checkout, update the backup worker: `backup.py`, its service unit (it may now write `/srv/catanova/status`), and a new `/srv/catanova/status` folder. Add `BACKUP_PING_URL` to the existing `backup.env`. Follow [the backup guide](backup/README.md#install-on-the-deployed-vm).
3. Install [the watchdog](monitoring/README.md#install-on-the-deployed-vm) and [the restore drill](backup/README.md#restore-drill), with their timers.
4. Create the three checks and paste their URLs as below, then run each job once.

**One-time setup on [healthchecks.io](https://healthchecks.io)** (its free plan has room for these three checks):

1. Sign up with the address that should receive alerts. Sign-up creates a project, and email notifications to that address are its default integration.
2. On the project's **Checks** page, click **Add Check**. Name it `catanova-watchdog`, set **Period** to 5 minutes and **Grace Time** to 10 minutes, and save. Copy its **Ping URL** (`https://hc-ping.com/…`) from the check's page.
3. Repeat for `catanova-backup` (15 minutes, grace 20 minutes) and `catanova-restore-drill` (7 days, grace 1 day).
4. Optional phone push for every check: on the project's **Integrations** page, add **ntfy** or **Discord** and enable it for all three checks.

**On the VM**, paste each Ping URL into its file with `sudoedit` (which keeps the files root-owned and `0600`), after installing the jobs as their guides describe:

```sh
sudoedit /etc/catanova/watchdog.env   # WATCHDOG_PING_URL=https://hc-ping.com/...
sudoedit /etc/catanova/backup.env     # BACKUP_PING_URL=https://hc-ping.com/...
sudoedit /etc/catanova/drill.env      # DRILL_PING_URL=https://hc-ping.com/...
sudo stat -c '%a %U %n' /etc/catanova/*.env
sudo systemctl start catanova-backup.service catanova-watchdog.service catanova-drill.service
```

All three checks should turn green within a minute or so; the drill takes longest. To see a real alert once, set `WATCHDOG_DISK_PERCENT_MAX=1` in `watchdog.env` and run `systemctl start catanova-watchdog.service`: the check turns red and the email arrives. Then remove that line and run it again; the check recovers. During planned maintenance, use the **Pause** button on a check to silence it.

**Optional direct push from the watchdog.** `ALERT_WEBHOOK_URL` in `watchdog.env` pushes the watchdog's own message, naming every failing check, when failures change, every six hours while they last, and once on recovery.

- **ntfy:** install the ntfy app and subscribe to a new topic with a long random name, for example `catanova-` followed by the output of `openssl rand -hex 16`. Anyone who knows a topic's name on ntfy.sh can read it. Set `ALERT_WEBHOOK_URL=https://ntfy.sh/<topic>` and `ALERT_WEBHOOK_KIND=text`.
- **Discord:** in a private server, open **Server Settings → Integrations → Webhooks → New Webhook**, choose a channel, and **Copy Webhook URL**. Set `ALERT_WEBHOOK_URL=<that URL>` and `ALERT_WEBHOOK_KIND=discord`.

Send a test push with `sudo systemd-run --quiet --wait --pipe -p EnvironmentFile=/etc/catanova/watchdog.env /usr/bin/python3 -B /opt/catanova-watchdog/watchdog.py --test-alert`. Ping and webhook URLs are secrets: anyone holding one can report into the check or read its alerts. Keep them only in `/etc/catanova`, never in Git, issues or screenshots. Alert text contains hostnames, check results and counts, never room ids or game data.

Azure cost alerts are separate and still not configured; see [the deployment record](AZURE.md#expected-azure-cost).

## Reading status

Every run of the three jobs atomically replaces one JSON file in `/srv/catanova/status`. The files are world-readable (`0644`) and hold no secrets or game data, so the admin console shows them (Overview → Host reports) through the **read-only** mount of that folder at `/app/status` in `compose.yaml`. Every file has `schema`, `kind`, `timestamp` (UTC), `result` (`success`/`failure`), `reason` and `durationSeconds`.

| File            | Written by                   | Also holds                                                                                                                                         |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup.json`   | backup worker, every run     | blob name, `archiveBytes`, `snapshotBytes`, `sha256`, and `lastSuccess` (kept through failed runs)                                                 |
| `watchdog.json` | watchdog, every five minutes | running `revision`, `container` status and health, `diskPercent` (`os`, `data`), `certificateDaysLeft`, `lastBackupAgeMinutes`, each check         |
| `drill.json`    | restore drill, weekly        | blob, `backupAgeMinutes`, checksums, `revision` and image used, `rooms`, `games`, `verified`, `failed`, `phases`, `journalChain`, failing room ids |

```sh
python3 -m json.tool /srv/catanova/status/watchdog.json
python3 -m json.tool /srv/catanova/status/backup.json
python3 -m json.tool /srv/catanova/status/drill.json
systemctl list-timers 'catanova-*'
systemctl --failed
```

A stale `timestamp` means that job stopped running. Its check on healthchecks.io will already have alerted. The watchdog's unit also shows as failed in `systemctl --failed` while any check fails.

## Restore drill

The weekly [restore drill](backup/README.md#restore-drill) downloads the newest backup and verifies its checksum and SQLite structure. It then checks every room with the deployed release's own code: saved state against the journal hash chain, history, rules invariants, and one legal move applied to a copy of each unfinished game. It runs on Wednesdays at 21:40 UTC. To run one now and read the result:

```sh
systemctl start catanova-drill.service
journalctl -u catanova-drill.service -n 80 --no-pager
python3 -m json.tool /srv/catanova/status/drill.json
```

A passing run ends with `restore drill passed: N games in M rooms verified` and pings its check. A failing drill never touches live data, so read which step failed before acting:

- **Download or checksum:** the backup could not be fetched, or it is not the file the worker uploaded. Check the storage role and recent backups (`--list`, below); try `--blob` with the previous backup.
- **gzip or SQLite:** that backup is damaged. Drill the previous one. If several are damaged, stop and investigate the worker before trusting any backup.
- **Game verification:** the journal names each failing room and reason, for example `loadGame: STATE_INTEGRITY` or `wood: bank 4 + hands 16 = 20, expected 19`. The same room in the live database is probably damaged too. Check it before it spreads into further backups, and keep that backup for analysis.

`--list`, `--blob NAME --output FILE` and offline use from a downloaded archive are described in [the backup guide](backup/README.md#restore-drill).

## Restore production from a backup

Use this when the live database is lost or damaged: a disk fault, `STATE_INTEGRITY` errors across rooms, or a release that corrupted data. A restore puts **every** room back to the moment of the chosen backup and loses all later moves. For one damaged room, investigate that room instead. The weekly drill rehearses steps 2 and 3 with the newest backup, so a passing drill is evidence these steps will work. Never restore into the production volume just to practise.

If the VM or its data disk is gone, first build a replacement host with [bootstrap.sh](bootstrap.sh), deploy the same reviewed release as in [the deployment guide](README.md), and install the backup worker and drill without enabling their timers. Then follow the steps below; step 5 has nothing to preserve.

Run everything as root on the VM with the `catanova_compose` helper from [Connect and inspect](#connect-and-inspect) defined.

1. **Record and quiet the incident.** Note the time the damage began. Optionally pause the three checks on healthchecks.io so planned downtime does not page anyone.
2. **Choose the snapshot:** the newest backup taken before the damage began.

   ```sh
   run_drill() {
     systemd-run --quiet --wait --pipe -p EnvironmentFile=/etc/catanova/backup.env \
       -p EnvironmentFile=/etc/catanova/drill.env /usr/bin/python3 -B /opt/catanova-backup/restore_drill.py "$@"
   }
   run_drill --list 20
   ```

3. **Verify it into a private file** with the release that will serve it. By default the drill uses the game container's image, even a stopped container; if the container was removed, add `--image catanova-local:<full commit hash>`. Continue only after `restore drill passed`, and write down the `sha256` it prints for the verified database.

   ```sh
   install -d -m 0700 /root/catanova-restore
   run_drill --blob 'game/YYYY/MM/DD/NAME.sqlite.gz' --work-directory /root/catanova-restore \
     --output /root/catanova-restore/verified.sqlite --no-report
   ```

4. **Stop every writer.** Stop the timers, let a running backup finish, then stop the game. Players see an error page from Caddy until step 7.

   ```sh
   systemctl stop catanova-backup.timer catanova-drill.timer catanova-watchdog.timer
   while systemctl is-active --quiet catanova-backup.service catanova-drill.service; do sleep 2; done
   catanova_compose stop game
   ```

5. **Preserve the current database and its WAL/SHM files together**, for later analysis or to undo the restore:

   ```sh
   volume=$(docker volume inspect catanova-game-data --format '{{.Mountpoint}}')
   saved=/root/catanova-restore/before-$(date -u +%Y%m%dT%H%M%SZ)
   install -d -m 0700 "$saved"
   cp -a "$volume"/probe.sqlite* "$saved"/
   ls -la "$saved"
   ```

6. **Install the verified file** with the old file's owner and mode. The old `-wal` and `-shm` files must go: SQLite would apply them to the restored database. Compare the checksum with step 3.

   ```sh
   owner=$(stat -c '%u' "$volume/probe.sqlite"); group=$(stat -c '%g' "$volume/probe.sqlite")
   mode=$(stat -c '%a' "$volume/probe.sqlite")
   install -m "$mode" -o "$owner" -g "$group" /root/catanova-restore/verified.sqlite "$volume/probe.sqlite.restoring"
   rm -f "$volume/probe.sqlite-wal" "$volume/probe.sqlite-shm"
   mv "$volume/probe.sqlite.restoring" "$volume/probe.sqlite"
   sha256sum "$volume/probe.sqlite"
   ```

   On a replacement host with no old file, use owner and group `1000` (the image's `node` user) and mode `600`.

7. **Start the same release and check it.** Wait for `healthy`, read the logs, and open a room you know from the snapshot. Its board, hands and turn should match that moment.

   ```sh
   catanova_compose up -d --no-build game
   catanova_compose ps
   catanova_compose logs --tail=80 game
   curl --fail --show-error https://catanova.io/healthz
   ```

8. **Resume protection.** Take a fresh backup of the restored state, re-enable the timers, confirm the watchdog passes, and resume the healthchecks.io checks.

   ```sh
   systemctl start catanova-backup.service
   systemctl show catanova-backup.service -p Result -p ExecMainStatus
   systemctl start catanova-backup.timer catanova-drill.timer catanova-watchdog.timer
   systemctl start catanova-watchdog.service
   journalctl -u catanova-watchdog.service -n 12 --no-pager
   ```

9. **Record** the backup name, its time, the restore time, the lost interval and the verified checksum. Keep `$saved` until the cause is understood, then delete it: it holds every game.

To undo, stop the game again, copy `probe.sqlite`, `-wal` and `-shm` back from `$saved` together with `cp -a`, and start the game.

## Journal size and compaction

Every move is journaled. Since the release that introduced compact journal rows, a move is stored without the board and deflated (about 1.4 KB instead of about 18 KB); the board is stored once per game in `journal_boards`. Rows written by older releases are rewritten in the background by the running server, about 40 a second, until none remain. That needs no action and no downtime.

The file does not shrink on its own: SQLite reuses the freed pages for new moves. To hand the space back to the disk, run the offline command during a planned update, after a fresh backup, with the game container stopped:

```sh
systemctl start catanova-backup.service
systemctl show catanova-backup.service -p Result -p ExecMainStatus
catanova_compose stop game
docker run --rm -v catanova-game-data:/app/data catanova-local:"$(grep '^CATANOVA_REVISION=' /etc/catanova/production.env | cut -d= -f2)" \
  node dist/scripts/compact-database.js --database /app/data/probe.sqlite
catanova_compose up -d --no-build
curl --fail --show-error https://catanova.io/healthz
```

It prints how many rows it compacted and the size before and after. Rows whose saved state does not match its hash are never rewritten; they are left exactly as written and reported, so run a restore drill (or `verifyJournal` from the admin view) if that count is not zero.

Rollback: a release from before compaction can still read a compacted database. Its roll statistics count no rolls for compacted rows until the newer release is back; nothing else is affected.

## DNS and VM power

The apex **A record for `catanova.io`** targets `74.225.248.124`; ordinary DNS-based HTTPS passed. If the VM's public IP resource is deliberately replaced, update the A record to the verified replacement IP and check propagation. Do not publish an AAAA record without a working IPv6 listener. The same hostname remains in `CATANOVA_DOMAIN`, Supabase redirect settings, and Turnstile's allowed hostnames. Keep TCP 80/443 reachable for Caddy.

```sh
dig +short A catanova.io
curl --fail --show-error https://catanova.io/healthz
```

The origin has a verified Let's Encrypt certificate. `curl --resolve catanova.io:443:74.225.248.124 https://catanova.io/healthz` checks it while preserving HTTPS hostname validation, even when a local DNS cache lags. Do not delete the static IP resource as part of a reboot or update; Azure releases its address when that resource is deleted. [Azure public IP behavior](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses)

From the operator's authenticated Azure CLI, verify the selected subscription is the intended one before using these resource-group-scoped commands:

```sh
az vm show --resource-group catanova-prod-centralindia --name catanova-game-01 --show-details --query '{power:powerState,ip:publicIps}' -o json
```

For an intentional outage, first complete a backup and run `catanova_compose stop game` on the VM to stop the game gracefully. Then deallocate from the operator's computer; start it again with the second command when ready:

```sh
az vm deallocate --resource-group catanova-prod-centralindia --name catanova-game-01
az vm start --resource-group catanova-prod-centralindia --name catanova-game-01
```

After starting the VM, reconnect, define the helper, verify `/srv/catanova` is mounted, and run `catanova_compose up -d --no-build`. A container explicitly stopped before the outage will not automatically resume under `unless-stopped`. Then verify HTTPS and room reconnect and request a fresh backup.

**Deallocation stops VM compute billing, but managed disks, static IPv4, and backup storage still incur charges.** An OS shutdown or Azure stop without deallocation can continue compute billing too. [Azure VM states and billing](https://learn.microsoft.com/en-us/azure/virtual-machines/states-billing)
