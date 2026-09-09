# Game art

The current art is detailed, softly lit gouache-style terrain: distinct natural biomes, restrained saturation and lifted shadows. The table is lighter honey-walnut. Resource illustrations and twelve selectable portraits share the painted direction. These are original **AI-generated** assets, not human-painted commissions or official game art.

## Saved assets and prompts

An asset-only agent used the **built-in image generation tool** on 9 September 2026. Terrain and environment are edits of our previous original atlases; sprites and portraits are fresh generations. Accepted outputs were inspected and copied unchanged into the project. Sprites have verified real transparency. [Exact prompts, dimensions, references and SHA-256 provenance](art/painted-provenance.json).

| Saved asset                                                      | Dimensions and layout         | Row-major cell order                                                         |
| ---------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| [Terrain](../apps/client/public/art/terrain-painted.png)         | 1536 × 1024; 3 × 2            | Timber forest, Clay quarry, Sheep meadow, Hay fields, Rock mountains, Desert |
| [Environment](../apps/client/public/art/environment-painted.png) | 1254 × 1254; 2 × 2            | Deep ocean, shallow water, sandy ground, wood table                          |
| [Sprites](../apps/client/public/art/sprites-painted.png)         | 1774 × 887; 4 × 2; real alpha | Logs, clay, sheep, hay, rocks, mixed-resource crate, T-pier, sailboat        |
| [Avatars](../apps/client/public/art/avatars.png)                 | 1448 × 1086; 4 × 3            | Twelve distinct illustrated sailors, explorers and traders                   |

Environment and sprite outputs retain the requested grid proportions at different pixel dimensions. SVG view boxes and normalized shader coordinates select cells without editing the raster output. Portraits are offered with six accents and rope, brass or plain frames. Both the selected portrait and styling are saved; frame color is separate from the player's assigned road/house color.

## Rendering and readability

A static WebGL 2 layer samples the terrain and environment atlases. Inset hex masks with subtle noise feather each biome into shared sandy ground. A textured beach, shallow water and foam follow the coast. Eighteen ocean hexes form one outer ring, with a restrained physical rim at its exposed boundary.

The GPU layer draws on asset load, context recovery and resize, not on an idle animation loop. Device pixel ratio is capped at two. The SVG fallback displays the same atlas with displaced, feathered masks; its shoreline is simpler. Zoom transforms the board and is bounded between 85% and 220%; wheel/pinch deltas are capped, focal points are preserved, and panning keeps the board reachable. Dragging suppresses accidental placement clicks.

Each harbor has **two planked bridges**, one beginning at each eligible coastal corner, converging toward its boat. Resource medallions identify 2:1 ports; a question mark identifies a general 3:1 port. The mix remains four general and five specific harbors. Bridges are procedural SVG geometry so they stay aligned to actual rules-engine vertices.

Roads use solid rotated rectangles and a contrasting foundation. They avoid SVG filters on zero-width vertical line bounds, which could make vertical roads disappear. Houses and cities have larger silhouettes, roof highlights, windows and visible bases; the local player's pieces receive an extra pale outline. Number tokens and placement targets remain above terrain, with keyboard-accessible actions.

Hand cards use paper borders, stacked edges, counts, resource art and a slight fan above the bottom UI table edge. Awards live on player profiles. Finite feedback and notification motion honor reduced-motion preferences.

Images are served locally and revalidated with ETags; unchanged refreshes can reuse cached atlases. Slow-network image delivery, mobile graphics-driver behavior and real touch handling still require device testing. Optimized delivery formats can be added without replacing the source art.

## Fonts, icons and licenses

[Lucide](https://lucide.dev/) supplies interface icons under ISC, including the listed Feather-derived icons under MIT. Cinzel supplies compact game titles and number tokens; Barlow supplies controls. Both fonts use SIL Open Font License 1.1 and are bundled locally through Fontsource.

Full notices ship with the browser distribution: [Lucide](../apps/client/public/licenses/lucide.txt), [Cinzel](../apps/client/public/licenses/cinzel.txt), [Barlow](../apps/client/public/licenses/barlow.txt). These assets retain their own licenses.

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record asserts no third-party trademark rights or exclusive ownership of generated imagery. Previous art and prompt sets remain available in Git history.
