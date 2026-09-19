# Game art

The current direction is expressive fantasy: exaggerated silhouettes, crooked organic forms, tactile painted surfaces, and warm light against cooler shadows. Original creature portraits and whimsical terrain share this direction. Dark walnut surrounds the brighter island and hand cards. The bitmap illustrations are original **AI-generated assets** made with the built-in image generation tool; “painted” describes their appearance, not a human commission.

## Current assets and provenance

[Fantasy provenance](art/fantasy-provenance.json) records the exact source prompts, reference roles, accepted output filenames, dimensions, crop bounds, and SHA-256 hashes. Three user-provided images informed style only; their characters and scenes were not reproduced. Avatars, terrain, and development cards were fresh generations using those style references. Resource sprites were generated fresh without image references and have verified real alpha. Accepted PNGs were inspected and copied unchanged.

[Title landscape provenance](art/title-provenance.json) records the exact text-only generation prompt, unchanged source filename, dimensions and hash for the coastal title/lobby painting. No reference images were supplied. The saved RGB PNG is byte-for-byte identical to the generated output; titles and controls are separate code-rendered layers.

[Catanova identity](art/logo-concepts/README.md) contains the brighter standalone mark and matching full wordmark, with exact generation prompts and hashes. The landing menu places the cream-backed wordmark on a matching paper surface over the title landscape; the separate mark has transparent alpha.

[Branding exports](BRANDING_EXPORTS.md) records the optimized favicon/app-icon sizes and social-preview composition made from those approved originals. The source PNGs remain unchanged; the technical crop, resizing and encoding steps are reproducible.

[Interface provenance](art/interface-provenance.json) records the generated rope-and-wood frame and a rejected icon-atlas experiment. Only the frame is shipped from that generation, as a 3–4 pixel portrait border. Buttons use simple borders and original editable SVG icons in [GameIcons.tsx](../apps/client/src/GameIcons.tsx), without scaled rope artwork. The rejected icon atlas is not part of the browser's assets.

The links below point to the compressed browser files. Historical PNG names and original prompts remain in the provenance records; they are not runtime URLs.

| Browser asset                                                                                        | Delivered dimensions | Current use / provenance                                                                    |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| [Title landscape](../apps/client/public/art/optimized/title-landscape.05db8101ac33.webp)             | 1672 × 941           | Public landing only; [prompt](art/title-provenance.json)                                    |
| [Storybook terrain](../apps/client/public/art/optimized/terrain-storybook.102c1df356ce.webp)         | 1536 × 1024          | Default personal board theme; [prompt](art/terrain-concept.md)                              |
| [Storybook environment](../apps/client/public/art/optimized/environment-storybook.0265406d629e.webp) | 1024 × 1024          | Default board water and sand; [prompt](art/terrain-concept.md)                              |
| [Classic terrain](../apps/client/public/art/optimized/terrain-fantasy.777e0ac07117.webp)             | 1536 × 1024          | Optional Classic board theme; [prompt](art/fantasy-provenance.json)                         |
| [Classic environment](../apps/client/public/art/optimized/environment-painted.00c506c983c0.webp)     | 1254 × 1254          | Classic water and sand; [prompt](art/painted-provenance.json)                               |
| [Dark tabletop](../apps/client/public/art/optimized/environment-dark.c55c6de597e4.webp)              | 1254 × 1254          | Bottom-right walnut cell used in play, hub and lobby; [prompt](art/vibrant-provenance.json) |
| [Sprites](../apps/client/public/art/optimized/sprites-fantasy.3aaf69915ec6.webp)                     | 1774 × 887           | Resources and ship; [prompt](art/fantasy-provenance.json)                                   |
| [Avatars](../apps/client/public/art/optimized/avatars-fantasy.6bf04e83341a.webp)                     | 1448 × 1086          | Twelve fantasy portraits; [prompt](art/fantasy-provenance.json)                             |
| [Development cards](../apps/client/public/art/optimized/development-cards.e40eabee1fa7.webp)         | 768 × 768            | Six illustrated card faces; [prompt](art/development-cards-readable.md)                     |
| [Painted icons](../apps/client/public/art/optimized/painted-icons.ca739109762c.webp)                 | 576 × 432            | Gameplay controls and medals; [prompt](art/painted-ui-icons.md)                             |
| [Portrait border](../apps/client/public/art/optimized/portrait-frame.de152d0c9426.webp)              | 1254 × 1254          | Thin portrait decoration; [prompt](art/interface-provenance.json)                           |
| [Wordmark](../apps/client/public/art/optimized/catanova-logo-v2.a161a887edbc.webp)                   | 2172 × 724           | Landing identity; [prompt](art/logo-concepts/provenance-v2.json)                            |
| [App mark](../apps/client/public/art/optimized/catanova-mark-v2.77f0ea5ff580.webp)                   | 1254 × 1254          | Standalone identity; [prompt](art/logo-concepts/provenance-v2.json)                         |

[Quiet coastal lounge](../apps/client/public/art/optimized/quiet-lounge.336ba3af237d.webp), 1600 × 900 / 53,072 bytes, is retained for reverting the pregame visual commit but is **not the active hub/lobby background**. Its [generation and compression record](art/coastal-lounge.md) replaces the earlier 91,832-byte coastal-lounge reference. The older `development-cards.d7fcdf84252a.webp` export is also retained in the asset directory; current card rendering uses the `e40eabee1fa7` file above.

The avatar artwork has uneven row heights. [Profile.tsx](../apps/client/src/Profile.tsx) uses the measured row boundaries `0, 350, 698, 1086` and 362-pixel columns, with centered crops in rounded-square portraits. Other measured boundaries and nominal atlas grids are recorded in the fantasy provenance. SVG view boxes and normalized shader coordinates select artwork without editing the source PNGs. Generation prompts retain their original crop instructions as a historical record; the interface controls the current crop shape.

Profiles use a chosen username and one of twelve generated portraits with a consistent thin frame. Google profile names and photos are not used. Coral, cyan, lilac and gold portrait outlines match the assigned piece colors. The caption places a name above compact points, resource-card and development-card counts. Road/army badges remain; a phase icon identifies what a player must do, including independent discard obligations. A faint red tint and translucent Wi-Fi-off symbol identify disconnected portraits while keeping the face visible. There are no separate accent or frame choices.

The painted environment is a built-in image-tool edit documented in [painted provenance](art/painted-provenance.json). The dark tabletop is byte-for-byte identical to `apps/client/public/art/environment.png` at Git revision `e7d567a649b3bf059cdaf12018e5843b91650483`; its original built-in generation prompt is in [vibrant provenance](art/vibrant-provenance.json). The fantasy provenance also records both currently used environment assets and the dark atlas's restoration source.

Active bitmap assets are listed above; the two explicitly retained exports are not additional runtime preload requirements. Other superseded variants remain in Git history. Earlier provenance records remain for traceability; [development provenance](art/development-provenance.json) is explicitly historical, and fantasy provenance is authoritative for the current development-card image.

## Terrain, pieces, and camera

[Terrain.tsx](../apps/client/src/Terrain.tsx) draws a static, straight-down WebGL 2 terrain plane from the existing atlases. Inset hex masks feather biomes into shared sand. Shallow water, beach and foam follow the same island coast, with a broad transparent feather at the outer edge of the sea band. Mirrored material repeats and inset atlas sampling reduce seams and neighboring-cell bleed. The SVG fallback uses the same art, mirrored repeat convention and sea-boundary constants.

Terrain redraws on load, resize, board changes and context recovery, with no idle render loop. Device pixel ratio is capped at two. The WebGL low-power preference is an advisory request. Graphics-driver behavior, touch handling and performance on lower-powered devices still require device testing.

[Board.tsx](../apps/client/src/Board.tsx) restores the flat road, settlement and city shapes from revision `3813b24`, in coral, cyan, lilac and gold, with their original narrow dark contours, roof lines and small ground shadows. They share coordinates with rules-engine edges and vertices. Affordable legal sites show matching piece previews on hover/focus; clicking opens the separate placement confirmation.

[BoardViewport.tsx](../apps/client/src/BoardViewport.tsx) moves the flat island and walnut table texture together. Scroll, pinch and keyboard controls zoom between 85% and 220%; dragging pans within bounds and suppresses accidental placement clicks. Wheel and keyboard zoom have a short glide that ends at its target. With the board focused, `0` restores the initial view. The interface has no Fit button or tilt settings. Reduced motion removes the camera glide. [Board and dice presentation](3D_NOTES.md).

Each harbor has two procedural planked bridges anchored to its eligible coastal corners. The 80-pixel sailboat sprite rotates with the coastal edge so its exposed side faces land. Each bridge reaches a separate boarding point; the resource-and-ratio badge sits beyond the seaward side of the hull. All rotated ship and badge bounds stay inside the board view. General ports use a question mark; the nine harbors retain four general and five resource-specific trades. Port ownership remains tied to the same two rules-engine vertices.

## Cards and visual feedback

[DevelopmentCards.tsx](../apps/client/src/DevelopmentCards.tsx) places a compact illustrated hand inline beside the resource counters, with counts, availability symbols and a glossy surface. Its separate purchase slot uses a plus/development icon with Sheep, Hay and Rock price sprites. Selecting a held card opens its rules and Play controls; its tooltip retains the story and availability explanation. Duplicate cards share stacks. The optimized atlas uses simpler, character-free illustrations; each face is clipped to its own cell. Generation prompts are recorded in the art provenance.

Resources are bright icon-and-number counters on a compact wooden shelf, with no hover behavior. Development cards sit beside them in illustrated stacks. The square development purchase tile matches Trade; the shared Roll/Next control is larger. Dice, resource trails, profile +N receipts and scene transitions are finite; reduced motion quiets spatial effects. Player settings include separate effects/music controls and a personal board theme. Hosts configure the turn timer, victory target and dice mode before launch.

## Fonts, icons, and licenses

Interface icons use a small compressed painted atlas through [GameIcons.tsx](../apps/client/src/GameIcons.tsx), with lightweight vectors for controls that need precise directional or player-colored feedback. Rules uses a book; connection uses Wi-Fi arcs with a slashed offline variant; fullscreen has distinct enter and exit shapes. Turn-grouped history reuses action and resource icons. Cinzel supplies titles; Barlow supplies controls and number tokens.

Reaction faces are drawn as SVG in [ReactionArt.tsx](../apps/client/src/ReactionArt.tsx) and are original artwork, not emoji. Emoji are rendered by the reader's own device, so the same character is a different face on every platform and none of them share this island's palette; drawing them here keeps one expression everywhere and adds nothing to download. Every face is built the same way — a wax disc, a soft highlight, and brows, eyes and a mouth in one ink — so fourteen feelings read as one set.

Font notices ship with the browser distribution: [Cinzel](../apps/client/public/licenses/cinzel.txt) and [Barlow](../apps/client/public/licenses/barlow.txt). Both fonts retain their SIL Open Font License 1.1.

Google sign-in uses Google's official unmodified mark and locally served Google Sans. The external repository link uses GitHub's official Invertocat. These are third-party provider assets, excluded from claims about original MIT-licensed Catanova artwork. Their sources, usage terms and the Google Sans OFL notice are recorded in [provider marks](PROVIDER_MARKS.md).

Original repository contributions are distributed under MIT to the extent rights apply. This provenance record asserts no third-party trademark rights or exclusive ownership of generated imagery.

The approved Storybook terrain and water are the default personal board theme. Classic remains available in Settings and the choice is saved on each device. See [concept art and prompts](art/terrain-concept.md). Preview event controls and sample game data stay outside the production browser build.
