# Board, camera and dice presentation

The current board is a flat, straight-down scene. [Board.tsx](../apps/client/src/Board.tsx) draws brighter coral, cyan, lilac and gold pieces in SVG using the rules engine's edge and vertex IDs. Thinner outlines and lighter ground shadows define the pieces. Affordable legal sites reveal hover/focus previews; clicking opens a separate Build confirmation. Painted terrain, the continuous sea band and pieces retain one coordinate system.

## Camera and table

[BoardViewport.tsx](../apps/client/src/BoardViewport.tsx) pans and scales the island and the walnut table texture together. The interface stays fixed. Scroll or pinch to zoom between 85% and 220%; drag to pan within bounds. With the board focused, `+` and `-` zoom and `0` restores the initial view. Fullscreen uses distinct entry/exit icons; there is no Fit button or tilt control.

Wheel and keyboard zoom use a short glide that stops at its target. Pointer dragging and pinch movement follow the gesture directly. A `ResizeObserver` updates the available board area, and changing the board seed restores the initial camera. Dragging suppresses accidental placement clicks. Reduced motion applies camera changes without the glide. There is no idle camera animation or perspective transform.

The terrain renderer draws on load, resize, board changes and graphics-context recovery. Its SVG fallback uses the same artwork with a simpler shoreline. Both use the same gentler outer-sea curves, preserving the coast-following band and island shape. Mirrored material repeats and atlas gutters reduce seams and adjacent-cell bleed. The water is not an extra ring of playable hexes. See [art and renderer details](ART.md).

## Accepted dice and finite effects

[DiceThrow.tsx](../apps/client/src/DiceThrow.tsx) receives an accepted event ID and two server values. Two six-faced dice follow bounded, event-seeded throw paths and settle to the specified faces. Opposite faces sum to seven. The faces remain readable before production begins, then the dice move to the small dock above the turn control. The last accepted pair remains available there. Exported timing constants coordinate the impacts, reading pause, dock movement and resource flights.

The dice animation cannot generate or change an outcome. The event coordinator suppresses replay on initial load, reconnect and duplicate revisions. Reduced motion reveals the result without flight or rotation. Decorative dice are hidden from assistive technology; the game announcement supplies the accessible result.

`FantasyTransition` introduces a newly started match with a finite cloud-curtain reveal and a shorter reduced-motion fade. It belongs to the start-event presentation, so a reconnect does not replay the introduction. Resource flights, profile receipts and construction highlights also end after their accepted event.

Automated checks cover die landing geometry, trajectory bounds, board geometry, camera limits and event presentation. They do not establish browser appearance or device performance. [Feedback and testing limits](GAME_FEEDBACK.md) describe the remaining device checks. This document keeps its existing filename so earlier repository links continue to resolve.
