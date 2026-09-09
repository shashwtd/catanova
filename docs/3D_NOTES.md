# Lightweight board pieces and dice

Roads, settlements, and cities use small CSS meshes aligned to the existing SVG board. The board and game rules retain the same coordinates and IDs. Every road has five visible rectangular faces; settlements add a pitched roof, and cities have two connected roofed volumes. The underside is omitted. Material lighting and ground shadows are static CSS rather than real-time lights or shadow maps.

This adds no 3D engine, model download, physics simulation, or idle rendering loop. A single `ResizeObserver` adjusts the common unit size when the board changes size. Board movement changes the parent transform; piece geometry stays fixed. Performance still depends on browser and device, so this is a deliberately bounded rendering cost rather than a claim of zero heat on every device.

`Pieces3D` belongs inside the same `.island-stage` as the SVG and terrain. Its ancestors need `transform-style: preserve-3d`. Put effects such as drop shadows on the terrain layer, not on that ancestor chain: filters, opacity below one, and paint containment flatten descendants. [CSS transform-style reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style).

`BoardViewport` has separate `depth` and `tilt` preferences. Depth rests at a 12° pitch. Dragging can adjust pitch only between 8° and 16°, and yaw only between −5° and 5°; even an abnormally large pointer event moves either angle at most one degree. There is no inertia or idle movement. The Fit-view button resets angle, pan, and zoom. Wheel/pinch zoom and the +, −, and 0 keyboard controls remain available. Disabling depth restores the flat view; reduced motion keeps the depth but disables interactive tilt. Load `board-camera.css` after the base stylesheet so the legacy stage drop-shadow cannot flatten the new meshes.

`DiceThrow` only receives an already accepted event ID and two server values. Two six-faced cubes follow bounded, event-seeded throw paths, tumble for 1,120 ms, settle to the correct two faces, and remain briefly visible before completion at 1,760 ms. Opposite faces sum to seven. The animation cannot generate or change the outcome. Four exported impact times allow sound to meet the visible bounces. Reduced motion reveals the settled result for 360 ms without flight or rotation.

No replay should occur on a reconnect snapshot, initial room load, or a repeated event ID. That decision belongs to the event presentation coordinator. The dice are decorative and hidden from assistive technology; the surrounding game announcement provides the accessible result once.

`FantasyTransition` gives a new match a 760 ms cloud-curtain reveal. It is code-native SVG with finite CSS transforms and a 160 ms reduced-motion fade. The start-event coordinator should mount it once when a lobby starts a game, rather than replaying it on reconnect.

Tests cover all six landing rotations mathematically, die face opposites, trajectory bounds, all 72 road orientations, the city’s two volumes, camera angle limits, and reduced-motion/flat-view structure. Browser visual testing is a separate check.
