# Accounts, Google and guest authentication

Catanova uses Supabase Auth with PKCE, plus Supabase Postgres for globally unique usernames, account portraits and private friend relationships. Game state, seats, move history and command receipts still use the game server's SQLite database. Account storage and the future hosted game-state adapter are separate concerns.

## Configure a project

1. Copy the Supabase project URL and **publishable** key. A legacy `anon` key also works. Never configure a secret or `service_role` key: `/api/config` supplies these two public values to the browser.
2. Configure a Google OAuth Web client and enable Google under Supabase Authentication → Sign In / Providers. Store Google's client secret in Supabase, never this repository. Use the callback shown by Supabase in Google's allowed redirects. See the [official Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
3. Enable anonymous sign-ins for **Continue as guest**. Enable **manual identity linking** so an anonymous user can link Google to the same account. These are separate settings. See [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
4. Set up a fresh project by running [supabase/schema.sql](../supabase/schema.sql) in the Supabase SQL editor. It creates the account tables, scoped functions and permissions, with no old-user import or migration history. It is safe to rerun. The app returns `ACCOUNT_SETUP_REQUIRED` with a retry message when the functions are absent; it never substitutes a local username reservation.
5. In Supabase Authentication → URL Configuration, allow the exact application callback: `http://127.0.0.1:3000/auth/callback` for the local server, `http://127.0.0.1:5173/auth/callback` for Vite, and your production HTTPS callback when hosting. Set the Site URL and keep the hostname consistent.
6. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `REQUIRE_AUTH=true` in the server environment, then build and restart. Changing these runtime values does not require rebuilding the client.

```sh
npm run build
node --env-file=.env dist/apps/server/src/index.js
```

The checked-in Compose file is an explicit loopback-only local playtest. Supply Supabase configuration before exposing an authenticated service publicly.

## Username and portrait ownership

Every new account completes onboarding before entering a room. Usernames use 3–20 ASCII letters, numbers or underscores. Their chosen capitalization is retained; a database unique index reserves each spelling case-insensitively. The availability check is guidance; the atomic save decides ownership and returns a friendly conflict if another account wins the name. Renaming releases the previous name.

Players choose one of twelve game portraits or their Google photo. The photo comes from the provider-owned `auth.identities` record, never editable user metadata or a supplied image URL. Only HTTPS `lh[number].googleusercontent.com` URLs are accepted. Avatar images use no-referrer and the app's CSP permits Google's image hosts. Public profile data contains the username and chosen cosmetics; it contains no email or auth credentials. Legacy accent/frame fields remain readable in old saves but are no longer customization controls.

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
