# Game art

The current direction is expressive fantasy: exaggerated silhouettes, crooked organic forms, tactile painted surfaces, and warm light against cooler shadows. Original creature portraits and whimsical terrain share this direction. Dark walnut surrounds the brighter island and hand cards. The bitmap illustrations are original **AI-generated assets** made with the built-in image generation tool; “painted” describes their appearance, not a human commission.

## Current assets and provenance

[Fantasy provenance](art/fantasy-provenance.json) records the exact source prompts, reference roles, accepted output filenames, dimensions, crop bounds, and SHA-256 hashes. Three user-provided images informed style only; their characters and scenes were not reproduced. Avatars, terrain, and development cards were fresh generations using those style references. Resource sprites were generated fresh without image references and have verified real alpha. Accepted PNGs were inspected and copied unchanged.

[Interface provenance](art/interface-provenance.json) records the generated rope-and-wood frame and a rejected icon-atlas experiment. Only the frame is shipped from that generation: its texture is used as a 3–4 pixel CSS border-image around portraits and selected controls. The runtime interface uses original editable SVG icons in [GameIcons.tsx](../apps/client/src/GameIcons.tsx). The rejected icon atlas is not part of the browser's assets.

| Current asset                                                        | Dimensions and layout             | Content and use                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Terrain](../apps/client/public/art/terrain-fantasy.png)             | 1536 × 1024; 3 × 2                | Timber, Clay, Sheep, Hay, Rock, Desert, in row-major order                                                             |
| [Sprites](../apps/client/public/art/sprites-fantasy.png)             | 1774 × 887; 4 × 2; real alpha     | Logs, clay, sheep, hay, rocks, mixed-resource crate, T-pier, sailboat                                                  |
| [Avatars](../apps/client/public/art/avatars-fantasy.png)             | 1448 × 1086; 4 × 3                | Twelve original fantasy personalities, from fox cartographer and pebble golem to witch herbalist and mushroom wanderer |
| [Development cards](../apps/client/public/art/development-cards.png) | 1254 × 1254; 3 × 2 portrait cells | Knight, Road Building, Year of Plenty, Monopoly, Victory Point, card back                                              |
| [Water and sand](../apps/client/public/art/environment-painted.png)  | 1254 × 1254; 2 × 2                | Deep ocean, shallow water, sand, lighter wood; the board uses the water and sand cells                                 |
| [Dark tabletop](../apps/client/public/art/environment-dark.png)      | 1254 × 1254; 2 × 2                | Historical environment atlas restored unchanged; the table uses its bottom-right walnut cell                           |
| [Portrait border](../apps/client/public/art/portrait-frame.png)      | 1254 × 1254; real alpha           | Rope, carved wood and brass texture, sliced into thin portrait and control borders                                     |

The avatar artwork has uneven row heights. [Profile.tsx](../apps/client/src/Profile.tsx) uses the measured row boundaries `0, 350, 698, 1086` and 362-pixel columns, with centered crops in rounded-square portraits. Other measured boundaries and nominal atlas grids are recorded in the fantasy provenance. SVG view boxes and normalized shader coordinates select artwork without editing the source PNGs. Generation prompts retain their original crop instructions as a historical record; the interface controls the current crop shape.

Profiles offer a display name and one of twelve portraits. Portraits use a consistent frame; there are no accent or frame choices. Assigned player colors still identify roads and buildings.

The painted environment is a built-in image-tool edit documented in [painted provenance](art/painted-provenance.json). The dark tabletop is byte-for-byte identical to `apps/client/public/art/environment.png` at Git revision `e7d567a649b3bf059cdaf12018e5843b91650483`; its original built-in generation prompt is in [vibrant provenance](art/vibrant-provenance.json). The fantasy provenance also records both currently used environment assets and the dark atlas's restoration source.

Only active bitmap assets belong in the browser's art directory. Superseded bitmap variants are retained in Git history. Earlier provenance records remain for traceability; [development provenance](art/development-provenance.json) is explicitly historical, and fantasy provenance is authoritative for the current development-card image.

## Terrain, pieces, and camera

[Terrain.tsx](../apps/client/src/Terrain.tsx) draws a static, straight-down WebGL 2 terrain plane from the terrain and environment atlases. Inset hex masks feather biomes into shared sand. Shallow water, textured beach and foam follow the coast, surrounded by one continuous sea band with a rugged outer edge. The SVG fallback uses the same art with a simpler shoreline and the same continuous water boundary.

Terrain redraws on load, resize, board changes and context recovery, with no idle render loop. Device pixel ratio is capped at two. The WebGL low-power preference is an advisory request. Graphics-driver behavior, touch handling and performance on lower-powered devices still require device testing.

[Board.tsx](../apps/client/src/Board.tsx) draws roads, settlements and cities as bright player-colored SVG shapes, with dark edges, highlights and small static ground shadows. They share coordinates with the rules-engine edges and vertices. Interaction targets and accessible labels stay in that same flat board layer.

[BoardViewport.tsx](../apps/client/src/BoardViewport.tsx) moves the flat island and walnut table texture together. Scroll, pinch and keyboard controls zoom between 85% and 220%; dragging pans within bounds and suppresses accidental placement clicks. Wheel and keyboard zoom have a short glide that ends at its target. With the board focused, `0` restores the initial view. The interface has no Fit button or tilt settings. Reduced motion removes the camera glide. [Board and dice presentation](3D_NOTES.md).

Each harbor has two procedural planked bridges anchored to its eligible coastal corners and converging toward the boat. Specific ports use resource medallions; general ports use a question mark. The nine harbors retain four general and five specific trades. Procedural bridge geometry keeps the piers aligned with the actual rules-engine vertices.

## Cards and visual feedback

[DevelopmentCards.tsx](../apps/client/src/DevelopmentCards.tsx) places a compact illustrated hand inline beside the resource cards, with counts, availability symbols and a purchase card. Selecting a development card opens its title, rules and Play controls; its tooltip retains the illustrated story and availability explanation. The atlas contains artwork only. Duplicate development cards share stacks, and the navy compass-and-leaf cell supplies the card back. The six current scenes and their exact generation prompt are recorded in fantasy provenance.

Resource hand cards combine transparent resource art, distinct material colors and counts in a small fan above the dark table. They omit visible resource names and tooltips while retaining accessible names and quantities. One square Roll/End control and Trade sit beside the hand. Dice throws, resource trails, profile +N receipts and the cloud-and-compass scene transition are finite visual effects. The system reduced-motion setting selects quieter presentation. Scores, awards and the current-turn marker remain attached to player profiles. Settings contain volume and the optional turn timer.

## Fonts, icons, and licenses

Interface icons are original SVG shapes maintained in [GameIcons.tsx](../apps/client/src/GameIcons.tsx), with filled silhouettes, ink edges and a shared color palette. They are editable repository contributions and have no Lucide runtime dependency. Cinzel supplies compact game titles and number tokens; Barlow supplies controls. Both fonts use SIL Open Font License 1.1 and are bundled locally through Fontsource.

Font notices ship with the browser distribution: [Cinzel](../apps/client/public/licenses/cinzel.txt) and [Barlow](../apps/client/public/licenses/barlow.txt). These fonts retain their own licenses. The retained [Lucide notice](../apps/client/public/licenses/lucide.txt) documents the earlier icon set; it does not describe the current interface artwork.

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record asserts no third-party trademark rights or exclusive ownership of generated imagery.
