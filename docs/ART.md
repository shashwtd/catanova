# Terrain art

Active asset: [`apps/client/public/art/terrain-simple.png`](../apps/client/public/art/terrain-simple.png).

Generated 9 September 2026 using the **built-in image generation tool**, in one fresh request by an asset-only agent. No input/reference image or third-party artwork was used. The owner inspected the result and copied the chosen output into this repository. It replaces an earlier detailed painterly experiment, which is not shipped.

The user requested simpler, playful terrain that reads immediately at board size. The atlas is 1536 × 1024 PNG: three columns and two rows of 512 × 512 cells, with no gutters. Row-major order: Timber, Clay, Sheep, Hay, Rock, Desert. SVG view boxes select cells, then functional hex clip paths mask them. Resource cards use the same atlas. No image-generation API is called by the running game.

This project distributes its contribution under the repository's MIT license, to the extent rights apply. This provenance record is not a claim of third-party trademark rights or exclusive ownership of generated imagery.

## Final generation prompt

```text
Use case: stylized-concept
Asset type: replacement terrain texture atlas for a friendly miniature strategy board game.
Primary request: Generate ONE new landscape PNG image, exactly 1536 by 1024 pixels, aspect ratio 3:2. Arrange exactly six equally sized SQUARE cells in a precise 3-column by 2-row grid. Each cell is exactly 512 by 512 pixels. No gutters, no borders; six terrains fill the whole canvas edge to edge with clean straight transitions at x=512 and x=1024, y=512.
Cell order from left to right then top to bottom: TOP LEFT Timber: a saturated deep-green background with just a few big friendly rounded or conical evergreen trees. TOP MIDDLE Clay: a softly saturated terracotta-orange background with a few large smooth simple clay mounds. TOP RIGHT Sheep: a much lighter fresh mint/lime meadow background with a few big plump white sheep with simple dark faces. BOTTOM LEFT Hay: a golden-yellow background with two or three big simple hay bales and broad simple golden field bands. BOTTOM MIDDLE Rock: a cool gray-blue background with just a few big chunky gray boulders. BOTTOM RIGHT Desert: a pale sandy-yellow background with broad simple smooth sand dunes.
Style/medium: extremely simple and playful flat illustration with a little dimensional shape from hard-edged flat color facets. Bold, friendly, chunky toy-like shapes. Use only 2 to 4 flat color shades per terrain. Sparse compositions with few big instantly recognizable resource symbols, generous simple background areas, minimal texture and no tiny detail. No complicated scenery. Crisp soft-edged silhouettes, cheerful accessible tabletop-game feel.
Composition/framing: each terrain cell must read immediately when cropped into a roughly 100-pixel-wide hex tile, with a large round number token covering the exact center. Spread the few big symbols around each cell so terrain can still be recognized from its outer portions; do not rely on a single central object. Consistent softly overhead view, coherent object size across all cells.
Color palette: clearly distinguish saturated green forest from much lighter mint/lime sheep meadow, golden hay, orange clay, cool gray-blue rock, and pale sand. Cell backgrounds saturated but softly contrasted.
Constraints: NO gradients. NO text, letters, numbers, labels, watermark, grid outlines, borders, gutters, hexagon outlines, UI, coastlines, brand imitation. NO fussy painterly foliage, brush texture, quarry scenes, elaborate mountain landscapes, tiny stones, tiny flowers, tiny grass strokes, complex shading, or decorative detail. Keep everything intentionally simple and playful.
```

The generated result has minor soft tonal variation; its large shapes and resource categories were accepted as the simplified direction. Future art revisions should preserve this readability and record their own provenance.
