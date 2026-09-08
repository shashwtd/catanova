# Setup reference

This text records board configuration facts from the English 2025 base-game manual, pages 4–5 and 11–12. It does not reproduce the publisher's artwork. See [the source ledger](RULE_SOURCES.md).

## Coordinate convention

Label rows A through E from top to bottom, with 3, 4, 5, 4, and 3 point-up hexes. Number each row left to right. An interior intersection can be specified by the three hexes touching it. A road can be specified by the two hexes sharing its edge. That road must touch the listed settlement intersection.

## Fixed beginner terrain and numbers

| Row | Hex 1 | Hex 2 | Hex 3 | Hex 4 | Hex 5 |
| --- | --- | --- | --- | --- | --- |
| A | Desert; robber | Fields 8 | Pasture 11 | — | — |
| B | Hills 6 | Pasture 3 | Forest 4 | Mountains 9 | — |
| C | Forest 10 | Fields 5 | Hills 12 | Forest 11 | Pasture 5 |
| D | Fields 2 | Hills 9 | Mountains 4 | Forest 8 | — |
| E | Mountains 6 | Fields 3 | Pasture 10 | — | — |

## Fixed beginner pieces

The two roads listed for each player are independent starting roads. The second settlement is the one that supplies the starting resources. “First” and “second” here identify the fixed positions; players do not draft these positions.

| Reference color | First settlement | First road | Second settlement | Second road | Starting resources |
| --- | --- | --- | --- | --- | --- |
| Red | D1/D2/E1 | D1/E1 | A2/A3/B3 | A2/B3 | Hay, sheep, Timber |
| Blue | C4/C5/D4 | C4/D4 | D2/D3/E2 | D2/E2 | Clay, Rock, Hay |
| Orange | B3/B4/C4 | B3/B4 | B1/B2/C2 | B1/C2 | Clay, sheep, Hay |
| White | D3/D4/E3 | D3/E3 | C2/C3/D2 | C2/D2 | Hay, Clay, Clay |

In a three-player fixed game, omit White's settlements and roads. Do not remove hexes or resources from the bank. Player colors are labels, not different powers.

## Ports and coastal frame

Nine ports exist, each granting access at the two ends of its designated coastal edge. There are four 3:1 ports and five resource-specific 2:1 ports. Use the frame's numbered arrangement for the fixed board. Reading around that frame clockwise from the upper-left general port gives:

**3:1 → sheep 2:1 → 3:1 → 3:1 → Clay 2:1 → Timber 2:1 → 3:1 → Hay 2:1 → Rock 2:1.**

For point-up hexes, name the six **edges** NE, E, SE, SW, W, and NW by their outward-facing direction. For example, E is the vertical right edge; NW joins the top corner to the upper-left corner. The fixed port edges are:

| Coastal hex | Edge | Port |
| --- | --- | --- |
| A1 | NW | 3:1 |
| A3 | NW | Sheep 2:1 |
| B4 | NE | 3:1 |
| C5 | E | 3:1 |
| E3 | E | Clay 2:1 |
| E2 | SE | Timber 2:1 |
| E1 | SW | 3:1 |
| D1 | W | Hay 2:1 |
| B1 | W | Rock 2:1 |

Each port is usable from either endpoint of its edge. These configuration facts were transcribed by inspecting both pages of the fixed-setup diagram. Add a rendered fixture check when the geometry is implemented; there is no board generator in the initial repository.

## Variable setup

The published variable method shuffles the six coastal frame sections, randomizes terrain, and uses the A–R counterclockwise number spiral described in the [rulebook](RULEBOOK.md#32-variable-island-setup). Ports move with their frame sections; this is not the same as independently shuffling nine ports onto arbitrary coastal corners.

The current app uses the explicitly requested **balanced-v1** preset described in [Map generation](MAP_GENERATION.md). It constrains clustering and production, and shuffles port positions; its distribution differs from the official setup above. The fixed and classic variable presets on this page are reference targets and are not selectable yet. Every saved game preserves its actual board, preset and seed.

## Implementation checks required

- Confirm 19 land hexes, 54 intersections, and 72 land/coastal edges.
- Verify terrain and number multisets and the absence of a desert token.
- Validate fixed starting intersections, road endpoints, distance legality, and second-settlement resources against this table.
- Encode and visually check the exact six frame sections and nine port edges before offering the fixed preset.
- Validate the counterclockwise inward spiral from each possible starting corner, skipping the desert exactly once.
- Use 1–2–3–4–4–3–2–1 or 1–2–3–3–2–1 for variable initial placements.

These are acceptance criteria for future board code, not tests already passing in this transport-only repository.
