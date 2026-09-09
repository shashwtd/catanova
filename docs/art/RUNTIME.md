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
