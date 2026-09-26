# Gold field tiles

Open Sea's gold field has one painted tile for each board theme. Both were made on 26 September 2026 from the draft the owner chose on 25 September: one large rock, a wide softly glowing seam of gold, and a small pool with nuggets. [Gold provenance](gold-provenance.json) records every step, the models, the inputs and the SHA-256 of each file.

| Theme     | Master                                 | Browser file                                                        |
| --------- | -------------------------------------- | ------------------------------------------------------------------- |
| Storybook | `assets/source-art/gold-storybook.png` | `apps/client/public/art/optimized/gold-storybook.017351263200.webp` |
| Classic   | `assets/source-art/gold-classic.png`   | `apps/client/public/art/optimized/gold-classic.5a9996f0725b.webp`   |

Each master is 512 × 512, the size of one cell of the terrain atlases, resized from a 1024 × 1024 final. The browser files are WebP at quality 78, exported by `scripts/optimize-art.mjs` from [runtime-art.json](runtime-art.json).

## How the board uses them

The tile maps onto the square of two hex radii round its hex, exactly as an atlas cell does, and is cut to the hex the same way. It is a texture of its own, `gold` in `apps/client/src/board-theme.ts`, beside the 3 × 2 atlases rather than inside them, so the six Classic tiles and their pixels are unchanged. Only a board with a gold field loads it. Until it loads, and wherever WebGL 2 is missing, the hex shows the warm stone colour `#8f7f5a` with the label Gold.

To replace a tile, overwrite its master, run `node scripts/optimize-art.mjs` with Sharp available, then `--check`. The script names the new file by its hash and updates `board-theme.ts` and the redirects.

## Prompts

These are the prompts of the three accepted steps, in order. Each was an edit with the named inputs.

1. Storybook draft, gpt-image-2.5-flare, from the chosen draft and the Storybook terrain atlas: "Repaint the FIRST image (a gold-field terrain tile) as a new terrain cell that belongs in the SECOND image, a board-game terrain atlas (Storybook theme). Keep one large warm grey-brown rock outcrop with a wide, softly glowing seam of gold, a small calm turquoise pool, two or three nuggets. Move the composition up (top half, centred); muted warm stone and ochre ground, not pasture; gold no brighter than the hay field; no sparkles; remove edge clutter; calm, lighter edges. Match the atlas camera and gouache painting."
2. Storybook final, gpt-image-2.5-sunburst, from the draft and the Storybook atlas: "Refine the first image so it sits beside the six atlas tiles. Keep the outcrop, seam, pool and nuggets. Ground: muted warm taupe-grey stony earth with low muted olive shrubs, clearly unlike Desert, Hay, Rock or Sheep. Layout: outcrop starts about a tenth of the height below the top edge; outcrop, seam, pool and nuggets within the upper 42%, centred; calm open ground below where the number token sits. Gold rich and warm, no brighter than hay, no sparkles. Calm, slightly lighter edges. Match the atlas camera and gouache painting."
3. Classic final, gpt-image-2.5-sunburst, from the Storybook final and the Classic atlas: "Paint the gold-field tile again in the style of the Classic theme atlas (denser, more saturated, more detailed), as its seventh tile. Same subject and layout (all features in the upper 42%, calm ground where the token sits). Small painted props allowed. Warm taupe-grey stony ground with muted olive shrubs, unlike the atlas's Desert, Hay, Rock and Sheep. Gold no brighter than hay; no sparkles. Calmer edges."

Both were checked hex-cropped at 110 and 44 pixels beside the six tiles of their atlas, with a number token: each reads as distinct from every other tile, the seam shows at phone size, and the token covers only the lower part of the pool.
