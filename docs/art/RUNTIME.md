# Runtime artwork and loading

The browser uses full-resolution WebP derivatives of the original PNG masters. The accepted masters remain unchanged in `assets/source-art/`, outside the public directory and Docker context. Historical generation records describe those masters; `runtime-art.json` records the derivative URLs, encoding settings, dimensions and both sets of hashes.

The ten large images total **22,962,473 → 3,663,912 bytes (84% smaller)**. WebP quality is 88 for scenery/terrain/cards/avatars and 90 for logos/sprites/frames, with alpha quality 100 and no resizing. Decoded alpha matched every original exactly. Compression is lossy in color; terrain, scenery and sprite comparisons were inspected for obvious blur, palette banding and edge damage.

| Image                   | Original PNG | Runtime WebP |
| ----------------------- | -----------: | -----------: |
| avatars-fantasy.png     |  2,823,576 B |    417,902 B |
| catanova-logo-v2.png    |  1,443,888 B |    138,182 B |
| catanova-mark-v2.png    |  1,326,323 B |    277,638 B |
| development-cards.png   |  2,938,577 B |    454,162 B |
| environment-dark.png    |  2,985,679 B |    465,438 B |
| environment-painted.png |  2,903,217 B |    417,002 B |
| portrait-frame.png      |  1,449,067 B |    337,102 B |
| sprites-fantasy.png     |  1,819,242 B |    445,462 B |
| terrain-fantasy.png     |  2,858,277 B |    405,252 B |
| title-landscape.png     |  2,414,627 B |    305,772 B |

The smaller returned PNG versions of the Apple icon, 48/96px favicons and 512px app icon were retained. The official Google mark, 192px icon and social preview remain unchanged. The large palette-compressed downloads were superseded by WebP encodes from the masters to retain smoother shading.

## Updating artwork

Install Sharp in your maintainer environment, or set `SHARP_MODULE` to an absolute Sharp entry point. Export explicitly with `node scripts/optimize-art.mjs`; validate without rewriting with `node scripts/optimize-art.mjs --check`. Normal builds never regenerate artwork. The script validates the sources, writes content-hashed WebP files, updates exact runtime references, and removes only superseded outputs listed in the previous manifest. Always review changed artwork before deploying.

Use `scripts/export-branding.mjs` only when deliberately regenerating browser icons/social previews. It reads the original masters and would overwrite hand-optimized derived icons.

## Loading behavior

- Content-hashed WebP URLs can be cached for a year. A changed image gets a new URL; unversioned files and HTML still revalidate.
- Older PNG URLs temporarily redirect to their optimized replacements so existing open tabs can still load artwork. The export script keeps those redirects synchronized with the manifest.
- Public welcome pages discover the logo and scenery early; private game routes do not preload welcome artwork.
- The board draws resource-colored tiles and short labels underneath textures immediately. Loaded artwork covers them, and game commands never wait for image downloads.
- Browser sign-in imports only the Supabase authentication client, retaining the previous session storage/PKCE settings.
- The production build writes smaller Brotli/gzip versions of text files. The server negotiates them without compressing on each request; Caddy retains API compression.

These are byte-size and behavior improvements, not a claim that an actual throttled-device benchmark or maximum player capacity has been measured.

## Landing thumbnails

The signed-out landing shows four avatars and two resources below the fold. It used to draw them from the full avatar and sprite atlases through inline SVG `<image>` elements, which download eagerly: 863,364 bytes on every first visit for six small pictures. The landing now has its own crops, loaded with `loading="lazy"`:

| File               | Master                | Region (x, y, width, height) | Output          |
| ------------------ | --------------------- | ---------------------------- | --------------- |
| `landing-avatar-0` | `avatars-fantasy.png` | 6, 0, 350, 350               | 192 × 192, q 80 |
| `landing-avatar-1` | `avatars-fantasy.png` | 368, 0, 350, 350             | 192 × 192, q 80 |
| `landing-avatar-3` | `avatars-fantasy.png` | 1092, 0, 350, 350            | 192 × 192, q 80 |
| `landing-avatar-5` | `avatars-fantasy.png` | 369, 350, 348, 348           | 192 × 192, q 80 |
| `landing-timber`   | `sprites-fantasy.png` | 0, 0, 443.5, 443.5           | 72 × 72, q 90   |
| `landing-rock`     | `sprites-fantasy.png` | 0, 443.5, 443.5, 443.5       | 72 × 72, q 90   |

Each region is exactly what the game shows: the square that the avatar's `slice` viewBox keeps of its 362-pixel-wide cell, and one 512-unit sprite cell, which is 443.5 pixels of the 1774 × 887 master. Outputs are twice the largest display size (a 95 px medallion on a wide screen; the 36 px `.sprite` the trade icons have always been drawn at), which also covers a three-times phone showing the 57 px medallion. The six files total 49,582 bytes. On a production build, a first visit to `/` fell from 1,869,213 to 1,056,737 transferred bytes at 1440 × 900; on a 375 × 812 phone it is 1,047,513 until the trade example scrolls near.

`optimize-art.mjs` exports whole images only and Sharp is not installed in the repository, so these were made once in Chromium: a Lanczos-3 resample of the PNG master on premultiplied RGBA, then `canvas.toBlob(…, 'image/webp', quality)`. Alpha survived encoding exactly. Against the atlas rendering at display size, the mean channel difference is 3–4 of 255 for the avatars and 2–3 for the resources; the atlas itself differs from its master by up to 1.5. The files are named by the first twelve hex digits of their SHA-256, like the other optimized art, but are deliberately not in `runtime-art.json`, whose export would rebuild them at full size. To remake one with Sharp instead, use `extract` with the region (rounded to whole pixels), `resize(size, size, { kernel: 'lanczos3' })` and `webp({ quality })`, then rename it by hash and update `apps/client/src/LandingFeatures.tsx`.

## Current development cards

The September 2026 [readability pass](development-cards-readable.md) uses a new, smaller 768px atlas (96,886 bytes). The full-resolution table above and `runtime-art.json` record the legacy art exports, which remain available for old PNG URLs.

## Pictures of the game

The player guide's screenshots are taken from a real game rather than drawn.
`scripts/capture-guide-shots.mjs` drives a browser against a running server: it
creates a room, sits three bots down, plays until the island has cities on it,
hides the chrome that means nothing to a reader (the tool rail, the menus, and
any caption naming the current moment), and writes PNG masters into
`assets/source-art`. Like `optimize-art.mjs` it is a maintainer tool and never
part of a build.

```
PORT=3100 node dist/apps/server/src/index.js &
PUPPETEER_MODULE=/abs/path/to/puppeteer/lib/puppeteer/puppeteer.js \
  node scripts/capture-guide-shots.mjs --url http://127.0.0.1:3100
```

It only ever clicks what a player can click, so a shot can only show a position
the rules allow. Re-run it, then run `optimize-art.mjs`, to refresh the pictures
after an interface change.

## Measurement

Direct Google Analytics 4 uses measurement ID `G-NGHVNKN7FZ`. It replaces
GTM-W4XDJ2N4; the GTM container script and noscript iframe are no longer injected.
`apps/client/src/analytics.ts` generates `/analytics.js`, which asks for consent
and only then loads Google's `gtag/js` and configures GA4. Only the public
homepage, guide and privacy page inject it; private app entry routes do not. No
Google Tag Manager publication is needed.

The same-origin loader preserves the inline-script CSP restriction. It skips
non-production hostnames and sets sanitized page URL defaults before loading
GA4 loads. Referrers are blank. If the loader executes after a private route has
opened, it exits without loading Google. Before any pushState/replaceState, or on
back/forward/hash navigation, it sets Google's `ga-disable-G-NGHVNKN7FZ` flag.
Collection stays disabled for the rest of that document, including a return to `/`.
A fresh public page load resumes normal website measurement. We intentionally do
not report `/room` page views: gameplay reporting belongs to first-party records.

Network interception with the published Google tag reproduced a raw room URL in
automatic enhanced-measurement page views despite sanitized `gtag('set')` defaults.
Moving the setter before history mutation did not fix that event-level override.
The disable boundary was tested against those same requests, including delayed
script arrival, another history wrapper and back navigation; no synthetic room
identifiers were transmitted. Test requests were intercepted, not sent to GA4.

These protections are not a general sandbox: property settings can enable other
collection on public pages. Disable enhanced history/form/outbound-link measurement if it would
collect private URLs or inputs; validate any future analytics changes in DebugView.
No usernames, emails or room codes are deliberately added as event parameters.

`GA_MEASUREMENT_ID=off` disables injection at build time. A different `G-…` value
selects another property. The former `GTM_ID` setting is retired.

### Consent

The loader uses Google Consent Mode v2 in what Google calls basic mode. Before
anything else it sets `ad_storage`, `ad_user_data`, `ad_personalization` and
`analytics_storage` to `denied`, and it does not fetch `gtag/js` at all until the
visitor chooses **Accept all**. Without an answer, or after **Deny**,
nothing is sent to Google Analytics, not even a cookieless ping. Allowing sends
`gtag('consent', 'update', { analytics_storage: 'granted' })`, then the usual
config and tag.

A modal dialog asks on the loader's pages only, and the page cannot be used
until it is answered: **Accept all** is the bright button, **Deny** an equally
sized, quieter one. Escape does not close it, and if a browser closes it anyway it
opens again; it asks on every visit until there is an answer. Its styles are
`/consent.css`, fetched only while there is no answer, and the dialog opens once
they have loaded. The history wrapper closes it as soon as the address leaves those
pages, so it never shows in a room, the lobby or a game. The answer is kept in
`localStorage` under `catanova.analytics-consent` (`granted` or `denied`); every
access is guarded, so a browser that refuses storage is simply asked again next
time. An answer given after the app has changed the address takes effect from the
next public page load, because collection never resumes in a document once it has
been disabled. **Deny** also expires `_ga` and `_ga_*` cookies left from
before consent was asked.

The dialog links to `/privacy/`, which says what is collected and carries the
control for changing the answer later. That control is rendered hidden and the
loader reveals and wires it, so where the loader does not run (another host, a
build with measurement off, a blocker) no dead buttons are shown. The page's
contact address is the placeholder `PRIVACY_CONTACT` in
`apps/client/src/PublicPages.tsx`; the build warns until it is replaced.
