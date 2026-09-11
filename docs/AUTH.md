# Accounts, Google and guest authentication

Catanova uses Supabase Auth with PKCE, plus Supabase Postgres for globally unique usernames, account portraits and private friend relationships. Game state, seats, move history and command receipts still use the game server's SQLite database. Account storage and the future hosted game-state adapter are separate concerns.

## Configure a project

1. Copy the Supabase project URL and **publishable** key. A legacy `anon` key also works. Never configure a secret or `service_role` key: `/api/config` supplies these two public values to the browser.
2. Configure a Google OAuth Web client and enable Google under Supabase Authentication → Sign In / Providers. Store Google's client secret in Supabase, never this repository. Use the callback shown by Supabase in Google's allowed redirects. See the [official Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
3. Enable anonymous sign-ins for **Continue as guest**. Enable **manual identity linking** so an anonymous user can link Google to the same account. These are separate settings. See [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
4. Set up a fresh project by running [supabase/schema.sql](../supabase/schema.sql) in the Supabase SQL editor. It creates the account tables, scoped functions and permissions and is safe to rerun. For an existing project, see the targeted cleanup below. The app returns `ACCOUNT_SETUP_REQUIRED` with a retry message when the functions are absent; it never substitutes a local username reservation.
5. In Supabase Authentication → URL Configuration, allow the exact application callback: `http://127.0.0.1:3000/auth/callback` for the local server, `http://127.0.0.1:5173/auth/callback` for Vite, and your production HTTPS callback when hosting. Set the Site URL and keep the hostname consistent.
6. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `REQUIRE_AUTH=true` in the server environment, then build and restart. Changing these runtime values does not require rebuilding the client.
7. For guest CAPTCHA, select **Cloudflare Turnstile** under Supabase Authentication → Bot and Abuse Protection and save its secret there. Set only the public `TURNSTILE_SITE_KEY` in the game's environment. Allow the game's hostname in the Turnstile widget settings, including `127.0.0.1` or `localhost` when testing locally. The secret is not needed in this repository or the game server.

## Guest verification

Choosing **Play as guest** opens a compact Turnstile check. Its single-use token goes directly to `signInAnonymously({ options: { captchaToken } })`; Supabase performs server-side validation. A failed attempt waits for an explicit retry and a new token, and leaving the screen removes the widget. The script is loaded only when the guest check opens; the server's content security policy permits the Cloudflare script and frame only when a site key is configured.

Google sign-in and guest-to-Google linking remain direct, with no additional CAPTCHA. Existing guest sessions do not repeat the check on every room join or reconnect. Supabase's CAPTCHA setting must remain enabled to protect direct anonymous signup requests as well as the app's UI. See [Supabase's CAPTCHA guide](https://supabase.com/docs/guides/auth/auth-captcha), [anonymous sign-in API](https://supabase.com/docs/reference/javascript/auth-signinanonymously), and [Cloudflare hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).

```sh
npm run build
node --env-file=.env dist/apps/server/src/index.js
```

The checked-in Compose file is an explicit loopback-only local playtest. Supply Supabase configuration before exposing an authenticated service publicly.

## Minimal Google permissions

Google sign-in and guest linking both send the provider parameter `scope=openid email`. Google supplies the email and stable identity needed to authenticate the account; the game does not use a Google name, email prefix or photo as a username or avatar. The browser's game identity contains only the account ID and guest status. Email remains with Supabase Auth and is not exposed in game profiles or friend search.

Use the singular `queryParams.scope` provider parameter. Supabase's plural `options.scopes` appends to its Google defaults (`email profile`) and does not remove the profile permission. The hosted project's outgoing Google redirect was verified to contain exactly `openid email` on 11 September 2026. Both normal OAuth and identity linking retain PKCE and their existing callback/session protections. No Google client secret or additional dashboard configuration is needed for this request change. [Supabase Google provider](https://github.com/supabase/auth/blob/master/internal/api/provider/google.go), [external provider parameters](https://github.com/supabase/auth/blob/master/internal/api/external.go), [identity linking](https://github.com/supabase/auth/blob/master/internal/api/identity.go).

This limits newly requested permissions; it does not revoke earlier grants or erase provider-managed metadata from existing Supabase Auth sessions. Google controls its own consent screen and may include previously granted profile claims. The app ignores those claims. A fresh-consent browser check is still needed before describing the exact wording users will see. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Username and portrait ownership

Every new account completes onboarding before entering a room. Usernames use 3–20 ASCII letters, numbers or underscores. Their chosen capitalization is retained; a database unique index reserves each spelling case-insensitively. The availability check is guidance; the atomic save decides ownership and returns a friendly conflict if another account wins the name. Renaming releases the previous name.

Players may choose one of twelve game portraits; a default is already selected, so saving a username does not require an avatar click. Google photos are not offered or rendered. Legacy Google-photo fields are discarded when parsing saved profiles and account responses; the stored game-avatar index and username remain intact. The content security policy permits only local/data images, so old provider-photo URLs cannot trigger external image requests. Public profile data contains the username and game cosmetics, with no email or auth credentials. Legacy accent/frame fields remain readable in old saves but are no longer customization controls.

For an existing hosted project, **deploy the updated app/server first**, then run [the game-avatar cleanup](../supabase/patches/20260911_game_avatars_only.sql) in the Supabase SQL editor. The new server works with both the previous and updated RPC responses. The transaction removes copied photo URLs and stops account functions importing them; it preserves account IDs, usernames, avatar indexes, timestamps, friendships and default-deny RLS. The old storage columns remain inert for row-type compatibility. The patch is safe to rerun and does not edit provider-managed `auth.users` or `auth.identities`. Shipping this SQL in Git does not apply it to Supabase.

The game server verifies every WebSocket handshake through `auth.getUser(token)` and the caller's scoped account RPC. Unregistered accounts, expired guests, mismatched IDs and invalid tokens cannot claim a seat. A valid public configuration alone does not grant access. Account outages fail the handshake closed; no replacement or unowned seat is created.

An account occupies one active seat per room. A fresh device can use the same invite to resume its account-owned seat; the local seat token rotates and the previous socket loses authority immediately. Resuming a lobby refreshes the canonical username/portrait and clears that player's old Ready state if either changed. Once play starts, the match retains the names/cosmetics recorded at its start so a later account rename does not rewrite history. The host starts directly; the other players must be ready and everyone connected.

## RLS and friendship boundaries

The schema enables RLS and revokes all direct table access from `anon`, `authenticated` and `PUBLIC`. No table policy grants a public directory or cross-account access. Narrow `SECURITY DEFINER` RPCs use a fixed empty search path and derive their caller from `auth.uid()`. Private helper functions and the private schema have no client grants. Only authenticated-role RPC execution is granted; Supabase anonymous users still carry that role and are explicitly checked inside the functions.

Both sides of a friendship must be registered Google accounts. Guest friend calls and requests targeting guests fail independently of the UI. A guest searching for friends is offered Link Google. Permanent users can search username prefixes of at least three characters; results expose at most ten public profiles, including a guest marker so those entries can show why they cannot be added. Pending requests are visible only to their two participants. Acceptance requires the recipient; an opposite request never silently accepts. Limits are 20 outgoing pending requests, 40 total pending requests at a recipient, and 100 accepted friends per account. Mutations are atomic and repeated request/accept/remove operations are safe. Durable SQL counters also cap successful friendship mutations at 12 per minute and 60 per hour, search at 30 per minute, username checks at 60 per minute, and profile saves at 20 per minute. Request/cancel cycling consumes the same friendship budget; clients cannot reset counters or call the private limit helper. Exceeding a budget returns a clear retry message and HTTP 429.

## Guests, activity and upgrades

See [the implemented guest policy](GUEST_ACCESS.md). Linking uses `linkIdentity` and keeps the exact Supabase account ID, username, avatar and room ownership. If the selected Google identity already belongs elsewhere, the guest session is retained and the UI explains the conflict. There is no automatic merge. Successful linking refreshes the JWT before enabling friendship calls. An expired guest starts a new Google sign-in instead of attaching Google to an expired identity.

## Local development and validation

Without Supabase configuration, development retains an isolated seat-token playtest mode. It does not claim global username ownership. Production rejects absent auth unless `ALLOW_LOCAL_PLAYTEST=true` is explicitly set; `REQUIRE_AUTH=true` overrides that exception. Partial configuration always fails startup.

Automated tests execute the schema in an actual embedded Postgres engine and verify RLS/default deny, helper grants, uniqueness conflicts, expiry, tombstones, identity upgrades, public search fields and friendship ownership. Auth/HTTP/socket fixtures cover verified-account admission, missing account schema, failed services, profile canonicalization, takeover prevention, resume and background activity behavior. Pure auth-flow tests cover successful same-ID linking, conflicting identity recovery, expired-guest sign-in and local-session cleanup.

Setting up this schema in a project and completing a real Google consent/callback round trip remain deployment checks. Local fixtures do not prove live provider configuration or internet availability. Before hosting, check invite → sign-in → onboarding → lobby, logout/login persistence, second-device resume, guest-to-Google linking and friend request/acceptance with separate real accounts.
