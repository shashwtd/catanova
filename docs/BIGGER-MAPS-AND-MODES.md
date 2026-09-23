# Bigger maps, and modes like Seafarers

A plan, not a commitment. It says what the board code assumes today, which of
those assumptions have to go, in what order, and what each step actually costs.
Read the first two sections before the phases: almost every estimate later on
follows from them.

Rules research is summarised at the end, with sources. Nothing here reproduces
rulebook text; game mechanics are described in our own words so we can build
them, which is the same basis the existing rulebook doc is written on.

## The short version

The rules engine is in better shape for this than the renderer. `topology()`
builds hexes, vertices and edges from coordinates rather than from a fixed
table, so a larger or differently shaped island is a change to one loop. The
renderer is the opposite: it assumes one island, one closed coastline, and a
fixed world box, and three of its nicest effects are built directly on those
assumptions.

So the order is: make the board data-driven first with no visible change, then
ship 5–6 players (a bigger map and one new rule), then Seafarers (sea hexes,
ships, and a renderer that can draw more than one island), then scenarios.

Rough shape of the work:

| Phase | What ships                                     | Size   |
| ----- | ---------------------------------------------- | ------ |
| 0     | Nothing visible. The board becomes data.       | Medium |
| 1     | 5–6 players on the 30-hex board                | Medium |
| 2     | Seafarers core: sea, ships, gold, pirate       | Large  |
| 3     | Scenarios as data                              | Medium |
| 4     | Fog / exploration, then maybe Cities & Knights | Large  |

## What the code assumes today

Five assumptions are load-bearing. Everything else is detail.

**1. The island is a radius-2 hexagon.** `topology()` in
`packages/rules/src/board.ts` loops `r` from −2 to 2 and bounds `q` to match,
producing exactly 19 tiles. Nothing else in the file knows the number 19, which
is the good news.

**2. The terrain and number bags are fixed.** `generateBoard` hardcodes one
desert and 4/4/4/3/3 of the resources, draws from `NUMBER_SPIRAL` (18 entries),
and places nine harbours at fixed positions along the sorted coast ring —
`[0, 3, 6, 10, 13, 16, 20, 23, 26]`. A 30-hex board needs a different bag, a
different token list and eleven harbours, so this function needs to take a
recipe rather than be one.

**3. An edge is coastal if it touches exactly one hex.** `Edge.hexes.length === 1`
is the definition used by `coastline()`, `portPlacement()` and the harbour
picker in `generateBoard`. The moment sea hexes exist as real tiles, _every_
edge touches two hexes and this definition silently stops meaning anything. It
does not throw; it just returns an empty list. This is the single most
dangerous line in the change, because it fails quietly.

**4. There is exactly one coastline, and it is a closed loop around the
origin.** `coastline()` in `apps/client/src/scene.ts` picks the first coastal
edge and walks neighbours until it returns to the start. With two islands it
walks one of them and never sees the other. `waterOutline()` is worse: it
marches a ray outward from the origin at 240 angles and binary-searches for the
shore, which only describes a single roughly star-shaped island. The painted
water band, the coast feathering and the island drop shadow are all built on
it.

**5. The world box is a constant.** `WORLD` in `scene.ts` is
`{ x: -392, y: -368, width: 784, height: 736 }`, sized by hand for a radius-2
island at `HEX_SIZE = 64`. `fitBoard` and the camera clamp both read it. A
30-hex board overflows it; a Seafarers archipelago overflows it badly.

Smaller things that will need touching, none of them hard:

- `SUPPLY` has roads, settlements and cities but no ships.
- `Game.roads` is `Record<edgeId, playerId>` and `robber` is a single hex id.
- `longestTrail` walks `g.roads` only, and breaks at another player's building
  — which is already the right rule, and is most of the work for trade routes.
- `TERRAIN_INDEX` has six terrains, matched to rows in the WebGL terrain atlas.
  Sea, gold and fog are three more.
- Seat count is capped at four in three places: `SEATS` in `Lobby.tsx`, the
  four-seat guard in `Store.lobby`, and `createGame`'s own check. The colour
  palette already holds eight, so six players need no new colours.
- `Board.preset` is `'balanced-v1' | 'balanced-v2'` (new boards are v2) and
  `Game.schema` is `1`. Both are versioned, which is exactly what we want.

## Phase 0 — make the board data

No player sees anything change. This is the phase that decides whether the rest
is pleasant or miserable, so it is worth doing properly and worth its own PR.

**Board recipes.** Replace the hardcoded bag with a `BoardPreset` record: the
coordinate shape, terrain counts, number tokens, harbour count and the fairness
rules to apply. `generateBoard(seed, preset)` reads one. `'balanced-v2'` becomes
the first entry. Saved games and lobbies keep the board JSON they were dealt
and start from it, so no preset has to reproduce old boards byte for byte; a
fixture per preset is still worth keeping, to notice unintended changes.

**Shape as data.** `topology()` takes a predicate or a list of axial
coordinates instead of a hardcoded range. Radius-2 stays the default.

**A real coastal test.** Replace `edge.hexes.length === 1` with something that
survives sea hexes: an edge is coastal when exactly one of its hexes is land.
Today, with no sea hexes, that is the same answer. Doing it now means Phase 2
does not have to find every call site under pressure.

**Derive the world box.** Compute `WORLD` from the board's extent rather than
storing it. The camera already reads it through `fitBoard`, so this is
contained, but it needs checking at every viewport the `board-camera` tests
cover.

**Coastlines, plural.** Rewrite `coastline()` to return every closed loop, by
walking the boundary graph until all coastal edges are used. One island returns
one loop and the renderer is unchanged. This is the honest cost of Phase 0 and
the part most likely to eat a day on its own.

The water band is _not_ solved here. See Phase 2.

Risk: low, visibility: zero, value: everything after it gets cheaper. The
failure mode to watch is silent board drift — a seed producing a different
island than it did last week — which is why the fixture test comes first.

## Phase 1 — five and six players

The smallest real feature, and a good test of Phase 0.

**The board.** Rows of 3-4-5-6-5-4-3, thirty tiles, two deserts, twenty-eight
number tokens including a third 6 and a third 8, and eleven harbours. That is a
new preset and nothing else, if Phase 0 landed.

**Seats.** Lift the cap from four to six in the three places named above.
`PLAYER_COLORS` already has eight.

**Supply.** More of everything, per the extension.

**The Special Building Phase.** This is the only new rule, and it is the only
part that is not small. Between turns, each other player in order may build a
road, a settlement or a city, or buy a development card. They may not trade with
anyone, and they may not play a development card. You can still only _win_ on
your own turn.

That touches more than it looks like:

- `Phase` gains a state, and `active` alone stops describing whose input the
  game is waiting for.
- The turn clock is per-turn today. A build window needs its own, shorter one,
  or players will sit through six of them a round.
- The bot driver's `owedBy` decides who owes a move from the active seat and
  the discard map. It needs to understand the window.
- Stand-in bots need to take their window too, or a covered seat plays worse
  than the person did.
- The client's optimistic-move path assumes one player can act at a time.

There is a legitimate simpler option: ship the 30-hex board for 5–6 _without_
the special build phase, as a house rule, and add the phase after. Six players
waiting through five turns is the reason the phase exists, so I would not want
to leave it out permanently, but it is a clean way to split the PR.

## Phase 2 — Seafarers core

The big one. Four new systems, and a renderer that has to learn to draw an
archipelago.

### Sea hexes and the map frame

Sea becomes a real terrain, not the absence of one. Boards gain a frame of sea
tiles, and the land is one or more islands inside it. Every hex gets an island
identifier (land hexes sharing a connected component; sea is its own).

This is what breaks the renderer, and it is worth being clear about the trade:
the painted water band and its coast feathering are genuinely nice, and they
exist because there was one island with a soft edge. Seafarers needs edges _on
water_ for ships to sit on, so water has to be tiles. The options are to draw
sea hexes and keep a soft band only at the outer frame, or to draw sea hexes
throughout and retire the band. I would keep the band at the frame: it is what
makes the board look like a painting rather than a grid, and the frame is the
only place it still makes sense.

### Ships

- Cost one timber and one wool. Fifteen per player.
- Placed on an edge where at least one of the two hexes is sea.
- Connect to your own settlements, cities, or other ships of yours.
- **Ships and roads never join at a bare intersection.** A road and a ship
  meeting at an empty corner are two separate networks until you build a
  settlement there. This is the rule most likely to be got wrong, and it
  matters for both connectivity and the trade route award.

**Ship movement** is the genuinely new mechanic, and the only action in the
game that moves a piece already on the board:

- A shipping route is _closed_ once it connects two of your buildings. Ships in
  a closed route never move.
- Otherwise the route is open, and once per turn you may move a ship at an open
  _end_ of it to anywhere a new ship could legally go.
- Not the turn you built it. Not a ship adjacent to the pirate.
- Two edge cases from the official FAQ worth encoding as tests: in a ring of
  ships with no building on it, every ship counts as open; and a route that
  leaves and returns to the same single building leaves one of the two end
  ships movable.
- Moving must not cost you Longest Trade Route if the route is still at least
  as long afterwards.

Data model: a second map, `ships: Record<edgeId, playerId>`, rather than
overloading `roads`. Two maps keep `longestTrail` honest about which segments
can be traversed and make the "only join at a building" rule a property of the
walk rather than a special case.

**Longest Trade Route** replaces Longest Road: minimum five, roads and ships
combined, but a road segment and a ship segment only chain through a building
of yours. `longestTrail` already breaks at another player's building, so the
shape of the search is right; it gains a "what kind of segment was I on, and am
I standing on my own building" condition.

### Gold fields

A terrain that pays the holder's choice: one resource per adjacent settlement,
two per city. Mechanically small — the payout step gains a pending choice — but
it needs a UI (we already have `ResourcePicker` for Year of Plenty) and it can
block the turn while several players choose at once, the way discarding does.
Reuse the discard flow's shape rather than inventing a second one.

### The pirate

A second blocker, on sea hexes. On a seven, or with a knight, you move the
robber _or_ the pirate. The pirate steals from a player with a ship on an
adjacent edge, and blocks ships from being built or moved on its hex's edges.
It does not touch settlements, roads or harbours.

`Game.robber: number` becomes two fields. `RobberFlow.tsx` grows a choice of
which piece to move, and the board needs sea-hex targeting.

### Victory points for islands

Scenario-dependent: typically two points for your first settlement on an island
you have not settled before. Needs per-player island tracking and a new
scoring term. `score()` is currently four terms; this is a fifth, and the
results screen's breakdown — which is already built from parts that must sum to
the total — will show it for free.

## Phase 3 — scenarios as data

Once Phase 2 exists, a scenario is mostly a map plus a few switches:

```
{ id, name, board: BoardPreset, victoryPoints,
  islandBonus?, revealsFog?, specialRules?: [...] }
```

The nine official Seafarers scenarios and their targets, for reference:

| Scenario               | Target | What makes it different                                     |
| ---------------------- | ------ | ----------------------------------------------------------- |
| Heading for New Shores | 12     | Main island plus two small ones. The teaching scenario.     |
| The Four Islands       | 13     | Four islands, no shared mainland; everyone starts split     |
| The Fog Islands        | 12     | Face-down hexes revealed by building toward them            |
| Through the Desert     | 12     | A desert wall between the mainland and the outlying islands |
| The Forgotten Tribe    | 13     | Fixed rewards on a remote island                            |
| Cloth for Catan        | 14     | Villages pay cloth; two cloth is a point                    |
| The Pirate Islands     | 13     | The pirate runs a fixed circuit; knights become warships    |
| The Wonders of Catan   | 13     | Build one of several wonders, each with its own cost        |
| New World              | varies | The whole board is a custom layout                          |

The first four are the ones worth building. **Heading for New Shores** is the
right first scenario: it is the introductory one, it exercises ships, islands
and island bonuses, and it needs no mechanic beyond Phase 2.

Fog needs one thing Phase 2 does not have: hidden board state, revealed per
player as they reach it. `gameView` already filters state per viewer, so the
machinery exists, but a hidden _board_ is a bigger change than a hidden hand —
the client currently receives the whole board once and caches it by seed.

## Phase 4 — further out

**Cities & Knights** is a larger project than Seafarers, not a smaller one. It
adds a second resource economy (paper, coin and cloth from cities on forest,
mountain and pasture), three progress card decks that are not development
cards, knights that are placed, activated and promoted, city walls that raise
your discard limit, and a barbarian ship on a track that attacks the player
with the weakest knights. It touches nearly every rule we have. Worth doing
eventually; not worth starting before Seafarers has shipped and settled.

## What this does to the bots

Worth saying plainly: bots will play new modes badly at first, and that is a
feature gap, not a bug to fix later by accident.

`heuristics.ts` enumerates corners and roads and ranks them by pips and
distance. It has no concept of a sea crossing, a second island, or a scenario
goal. The division of labour holds — code enumerates, the model judges — so the
work is new enumerators (`rankShipRoutes`, `islandValue`) and new questions,
rather than a new architecture. The champion's planner would need one more
long-game archetype: _cross early_.

Budget one extra decision per turn for ship-heavy positions, which on the
measured numbers is small, but the enumeration work is real.

## Order, and why

1. **Phase 0**, alone, with the seed fixture test. Nothing else is safe until
   the board is data and the renderer can count past one island.
2. **Phase 1 without the special build phase.** A 30-hex board for up to six
   players is a real feature on its own and proves Phase 0.
3. **The special build phase.** Its own PR, because it touches the turn state
   machine, the clock, the bots and the stand-ins.
4. **Phase 2**, split: sea and rendering first with no new mechanics — a board
   with a sea frame that plays exactly like base Catan — then ships, then gold,
   then the pirate, then island points. Each is shippable behind the scenario
   that needs it.
5. **Heading for New Shores** as the first real scenario.
6. Everything else by appetite.

The thing I would most want to avoid is starting at ships. They are the fun
part and the part everyone wants to see, and building them on a renderer that
still believes in one coastline is how this becomes a six-week branch that
cannot be merged.

## Rules reference

Sourced summaries, in our own words.

**5–6 players.** Thirty hexes in rows of 3-4-5-6-5-4-3, two deserts, twenty-
eight number tokens including a third 6 and a third 8, eleven harbours. Ten
points to win, unchanged. Between turns each other player in seat order may
build a road, settlement or city or buy a development card; no trading, no
playing development cards, and you may only win on your own turn.

**Seafarers.** Ships cost timber and wool, fifteen each, and sit on edges
touching at least one sea hex. They chain to your own buildings and ships, and
join a road network only through a building of yours. A route connecting two of
your buildings is closed and frozen; otherwise you may move one end ship per
turn, but not one built this turn and not one beside the pirate. Longest Trade
Route needs five and counts roads and ships together. Gold fields pay one
resource of your choice per settlement, two per city. The pirate sits on sea,
is moved instead of the robber, steals from adjacent ships, and blocks ship
building and movement on its edges. Scenario targets run 12 to 14, usually with
bonus points for first settlement on a new island.

**Cities & Knights**, for scoping only. Cities on forest, mountain and pasture
also produce paper, coin and cloth. Three progress card decks replace part of
development. Knights are placed, activated and promoted. Walls raise your
discard limit by two, up to three walls. Barbarians attack the player with the
weakest active knights.

### Sources

- [Seafarers — CATAN official](https://www.catan.com/seafarers)
- [Seafarers FAQ — CATAN official](https://www.catan.com/faq/seafarers)
- [Catan: Seafarers — Wikipedia](https://en.wikipedia.org/wiki/Catan:_Seafarers)
- [Seafarers rules — Colonist](https://colonist.io/catan-rules/seafarers)
- [Seafarers rules — UltraBoardGames](https://www.ultraboardgames.com/catan/seafarers-game-rules.php)
- [Seafarers rules summary — SOB](https://www.sob-zine.org/PlayerAids/SeafarersOfCatanRules.html)
- [Seafarers scenarios — Catan Rules Guide](https://catanrulesguide.com/seafarers)
- [5–6 and 7–8 player rules — Colonist](https://blog.colonist.io/5-6-and-7-8-player-catan-expansion-pack-rules/)
- [Catan: Cities & Knights — Wikipedia](https://en.wikipedia.org/wiki/Catan:_Cities_%26_Knights)
