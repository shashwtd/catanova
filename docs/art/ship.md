# Open Sea's ship

Ships and the pirate are one painted wooden ship, seen from above like the harbour boat in the sprite sheet. The owner did not like the first, flat ship drawn in the house contour, so on 26 September 2026 it was replaced by this painting, whose sail takes each player's colour.

| File                                   | What it is                                               | Browser file                                                        |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `assets/source-art/ship-painted.png`   | The ship, 130 × 256, bow up, on a transparent background | `apps/client/public/art/optimized/ship-painted.8c31ede90b16.webp`   |
| `assets/source-art/ship-sail-mask.png` | White, with the sail's coverage as its alpha             | `apps/client/public/art/optimized/ship-sail-mask.49ba6ca51b30.webp` |

Both browser files are exported by `scripts/optimize-art.mjs` from [runtime-art.json](runtime-art.json), the ship at WebP quality 88 and the mask at 90, with their alpha kept exactly. Only a board with sea loads them.

## How the board uses them

`ShipShape` in `apps/client/src/Board.tsx` lays the painting along its edge, about a road's length (54 units), with a soft shadow towards the lower right. On a coastal edge the ship sits 9 units out to sea (`shipPlacement` in `scene.ts`), so it floats rather than lying on the sand. A rectangle in the seat colour is drawn over the ship through the sail's mask and multiplied onto it, so the sail takes the colour and keeps the painting's shading, and the hull stays wood.

The pirate is the same ship a tenth larger, turned across its hex: its hull is multiplied by a dark slate through the ship's own outline and its sail by the robber's near-black `#172231`.

## Making it

1. Draft, gpt-image-2.5-flare, an edit of the sprite sheet `assets/source-art/sprites-fantasy.png`: "Paint ONE new game sprite in exactly the style of the reference sprite sheet (especially its painted wooden boat, bottom right): a small wooden sailing ship for a board game, seen from directly above like the reference boat, pointing straight up (bow at the top), centred, with a TRANSPARENT background and nothing else in the image. The ship is a little fuller than the reference rowboat: a sturdy wooden hull with warm brown planks and a darker rim, a short deck, one mast in the middle, and ONE broad square sail set across the ship, seen from above as a wide rectangle that spans a bit wider than the hull. The sail must be plain, clean, pure WHITE cloth with only soft shading (so it can be recoloured in the game), no emblem, no stripes, no rope clutter across it. Same gouache painting, soft light from the upper left, gentle cast shadow on the hull only, readable at very small size, broad simple forms. No water, no ground shadow, no text, no border." Output 1024 × 1024, SHA-256 `0f194c6403b9cce186373f230ae236ec6ff824548f95cfba63dafa67a75a8888`.
2. The master is the draft cropped to its outline and resized to 130 × 256 (SHA-256 `18043321b9f88f78be572d45060483028342c62cb9f48ecec6feb5351c518949`). The sail's mask takes pixels that are bright in blue and low in saturation, ramping in so its edge is soft (SHA-256 `4a40187b65139bd0cec11177609abc81e2cb333f3c4c0be182bd45e6248e0f03`).

It was checked on the four-player Outer Isles board in the design preview at 1440 × 900 and 390 × 844: each sail reads in its player's colour, and the pirate reads as a dark ship on open water.
