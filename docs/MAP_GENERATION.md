# Balanced islands, version 2

Catanova defaults to a **balanced** board preset, requested for this project. It is a custom setup policy; the rules of turns, production, trading, and construction stay the same. It is not advertised as the official random setup.

Each island retains the normal 19 terrain tiles, number-token supply, 54 intersections, 72 road sites, and nine harbours. The five resources appear as **Timber, Clay, Sheep, Hay, and Rock**. Storage IDs remain `wood`, `brick`, `sheep`, `wheat`, and `ore` for continuity with the source ledger.

## Terrain and numbers

Terrain is shuffled first, then the number tokens. Generation accepts a layout only when:

- No connected group contains more than two tiles of the same resource.
- Each resource has at least two tiles three or more hex steps apart.
- Each resource has 2.5–4 production pips per tile, rounding the lower bound up: 10–16 pips in total for Timber, Sheep and Hay (four tiles each) and 8–12 for Clay and Rock (three tiles each). This avoids putting all the low numbers on one resource. Pips count the dice combinations producing a number: 2/12 = 1 through 6/8 = 5.
- No intersection exceeds 11 production pips across its adjacent tiles.
- A 6 or 8 never borders another 6 or 8.
- Equal numbers never border each other, so no intersection touches the same number twice.
- The 2 never borders the 12.

The official A–R number spiral satisfies the last three from every starting corner and desert position. Strong three-resource intersections remain possible within the 11-pip cap.

## Harbours

- There are four generic 3:1 harbours and one 2:1 harbour for each resource, in shuffled order.
- They sit on nine of the 30 coastal edges, spaced 3, 3 and 4 edges apart all the way round, so no two harbours share an intersection or sit on neighbouring intersections.
- Harbours alternate with open sea around the island, as on the fixed frame in the [setup reference](SETUP.md#ports-and-coastal-frame). Every other one of the 18 sea spaces bordering the coast holds a harbour, so no two harbours face the same or neighbouring sea spaces and three of the six sea spaces off the island's tips hold one. Six rotations of the spacing do this, and each island uses one of them at random. The other four rotations would put three pairs of harbours side by side, leaving every tip bare, and are never used.

An intersection still touches up to three terrain tiles, and strong three-resource spots remain part of the game. The constraints reduce extreme boards; they do not promise equal seats, equal harbour access, or equally good placements. The normal snake draft is still important. There are no secretly adjusted dice or catch-up bonuses.

## Seeds, limits and tests

The server chooses a random public map seed. A deterministic generator reproduces that board, under the same preset, for debugging; **the map seed never determines dice, steals, or the development deck**. Search has explicit limits and fails if no valid map is found; constraints are never silently weakened.

Numbers are dealt tile by tile, and a deal is abandoned as soon as a token lands beside one it may not border. The full check would reject those deals anyway, so every valid numbering of the chosen terrain stays equally likely. On a development laptop a typical island takes about a millisecond. Across 20,000 seeds the slowest took about 11 ms, and none needed more than 60 of the 10,000 terrain shuffles the search limit allows.

The test suite checks 500 seeds against every rule above, including harbour alternation. It also checks inventories, topology and reproducibility, and fails if any island takes longer than 100 ms to generate.

## Versions

Each board records the preset that generated it, and a seed produces a different island under each version. Saved games keep the board they were dealt, so games already started on a `balanced-v1` island keep that island.

A preset is data: `BALANCED_V2` in `packages/rules/src/board.ts` lists the hexes of the island, how many tiles of each terrain it deals, the number tokens, the harbour slots and trades, and the fairness limits above. `generateBoard(seed, preset)` deals from it, and a preset that cannot be dealt, such as one with more hexes than tiles, is refused before any search. `tests/fixtures/classic-board.json` pins the boards `balanced-v2` deals, seed by seed, so a change to the code that deals them cannot move a tile unnoticed.

- **`balanced-v2`** (current) added the rules against equal numbers and against the 2 beside the 12, and made harbours alternate with open sea. In 5,000 version-1 islands, 81% had equal numbers on neighbouring tiles, 24% had the 2 beside the 12, and 41% had three pairs of harbours on neighbouring sea spaces.
- **`balanced-v1`** had the same terrain, production and 6/8 rules and the same harbour spacing, but let the spacing take any of its ten rotations.

Next balance evidence should come from playtests: compare first/last setup seats, resource scarcity, win rate by seat, and player feedback before tightening these bounds. An official-style board preset can be added separately.
