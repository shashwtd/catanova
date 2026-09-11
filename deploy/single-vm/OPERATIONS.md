# Catanova operations

Operator runbook for the deployed Azure layout, updated **10 September 2026**. Direct HTTPS, routing and unauthenticated-access checks passed. A full VM reboot preserved storage, restarted healthy services and passed isolated two-client game recovery. Private backup upload, authenticated download, checksum and isolated SQLite structure were verified; the fifteen-minute timer remained active and a post-reboot upload succeeded. Real Google/Turnstile sessions and recovery of a played match from a downloaded backup remain untested; no monitoring alerts are configured. See the [deployment record](AZURE.md#launch-verification) for the exact scope of verification.

| Item                          | Location                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| Azure VM / resource group     | `catanova-game-01` / `catanova-prod-centralindia`                    |
| Public IPv4 / game origin     | `74.225.248.124` / `https://catanova.io`                             |
| Release checkout              | `/opt/catanova/app`                                                  |
| Initial pinned release        | `8741e4459853277b41547e8cdc2d0a5c0d689eee`                           |
| Production configuration      | `/etc/catanova/production.env`, root-owned, mode `0600`, outside Git |
| Managed data-disk mount       | `/srv/catanova`, retained Azure LUN0                                 |
| Persistent container storage  | `/srv/catanova/docker` and `/srv/catanova/containerd`                |
| Backup worker / configuration | `/opt/catanova-backup` / `/etc/catanova/backup.env`                  |

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
    docker compose \
      --env-file /etc/catanova/production.env \
      -f /opt/catanova/app/deploy/single-vm/compose.yaml "$@"
}

git -C /opt/catanova/app rev-parse HEAD
catanova_compose config --quiet
catanova_compose ps
catanova_compose logs --tail=100 game caddy
findmnt --mountpoint /srv/catanova
df -h / /srv/catanova
docker volume inspect catanova-game-data --format '{{.Mountpoint}}'
curl --fail --show-error https://catanova.io/healthz
```

Health confirms the HTTP/database check only. Also verify login, guest verification, room joining, and reconnect after a release. Keep full environment files and private game snapshots out of issue reports and Git.

The [isolated recovery check](verify-recovery.mjs) prepares a two-client fixture, then verifies it after restarting its test container or the VM. It checks seats, one settlement and road, private views, history and duplicate-command receipts. It targets loopback port 3001, refuses authenticated/Supabase servers, and requires a separate test database and private proof file. It passed across the first VM reboot; its disposable container, volume and proof files have been removed. It is not a public-account or backup-restore test. Keep future proof files, which contain test seat tokens and state, outside Git and remove disposable test resources separately from production volumes.

## Deploy a reviewed update

Merging a pull request into `main` does **not** deploy it. The GitHub workflow runs checks only; there is no Azure deployment job or server auto-pull. A merge already updates `main`, so no second push is needed. Deploy the reviewed merge commit with the process below.

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

Then inspect logs and HTTPS health and reconnect a test room. If only restarting the existing game process, use `catanova_compose restart game`; this also interrupts active connections. A code rollback uses the previous reviewed commit and its matching revision, provided it remains compatible with the current database. Preserve the old image until the new release is verified.

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

Verify the upload and latest successful timestamp; an inactive successful oneshot is normal. Configure an alert if the last successful backup is over 30 minutes old; that alert has not been installed. For recovery, follow [Restore and verify](backup/README.md#restore-and-verify): validate a downloaded snapshot in isolation, stop the backup worker and sole game writer, preserve the old database and WAL files, then restore with correct ownership. Never copy a live SQLite file as a backup or overwrite an open database. These snapshots cover matches; Supabase accounts, Caddy certificates, and VM configuration have separate recovery needs.

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
