# Admin console

`https://admin.catanova.io` is the operator's view of the running game: live operations, games, players and statistics, the feedback inbox and an audit log. It is reachable only through Cloudflare Zero Trust, signed in as the owner, and the server checks Cloudflare's signature on every request as well. This page covers how it is built, what an attacker would need, the Cloudflare setup, deployment and verification, and local development.

## Architecture

```text
Owner's browser ──HTTPS──▶ Cloudflare edge ── Access: sign-in and an Allow policy for the owner's email
                                 │              adds Cf-Access-Jwt-Assertion, a JWT signed by the team's key
                                 ▼
                    Cloudflare Tunnel ◀── outbound connection from the cloudflared container
                                 │
             cloudflared ──HTTP──▶ game:3100   admin listener, private Compose network only
                                                verifies the JWT on every request, then the API
                                                reads the same Store and live sockets as the game

Players ──HTTPS──▶ Caddy :443 ──▶ game:3000   public game; never routes to or serves the admin
```

- **A second listener in the game process.** `startAdminServer` (`apps/server/src/admin/listener.ts`) starts only when `ADMIN_PORT` is set. It shares the game's `Store` and socket state but nothing else: the public server on port 3000 has no admin routes and never serves `dist/admin`. In Compose it binds `0.0.0.0:3100` inside the container; that port is not published on the VM and Caddy proxies only `game:3000`.
- **The interface** is a React app in `apps/admin`, built to `dist/admin` by `npm run build` and served from an in-memory map of exact paths, so no request path ever reaches the filesystem. It loads one script and one stylesheet from its own origin: no inline code, fonts, third-party requests or analytics.
- **Reads that grow with the database run off the game loop.** `node:sqlite` is synchronous, so anything that scans on the game's own connection pauses every table in play. Statistics and the retention report each run in a short-lived worker thread on a read-only SQLite connection and are cached (five and ten minutes); on a 106 MiB, 6,440-row journal the inline queries delayed a 5 ms timer by up to 29 ms, in the worker by at most 1.2 ms. The room index behind Overview's counts, the Games list and player search (every room is kept, so a full pass took about 0.14 s at 50,000 rooms and 0.75 s at 200,000) runs in its own long-lived worker, at most once every 5 seconds however many pages are open, and exits after a minute without questions. A run that overstays its timeout is stopped, and no second run of the same kind starts until its thread has actually exited, because SQLite cannot be interrupted from outside. What stays on the game's thread is bounded: primary-key lookups for one room or one page of 25, indexed lookups for at most 50 players a search found, and PRAGMAs.

## Security model

Every request, whether for the page, a script or the API, passes these checks in order:

1. **Headers first**, so refusals carry them too: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, COOP and CORP `same-origin`, a Permissions-Policy denying sensors, camera, microphone, payment and USB, `X-Frame-Options: DENY` and HSTS.
2. **Authentication, failing closed.** With `ADMIN_AUTH=cloudflare-access`, the `Cf-Access-Jwt-Assertion` header must be an RS256 JWT (the algorithm is fixed by the server, so `none`, HS256 and everything else are refused before any key is touched) whose `kid` is in the team's published key set, whose `aud` includes `ADMIN_ACCESS_AUD`, whose `iss` is `https://ADMIN_ACCESS_TEAM_DOMAIN`, whose `exp`, `nbf` and `iat` hold within 60 seconds of skew, and whose lower-cased `email` is in `ADMIN_EMAILS`. Keys come from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, are cached for an hour, and an unknown `kid` refreshes them at most once a minute (Cloudflare rotates every six weeks and publishes both keys). If they cannot be fetched the answer is 503, never a pass. The unsigned `Cf-Access-Authenticated-User-Email` header is ignored.
3. **Rate limits** per signed-in email: 240 requests and 20 changes a minute.
4. **Cross-site protection.** Every API call needs `X-Catanova-Admin: 1`, which a page on another site cannot add without a CORS preflight that is never granted, and a `Sec-Fetch-Site` of `same-origin` when the browser sends one. Changes must also be `POST` with `Content-Type: application/json`, a body of at most 16 KB, and an `Origin` exactly equal to `ADMIN_ORIGIN`.
5. **Audit.** Ending a game, resolving or reopening feedback, generating the retention report and viewing a game's private state (hands and decks) each write a row to the append-only `admin_audit` table (triggers refuse updates and deletes) with the time, email, action, target, details, Cloudflare's client address, the request id and the Cloudflare ray id. A change and its audit row commit in the same transaction.

The server refuses to start the admin listener in production unless all of this is configured, and `ADMIN_AUTH=local-dev` only exists outside production on a loopback address.

### What an attacker would need

| Goal                       | Would need                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reach the listener at all  | A foothold inside the Compose network (the game or Caddy container). Nothing on the VM listens for it and the Azure firewall has no rule for it. From the internet, the only path is Cloudflare's edge and this team's tunnel.                                                                                                                                                                                         |
| Get past Cloudflare Access | To sign in as an allowed identity: the owner's Google account, or the owner's mailbox for a one-time PIN.                                                                                                                                                                                                                                                                                                              |
| Get past the server        | A JWT signed by this team's current key, for this application's AUD, unexpired, naming an address in `ADMIN_EMAILS`. A token copied from the owner's browser works until it expires, which is why sessions are kept short (8 hours) and can be revoked in Cloudflare.                                                                                                                                                  |
| Change something           | All of the above, from a page on `ADMIN_ORIGIN` itself. Cross-site pages cannot add the custom header, set the Origin, or read responses. The strict CSP and React's escaping keep player-supplied text (feedback, names) inert.                                                                                                                                                                                       |
| Abuse the tunnel token     | With `TUNNEL_TOKEN`, someone can run their own connector for this tunnel and receive a share of the requests Cloudflare routes to it, including the owner's Access cookie, which they could replay through Cloudflare until that session ends. Treat the token like a password: keep it only in the root-only environment file, rotate it and revoke sessions if it leaks. The audit log shows what every session did. |
| Everything                 | Control of the Cloudflare account (it could change the policy or add an identity provider that asserts the owner's email), root on the VM, or the owner's unlocked device. Protect the Cloudflare account with a hardware key or authenticator app. The audit log records what the console did; it cannot stop a root user from rewriting the database.                                                                |

## Cloudflare setup

Do this once, in the Cloudflare dashboard. The free Zero Trust plan is enough; it may still ask for a payment method.

0. **The zone.** `catanova.io` must be an active zone in this Cloudflare account, because the tunnel publishes `admin.catanova.io` as a record in it. If its DNS is hosted elsewhere today: add the site on the Free plan, check that the imported records match the current ones exactly (including any mail records), and set the existing `catanova.io` A record to **DNS only** (grey cloud) so players still reach Caddy directly and its certificates keep renewing. Then change the nameservers at the registrar and wait for the zone to show **Active**.
1. **Team.** Open **Zero Trust**. On first visit choose a team name, such as `catanova`; your team domain is then `catanova.cloudflareaccess.com`, and the Zero Trust settings show it as the team domain.
2. **Login method.** **Zero Trust → Integrations → Identity providers → Add new identity provider**:
   - **One-time PIN** is the simplest: Cloudflare emails a code, and only to addresses an Access policy allows.
   - Or **Google**: create an OAuth client in Google Cloud Console with the authorised redirect URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`, paste its client ID and secret, and **Test** it.
3. **Tunnel.** **Networks → Tunnels** (newer dashboards: **Networking → Tunnels**) → **Create a tunnel** → **Cloudflared** → name it `catanova-admin` → **Save tunnel**. On the connector page choose **Docker** and copy only the long value after `--token` in the command it shows. That is `TUNNEL_TOKEN`. Do not run the command; Compose runs the connector.
4. **Route.** In the tunnel, add a **Public hostname** (newer dashboards: **Routes → Add route → Published application**): subdomain `admin`, domain `catanova.io`, path empty, service type **HTTP**, URL `game:3100`. Save. Cloudflare creates a proxied `admin` CNAME pointing at the tunnel.
5. **Access application.** **Zero Trust → Access (Access controls) → Applications → Add an application → Self-hosted**:
   - Name `Catanova admin`; session duration **8 hours** (or shorter).
   - Public hostname: subdomain `admin`, domain `catanova.io`, no path.
   - Identity providers: the one from step 2 only (turn on **Instant Auth** if offered).
   - Policy: **Add a policy**, name `Owner only`, action **Allow**, include selector **Emails**, value: your email address. Add nothing else; never use **Everyone**.
   - If offered under cookie settings: **SameSite Strict**, **HTTP Only** on, **Binding Cookie** on.
   - Save, then open the application's **Configure → Additional settings** (or **Overview**) and copy the **Application Audience (AUD) Tag**.
6. **Optional second check at the connector.** Back in the tunnel route from step 4, under **Additional application settings → Access**, turn on **Protect with Access** with your team name and the AUD tag, so `cloudflared` also refuses requests without a valid token.
7. **Production settings.** Add these lines to `/etc/catanova/production.env` on the VM (root-owned, mode `0600`):

   ```sh
   TUNNEL_TOKEN=<value from step 3>
   ADMIN_ACCESS_TEAM_DOMAIN=catanova.cloudflareaccess.com
   ADMIN_ACCESS_AUD=<64-character AUD tag from step 5>
   ADMIN_EMAILS=<your email, exactly as in the policy>
   ADMIN_ORIGIN=https://admin.catanova.io
   ```

   `ADMIN_EMAILS` accepts a comma-separated list; keep it identical to the policy. Compose fixes the rest: `ADMIN_PORT=3100`, `ADMIN_HOST=0.0.0.0`, `ADMIN_AUTH=cloudflare-access` and `STATUS_DIR=/app/status`.

## Deploy

The release that introduces the console will not start without the settings above: `docker compose config` stops with a message naming the missing variable before anything is replaced, so the running game is untouched until they are filled in.

1. Prepare the status directory the host's backup and watchdog scripts write to. It is mounted read-only at `/app/status`:

   ```sh
   install -d -m 0755 /srv/catanova/status
   ```

   The backup worker, the watchdog and the weekly restore drill write `backup.json`, `watchdog.json` and `drill.json` there, each replaced atomically with mode `0644` so the container's `node` user can read it ([Reading status](../deploy/single-vm/OPERATIONS.md#reading-status) describes their fields). Overview → Host reports shows each one as **OK** (its last run succeeded), **Failing** (its last run failed, however long ago), **Stale** (not renewed for 35 minutes, 15 minutes or 8 days respectively: the job itself has stopped), **Unreadable**, or **Not configured** while the file is absent.

2. Deploy the reviewed commit exactly as in [Operations](../deploy/single-vm/OPERATIONS.md#deploy-a-reviewed-update). `up -d` pulls the pinned `cloudflare/cloudflared` image the first time.
3. Check the connector: `catanova_compose ps` lists `cloudflared` as running, `catanova_compose logs --tail=50 cloudflared` shows registered tunnel connections, and the tunnel shows **Healthy** in Zero Trust.

## Verify

From a computer without a Cloudflare session:

```sh
curl -sI https://admin.catanova.io/ | head -n 5                  # a redirect to <team>.cloudflareaccess.com, never 200
curl -s -o /dev/null -w '%{http_code}\n' https://admin.catanova.io/api/admin/overview   # 302 (or 401/403), never 200
curl -s -o /dev/null -w '%{http_code}\n' https://catanova.io/api/admin/overview         # 404: the game never serves it
nc -vz -w 5 74.225.248.124 3100                                  # fails: nothing listens publicly
```

In a browser: open `https://admin.catanova.io`, sign in, and check that the header shows your email and Overview shows the deployed revision. A private window signed in with any other address must be refused by Cloudflare; if a policy were ever loosened by mistake, the server would still answer 403.

On the VM:

```sh
ss -ltnp | grep -E ':(3000|3100)\b'            # nothing: neither port listens on the host
docker port catanova-game                      # nothing published
catanova_compose exec caddy wget -q -O - http://game:3100/api/admin/session
                                               # fails with 401 Unauthorized: inside the network, no token, no entry
```

Then end a test game or open a game's private state and check that it appears under **Audit**.

## Local development

```sh
npm run build
ADMIN_PORT=3100 ADMIN_AUTH=local-dev npm start
```

Open `http://127.0.0.1:3100`. The actor is recorded as `local-dev`. This mode is refused when `NODE_ENV=production` or when `ADMIN_HOST` is not a loopback address, and it rejects any `Host` header that is not loopback, so a DNS-rebinding page cannot borrow it. Changes are accepted only from `ADMIN_ORIGIN`, which defaults to `http://127.0.0.1:<ADMIN_PORT>`; use that exact address, or set `ADMIN_ORIGIN` to match the one you open. The listener reads `dist/admin` at startup, so restart it after rebuilding.

For live reloading of the interface, run the listener with `ADMIN_ORIGIN=http://127.0.0.1:5174` and `npm run dev:admin` in a second terminal; Vite proxies `/api/admin` to port 3100.

## Settings

| Variable                   | Meaning                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `ADMIN_PORT`               | Starts the admin listener. Unset means no admin listener. Must differ from `PORT`.               |
| `ADMIN_HOST`               | Bind address; default `127.0.0.1`. Compose uses `0.0.0.0` inside the container, never published. |
| `ADMIN_AUTH`               | `cloudflare-access`, or `local-dev` outside production on loopback only. Required.               |
| `ADMIN_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com`, without `https://`.                                               |
| `ADMIN_ACCESS_AUD`         | The Access application's AUD tag, 64 hex characters.                                             |
| `ADMIN_EMAILS`             | Comma-separated addresses allowed in; compared lower-cased.                                      |
| `ADMIN_ORIGIN`             | The exact browser origin allowed to make changes, such as `https://admin.catanova.io`.           |
| `STATUS_DIR`               | Where `backup.json`, `watchdog.json` and `drill.json` are read from; default `/app/status`.      |
| `CATANOVA_REVISION`        | Shown on Overview.                                                                               |
| `TUNNEL_TOKEN`             | Used by the `cloudflared` service only.                                                          |

## Operating it

- **Sign someone out, or yourself everywhere:** Zero Trust → My Team → Users → the user → **Revoke session**. Their token stops working at Cloudflare at once and at the server when it expires.
- **Add or remove an admin:** change the Access policy and `ADMIN_EMAILS` together, then `catanova_compose up -d --no-build game` to recreate the game container with the new list. Both must allow an address for it to get in.
- **Rotate the tunnel token:** rotate it in the tunnel's settings where the dashboard offers it, or create a replacement tunnel with the same route and delete the old one; then update `TUNNEL_TOKEN` and recreate `cloudflared`.
- **Signing keys** rotate automatically; nothing to do.
- **Ending a game** closes it with no winner, as if every remaining player had left, through the same rules-engine path the server uses for an abandoned table. It is journaled (`abandoned`, "Catanova closed this game. There is no winner."), audited, and pushed to anyone connected, who can then leave the room. It cannot be undone.
- **The retention report** runs `scripts/reporting/retention.ts` against a read-only connection to the live database in a worker. It reads each match's final journal row to classify how it ended, decoding compact rows (the deflated state plus the board stored once in `journal_boards`) as well as rows older releases wrote whole.
