# One VM, one game server

This deployment runs the existing Node HTTP/WebSocket server and SQLite store behind Caddy HTTPS. The same origin serves the app, account API, and `/ws`. Supabase handles Google/guest identities, profiles, and friends; it does **not** store this server's matches.

Use this bundle for the first controlled online release. It has one authoritative game process and a brief interruption during updates, not automatic failover. Do not add replicas or mount its SQLite volume into another running game server. The fixed container name prevents accidental Compose scaling.

## Prepare the host and accounts

- Use a Linux VM with Docker Engine and the Compose plugin, with Docker's volume directory on a persistent managed disk rather than an Azure temporary/resource disk. VM deletion can still delete attached storage depending on its delete settings; decide that during provisioning.
- Point the assigned Azure DNS hostname—or later `catanova.io`—at the VM's static public IP. Allow public inbound **TCP 80 and 443** in the network security group and host firewall. Restrict SSH to the administrator's source addresses; do not open 3000 or Caddy's admin port. Caddy obtains and renews HTTPS certificates when DNS and ingress are reachable. [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- Apply [supabase/schema.sql](../../supabase/schema.sql). Enable Google, anonymous sign-ins, and guest CAPTCHA in Supabase. Add the site's HTTPS origin and callback/redirect URLs required by [the auth setup](../../docs/AUTH.md). Allow this hostname on the production Turnstile widget. Its secret stays inside Supabase.

## Pin and configure a release

Clone [the public repository](https://github.com/shashwtd/catanova), then check out the reviewed **full commit hash** in detached mode. Build from that clean checkout, not a moving branch or an uncommitted local tree. Preserve this checkout for configuration updates.

```sh
git clone https://github.com/shashwtd/catanova.git
cd catanova
git checkout --detach REVIEWED_FULL_COMMIT_HASH
git rev-parse HEAD
cp deploy/single-vm/.env.example deploy/single-vm/.env
chmod 600 deploy/single-vm/.env
```

Replace the commit placeholder before running the commands. Fill all five values in `deploy/single-vm/.env`; `CATANOVA_REVISION` must exactly match `git rev-parse HEAD`. This file is ignored by Git. Use one bare DNS hostname for `CATANOVA_DOMAIN`. Public keys belong here; privileged keys do not.

Run the following from **deploy/single-vm**. `--env-file .env` explicitly selects this deployment's configuration, and `${VAR:?message}` rejects missing or empty values. Avoid exporting conflicting variables in the shell: shell values take precedence. [Compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env build --pull game
docker compose --env-file .env pull caddy
docker compose --env-file .env run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=80 game caddy
```

The image carries the source revision label. Node's base-image tag in the repository Dockerfile and Caddy's patch tag can receive image rebuilds; keep the resulting image IDs with release records if exact rollback is needed. This pins application source, not every upstream image digest.

Caddy waits for the app image's `/healthz` check on initial startup. The game runs as the Dockerfile's `node` user, with a read-only root filesystem and writable data/tmp mounts. Missing auth configuration cannot enable local play. Caddy proxies WebSockets automatically; no special upgrade headers or separate public game port are needed. [Compose startup ordering](https://docs.docker.com/compose/how-tos/startup-order/), [Caddy proxy behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

Check HTTPS `/healthz` and `/api/config` (`mode` must be `authenticated`), then test Google sign-in, guest verification, onboarding, an invited two-player room, and refresh/reconnect. Health alone does not verify Supabase schema, CAPTCHA, or multiplayer admission. Restart only the game container during a test and confirm the same room and pieces return.

## Updates and switching to catanova.io

Before an update, make a consistent backup, record the old commit/image ID, and finish active games if possible. Fetch and detach at the next reviewed commit; update `CATANOVA_REVISION`, verify the clean checkout, rebuild `game`, and run `up -d --no-build` again. Compose retains the three named volumes. SIGTERM has 30 seconds for shutdown; clients reconnect after the replacement starts. There is no zero-downtime claim.

For the domain change, configure apex DNS, Supabase redirect URLs/Site URL, and Turnstile's hostname allowlist first. Update `CATANOVA_DOMAIN`, validate the configuration, then run:

```sh
docker compose --env-file .env up -d --no-build --force-recreate game caddy
```

This switches to one hostname and updates the game's allowed origin at the same time. It does not maintain the Azure hostname as a second playable origin. Browser storage belongs to the old origin: Google users can sign in again; guests should link Google before the cutover so they can recover their identity. Recreate Caddy after changing its config file so the mounted configuration is refreshed.

Keep `catanova-game-data`, `catanova-caddy-data`, and `catanova-caddy-config`. Do not use `down -v`, volume pruning, or volume deletion for an update. Caddy's data contains certificate private keys and must persist. [Caddy image storage guidance](https://hub.docker.com/_/caddy)

## Backups and recovery

SQLite uses WAL files: copying only the live `probe.sqlite` file can omit committed moves. Use SQLite's online backup API for a consistent snapshot, or stop the sole writer and copy the complete database/WAL state while it remains stopped. A disk snapshot taken during writes is not a substitute for a tested consistent backup. [SQLite backup guidance](https://www.sqlite.org/backup.html)

The volume is persistence, not a backup. Before inviting users, arrange scheduled, encrypted copies **off this VM**, retain several versions, and test restoring a copy on an isolated server. Do the same for Caddy's data/config if preserving certificate state across VM loss is required. Supabase backups cover account data separately; they cannot recover this game's SQLite matches.

Restore with the game stopped and a preserved copy of its existing data. Restore the chosen consistent snapshot to `/app/data/probe.sqlite`, remove stale WAL/SHM companions from the replaced database, preserve the `node` user's ownership, then start the same reviewed release and test room recovery. Never replace an open database or run the restored test against the production data volume. Backup scheduling and VM-loss recovery are operational work still to configure; this Compose file does not silently provide them.
