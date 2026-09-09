# Game art

The current direction is expressive fantasy: exaggerated silhouettes, crooked organic forms, tactile painted surfaces, and warm light against cooler shadows. Original creature portraits and whimsical terrain share this direction. Dark walnut surrounds the brighter island and hand cards. The bitmap illustrations are original **AI-generated assets** made with the built-in image generation tool; “painted” describes their appearance, not a human commission.

## Current assets and provenance

[Fantasy provenance](art/fantasy-provenance.json) records the exact source prompts, reference roles, accepted output filenames, dimensions, crop bounds, and SHA-256 hashes. Three user-provided images informed style only; their characters and scenes were not reproduced. Avatars, terrain, and development cards were fresh generations using those style references. Resource sprites were generated fresh without image references and have verified real alpha. Accepted PNGs were inspected and copied unchanged.

[Title landscape provenance](art/title-provenance.json) records the exact text-only generation prompt, unchanged source filename, dimensions and hash for the coastal title/lobby painting. No reference images were supplied. The saved RGB PNG is byte-for-byte identical to the generated output; titles and controls are separate code-rendered layers.

[Catanova identity](art/logo-concepts/README.md) contains the brighter standalone mark and matching full wordmark, with exact generation prompts and hashes. The landing menu places the cream-backed wordmark on a matching paper surface over the title landscape; the separate mark has transparent alpha.

[Interface provenance](art/interface-provenance.json) records the generated rope-and-wood frame and a rejected icon-atlas experiment. Only the frame is shipped from that generation, as a 3–4 pixel portrait border. Buttons use simple borders and original editable SVG icons in [GameIcons.tsx](../apps/client/src/GameIcons.tsx), without scaled rope artwork. The rejected icon atlas is not part of the browser's assets.

| Current asset                                                        | Dimensions and layout             | Content and use                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Title landscape](../apps/client/public/art/title-landscape.png)     | 1672 × 941; opaque RGB            | Coastal scenery for title and lobby, with open pale sky at left and darker wooded background at right                  |
| [Terrain](../apps/client/public/art/terrain-fantasy.png)             | 1536 × 1024; 3 × 2                | Timber, Clay, Sheep, Hay, Rock, Desert, in row-major order                                                             |
| [Sprites](../apps/client/public/art/sprites-fantasy.png)             | 1774 × 887; 4 × 2; real alpha     | Logs, clay, sheep, hay, rocks, mixed-resource crate, T-pier, sailboat                                                  |
| [Avatars](../apps/client/public/art/avatars-fantasy.png)             | 1448 × 1086; 4 × 3                | Twelve original fantasy personalities, from fox cartographer and pebble golem to witch herbalist and mushroom wanderer |
| [Development cards](../apps/client/public/art/development-cards.png) | 1254 × 1254; 3 × 2 portrait cells | Knight, Road Building, Year of Plenty, Monopoly, Victory Point, card back                                              |
| [Water and sand](../apps/client/public/art/environment-painted.png)  | 1254 × 1254; 2 × 2                | Deep ocean, shallow water, sand, lighter wood; the board uses the water and sand cells                                 |
| [Dark tabletop](../apps/client/public/art/environment-dark.png)      | 1254 × 1254; 2 × 2                | Historical environment atlas restored unchanged; the table uses its bottom-right walnut cell                           |
| [Portrait border](../apps/client/public/art/portrait-frame.png)      | 1254 × 1254; real alpha           | Rope, carved wood and brass texture, sliced into a thin portrait border                                                |

The avatar artwork has uneven row heights. [Profile.tsx](../apps/client/src/Profile.tsx) uses the measured row boundaries `0, 350, 698, 1086` and 362-pixel columns, with centered crops in rounded-square portraits. Other measured boundaries and nominal atlas grids are recorded in the fantasy provenance. SVG view boxes and normalized shader coordinates select artwork without editing the source PNGs. Generation prompts retain their original crop instructions as a historical record; the interface controls the current crop shape.

Profiles use a username and a choice of twelve generated portraits or a verified Google profile photo, with a consistent thin frame and a generated fallback if a photo fails to load. Coral, cyan, lilac and gold portrait outlines match the assigned piece colors. The caption places a name above compact points, resource-card and development-card counts. Road/army badges remain; a phase icon identifies what a player must do, including independent discard obligations. A faint red tint and translucent Wi-Fi-off symbol identify disconnected portraits while keeping the face visible. There are no separate accent or frame choices.

The painted environment is a built-in image-tool edit documented in [painted provenance](art/painted-provenance.json). The dark tabletop is byte-for-byte identical to `apps/client/public/art/environment.png` at Git revision `e7d567a649b3bf059cdaf12018e5843b91650483`; its original built-in generation prompt is in [vibrant provenance](art/vibrant-provenance.json). The fantasy provenance also records both currently used environment assets and the dark atlas's restoration source.

Only active bitmap assets belong in the browser's art directory. Superseded bitmap variants are retained in Git history. Earlier provenance records remain for traceability; [development provenance](art/development-provenance.json) is explicitly historical, and fantasy provenance is authoritative for the current development-card image.

## Terrain, pieces, and camera

[Terrain.tsx](../apps/client/src/Terrain.tsx) draws a static, straight-down WebGL 2 terrain plane from the existing atlases. Inset hex masks feather biomes into shared sand. Shallow water, beach and foam follow the same island coast, with a broad transparent feather at the outer edge of the sea band. Mirrored material repeats and inset atlas sampling reduce seams and neighboring-cell bleed. The SVG fallback uses the same art, mirrored repeat convention and sea-boundary constants.

Terrain redraws on load, resize, board changes and context recovery, with no idle render loop. Device pixel ratio is capped at two. The WebGL low-power preference is an advisory request. Graphics-driver behavior, touch handling and performance on lower-powered devices still require device testing.

[Board.tsx](../apps/client/src/Board.tsx) restores the flat road, settlement and city shapes from revision `3813b24`, in coral, cyan, lilac and gold, with their original narrow dark contours, roof lines and small ground shadows. They share coordinates with rules-engine edges and vertices. Affordable legal sites show matching piece previews on hover/focus; clicking opens the separate placement confirmation.

[BoardViewport.tsx](../apps/client/src/BoardViewport.tsx) moves the flat island and walnut table texture together. Scroll, pinch and keyboard controls zoom between 85% and 220%; dragging pans within bounds and suppresses accidental placement clicks. Wheel and keyboard zoom have a short glide that ends at its target. With the board focused, `0` restores the initial view. The interface has no Fit button or tilt settings. Reduced motion removes the camera glide. [Board and dice presentation](3D_NOTES.md).

Each harbor has two procedural planked bridges anchored to its eligible coastal corners and converging toward the boat. The original painted sailboat sprite is displayed horizontally at every port, using an 80-pixel square crop with a roughly 76-pixel visible hull. Both bridges meet a shared point on its shore-facing side. Small resource-colored badges sit above or beside each ship and show its resource and ratio; general ports use a question mark. The nine harbors retain four general and five specific trades. Procedural bridge geometry keeps the piers aligned with the actual rules-engine vertices.

## Cards and visual feedback

[DevelopmentCards.tsx](../apps/client/src/DevelopmentCards.tsx) places a compact illustrated hand inline beside the resource cards, with counts, availability symbols and a glossy surface. Its separate purchase slot uses a plus/development icon with Sheep, Hay and Rock price sprites. Selecting a held card opens its rules and Play controls; its tooltip retains the story and availability explanation. Duplicate cards share stacks. The atlas remains unchanged, including its navy compass-and-leaf back cell; generation prompts are recorded in fantasy provenance.

Resource hand cards combine transparent art, distinct material colors and counts within one uniform border. Their mild vertical color gradient has no diagonal sheen, bright top/left trim or offset backing layer. They omit visible names/tooltips while retaining accessible names and quantities. Positive cards keep hover sound independently of reduced motion; empty cards stay still and silent. The square development purchase tile matches Trade; the shared Roll/End control is larger. Trade stays to its left, with space between hand groups. Dice, resource trails, profile +N receipts and scene transitions are finite; reduced motion quiets spatial effects. Settings contain volume and the optional turn timer.

## Fonts, icons, and licenses

Interface icons are original SVG shapes in [GameIcons.tsx](../apps/client/src/GameIcons.tsx), with filled silhouettes, ink edges and a shared palette. Rules uses a book; connection uses Wi-Fi arcs with a slashed offline variant; fullscreen has distinct enter and exit shapes. Turn-grouped history reuses action and resource icons. Cinzel supplies titles; Barlow supplies controls and number tokens.

Font notices ship with the browser distribution: [Cinzel](../apps/client/public/licenses/cinzel.txt) and [Barlow](../apps/client/public/licenses/barlow.txt). Both fonts retain their SIL Open Font License 1.1.

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record asserts no third-party trademark rights or exclusive ownership of generated imagery.
