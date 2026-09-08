# Balanced islands, version 1

Catanova defaults to a **balanced** board preset, requested for this project. It is a custom setup policy; the rules of turns, production, trading, and construction stay the same. It is not advertised as the official random setup.

Each island retains the normal 19 terrain tiles, number-token supply, 54 intersections, 72 road sites, and nine ports. The five resources appear as **Timber, Clay, Sheep, Hay, and Rock**. Storage IDs remain `wood`, `brick`, `sheep`, `wheat`, and `ore` for continuity with the source ledger.

Generation accepts a layout only when:

- No connected group contains more than two tiles of the same resource.
- Each resource has at least two tiles three or more hex steps apart.
- A 6 or 8 never touches another 6 or 8.
- No intersection exceeds 11 production pips across its adjacent tiles. Pips count the dice combinations producing a number: 2/12 = 1 through 6/8 = 5.
- Each resource has 2.5–4 production pips per tile on average (rounded up for the lower bound). This avoids putting all the low numbers on one resource.
- Ports occupy nine separated coastal edges, with four generic ports and one per resource. Their ordering is shuffled independently in this preset.

An intersection still touches up to three terrain tiles, and strong three-resource spots remain part of the game. The constraints reduce extreme boards; they do not promise equal seats, equal harbor access, or equally good placements. The normal snake draft is still important. There are no secretly adjusted dice or catch-up bonuses.

The server chooses a random public map seed. A deterministic generator reproduces that board for debugging; **the map seed never determines dice, steals, or the development deck**. Search has explicit limits and fails if no valid map is found; constraints are never silently weakened. The test suite checks 500 seeds, inventories, port geometry, topology, and reproducibility.

Next balance evidence should come from playtests: compare first/last setup seats, resource scarcity, win rate by seat, and player feedback before tightening these bounds. An official-style board preset can be added separately.
