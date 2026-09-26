# Map generation

Catanova defaults to a **balanced** board preset, requested for this project. It is a custom setup policy; the rules of turns, production, trading, and construction stay the same. It is not advertised as the official random setup.

Each island retains the normal 19 terrain tiles, number-token supply, 54 intersections, 72 road sites, and nine harbours. The five resources appear as **Timber, Clay, Sheep, Hay, and Rock**. Storage IDs remain `wood`, `brick`, `sheep`, `wheat`, and `ore` for continuity with the source ledger.

The sections from here to [Big Table islands](#big-table-islands) describe Classic's `balanced-v2` preset. Big Table and Open Sea deal their boards from presets of their own, specified after it. Neither is built yet.

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

## Big Table islands

Big Table, for five and six players (ruleset `big-table-v1`), deals every board from one preset, `big-table-balanced-v1`. It is Catanova's balanced approach adapted to the 30-hex island, and the default and only board in v1. It is our own policy, not the official setup. The official lettered spiral is described for reference in the [Big Table rulebook](RULEBOOK-BIG-TABLE.md). It is not offered in `big-table-v1`, and a spiral preset is recorded only as a possible later option. There is no fixed first-game layout. Nothing here is built yet. The measurements below come from a throwaway prototype, not from release code.

### The island

- 30 land hexes in rows of 3, 4, 5, 6, 5, 4 and 3: six each of Timber, Sheep and Hay, five each of Clay and Rock, and two deserts. The middle row has six hexes, so the island's centre falls between two hexes, (−1, 0) and (0, 0), rather than on one.
- Coordinates, in the axial system described under [Outer Isles](#coordinates): every hex with −3 ≤ q ≤ 2, −3 ≤ r ≤ 3 and −2 ≤ s ≤ 3. Row by row from the top: r = −3, q = 0 to 2; r = −2, q = −1 to 2; r = −1, q = −2 to 2; r = 0, q = −3 to 2; r = 1, q = −3 to 1; r = 2, q = −3 to 0; r = 3, q = −3 to −1. A half turn taking (q, r) to (−1 − q, −r) maps the island onto itself.
- Hex ids are assigned row by row, top to bottom, and left to right within a row, as `topology()` does for Classic. So (0, −3) is hex 0 and (−1, 3) is hex 29. Tests and fixtures refer to hexes by these ids.
- 28 number tokens: two each of 2 and 12, and three of every other number. That is 88 pips, an average of 3.14 per token against Classic's 3.22.
- 80 intersections, 109 edges and 38 coastal edges. 42 intersections touch three tiles, against 24 of 54 on the Classic island. The island is six hex steps across, where Classic's is four.
- 22 sea spaces border the coast. The six off the corner hexes, the tips, each face one coastal edge. The other 16 face two.

### Number and terrain rules

Generation accepts a board only when all of these hold. Rules 1 and 4–7 are Classic's, unchanged. Rules 2 and 3 are Classic's with their bounds set for this island. Rule 8 is new.

1. No connected group contains more than two tiles of the same resource.
2. Each resource has at least two tiles four or more hex steps apart. Classic asks for three steps on an island four steps across. Here three would reject no layout at all. Four rejects about 4% of the terrain layouts that pass rule 1, and five would reject about 69%.
3. Each resource has 2.5–4 production pips per tile, rounding the lower bound up: 15–24 pips in total for Timber, Sheep and Hay (six tiles each) and 13–20 for Clay and Rock (five tiles each). The average token is close to Classic's, so the per-tile bounds carry over unchanged.
4. No intersection exceeds 11 production pips. This bound does not grow with the island, because an intersection still touches at most three tiles. It is the expensive rule on 30 hexes; see [measurements](#measurements-so-far). Catanova decision: the cap stays at 11 for this preset and is not raised to make the search faster.
5. A 6 or 8 never borders another 6 or 8.
6. Equal numbers never border each other.
7. The 2 never borders the 12.
8. The two deserts never border each other. Touching deserts make one wider dead patch, with two intersections that touch both. The official setup allows it. In the prototype about 15% of terrain layouts that passed rule 1 had touching deserts.

### Harbour placement

- There are 11 harbours: five generic 3:1 harbours, two Sheep 2:1 harbours, and one 2:1 harbour each for Timber, Clay, Hay and Rock. Their types are shuffled onto the chosen edges.
- No two harbours share an intersection or sit on neighbouring intersections, so at least two empty coastal edges separate any two. Under that rule eleven harbours need at least 33 of the 38 edges, leaving five to spare. The gaps round the coast are therefore six of 3 edges and five of 4. Spreading the 4s as evenly as possible gives the spacing 3, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4.
- As in `balanced-v2`, no two harbours face the same or neighbouring sea spaces. With 11 harbours and 22 sea spaces, every other sea space holds a harbour, and three of the six tips get one.
- 18 of the spacing's 38 rotations meet both rules. Each board uses one of the 18 at random. The other 20 would put between one and five pairs of harbours on the same or neighbouring sea spaces, and are never used.

For scale: 10,374 sets of 11 coastal edges meet the intersection rule alone, and 216 of them also meet the sea-space rule. Alternating with open sea is not enough by itself: 512 layouts alternate, and only those 216 are also spaced. The 18 rotations are the most evenly spaced of the 216.

### Deserts and the robber

The robber starts on one of the two deserts, chosen with the map seed, each equally likely. The board records that hex. Game creation must read it: today it takes the first desert it finds, which would always pick the same one.

### Generation order and search limits

On 30 hexes the number rules are the hard part, and they depend only on where the deserts are. So this preset deals numbers first, the reverse of `balanced-v2`:

1. Pick the two deserts at random from the 364 of 435 pairs of hexes that do not touch.
2. Deal the 28 tokens onto the other 28 hexes in a random order. A deal is abandoned as soon as a token lands beside one it may not border, or lifts an intersection above 11 pips.
3. Shuffle the 28 resource tiles onto those hexes until rules 1–3 hold.
4. Pick the harbour rotation, shuffle the harbour types, and pick the robber's desert.

Every numbering that meets rules 4–7 for the chosen deserts is equally likely to be dealt, and every terrain layout that then meets rules 1–3 is equally likely to be chosen. As in `balanced-v2`, abandoning a deal early only skips deals the full check would reject.

Starting search limits: up to 10 desert pairs; for each pair, up to 4 million number deals; for each valid numbering, up to 10,000 terrain shuffles before a new numbering is dealt, which counts against the same 4 million. If every limit runs out, generation fails. No rule is weakened.

### Measurements so far

A prototype of these rules ran on a development laptop:

- The `balanced-v2` search ported unchanged (terrain first, 20,000 deals per terrain) found a board for each of 300 seeds, but slowly: about 45 ms for a typical board and up to about 440 ms. It needed about 500 terrain shuffles on average and up to about 3,200. The Classic island never needs more than 60.
- The deal is what costs. On the Classic island about 1 random deal in 2,700 passes every number rule. On the 30-hex island about 1 in 300,000 does. Three copies of most numbers make equal neighbours far more likely, and many more intersections touch three tiles.
- Numbers first, as above, found a board for each of 1,000 seeds: about 26 ms for a typical board and up to about 430 ms. The first valid numbering always had a valid terrain, within at most 529 shuffles. Number deals took about 130,000 for a typical board and up to about 2.25 million.
- With a 12-pip cap instead of 11, the same search took about 1 ms for a typical board and never more than 13 ms. But 970 of the 1,000 boards then had an intersection of 12 pips.

These are prototype figures. Before release the real implementation must be measured over 20,000 seeds, as `balanced-v2` was, and keep every board under the same 100 ms limit.

Catanova decision, made on 26 September 2026 under the owner's delegation: the 11-pip cap stays, and it is not raised to 12. The preset ships only when one of these holds:

1. A tuned search keeps every board under the 100 ms limit over 20,000 seeds.
2. If no tuned search can, boards are generated off the server's main thread, in a worker. A longer limit is then chosen from the 20,000-seed measurement and written down here before release.

Either way the preset does not ship until the release code has been measured.

### Tests

The test suite for `big-table-balanced-v1` must check:

1. Topology: the 30 hexes at the coordinates above, with ids in the order above, and 80 intersections, 109 edges, 38 coastal edges and 22 sea spaces.
2. Inventory: the terrain counts, exactly the 28 tokens listed above, and the 11 harbour types.
3. Every rule above over 500 seeds, including rule 8, both harbour rules, and that each harbour layout is one of the 18 rotations.
4. The robber starts on a desert, and across the 500 seeds each of the two deserts (the lower hex id and the higher) is chosen at least 200 times.
5. Reproducibility: the same seed and preset give the same board, and a fixture board for one seed catches unintended changes.
6. Speed: the suite fails if any board takes longer than 100 ms, or longer than the documented limit if boards are generated in a worker.
7. A rule that cannot be met, such as a 5-pip cap, makes generation fail within its limits rather than hang.
8. The `balanced-v2` tests and fixture pass unchanged, so Classic boards do not drift.

## Open Sea: Outer Isles

Outer Isles is Open Sea's first scenario (ruleset `open-sea-v1`, scenario id `outer-isles`), for three or four players. Its boards come from the preset `outer-isles-v1`: a fixed template for each player count, with terrain, numbers and harbours shuffled every game under fairness rules. The templates are our own designs, not copies of an official map. The game rules are in the [Open Sea rulebook](RULEBOOK-OPEN-SEA.md). Nothing here is built yet. Templates for five and six players come later.

### Coordinates

Hexes use the axial coordinates of `packages/rules/src/board.ts`: pointy-top hexes, with q counting along a row and r numbering the rows downwards, so r = −4 is the top row. The third coordinate is s = −q − r. The distance between two hexes is the largest of their differences in q, r and s. Because each row sits half a hex from the next, a hex's column, counted in half-hex steps from left to right, is 2q + r. The boards below are bounded by rows and columns, which keeps them close to rectangles.

Each template gives:

- The board: every hex inside its rows and columns.
- The sea ring: every board hex with fewer than six neighbours on the board. Ring hexes are always sea. The edges on the board's outside, the outer rim, take no piece. Ships may use every other edge of a ring hex, including the edges between two ring hexes.
- The main island and the small islands, by coordinates. Every other hex is sea.

In the sketches below, `M` is the main island, lower-case letters are small islands, `.` is sea inside the ring, `~` is the ring and `P` is the pirate's start. North is at the top, and each row sits half a hex from the next.

### Three-player template

The board is every hex with −4 ≤ r ≤ 4 and −7 ≤ 2q + r ≤ 8: 72 hexes in nine rows of 8, each row starting half a hex left or right of the one above. It is 8½ hexes wide.

- Main island, 16 hexes in rows of 5, 5, 3, 2 and 1, a shield with its point to the south: r = −1, q = −2 to 2; r = 0, q = −1 to 3; r = 1, q = −1 to 1; r = 2, q = −1 to 0; r = 3, q = −1.
- North isle (`a`), 3 hexes: (1, −3), (2, −3), (3, −3).
- South-west isle (`b`), 3 hexes: (−3, 1), (−3, 2), (−3, 3).
- South-east isle (`c`), 2 hexes: (2, 2), (1, 3).
- Sea: the other 48 hexes, 30 in the ring and 18 inside it.
- Pirate start: (4, −2), open water between the north isle and the main island's north-east corner. It touches no land.

```
r=-4  ~ ~ ~ ~ ~ ~ ~ ~
r=-3 ~ . . a a a . ~
r=-2  ~ . . . . . P ~
r=-1 ~ M M M M M . ~
r= 0  ~ . M M M M M ~
r= 1 ~ b . M M M . ~
r= 2  ~ b . M M . c ~
r= 3 ~ . b . M . c ~
r= 4  ~ ~ ~ ~ ~ ~ ~ ~
```

### Four-player template

The board is every hex with −4 ≤ r ≤ 4 and −8 ≤ 2q + r ≤ 8: 77 hexes in rows of 9, 8, 9, 8, 9, 8, 9, 8 and 9. It is 9 hexes wide.

- Main island, 20 hexes in rows of 2, 4, 7, 4, 2 and 1, a diamond: r = −2, q = 0 to 1; r = −1, q = −1 to 2; r = 0, q = −3 to 3; r = 1, q = −2 to 1; r = 2, q = −1 to 0; r = 3, q = −1.
- North-west isle (`a`), 2 hexes: (−1, −3), (−2, −2).
- North-east isle (`b`), 3 hexes: (3, −3), (4, −3), (4, −2).
- South-east isle (`c`), 2 hexes: (2, 2), (1, 3).
- South-west isle (`d`), 3 hexes: (−4, 2), (−4, 3), (−3, 3).
- Sea: the other 47 hexes, 32 in the ring and 15 inside it.
- Pirate start: (2, 4), the ring's south-east corner. It touches no land.

The board is point-symmetric about the hex (0, 0). A half turn, taking (q, r) to (−q, −r), swaps the north-west and south-east isles, and the north-east and south-west isles, and maps the main island onto itself except for its southern tip, (−1, 3). Twenty hexes cannot turn onto themselves about a hex, so one hex has to be left over.

```
r=-4 ~ ~ ~ ~ ~ ~ ~ ~ ~
r=-3  ~ a . . . b b ~
r=-2 ~ a . M M . . b ~
r=-1  ~ . M M M M . ~
r= 0 ~ M M M M M M M ~
r= 1  ~ . M M M M . ~
r= 2 ~ d . . M M . c ~
r= 3  ~ d d . M . c ~
r= 4 ~ ~ ~ ~ ~ ~ ~ ~ P
```

In both templates the main island reaches the ring: at its west and east ends, and at its southern tip. Its coast there faces ring hexes, whose inner edges take ships like any other sea edge.

### Size on screen

The board has to fit a phone held upright. The first sketches of these templates were 11 and 12 hexes wide, 79 and 88 hexes, with a wide belt of open sea. On a phone that drew every hex at about half the size of a Classic hex. These templates keep the land and the ring and drop most of the open sea, so each board is about as tall as it is wide.

Hex size against Classic's in the same space, measured on the board area of the in-game preview with the current world margin:

| Screen                 | Board area | Three players (first sketch) | Four players (first sketch) |
| ---------------------- | ---------- | ---------------------------- | --------------------------- |
| Phone, 390 × 844       | 374 × 462  | 0.67 (0.54)                  | 0.64 (0.50)                 |
| Small phone, 375 × 667 | 359 × 305  | 0.66 (0.60)                  | 0.66 (0.56)                 |
| Desktop, 1440 × 900    | 1074 × 754 | 0.66 (0.66)                  | 0.66 (0.66)                 |

A taller, narrower board would gain a little on the upright phone and lose more on the desktop and the small phone, which are limited by height. The world margin, the painted water round the board, is 112 units on every side today. The ring is already water, so a sea board may not need all of it. That is a rendering choice for Phase 2, to be decided with screenshots (see [Bigger maps and modes](BIGGER-MAPS-AND-MODES.md)).

### What each template holds

|                     | Three players                                                                                              | Four players                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Main island         | 16: Timber 3, Clay 3, Sheep 4, Hay 3, Rock 2, desert 1                                                     | 20: Timber 4, Clay 4, Sheep 5, Hay 3, Rock 3, desert 1                          |
| Small islands       | 8 in three isles (3, 3, 2): gold 2, Timber 1, Clay 1, Hay 2, Rock 2                                        | 10 in four isles (3, 3, 2, 2): gold 2, Timber 1, Clay 1, Hay 3, Rock 3          |
| All land            | 24: Timber 4, Clay 4, Sheep 4, Hay 5, Rock 4, gold 2, desert 1                                             | 30: Timber 5, Clay 5, Sheep 5, Hay 6, Rock 6, gold 2, desert 1                  |
| Sea                 | 48: 30 ring, 18 inside                                                                                     | 47: 32 ring, 15 inside                                                          |
| Main-island tokens  | 15: 2, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12. Classic's 18 without one each of 3, 5 and 9; 48 pips | 19: Classic's 18 and a third 10; 61 pips                                        |
| Small-island tokens | 8: 2, 4, 5, 6, 8, 9, 10, 12; 26 pips                                                                       | 10: one each of 2, 3, 4, 5, 6, 8, 9, 10, 11, 12; 30 pips                        |
| Harbours            | 8: three 3:1, and one 2:1 for each resource                                                                | 9: four 3:1, and one 2:1 for each resource, as in Classic                       |
| Main-island coast   | 36 edges, facing 21 sea hexes                                                                              | 40 edges, facing 23 sea hexes                                                   |
| Whole board         | 178 intersections; 249 edges, of which 66 are outer rim and 148 can hold a ship                            | 190 intersections; 266 edges, of which 70 are outer rim and 150 can hold a ship |
| Robber start        | The desert                                                                                                 | The desert                                                                      |
| Pirate start        | (4, −2)                                                                                                    | (2, 4)                                                                          |

Every producing hex gets exactly one token: 23 tokens for 23 hexes with three players, 29 for 29 with four. Both main-island token sets average 3.2 pips, like Classic's.

The terrain split is deliberate. Timber and Sheep, which build ships, sit mostly on the main island. Hay and Rock, which build cities, lean to the small islands, and both gold fields are there, so sailing out pays for cities. As a sanity check against the Seafarers expansion's first scenario, the land totals are a little larger (24 and 30 hexes, against 22 and 28) and the harbour counts are the same.

Starting room. The main island has to hold every starting settlement with room to spare. The measure is the fewest intersections touching two or more main-island hexes that can be left for the last starting settlement, if every earlier one is placed to remove as many as the distance rule allows. The Classic island leaves 9 for the eighth settlement of a four-player game. The four-player main island leaves 11 of its 38, and the three-player main island leaves 11 of its 30 for the sixth settlement. This is a shape measure only: it ignores the desert and the numbers.

Reach. Each small island is one sea hex from the main island and at least three from every other small island, so no intersection belongs to two islands and the island bonus is never ambiguous. From the nearest point of the main island's coast, two ships reach an intersection on each small island that is not next to the main island. No single sea hex, with the pirate on it, cuts a small island off.

### Fairness rules

Generation accepts a board only when all of these hold. Rules 1–7 are `balanced-v2`'s rules, applied where they make sense. Rules 8–11 belong to this preset.

1. No connected group contains more than two tiles of the same resource.
2. On the main island, each resource with two or more tiles there has two of them three or more hex steps apart. Both main islands are six steps across.
3. On the main island, each resource has 2.5–4 pips per tile, rounding the lower bound up. With three players that is 8–12 pips for Timber, Clay and Hay, 10–16 for Sheep and 5–8 for Rock. With four it is 10–16 for Timber and Clay, 13–20 for Sheep, and 8–12 for Hay and Rock.
4. No intersection exceeds 11 pips. A gold field counts at its token's pips.
5. A 6 or 8 never borders another 6 or 8.
6. Equal numbers never border each other.
7. The 2 never borders the 12.
8. A gold field never carries a 6 or an 8.
9. No small island holds both gold fields.
10. Each small island has 2.5–4 pips per hex, rounding up: 5–8 on a two-hex island and 8–12 on a three-hex island. No small island is nearly barren or overloaded.
11. Harbours go only on the main island's coast, placed as described next.

No two islands border each other, so rules 1 and 5–7 only ever compare tiles on the same island. The template itself fixes the rest, and the template tests check it once: starting settlements go only on the main island, every small island is reachable by ship, the pirate starts away from the main island, and the robber starts on the desert.

### Outer Isles harbours

Harbours follow the two `balanced-v2` rules on the main island's coast: no two share or neighbour an intersection, and no two face the same or neighbouring sea hexes.

- Three players: 8 harbours on 36 coastal edges, spaced 4, 5, 4, 5, 4, 5, 4, 5 edges apart. 28 of the 36 rotations meet the sea-hex rule. The other 8 each put one pair of harbours on the same or neighbouring sea hexes.
- Four players: 9 harbours on 40 coastal edges, spaced 4, 4, 5, 4, 5, 4, 5, 4, 5 edges apart. 29 of the 40 rotations meet the sea-hex rule. Of the other 11, 7 put one pair on the same or neighbouring sea hexes and 4 put two.

Each board uses one qualifying rotation at random and shuffles the harbour types onto it.

### Generation and validation

The main island and the small islands share no intersection, so each is dealt on its own, the `balanced-v2` way: terrain first, then numbers, with a deal abandoned as soon as a token breaks rule 4, 5, 6, 7 or 8.

1. Take the template for the number of players when the game starts.
2. Main island: shuffle its terrain onto its hexes until rules 1 and 2 hold, then deal its tokens until rules 3–7 hold.
3. Small islands: shuffle their terrain onto their hexes until rules 1 and 9 hold, then deal their tokens until rules 4–8 and 10 hold.
4. Pick a harbour rotation and shuffle the harbour types onto it.
5. Put the robber on the desert and the pirate on the template's start. A later template with more than one desert picks the robber's desert with the map seed, as Big Table does.

Steps 2 and 3 each have the `balanced-v2` limits: 10,000 terrain shuffles, with up to 20,000 deals for each. If a limit runs out, generation fails. No rule is weakened.

In a prototype, 2,000 seeds per template all produced boards. A typical board took about 2 ms with three players and 3 ms with four. The slowest took 33 ms and 110 ms. The main island needed at most 76 and 47 terrain shuffles, and the small islands at most 6. The four-player diamond is the slow one: 21 of its 61 intersections touch three main-island hexes, so the 11-pip cap rejects more deals, and one terrain layout needed 16,058 deals. Its slowest board is over the 100 ms limit, so the Big Table rule applies here too: before release, a tuned search keeps every board under 100 ms over 20,000 seeds, or boards are generated in a worker with a limit measured and written down here.

### Outer Isles tests

Once per template, the tests check:

1. Hex counts: board, ring, inside sea, main island and each small island; land by terrain; one token per producing hex; the harbour types; and the board counts in the table.
2. Every ring hex is sea. The main island's coast is a single loop with no lake inside it. Each island is connected, and no two islands share an edge or an intersection.
3. Every small island is reachable by ship from the main island's coast, and stays reachable with any one sea hex blocked by the pirate.
4. The pirate's start touches no land, so no starting ship can be placed next to it.
5. Starting room: the worst case above leaves at least 9 intersections for the last starting settlement.
6. Exactly 28 harbour rotations qualify with three players, and 29 with four.

Over 500 seeds per template, they check:

7. Every fairness rule, the robber on the desert and the pirate on its start.
8. Reproducibility, with one fixture board per template.
9. That no board takes longer than 100 ms.

## Versions

Each board records the preset that generated it, and a seed produces a different island under each version. Saved games keep the board they were dealt, so games already started on a `balanced-v1` island keep that island.

- **`balanced-v2`** (current) added the rules against equal numbers and against the 2 beside the 12, and made harbours alternate with open sea. In 5,000 version-1 islands, 81% had equal numbers on neighbouring tiles, 24% had the 2 beside the 12, and 41% had three pairs of harbours on neighbouring sea spaces.
- **`balanced-v1`** had the same terrain, production and 6/8 rules and the same harbour spacing, but let the spacing take any of its ten rotations.

A preset is data: `BALANCED_V2` in `packages/rules/src/board.ts` lists the hexes of the island, how many tiles of each terrain it deals, the number tokens, the harbour slots and trades, and the fairness limits above. `generateBoard(seed, preset)` deals from it, and a preset that cannot be dealt, such as one with more hexes than tiles, is refused before any search. `tests/fixtures/classic-board.json` pins the boards `balanced-v2` deals, seed by seed, so a change to the code that deals them cannot move a tile unnoticed.

Next balance evidence should come from playtests: compare first/last setup seats, resource scarcity, win rate by seat, and player feedback before tightening these bounds. An official-style board preset can be added separately.

Big Table and Open Sea add two presets, versioned separately from Classic's: **`big-table-balanced-v1`** and **`outer-isles-v1`**, both planned and not built. `Board.preset` must widen to accept them. A seed means nothing across presets. Any later change to their rules or templates becomes a new version, such as `outer-isles-v2`, never an edit to v1, so saved games and fixtures keep their boards.
