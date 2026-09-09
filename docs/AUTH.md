# Google authentication

Catanova uses Supabase Auth with Google OAuth and PKCE. The integration is implemented; activation requires a project's public configuration, enabled Google provider and allowed redirects. Keep project-specific configuration outside the repository. A real account flow still needs the setup below and a live sign-in check.

## Configure a project

1. Choose the Supabase project and copy its project URL and **publishable** key from the Connect dialog. A legacy `anon` key also works. Never use a secret or `service_role` key in this configuration: the server sends these two public values to the browser through `/api/config`.
2. In Google Cloud, configure the OAuth consent screen and a Web application OAuth client. Add the callback shown by Supabase (normally `https://PROJECT.supabase.co/auth/v1/callback`) to Google's authorized redirect URIs. Add the application's origin to Google's authorized JavaScript origins as described in the Supabase guide. Add test users if the Google app is in testing mode.
3. Enable Google in Supabase Authentication → Sign In / Providers and enter Google's client ID and secret **there**. Catanova does not need Google's client secret.
4. In Supabase Authentication → URL Configuration, set the application's Site URL and allow its exact callback URL. For the local server this is `http://127.0.0.1:3000/auth/callback`; for Vite it is `http://127.0.0.1:5173/auth/callback`. Add the actual production HTTPS callback when hosting. Keep the chosen hostname consistent between opening the app and configuring redirects.
5. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `REQUIRE_AUTH=true` in the server environment. Build and restart. The menu now offers **Continue with Google**. No client rebuild is needed when changing these runtime values.

```sh
npm run build
node --env-file=.env dist/apps/server/src/index.js
```

For Docker, supply the same variables to the container. The checked-in Compose file is a localhost-only unauthenticated playtest. Replace that explicit local setting with the Supabase variables before exposing a service publicly.

Use [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google) for provider settings and the consent/branding requirements that apply to your Google project.

## Account and seat ownership

The browser retains its Supabase session and refreshes it with the official SDK. Invite context survives the OAuth redirect. On every WebSocket handshake, the server verifies the access token with Supabase's Auth user endpoint through `auth.getUser(token)`. It uses the verified user ID, requires a Google-linked non-anonymous account, and rejects another account's seat token. It never takes ownership from a browser-supplied ID or an unverified decoded JWT claim. Auth token expiry closes the socket so reconnection obtains a fresh token.

An account occupies one active seat per room. Signing in on another device and opening its invite offers Resume. Resuming rotates that seat's local token and revokes the old socket without creating an extra player. Google profile data only supplies a default name; users choose their portrait and display name. Portraits share a consistent border. Display names are not globally unique identities.

Profiles and game saves are currently stored by the game server in **SQLite**, keyed by verified Supabase user ID. They are not yet in Supabase Postgres. They survive normal server restarts as long as the database volume survives. The hosted Postgres migration remains a separate milestone.

Both Ready state and room cosmetic changes are durable. Customization is available before play; changing a lobby profile clears Ready in the interface. The game requires everyone to be connected and the other players to be ready before the host starts. The host has no separate Ready step. A network drop retains the seat and cosmetics.

## Local development and guests

Without Supabase configuration, development keeps the existing token-based local playtest so four local tabs can be exercised. This is labeled **Local playtest**, not a published guest-account feature. `NODE_ENV=production` requires authentication unless `ALLOW_LOCAL_PLAYTEST=true` is explicitly set. `REQUIRE_AUTH=true` takes precedence over that exception. Partial auth configuration always fails startup.

The Google path deliberately rejects Supabase anonymous users. [Guest access](GUEST_ACCESS.md) is a proposal for review, not an enabled sign-in option.

## Validation and remaining activation

Automated tests cover calls through the Supabase SDK to a local Auth fixture, forged/expired credentials, required Google identity, cross-account takeover denial, profile ownership, same-account device recovery, and production configuration. A valid public key alone does not enable the Google provider or configure redirects. The real Google/Supabase flow has not been verified. After configuration, check an invite → Google → same lobby round trip, profile persistence after logout/login, and resume on a second device before public hosting.
