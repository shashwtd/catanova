# Branding exports

Browser icons are technical exports of the approved Catanova mark. The current social preview is composed entirely by `scripts/export-branding.mjs`: existing logo and scenery, explicit layout and fades, and typeset text. No image generator is used for this version. The reused artwork retains its original provenance.

## Files

All image exports live in [`apps/client/public/branding`](../apps/client/public/branding/).

| File                   | Dimensions           | Format and use                                                             |
| ---------------------- | -------------------- | -------------------------------------------------------------------------- |
| `favicon.ico`          | 16, 32, 48 px frames | ICO with transparent PNG frames for browser tabs                           |
| `favicon-48.png`       | 48 × 48              | Transparent indexed PNG; small browser icon                                |
| `favicon-96.png`       | 96 × 96              | Transparent indexed PNG; larger browser icon                               |
| `apple-touch-icon.png` | 180 × 180            | Opaque cream PNG; home-screen icon                                         |
| `icon-192.png`         | 192 × 192            | Opaque cream PNG; web manifest icon                                        |
| `icon-512.png`         | 512 × 512            | Opaque cream PNG; web manifest icon                                        |
| `social-card.jpg`      | 1200 × 630           | Opaque JPEG; full wordmark, factual tagline and coastal scenery            |
| `social-card-v2.jpg`   | 1200 × 630           | Previous generated banner; retained for already shared URLs                |
| `social-card-v3.jpg`   | 1200 × 630           | Current code-composed JPEG; logo, typeset tagline and coast, 183,574 bytes |

[`site.webmanifest`](../apps/client/public/site.webmanifest) supplies the app name, root launch URL, colors and two app-icon sizes. Its icons use `purpose: any`, with padding around the mark. It does not claim maskable icons or add offline gameplay, a service worker, or a disconnected server mode.

## Sources

- [Approved transparent mark](../assets/source-art/branding/catanova-mark-v2.png): 1254 × 1254. The exports use the approved display bounds `145, 105, 983, 1113` to remove unused margins, preserve the entire spark and mark, and fit it proportionally into a square.
- [Approved full logo](../assets/source-art/branding/catanova-logo-v2.png): 2172 × 724, with its original opaque cream background. The legacy social card places a proportional 1080-pixel-wide copy onto a 1200 × 630 cream canvas.
- [Existing title scenery](../assets/source-art/title-landscape.png): proportionally cropped into the legacy social card's lower strip, with a gradual alpha fade into the cream canvas.
- [Previous generated preview master](../assets/source-art/branding/social-card-v2.png): 1731 × 908, copied unchanged from the built-in image generator. [Its provenance](art/social-preview-provenance.json) records the exact prompt, both references, hashes and delivery settings. This is an illustration, not a game screenshot. The master is excluded from Docker and never downloaded by players.
- [Original branding provenance](art/logo-concepts/provenance-v2.json) and [art documentation](ART.md) remain the sources for artwork authorship and generation history. These exports do not change the AI-generated artwork's provenance.

The current preview says “Build. Trade. Settle.” and “catanova.io”, typeset using the bundled Barlow SemiBold font. The full approved logo is resized proportionally; a small feather at its paper edges removes the rectangular seam. The scenery fills the bottom of the canvas with a controlled fade. Text remains inside comfortable margins. The export uses an isolated temporary font cache, removed on exit, and does not scan the user's font library.

The two previous URLs remain available for already shared links. Metadata now points to `social-card-v3.jpg`. The editable source is the export script; no additional generated master is needed.

Source PNG SHA-256 values:

| Source                 | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `catanova-mark-v2.png` | `d759b095210d615840f56b14ba68bf0e5ff84ea3f620c07e9b6ae1d58666c1ef` |
| `catanova-logo-v2.png` | `6dbcb01c27f7940249326666eda05f498acac5601b61734c02e422cf7e10b301` |
| `title-landscape.png`  | `bde5b239acc08862f627cc08a07ab5c9a10d349de1e5974fc273254329aecabc` |
| `social-card-v2.png`   | `52b5cb207ebf27a75b47693fe86d8ecec71de44c053d058368982f60caf7c281` |

## Regenerate

Run [`scripts/export-branding.mjs`](../scripts/export-branding.mjs) with Node and Sharp available:

```sh
node scripts/export-branding.mjs
```

To export only the current preview, without rewriting existing icons or the legacy preview:

```sh
node scripts/export-branding.mjs --social-only
```

The script imports `sharp` normally. If Sharp is supplied by a separate local runtime, set `SHARP_MODULE` to its module entry point:

```sh
SHARP_MODULE=/absolute/path/to/sharp/dist/index.cjs node scripts/export-branding.mjs
```

Sharp is only an export-time tool. It is not imported by the application or needed to serve the committed exports. The script writes only exported image files under `public/branding`; the manifest is maintained separately. PNGs use a 256-color palette and maximum lossless compression. The current JPEG uses quality 88 with full 4:4:4 chroma resolution to preserve lettering, with a 220 KB limit. The inspected result is 183,574 bytes. Existing runtime artwork remains at its previously approved WebP settings.

Each export verifies icon dimensions, transparent versus opaque alpha, the ICO's PNG-frame sizes, the social image's dimensions, and unchanged source hashes. Inspect the resulting favicon, launcher icon and social card before committing an updated export; these checks do not replace an artwork review.
