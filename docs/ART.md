# Game art

The current direction is expressive fantasy: exaggerated silhouettes, crooked organic forms, tactile painted surfaces, and warm light against cooler shadows. Original creature portraits and whimsical terrain share this direction. Dark walnut surrounds the brighter island and hand cards. The bitmap illustrations are original **AI-generated assets** made with the built-in image generation tool; “painted” describes their appearance, not a human commission.

## Current atlases and provenance

[Fantasy provenance](art/fantasy-provenance.json) records the exact source prompts, reference roles, accepted output filenames, dimensions, crop bounds, and SHA-256 hashes. Three user-provided images informed style only; their characters and scenes were not reproduced. Avatars, terrain, and development cards were fresh generations using those style references. Resource sprites were generated fresh without image references and have verified real alpha. Accepted PNGs were inspected and copied unchanged.

| Current atlas                                                        | Dimensions and layout             | Content and use                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Terrain](../apps/client/public/art/terrain-fantasy.png)             | 1536 × 1024; 3 × 2                | Timber, Clay, Sheep, Hay, Rock, Desert, in row-major order                                                             |
| [Sprites](../apps/client/public/art/sprites-fantasy.png)             | 1774 × 887; 4 × 2; real alpha     | Logs, clay, sheep, hay, rocks, mixed-resource crate, T-pier, sailboat                                                  |
| [Avatars](../apps/client/public/art/avatars-fantasy.png)             | 1448 × 1086; 4 × 3                | Twelve original fantasy personalities, from fox cartographer and pebble golem to witch herbalist and mushroom wanderer |
| [Development cards](../apps/client/public/art/development-cards.png) | 1254 × 1254; 3 × 2 portrait cells | Knight, Road Building, Year of Plenty, Monopoly, Victory Point, card back                                              |
| [Water and sand](../apps/client/public/art/environment-painted.png)  | 1254 × 1254; 2 × 2                | Deep ocean, shallow water, sand, lighter wood; the board uses the water and sand cells                                 |
| [Dark tabletop](../apps/client/public/art/environment-dark.png)      | 1254 × 1254; 2 × 2                | Historical environment atlas restored unchanged; the table uses its bottom-right walnut cell                           |

The avatar artwork has uneven row heights. [Profile.tsx](../apps/client/src/Profile.tsx) uses the measured row boundaries `0, 350, 698, 1086` and 362-pixel columns, with centered circular crops. Other measured boundaries and nominal atlas grids are recorded in the fantasy provenance. SVG view boxes and normalized shader coordinates select artwork without editing the source PNGs.

Profiles offer a display name and one of twelve portraits. Portraits use a consistent frame; there are no accent or frame choices. Assigned player colors still identify roads and buildings.

The painted environment is a built-in image-tool edit documented in [painted provenance](art/painted-provenance.json). The dark tabletop is byte-for-byte identical to `apps/client/public/art/environment.png` at Git revision `e7d567a649b3bf059cdaf12018e5843b91650483`; its original built-in generation prompt is in [vibrant provenance](art/vibrant-provenance.json). The fantasy provenance also records both currently used environment assets and the dark atlas's restoration source.

Only the active atlases belong in the browser's art directory. Superseded bitmap variants are retained in Git history. Earlier provenance records remain for traceability; [development provenance](art/development-provenance.json) is explicitly historical, and fantasy provenance is authoritative for the current development-card image.

## Terrain, pieces, and camera

[Terrain.tsx](../apps/client/src/Terrain.tsx) draws a static WebGL 2 terrain plane from the terrain and environment atlases. Inset hex masks feather biomes into shared sand. Shallow water, textured beach and foam follow the coast; eighteen ocean hexes form the outer ring. The SVG fallback uses the same art with a simpler shoreline.

Terrain redraws on load, resize, board changes and context recovery, with no idle render loop. Device pixel ratio is capped at two. The WebGL low-power preference is an advisory request. Graphics-driver behavior, touch handling and performance on lower-powered devices still require device testing.

[Pieces3D.tsx](../apps/client/src/Pieces3D.tsx) builds roads, settlements and cities from positioned CSS planes: solid road blocks, wall faces, pitched roofs, gables and foundations. These are code-built dimensional pieces, separate from the generated bitmap art. Their coordinates match the rules-engine edges and vertices. The 2D SVG pieces remain available when **3D pieces** is disabled; interaction targets and accessible labels stay in the board layer.

[BoardViewport.tsx](../apps/client/src/BoardViewport.tsx) places the scene in CSS perspective. With depth enabled it rests at a 12-degree pitch. Dragging pans and, when **Board movement** is enabled, gently tilts within 8–16 degrees of pitch and ±5 degrees of yaw. Tilt has no inertia or idle orbit. Reduced-motion preferences disable drag-induced tilt. Scroll, pinch and keyboard controls zoom between 85% and 220%; the fit button or `0` restores the view. Panning is bounded, and dragging suppresses accidental placement clicks.

Each harbor has two procedural planked bridges anchored to its eligible coastal corners and converging toward the boat. Specific ports use resource medallions; general ports use a question mark. The nine harbors retain four general and five specific trades. Procedural bridge geometry keeps the piers aligned with the actual rules-engine vertices.

## Cards and visual feedback

[DevelopmentCards.tsx](../apps/client/src/DevelopmentCards.tsx) composes the fantasy card illustrations with readable titles, counts, availability states and tooltips. The atlas contains artwork only; rules text and labels are rendered by the interface. Duplicate development cards share stacks, and the navy compass-and-leaf cell supplies the card back. The six current scenes and their exact generation prompt are recorded in fantasy provenance.

Resource hand cards combine the transparent resource art with paper edges, counts and a slight fan above the dark table. Dice throws, resource trails, card feedback and the cloud-and-compass scene transition are finite visual effects. The visual-effects preference and system reduced-motion setting select quieter presentation; depth and board movement have separate controls. Awards remain attached to player profiles.

## Fonts, icons, and licenses

[Lucide](https://lucide.dev/) supplies interface icons under ISC, including the listed Feather-derived icons under MIT. Cinzel supplies compact game titles and number tokens; Barlow supplies controls. Both fonts use SIL Open Font License 1.1 and are bundled locally through Fontsource.

Full notices ship with the browser distribution: [Lucide](../apps/client/public/licenses/lucide.txt), [Cinzel](../apps/client/public/licenses/cinzel.txt), [Barlow](../apps/client/public/licenses/barlow.txt). These assets retain their own licenses.

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record asserts no third-party trademark rights or exclusive ownership of generated imagery.
