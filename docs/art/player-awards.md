# Small game icons

Generated with the built-in image generation tool on September 13, 2026. The previous detailed award illustrations were replaced: tiny ribbons, foliage and stonework lost clarity at HUD sizes.

The new icons use broad silhouettes and very few color planes. Each atlas cell was cropped inside the grid, transparent padding trimmed, resized to 96×96, and encoded as WebP at quality 80 / effort 6 with alpha preserved. Generated originals remain outside the repository. No bitmap was wrapped in SVG to disguise its size.

## Assets

- `apps/client/public/art/optimized/simple-road.57796f6c7d77.webp` — 2,794 bytes.
- `apps/client/public/art/optimized/simple-house.f39f2d94e881.webp` — 3,546 bytes.
- `apps/client/public/art/optimized/simple-city.4b3917a61969.webp` — 4,218 bytes.
- `apps/client/public/art/optimized/simple-victory.994c816b98f8.webp` — 4,834 bytes.
- `apps/client/public/art/optimized/simple-buy-development.73b2758ddd18.webp` — 4,140 bytes.
- `apps/client/public/art/optimized/simple-road-award.a16c85e5b0e5.webp` — 4,332 bytes.
- `apps/client/public/art/optimized/simple-army-award.8e351c70c123.webp` — 4,780 bytes.

The two award icons replace the previous icons. The five road/house/city/trophy/purchase experiments are enabled only inside the development preview via **Preview → Simple icon study**. Toggle it off to compare existing icons. Gameplay pieces on the island are unchanged. The production application does not enable this icon study.

## Generation prompt

A production sprite atlas for a playful fantasy board game, 4 columns by 2 rows of exactly equal square cells, transparent background, each icon centered with 15 percent clear padding and similar visual weight. Designed FIRST for a tiny 32-pixel display: big clear silhouettes, only 2 or 3 broad color planes per object, a few soft painted edge highlights. Clean charming hand-painted cartoon game icons, NOT intricate illustrations, no realistic surface texture, no little stones, no leaves, no scenery, no fine ornament, no lettering, no glow. Top row left to right: 1 a short curving warm terracotta road of just THREE large paving slabs; 2 one ivory cottage with a large red roof and dark doorway; 3 two joined ivory towers with blue roofs, a simple city silhouette; 4 a gold victory trophy with broad handles and a teal gem. Bottom row left to right: 1 a purple development card with a simple gold four-point star and a clearly visible small plus badge in lower right; 2 Longest Road medal: THREE terracotta paving slabs across a plain gold shield with teal ribbon ends; 3 Largest Army medal: one simple silver knight helmet over a plain blue shield with gold rim and short plum ribbon ends; 4 leave completely empty transparent. Each icon should be a simple purposeful drawing with minimal internal lines, readable as a postage stamp. No heavy beveled borders. Actual alpha transparency. Square 4x2 atlas layout, wide 2:1 image.
