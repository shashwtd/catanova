# Game art

The current direction is vibrant, textured miniature terrain with distinct biomes. It replaces the earlier flat, oversized resource illustrations. The game loads these files locally; it makes no image-generation calls at runtime.

## Original generated assets

All three atlases were generated on 9 September 2026 with the **built-in image generation tool**, by an asset-only agent. These were fresh generations with no input/reference images or third-party game artwork. The outputs were inspected and copied unchanged into the repository. Exact prompts, actual output dimensions and source filenames are recorded in [the prompt set](art/vibrant-provenance.json).

| Asset                                                    | Actual dimensions             | Cell order, left to right then top to bottom                                                                           |
| -------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Terrain](../apps/client/public/art/terrain-vibrant.png) | 1536 × 1024, 3 × 2            | Dark pine forest; orange clay quarry; light green sheep pasture; golden hay fields; slate-blue mountains; sandy desert |
| [Environment](../apps/client/public/art/environment.png) | 1254 × 1254, 2 × 2            | Deep ocean; shallow turquoise water; sandy ground; dark walnut tabletop                                                |
| [Sprites](../apps/client/public/art/sprites.png)         | 1774 × 887, 4 × 2, real alpha | Logs; clay; sheep; hay; rocks; mixed-resource crate; top-down wooden T-pier; sailboat                                  |

The environment and sprite outputs differ from the requested pixel dimensions but retain the exact grid proportions. SVG view boxes and normalized shader coordinates select cells without rewriting the source imagery. The optional boat sprite is included in the atlas but currently unused.

## Rendering

A static WebGL 2 layer samples the terrain and environment atlases. Slightly inset hex masks with low-amplitude noise feather each biome into shared sandy ground. A textured beach, shallow water and foam follow the island coast. Eighteen visible ocean hexes form one complete outer ring; only its exposed boundary receives a subtle physical rim. The surrounding table uses the wood material.

The GPU layer draws on asset load and resize, not on a continuous animation loop. Device pixel ratio is capped at two. If WebGL is unavailable or its context is lost, an SVG layer displays the same atlas with displaced, blurred terrain masks; its shoreline is simpler. SVG remains responsible for number tokens, ports, pieces and keyboard-accessible placement targets.

Every pier starts at its coastal edge midpoint and faces perpendicular to that edge toward the sea. Resource/crate sprites and a trade ratio identify its port. Hand cards and trade controls reuse those same resource sprites. Timber stays dark green; Sheep stays light green; Hay, Clay and Rock have separate yellow, orange and blue-gray palettes.

These source PNGs total about 8 MB before browser caching. Load time on slow connections, graphics-driver behavior and mobile frame times still require device testing. An optimized delivery format can be introduced without changing the source artwork.

## Fonts and controls

[Lucide](https://lucide.dev/) supplies interface icons under its ISC license, including the listed Feather-derived icons under MIT. [Cinzel](https://fontsource.org/fonts/cinzel) supplies compact game titles and number tokens; [Barlow](https://fontsource.org/fonts/barlow) supplies controls and other text. Both fonts use SIL Open Font License 1.1. Fonts are bundled locally through Fontsource, with no external font request.

The full notices ship with the browser distribution: [Lucide](../apps/client/public/licenses/lucide.txt), [Cinzel](../apps/client/public/licenses/cinzel.txt), [Barlow](../apps/client/public/licenses/barlow.txt). Those assets retain their own licenses.

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record does not assert third-party trademark rights or exclusive ownership of generated imagery. Earlier art and its prompts remain available in Git history.
