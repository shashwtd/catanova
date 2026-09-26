# Bigger maps, and modes like Seafarers

A plan, not a commitment. It says what the board code assumes today, which of
those assumptions have to go, in what order, and what each step actually costs.
Read the first two sections before the phases: almost every estimate later on
follows from them.

For every variation of the game, the owner's decisions of 25 September 2026 and
the order to build modes in, see [Game modes](GAME-MODES.md), which this plan
sits under. The rules of the two modes it builds toward are in the
[Big Table rulebook](RULEBOOK-BIG-TABLE.md), for five and six players, and the
[Open Sea rulebook](RULEBOOK-OPEN-SEA.md). This plan says how to build them.

Rules research is summarised at the end, with sources. Nothing here reproduces
rulebook text; game mechanics are described in our own words so we can build
them, which is the same basis the existing rulebook doc is written on.

## The short version

The rules engine is in better shape for this than the renderer. `topology()`
builds hexes, vertices and edges from coordinates rather than from a fixed
table, so a larger or differently shaped island is a change to one loop. The
renderer is the opposite: it assumes one island, one closed coastline, and a
fixed world box, and three of its nicest effects are built directly on those
assumptions. The code around the engine is less ready than the engine itself:
the protocol, the lobby, the turn clock, stand-in bots and the restore checks
all assume 19 hexes and four seats.

So the order is: the mode system first (step 1 in
[Game modes](GAME-MODES.md#step-1-the-mode-system-m)), then make the board
data-driven with no visible change, then ship Big Table (a bigger map and a
second player acting in each turn), then Open Sea (sea hexes, ships, and a
renderer that can draw more than one island) with its first scenario, Outer
Isles, then more scenarios.

Rough shape of the work:

| Phase | What ships                                                       | Size                  |
| ----- | ---------------------------------------------------------------- | --------------------- |
| 0     | Nothing visible. The board becomes data.                         | Medium                |
| 1     | Big Table: 30 hexes, six seats, paired turns, the classic option | Medium, Medium, Small |
| 2     | Open Sea core: sea, ships, gold, pirate, island bonus            | Large                 |
| 3     | Outer Isles, then more scenarios as data                         | Medium each           |
| 4     | Open Sea for five and six players; knights are parked            | Medium                |

## What the code assumes today

Five assumptions are load-bearing. Everything else is detail.

**1. The island is a radius-2 hexagon.** `topology()` in
`packages/rules/src/board.ts` loops `r` from −2 to 2 and bounds `q` to match,
producing exactly 19 tiles. Nothing else in `board.ts` depends on the number 19,
but other code does: the action parser rejects any intersection from 54, edge
from 72 and hex from 19 before the rules see a move, and the WebGL terrain
shader holds exactly 19 hexes (`uLand[19]`). The full list is under
[Beyond the board](#beyond-the-board).

**2. The terrain and number bags are fixed.** `generateBoard` hardcodes one
desert and 4/4/4/3/3 of the resources, draws from `NUMBER_SPIRAL` (18 entries),
and places nine harbours at fixed positions along the sorted coast ring —
`[0, 3, 6, 10, 13, 16, 20, 23, 26]`. On a larger shape it crashes with a
TypeError at the 19th land hex. A 30-hex board needs a different bag, a
different token list and eleven harbours, so this function needs to take a
recipe rather than be one.

**3. An edge is coastal if it touches exactly one hex.** `Edge.hexes.length === 1`
is the definition used by `coastline()`, `portPlacement()` and the harbour
picker in `generateBoard`. Big Table has no sea hexes, so it still holds there.
Once sea hexes exist as real tiles, a shore edge touches a land hex and a sea
hex, and the only edges that touch one hex are on the outer rim of the sea. The
definition then quietly picks the wrong edges: the harbour picker and
`coastline()` would work along the outer rim instead of the shore. Only
`portPlacement()` fails loudly, throwing for a harbour on a real shore edge.
The quiet failures make this the most dangerous line in the change.

**4. There is exactly one coastline, and it is a closed loop around the
origin.** `coastline()` in `apps/client/src/scene.ts` picks the first coastal
edge and walks neighbours until it returns to the start. With two islands it
walks one of them and never sees the other. `waterOutline()` is worse: it
marches a ray outward from the origin at 240 angles and binary-searches for the
shore, which only describes a single roughly star-shaped island. Its search
stops at radius 440, so it clips the band on any board whose outline reaches
further (see Phases 1 and 2). The painted water band, the coast feathering and
the island drop shadow are all built on it.

**5. The world box is a constant.** `WORLD` in `scene.ts` is
`{ x: -392, y: -368, width: 784, height: 736 }`, sized by hand for a radius-2
island at `HEX_SIZE = 64`. It sets the SVG viewBox, the filter and mask regions,
the shader's world uniform, the camera fit and clamp, and the viewport's aspect
ratio. A 30-hex board overflows it (it needs roughly ±448 × ±464); an Open Sea
archipelago overflows it badly.

Smaller things that will need touching, none of them hard:

- `SUPPLY` has roads, settlements and cities but no ships.
- `Game.roads` is `Record<edgeId, playerId>` and `robber` is a single hex id.
- `createGame` starts the robber on the first desert it finds: with two deserts
  that is always the lower hex id, and on a map without one it throws. Both new
  modes start it on a desert chosen at random from the seed.
- `longestTrail` walks `g.roads` only, and breaks at another player's building
  — which is already the right rule, and is most of the work for Open Sea's
  Longest Route.
- `TERRAIN_INDEX` has six terrains, matched to rows in the WebGL terrain atlas.
  Sea, gold and fog are three more, and need new art.
- The board's static layers and the camera are memoised on `board.seed` alone.
  The key should be the preset and the seed, or a board hash.
- The colour palette already holds eight, so six players need no new colours.
  But `seatColors` gives six seats without a chosen colour coral and sky twice
  (see Phase 1).
- `Board.preset` is `'balanced-v1' | 'balanced-v2'` (new boards are v2) and
  `Game.schema` is `1`. `Game.ruleset` is saved on every game, and since
  Release A it is read: it names the game's ruleset. It is what tells a Classic
  game from a new one, so no schema bump is needed;
  [Game modes](GAME-MODES.md#one-ruleset-chosen-in-the-room-frozen-at-the-start)
  covers the rollback risk instead.

### Beyond the board

The earlier version of this plan said only `board.ts` knew the number 19, and
that seats were capped in three places. Both were wrong. What the codebase
review found, and where the mode system (Release A, step 1 of
[Game modes](GAME-MODES.md#step-1-the-mode-system-m)) has since dealt with it:

- **Protocol bounds.** `parseGameAction` rejects vertex ≥ 54, edge ≥ 72 and
  hex ≥ 19, and runs on every action before the rules. Big Table needs 80, 109
  and 30; every Open Sea board is larger still. Bounds belong in `applyAction`,
  checked against the game's own board, and `robberVictims` then needs to check
  that the hex exists.
- **Other 19s.** The bank starts at a literal 19 per resource. The hand parser,
  `ResourcePicker` and `TradePanel` cap one resource at 19, below the 24 in Big
  Table's bank. The terrain shader has room for 19 hexes. Piece limits (15, 5
  and 4) are literals in several files, and the development deck is one
  constant. Release A reads the bank, the deck, the pieces and the costs from
  each game's ruleset, and the parser, `ResourcePicker` and `TradePanel` from
  the bank; the shader went in Phase 0. The bots still read Classic's numbers,
  since they play only Classic.
- **Seven seat caps.** `createGame`, `Store.enter` (ROOM_FULL), the bot seat in
  `Store.lobby`, `RoomInvites.openRoom`, `RoomInvitePanel`, the lobby's
  `SEATS` and its "/4" label. Tests pin it as well. All seven read the ruleset
  since Release A.
- **The lobby's board.** A room deals a Classic board when it is created and on
  rematch, never re-deals it when settings change, and Start hands it to
  `createGame`, which checks only the seed. A mode change must re-deal, and
  Start must check that the board's preset matches the ruleset. Both do since
  Release A, and a room deals each board with its mode's preset. A lobby
  holding a board its mode does not play is simply dealt a new one.
- **Stand-in bots.** Any disconnected player is covered by a stand-in after 30
  seconds. Big Table and Open Sea allow no bots, so stand-ins are off there and
  the absence rule in [Turn clock](TURN_CLOCK.md#modes-without-bots) takes their
  place. It must act even in rooms without a turn timer, or a missing player
  could stop the game for good. Built in Release A: the ruleset's `standIns`
  decides, and the rule wakes the room on its own after the 2 minutes.
- **The clock and unknown phases.** If `timeoutAction` has no move for the
  current phase, `expireRoom` throws CLOCK_STATE and automatic play halts for
  that room. Every new phase ships with its timeout move. Since Release A,
  `timeoutAction` answers every kind of move `owedMoves` lists, setup
  included, and a test checks that through a whole game.
- **One actor.** Every action outside discards and trade replies requires the
  active player, there is one `playedCard` flag per turn, `GameView.legal` is
  computed for the active player only, and `checkWin` looks only at the active
  player. Release A adds the one place that says whom the game waits on,
  `owedMoves`, which the Partner's phase will extend; the rest is Big Table's.
- **Terrain classes.** Production and setup treat every terrain but desert as a
  resource. A gold field would pay nothing, and a sea or gold hex next to a
  second starting settlement writes a NaN key into the hand. The client repeats
  the production rule to animate gains and must change with it.
- **Results.** The results screen labels any point it cannot explain as a
  Victory Point card, and the results payload has no mode, ships or bonuses.
  Since Release A the payload carries each player's score terms and the screen
  names every part from them; the mode, ships and bonuses are still to come.
- **Restore verifier.** It checks Classic's numbers (two to four players, 19 of
  each resource, a 25-card deck, the phase list, trade offers owned by the
  active player) and would flag every new-mode game as corrupt. Since Release A
  it reads seats, bank, deck and pieces from each game's ruleset, and names a
  ruleset it does not know instead of misreading the game.
- **Copy.** Player-facing copy says "2–4 players" in many places, and new wiki
  pages must be added to the page list in `docs/wiki/build_pack.py`.

## Phase 0 — make the board data

No player sees anything change. This is the phase that decides whether the rest
is pleasant or miserable, so it is worth doing properly and worth its own PR.

**Status on 26 September 2026.** Built on `feature/board-data/2026-09-25`, not
yet merged. It does everything below except the water band, and it also moves
the board bounds from the protocol into the rules and lets the terrain shader
take up to 128 hexes. How it ships is in
[Game modes](GAME-MODES.md#how-the-modes-ship). When it merges, its pull
request (after merging main) marks as done the passages that still describe
the code before it: assumptions 1 to 5 above, apart from the 440-unit reach in
4 (`uLand[19]`, the parser's bounds, the fixed bags, the coastal test, the
single coastline, the constant `WORLD`), the board layers memoised on the seed,
and "Protocol bounds" and the 19-hex shader under
[Beyond the board](#beyond-the-board); in Game modes, the "Board bounds" item
and step 2.

**Board recipes.** Replace the hardcoded bag with a `BoardPreset` record: the
coordinate shape, terrain counts, number tokens, harbour count and the fairness
rules to apply. `generateBoard(seed, preset)` reads one. `'balanced-v2'` becomes
the first entry. Saved games and lobbies keep the board JSON they were dealt
and start from it, so no preset has to reproduce old boards byte for byte; a
fixture per preset is still worth keeping, to notice unintended changes.

**Shape as data.** `topology()` takes a predicate or a list of axial
coordinates instead of a hardcoded range. Radius-2 stays the default. The
30-hex island's middle row has six hexes, so its centre falls between hex
centres; coordinates are recentred, because scene code assumes an island
centred on the origin.

**A real coastal test.** Replace `edge.hexes.length === 1` with something that
survives sea hexes: an edge is coastal when exactly one of its hexes is land.
Today, with no sea hexes, that is the same answer. Doing it now means Phase 2
does not have to find every call site under pressure.

**Derive the world box.** Compute `WORLD` from the board's extent rather than
storing it. This is less contained than it looks: besides the camera, it sets
the viewBox, the filter and mask regions, the shader uniforms and the viewport
aspect ratio. Each needs checking at every viewport the `board-camera` tests
cover. Key the memoised board layers on the preset as well as the seed.

**Coastlines, plural.** Rewrite `coastline()` to return every closed loop, by
walking the boundary graph until all coastal edges are used. One island returns
one loop and the renderer is unchanged. This is the honest cost of Phase 0 and
the part most likely to eat a day on its own.

The water band is _not_ solved here. See Phase 2.

Risk: low, visibility: zero, value: everything after it gets cheaper. The
failure mode to watch is silent board drift — a seed producing a different
island than it did last week — which is why the fixture test comes first.

## Phase 1 — Big Table, for five and six players

The smallest real feature, and a good test of Phase 0.

**The board.** Rows of 3-4-5-6-5-4-3: thirty tiles (6 forest, 6 pasture, 6
fields, 5 hills, 5 mountains, 2 deserts), 28 number tokens (two each of 2 and
12, three of every other number), and eleven harbours (five 3:1, two Sheep 2:1,
and one 2:1 each for Timber, Clay, Hay and Rock). The island has 80
intersections, 109 edges and 38 coastal edges. Our balanced generator, adapted
to 30 hexes, is the default and only board in v1: the 11 harbours go on the 38
coastal edges with no two on the same or neighbouring intersections, types
shuffled. The official lettered spiral is documented only as reference. The
exact rules are in [Map generation](MAP_GENERATION.md). A prototype meets them
on 30 hexes, but slowly. The 11-pip cap per intersection stays (a Catanova
decision of 26 September 2026): the preset ships only when a tuned search keeps
every board under 100 ms over 20,000 seeds, or else generates boards in a
worker off the server's main thread, with a documented longer limit. That is a
new preset and nothing else, if Phase 0 landed.

**Seats and bounds.** Lift the cap in all seven places to the ruleset's range,
five to six for Big Table, and move the board bounds into the rules.

**Seat colours.** `seatColors` in `packages/protocol/src/colors.ts` fills seats
without a chosen colour from a spare list, the four defaults followed by the
whole palette, and never removes the repeats. Six such seats get coral, sky,
violet, amber, coral and sky. Remove the repeats before Big Table ships, so
seats 5 and 6 get jade and rose. Classic cannot change: with four seats or
fewer, the first four entries always cover every seat.

**Water band.** `waterOutline` still searches only 440 units out. The SVG
fallback asks it for an outline 24 units inside the band (half the feather),
and on Big Table that outline peaks at about 436 units, so nothing is cut
today. The full band would reach about 460 units and meet the cap on 70 of the
240 rays, so raise the reach, or work it out from the board, before anything
widens the band or narrows the feather.

**Supply.** 24 of each resource (120), 34 development cards (20 Knights, 3 Road
Building, 3 Year of Plenty, 3 Monopoly, 5 Victory Point), and the usual 15
roads, 5 settlements and 4 cities per player. Raise the caps of 19.

**The turn.** This is the only new rule, and it is the only part that is not
small. The official rule since 2021 is a paired turn; the older between-turns
build (the official Special Building Phase of editions up to 2020) is offered
as a labelled classic option. The host chooses. Both are in the
[Big Table rulebook](RULEBOOK-BIG-TABLE.md); in short:

- _Paired turns_ (default). The Lead plays a full turn. Then the Partner, the
  third seat to the Lead's left among players still in the game, has one action
  phase: bank and harbour trades, building, buying and one development card,
  but no roll and no trading with players. Both are on turn for the whole
  paired turn, so after every action the win check looks at both; if both have
  the target, the Lead wins. When fewer than five players remain, the Partner's
  phase stops.
- _Between-turns build._ After each turn, every other player in order may build
  and buy development cards with the cards in hand, with no trading of any kind
  and no card play. Nobody can win in the window.

That touches more than it looks like:

- `Phase` gains the Partner's phase and the build window, and `active` alone
  stops describing whose input the game is waiting for.
- The card allowance becomes one per part rather than one flag per turn, and a
  card bought in one role may be played in the other on a later part. A Knight
  or Road Building played by the Partner must return to the Partner's phase,
  while `returnPhase` is only `roll` or `actions` today.
- Bank and harbour trades need a path for the Partner, while player offers stay
  with the Lead.
- `checkWin` must check the Lead and the Partner after every action, a
  resignation that moves an award included, and again when each paired turn
  begins. A player who reached the target while holding neither marker wins
  when the next paired turn in which they hold a marker begins, so a new
  Partner wins before the Lead rolls. Under Between-turns build, a player who
  reached the target in a window wins at the start of their next turn.
- The turn clock is per turn today. The Partner's phase gets its own clock
  (half the room's turn time, rounded up to a whole second, at least 30
  seconds) and each build window 20 seconds, in every room: with six players a
  round has twelve action phases under paired turns, and thirty build windows
  under the classic option. `timeoutAction` needs a move for each new phase.
  The clock loop's comment assumes at most 12 forced steps in a row; six
  discards and a Partner's phase exceed that, which only delays the rest to
  the next tick.
- The bot driver's `owedBy` decides who owes a move, and the absence rule
  needs the same answer. Since Release A both read `owedMoves`, so the
  Partner's phase is added there once, with its timeout move.
- The client's "is it my move" checks all assume one actor: `myTurn`,
  `placementValid`, turn activity and attention prompts, `cardLockReason`, the
  turn and trade buttons, and the single highlight in `PlayerRail`. There is no
  optimistic-move path to change; these checks are the work.
- Analytics key turn times by the active player, so the Partner's time would be
  counted to the Lead.

**Phones.** Measured in the real renderer on the Phase 0 branch, Big Table's
hexes are 87% of Classic's size on a 390 × 844 phone and 79% on a 1440 × 900
desktop, and the tokens stay readable
([Game modes](GAME-MODES.md#matching-the-existing-look)). Today six players
would make three rows of the rail on a portrait phone. On a landscape phone
the rail is one column that does not scroll, and six of today's cards run on
to 425 pixels, past the dock at 303 and off an 812 × 375 screen. The owner has
picked the layouts for six players
([Game modes](GAME-MODES.md#interface-decisions-for-the-build)):

- Portrait phone: the rail becomes three columns of two rows. Cards are about
  115 × 44 pixels with 40-pixel portraits, and the rail is about 94 pixels
  tall, less than four players take today. Long names are truncated, and the
  card drops the development-card count. Four-player games keep today's
  two-column layout.
- Landscape phone: one tight column, with 38-pixel portraits, 44-pixel cards
  and 3-pixel gaps, ending above the dice and the hand dock. In the mock-up on
  812 × 375, the last card ends at 290 pixels and the dock starts at 303.
- Desktop: unchanged. In the mock-up on 1440 × 900, six cards fit, the last
  ending at 672 pixels and the dock starting at 812. On a laptop 1366 × 768,
  measured the same way, the column does not scroll either: the last card also
  ends at 672 pixels, 8 above the dock at 680, but its lower right corner sits
  under the dice of the last roll (646 to 674 pixels) and its lower left corner
  touches the development cards in the hand. The build should check that size.

The lobby's seat grid is built for four. Room setup gains a "Game mode" section
at the top, using the dialog's existing option cards (Classic; Big Table, "for
five and six players"; Open Sea), with Big Table's turn style (Paired turns or
Between-turns build) under it while Big Table is selected. The lobby also shows
the chosen mode. The picker is proposed and mocked up, and needs its own
icon.

**Order inside the phase.** Board, seats and supply first, merged but not
offered: a five- or six-player game with no second actor would be a house rule.
Then paired turns, which is when Big Table opens. Then the classic option, which
reuses the second-actor work.

## Phase 2 — Open Sea core

The big one. Four new systems, and a renderer that has to learn to draw an
archipelago.

### Sea hexes and the ring of sea

Sea becomes a real terrain, not the absence of one. Outer Isles surrounds its
islands with a ring of sea hexes that is part of the board; nothing lies beyond
it, and ships may not use the edges of the board's outer rim. Every hex gets an
island identifier, stored by the map template rather than worked out from
connectivity, because a later scenario (Sand Divide) has a region joined to the
main island by land.

This is what breaks the renderer, and it is worth being clear about the trade:
the painted water band and its coast feathering are genuinely nice, and they
exist because there was one island with a soft edge. Open Sea needs edges _on
water_ for ships to sit on, so water has to be tiles. The options are to draw
sea hexes and keep a soft band only at the outer rim, or to draw sea hexes
throughout and retire the band. I would keep the band at the rim: it is what
makes the board look like a painting rather than a grid, and the rim is the
only place it still makes sense.

Terrain needs classes: resource, desert, sea and gold. The robber goes on land
hexes only; today it may move to any other hex.

Board size on screen. The world box already follows the board (Phase 0). The
Outer Isles templates are kept about as tall as they are wide, so their hexes
draw at about two-thirds of Classic's size on a phone, against about half for
the first sketches ([Map generation](MAP_GENERATION.md#size-on-screen)). The
112-unit world margin exists for the water band round Classic's island. On a
sea board the ring is already water, so a narrower margin would help: at 48
units the hexes on a 390-pixel phone would be 0.75 and 0.71 of Classic's size
instead of 0.67 and 0.64. Decide it when the renderer is built, with
before-and-after screenshots at phone and desktop sizes.

**What the renderer must add.** On 26 September 2026 the Phase 0 branch drew
Outer Isles boards in a throwaway preview. Its data is right, but the client
has no idea of sea: sea hexes draw as land tiles (in WebGL from an undefined
atlas cell, in the fallback as forest), and their labels read "undefined".
With the sea hexes left out, each island already gets its own beach and
shallows. The outer islets reach about 442 units from the centre with three
players and 462 with four, past `waterOutline`'s 440, so the fallback's band
is visibly cut there. Phase 2 adds:

- sea as a client terrain: `TERRAIN_INDEX`, `TERRAIN_BASE` and the label
  "Sea". The fallback's tile loop skips sea hexes, and sea hexes get hit
  targets for the pirate and accessible names;
- in the shader, only land hexes in `uLand`, for beach, foam and shallows, and
  a separate mask of the whole sea frame so water fills it. The fade keys on
  distance outside the frame's rim rather than 90 units from land, and the
  waves on the frame rather than the angle about the origin. Deep-water seams
  in narrow channels need tuning;
- in the SVG fallback, the frame's outline, feathered as today, in place of
  the ray-march from the origin and its 440-unit cap. The per-island shallows
  and sand stay;
- gold as a new terrain, added without disturbing the 3 × 2 terrain atlases or
  Classic's pixels: as a second texture, or in a new atlas that keeps the old
  cells pixel for pixel and is saved losslessly
  ([Game modes](GAME-MODES.md#matching-the-existing-look)).

### Ships

- Cost one Timber and one Sheep. Fifteen per player.
- Placed on an edge that touches at least one sea hex, except an edge of the
  board's outer rim. A coastal edge holds a road or a ship, never both. A
  harbour edge is a coastal edge and may hold a ship.
- A ship attaches to your own ships or to your own settlement or city, never
  directly to one of your roads.
- **Ships and roads never join at a bare intersection.** A road and a ship
  meeting at an empty corner are two separate networks until you build a
  settlement there. This is the rule most likely to be got wrong, and it
  matters for both connectivity and the route award.
- In setup, the piece placed after a coastal settlement may be a ship instead of
  a road.
- Road Building places two roads or ships in any mix, one after the other.

**Ship movement** is the genuinely new mechanic, and the only action in the
game that moves a piece already on the board:

- Once per turn, in your action phase, you may move one ship to any edge where a
  new ship could legally go.
- The ship must sit at an open end of a line. An end is open when its far
  intersection has none of your buildings and none of your other ships. Your
  own road there does not close it; that follows the 2025 wording, where some
  older editions differ.
- A line that joins two of your buildings is closed, and its ships never move,
  even if an opponent later builds on it.
- Not the turn you built it. Not a ship on an edge of the pirate's hex, and not
  onto one.
- Loops and rings follow the official FAQ, and each is a test: a loop that
  leaves and returns to the same building of yours frees only its two end
  ships; in a ring with none of your buildings on it, every ship is movable.
- Your ships meeting at an intersection that holds an opponent's building do
  not connect through it. If the building was there first, each is an open end
  there. When an opponent settles later on your line, open or closed, the ships
  beside the new settlement stay closed there, as the official FAQ has it; the
  engine records those ends when the settlement is placed.
- A move may not detach another of your ships: every ship that was attached
  before the move must still be attached after it, and a ship already cut off
  never blocks a move. The destination is checked with the ship already
  lifted, so it cannot connect through its own old place. This check on the
  other ships is a Catanova decision (sections 8.5 and 8.7 of the Open Sea
  rulebook).
- Moving never costs you Longest Route if your route is still at least as long
  afterwards.
- No ship move between the two placements of Road Building.

On the board, ships are small upright boats in the player's colour with cream
sails, drawn on the edge they occupy, and the pirate is a ship with black sails.
In Open Sea, harbour markers drop their painted boat and keep only the pier and
the trade badge, so a harbour cannot be mistaken for a ship. This look is
proposed and mocked up
([Game modes](GAME-MODES.md#interface-decisions-for-the-build)).

Data model: a second map, `ships: Record<edgeId, playerId>`, rather than
overloading `roads`. Two maps keep `longestTrail` honest about which segments
can be traversed and make the "only join at a building" rule a property of the
walk rather than a special case.

**Longest Route** is Open Sea's name for the road award, because ships count: 2
points for at least five roads and/or ships in one continuous route. A road
segment and a ship segment only chain through a settlement or city of yours,
and an opponent's building interrupts the route. Ties and broken routes follow
Classic. `longestTrail` already breaks at another player's building, so the
shape of the search is right; it gains a "what kind of segment was I on, and am
I standing on my own building" condition. The award's key, its log line and
copy such as "Longest Road · minimum 5" are hard-coded and need a mode-aware
name.

### Gold fields

A terrain that pays the holder's choice: one resource per adjacent settlement,
two per city, in any mix. Ordinary production resolves first, with Classic's
shortage rule. Then the players owed gold choose, one at a time in turn order
starting with the player on turn, each from what the bank still holds. A second
starting settlement next to gold fields gets one chosen resource per adjacent
gold field.

Each player owed gold has one 20-second clock for all their picks, in every
room. If it runs out, the clock takes, for each card still owed, the resource
the player holds fewest of among those available, breaking ties in the order
Timber, Clay, Sheep, Hay, Rock. Picks are public once made. The closest picker
already exists: Year of Plenty's "Choose 2 from the bank" in
`DevelopmentCards`, which already disables the types the bank cannot pay.
`ResourcePicker` is a different component, used only in `TradePanel`. The
`pending` list in [Game modes](GAME-MODES.md#features-not-forks) gives the
order. This replaces the earlier idea of simultaneous picks shaped like
discards.

The gold field's art is chosen from drafts: a painted Storybook-style tile with
one large rock and a wide, glowing seam of gold above a pool with nuggets, which
read best at board size. The final tile is made with the high-quality image
model when Open Sea is built, as a new terrain in both board themes (see the
sea renderer list above).

### The pirate

A second blocker, always on a sea hex; our boards have no frame for it to park
on. It starts on a sea hex set by the map, away from the starting positions. On
a seven, after discards, or with a Knight, you move the robber _or_ the pirate,
not both. The pirate must go to a different sea hex. Then you must rob one
player who has a ship on an edge of that hex, if anyone does: one random
resource card. It blocks building and moving ships on its hex's edges, and
blocks no production, roads, buildings or harbours.

`Game.robber: number` becomes two fields. `RobberFlow.tsx` grows a choice of
which piece to move, pirate victims come from ships on the hex's edges, and the
board needs sea-hex targeting. When the clock has to finish this step, it
always moves the robber, never the pirate (section 15.3 of the Open Sea
rulebook).

### Victory points for islands

Two points for a player's first settlement on each small island, each island
counting once per player, with no supply limit. Starting settlements go only on
the main island, so the bonus never comes from setup. Needs per-player island
tracking and a new scoring term. `score()` is currently four terms; this is a
fifth. The results screen does not show it for free: it labels any point it
cannot explain as a Victory Point card, so the results payload needs the term
by name.

## Phase 3 — scenarios as data

Once Phase 2 exists, a scenario is mostly a map plus a few switches:

```
{ id, name, templates: { [players]: BoardTemplate }, victoryPoints,
  islandBonus?, revealsFog?, specialRules?: [...] }
```

**Outer Isles** (`outer-isles`) is the first, for three and four players, with a
template for each count. It is our own shape, not an official map: a main
island that holds every starting settlement, several small islands reachable
only by sea, gold fields on the small islands only, and the ring of sea around
them. Terrain, numbers and harbours are shuffled every game under fairness
rules: at least the balanced-v2 number rules where they apply, no 6 or 8 on a
gold field, every small island reachable by ship, and harbours on the main
island's coast with no two on the same or neighbouring intersections. The map
writer designs the templates and exact rules in
[Map generation](MAP_GENERATION.md). The target is 14 by default, and the host
may set it from 10 to 18.

The official Seafarers scenarios, for reference only. We do not copy their maps;
our later scenarios take structure from some of them, with our own shapes and
names:

| Scenario               | How it is won                                                               | What makes it different                                                     |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Heading for New Shores | 14 points                                                                   | A main island and three small ones, +2 for each. The teaching scenario.     |
| The Four Islands       | 13 points                                                                   | Four islands, no main one; each player picks one or two home islands        |
| The Fog Islands        | 12 points                                                                   | Face-down hexes turned up as players build beside them, in view of everyone |
| Through the Desert     | 14 points                                                                   | A desert band cuts a strip off the main island; +2 per unexplored region    |
| The Forgotten Tribe    | 13 points                                                                   | Points, cards and harbours waiting on sea edges, collected by ship          |
| Cloth for Catan        | 14 points, or most points once five villages run out                        | Villages pay cloth; two cloth is a point                                    |
| The Pirate Islands     | Capture your own fortress with at least 10 points                           | A pirate fleet on a fixed circuit; Knights become warships; no robber       |
| The Wonders of Catan   | Finish your wonder, or have at least 10 points and the most advanced wonder | Build one of several wonders, each with its own cost                        |
| New World              | 12 points                                                                   | Islands laid out at random; +1 for each island that is not home             |

The reserved later scenarios are **Sister Isles** (four islands, with home
islands), **Sand Divide** (a desert barrier, which forces region ids in the
scenario data) and **Veiled Waters** (fog). None is in v1.

Fog needs one thing Phase 2 does not have: hidden board state. The face-down
stacks must stay on the server; a revealed hex is public to everyone, not just
the player who found it. Today the board travels in every state message and in
the anonymous room preview, the client memoises the board's static layers on
`board.seed` (so a mid-game reveal would never redraw), and the compact journal
assumes the board never changes during a game.

## Phase 4 — further out

**Open Sea for five and six players.** The official five–six Seafarers uses the
paired turn too, with one ship move for the second player, on bigger boards. It
reuses Big Table's paired turn and needs its own templates. The official version
adds the five–six expansion's cards, so its bank and deck match Big Table's.
Outlined only.

**Cities & Knights** is parked by the owner. For scoping: it is a larger project
than Seafarers, not a smaller one. It adds a second resource economy (paper,
coin and cloth from cities on forest, mountain and pasture), three progress card
decks that are not development cards, knights that are placed, activated and
promoted, city walls that raise your discard limit, and a barbarian ship on a
track that attacks the player with the weakest knights. It touches nearly every
rule we have.

## What this does to the bots

Bots stay in Classic for now, by the owner's decision, and Big Table and Open
Sea have no stand-ins either. So nothing below blocks either release; it is the
bot milestone that follows each. One rule does bind the releases: costs are per
ruleset, because adding a ship to the global `COSTS` table would make Classic
bots treat ships as buildable.

`heuristics.ts` enumerates corners and roads and ranks them by pips and
distance. It has no concept of a sea crossing, a second island, or a scenario
goal, and it ranks sea hexes as robber targets. The division of labour holds —
code enumerates, the model judges — so the work is new enumerators
(`rankShipRoutes`, `islandValue`) and new questions, rather than a new
architecture. The champion's planner would need one more long-game archetype:
_cross early_. Big Table bots need a Partner's phase and, for the classic
option, a build window.

Budget one extra decision per turn for ship-heavy positions, which on the
measured numbers is small, but the enumeration work is real.

## Order, and why

1. **The mode system**, as step 1 of [Game modes](GAME-MODES.md). Nothing below
   can be offered without it.
2. **Phase 0**, alone, with the seed fixture test. Nothing else is safe until
   the board is data and the renderer can count past one island.
3. **Phase 1's board, seats and supply**, merged but not offered.
4. **Paired turns.** Its own PR, because it touches the turn state machine, the
   clock, the win check and the client's idea of whose move it is. Big Table
   opens here.
5. **The between-turns build**, as the host's classic option.
6. **Phase 2**, split: sea and rendering first with no new mechanics — a board
   with a ring of sea that plays exactly like Classic — then ships, then gold,
   then the pirate, then island points.
7. **Outer Isles**, with which Open Sea opens.
8. Then, as steps 6 and 7 of [Game modes](GAME-MODES.md): Sister Isles, Sand
   Divide, Veiled Waters and Open Sea for five and six, then bots for each
   mode. Everything else by appetite.

The thing I would most want to avoid is starting at ships. They are the fun
part and the part everyone wants to see, and building them on a renderer that
still believes in one coastline is how this becomes a six-week branch that
cannot be merged.

## Rules reference

Sourced summaries, in our own words. The full rules are in the two rulebooks.

**5–6 players (official, 2025).** Thirty hexes in rows of 3-4-5-6-5-4-3, two
deserts, 28 number tokens including a third 6 and a third 8, eleven harbours,
24 cards of each resource and 34 development cards. Ten points to win,
unchanged. Since 2021 the official turn is paired: the player three seats on
from the player on turn takes an action phase after them, with bank and harbour
trades, building and one development card, but no roll and no trading with
players. Editions up to 2020 used a between-turns build instead: each other
player in turn could build or buy, with no trading and no card play, and could
win only on their own turn. Big Table offers both, paired by default.

**Seafarers (official, 2025).** Ships cost Timber and Sheep, fifteen each, and
sit on edges touching at least one sea hex. They chain to your own buildings
and ships, and join a road network only through a building of yours. A line
connecting two of your buildings is closed; otherwise you may move one ship at
an open end per turn, but not one built this turn and not one on the pirate's
edges. Longest Route needs five and counts roads and ships together. Gold fields
pay one resource of your choice per settlement, two per city. The pirate sits on
sea (the official board also lets it rest on the frame), is moved instead of the
robber, robs a player with a ship on its hex's edges, and blocks ship building and
movement on its edges. Seven of the nine scenarios are won at 12 to 14 points;
two have other conditions. Several give bonus points for a first settlement on
a new island.

**Cities & Knights**, parked, for scoping only. Cities on forest, mountain and
pasture also produce paper, coin and cloth. Three progress card decks replace
development cards. Knights are placed, activated and promoted. Walls raise your
discard limit by two, up to three walls. Barbarians attack the player with the
weakest active knights.

### Sources

- [CATAN game rules index (official)](https://www.catan.com/understand-catan/game-rules),
  for the 2025 rulebooks of the 5–6 Player Expansion (CN3082) and the Seafarers
  Expansion (CN3083)
- [The new 5–6 player rule, 9 March 2021 (official)](https://www.catan.com/catan-fans/news/catan-universe-5-6-player-extension-new-rule-now-available)
- [The 5–6 player rule as a download, 2 August 2021 (official)](https://www.catan.com/catan-fans/news/new-5-6-player-extensions-rule-available-download-now)
- [Seafarers — CATAN official](https://www.catan.com/seafarers)
- [Seafarers FAQ — CATAN official](https://www.catan.com/faq/seafarers)
- [Catan: Seafarers — Wikipedia](https://en.wikipedia.org/wiki/Catan:_Seafarers)
- [Seafarers rules — Colonist](https://colonist.io/catan-rules/seafarers)
- [Seafarers rules — UltraBoardGames](https://www.ultraboardgames.com/catan/seafarers-game-rules.php)
- [Seafarers rules summary — SOB](https://www.sob-zine.org/PlayerAids/SeafarersOfCatanRules.html)
- [Seafarers scenarios — Catan Rules Guide](https://catanrulesguide.com/seafarers)
- [5–6 and 7–8 player rules — Colonist](https://blog.colonist.io/5-6-and-7-8-player-catan-expansion-pack-rules/)
  (describes the older between-turns build)
- [Catan: Cities & Knights — Wikipedia](https://en.wikipedia.org/wiki/Catan:_Cities_%26_Knights)
