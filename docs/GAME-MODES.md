# Game modes: a plan for a bigger Catanova

A plan, not a commitment. It lists the official variations of the game Catanova
is modelled on, records what the owner decided on 25 September 2026, says which
modes to build and in what order, and describes how a mode fits the code. The
engineering detail for bigger boards and the sea is in
[Bigger maps, and modes like Seafarers](BIGGER-MAPS-AND-MODES.md); this document
sits over it and covers the rest.

The first two new modes have their own rulebooks:
[Big Table](RULEBOOK-BIG-TABLE.md), for five and six players, and
[Open Sea](RULEBOOK-OPEN-SEA.md). Rules are described in our own words, as in
the [rulebook](RULEBOOK.md). Official product names appear here only to say
which published variation a mode resembles; [Names](#names) covers what we call
them in the game.

## The short version

Today Catanova plays the base game for two to four players, with a points target
from 8 to 15, natural or balanced dice, a turn clock and three bot levels. This
plan calls that mode Classic. Everything below adds to it without changing it: a
room that picks nothing new plays exactly as it does now.

The owner has chosen two new modes, and only these two, for now:

- **Big Table**, for five and six players, modelled on the official 5–6 player
  expansion.
- **Open Sea**, modelled on the Seafarers expansion. Its first release has one
  scenario of our own, Outer Isles, for three and four players.

The knights expansion is parked. Bots stay in Classic. Documentation comes
first: the research, then our own rulebooks, then the wiki, and only then code.

Build in this order:

| Step   | What players get                                                                           | Size      |
| ------ | ------------------------------------------------------------------------------------------ | --------- |
| 1      | Nothing visible: the mode system, proved with a hidden test mode                           | M         |
| 2      | Nothing visible: the board becomes data                                                    | M         |
| 3      | Big Table, for five and six players: paired turns, then the between-turns build option     | M + M + S |
| 4      | Open Sea core: sea tiles, ships, gold fields, the pirate, island bonuses (not yet offered) | L         |
| 5      | Open Sea opens with Outer Isles, for three and four players                                | M         |
| 6      | More Open Sea: three more scenarios, then five and six players                             | M each    |
| 7      | Bots for Big Table and for Open Sea                                                        | M each    |
| 8      | By appetite: small variants, fishermen, rivers, caravans, a map editor, teams              | Varies    |
| Parked | The knights mode                                                                           | XL        |

Sizes are for one developer working with AI help, counting tests, both screen
sizes and bots: **S** a few days, **M** one to two weeks, **L** two to four
weeks, **XL** one to two months. They are rough; the order matters more than the
numbers.

Big Table comes first because it is a bigger board and a second player acting
in each turn, on rules we already have; it proves the mode system without new
geometry. Open Sea is mostly geometry on top of the same rules. Knights would
touch nearly every rule, add a second economy, and bring 54 cards that each do
something different.

## Decisions

The list below was made by the owner on 25 September 2026. The two parts after
it were added on 26 September 2026. All of them are Catanova decisions, not
official rules. The rulebooks and the [turn clock](TURN_CLOCK.md) carry the
detail.

- **Priorities.** Big Table and Open Sea first. Cities & Knights is parked, with
  no work planned.
- **Names.** Big Table, always with the short description "for five and six
  players"; Open Sea, always two words; the base mode is Classic. The rulesets
  are `base-3-4-v1` (Classic), `big-table-v1` and `open-sea-v1`. See
  [Names](#names).
- **Mode system.** The host picks the mode in Room setup, and the ruleset is
  frozen when the game starts. Changing mode in a lobby is refused while the
  seats do not fit the new mode, or while bots are seated and the new mode
  allows none.
- **Bots.** Only in Classic, for now. Big Table and Open Sea allow no bots and
  no stand-in bots. Each gets its own bot milestone later.
- **Disconnects in Big Table and Open Sea.** A disconnected player is shown as
  disconnected, and the game waits for them. Once they have been offline for 2
  minutes, the turn clock acts for them whenever the game waits on them, exactly
  as if their time had run out, until they reconnect. This applies with or
  without a room turn timer. Reconnect grace, resignation and pausing an empty
  table work as in Classic. See
  [Modes without bots](TURN_CLOCK.md#modes-without-bots).
- **Big Table turns.** The host chooses between two turn structures. _Paired
  turns_ is the default and the current official rule: the Lead plays a full
  turn, then the Partner (the third seat to the Lead's left, counting only
  players still in the game) has one action phase with no roll and no trading
  with players. Both are on turn for the whole paired turn; if both have the
  target, the Lead wins. With fewer than five players left in the game, turns
  go one player at a time. _Between-turns build_ is the older official rule,
  offered as a labelled classic option: after each turn, every other player in
  order may build and buy development cards, with no trading, no card play and
  no win.
- **Big Table board and supply.** As the official expansion: 30 land hexes in
  rows of 3-4-5-6-5-4-3, 28 number tokens, 11 harbours, 24 cards of each
  resource, 34 development cards. Our balanced generator, adapted to 30 hexes,
  is the default and only board in v1; the official lettered spiral is
  documented only as reference. No two harbours sit on the same or neighbouring
  intersections. The robber starts on a desert chosen at random from the seed.
  There is no fixed first-game layout. The target is 10 by default, and the
  target slider, dice mode and turn timer work as in Classic.
- **Open Sea, first release.** One scenario, Outer Isles, for three or four
  players: a main island for every starting settlement, small islands reachable
  only by sea, gold fields on the small islands only, and a ring of sea that is
  part of the board. The target is 14 by default, and the host may set it from
  10 to 18. Each player's first settlement on each small island is worth 2
  bonus points. The bank and development deck are Classic's, and each player
  also has 15 ships. The pirate is always on a sea hex. Open Sea for five and
  six players comes later.
- **Maps.** Our own island shapes, shuffled every game under fairness rules.
  Official maps are never copied tile by tile. The templates and rules are in
  [Map generation](MAP_GENERATION.md).
- **Clocks.** The Partner's phase has half the room's turn time, rounded up to
  a whole second, at least 30 seconds. Each between-turns build window has 20
  seconds, and each player
  owed gold has one 20-second clock for all their picks. When the Partner's
  phase or a build window runs out, it simply ends, and nothing is bought or
  built. When a gold clock runs out, it takes the default resource for each card
  still owed: the type the player holds fewest of among those the bank still
  has, ties broken in the order Timber, Clay, Sheep, Hay, Rock.
- **Phones.** Six players need smaller player cards on phones. The layouts
  chosen are under
  [Interface decisions for the build](#interface-decisions-for-the-build).
- **Process.** Research, then our own rulebooks, then the wiki pack, then code.

### Rules settled on 26 September 2026

The owner delegated the rules questions the rulebooks had left open. The answers
below are Catanova decisions. Each rulebook's open-questions list closes the
item and says which section now states the rule.

- **Big Table board.** `big-table-balanced-v1` keeps its cap of 11 production
  pips per intersection, and the cap is not raised. The preset ships only when
  a tuned search keeps every board under the 100 ms limit over 20,000 seeds. If
  it cannot, boards are generated off the server's main thread, in a worker,
  with a longer limit written down in
  [Map generation](MAP_GENERATION.md#measurements-so-far). No official-style
  spiral preset is offered in `big-table-v1`; one is recorded only as a
  possible later option.
- **Big Table resignations.** Section 9.6 of the Big Table rulebook stands: a
  Lead who resigns is still followed by a Partner's phase if five or more
  remain; a Partner who resigns before their phase is not replaced that turn; a
  Partner's phase under way finishes when the count drops below five; and a
  robber move owed by a resigned player falls to the next player to act. A
  resignation that moves Longest Road or Largest Army triggers the win check.
- **Big Table build windows.** Once Between-turns build is chosen, windows
  continue at any player count. Every other player always gets a window;
  nothing skips one automatically, because that would leak hand information,
  and a player may pass at once. The 20-second window clock is always on, with
  or without a turn timer.
- **Big Table clocks.** Half-second clocks round up to whole seconds: the
  Partner's phase is 33 seconds at the 65-second stop and 58 at the 115-second
  stop. In a room without a timer, the 45-second Partner's clock starts when
  the phase begins with the Partner absent, or when they disconnect during it,
  and keeps running if they reconnect; an absent player's own turn there has
  no clock besides the 2-minute rule. When the Partner's phase runs out, free
  roads still owed from Road Building stay unplaced, and the clock completes a
  robber move still owed from a Knight.
- **Big Table winning.** A player who held no marker and reached the target
  wins when a later paired turn begins in which they hold a marker, if they
  still have the target then.
- **Absence during setup, both modes.** Once a player has been offline for 2
  minutes, the clock places for them: a settlement on the legal intersection
  with the most production pips (on the main island in Open Sea), with ties
  broken at random by the server, then a road on a random legal edge touching
  it. In Open Sea it places a ship there instead only if no road is legal.
- **Changing mode.** The points target resets to the new mode's default: 10 for
  Classic and Big Table, 14 for Open Sea. Only too many seated players, or
  seated bots, block a change, so a room with fewer than three players may
  switch to Open Sea and wait for more before starting.
- **Open Sea gold.** The 20-second pick clock is always on. Picks from an empty
  bank lapse, a player must pick a type the bank still has, and picks are
  public.
- **Open Sea ships.** A move may not detach another of your ships. The
  movable-ship check in section 8.7 of the Open Sea rulebook applies to any
  network of ships. A loop or ring through an opponent's building is broken
  there. When an opponent places a settlement on your line of ships, open or
  closed, the ships beside it do not become open, as the publisher's FAQ has it.

### Interface decisions for the build

Picked by the owner on 26 September 2026 from mock-ups. They are design
decisions, not rules, and the build follows them.

- **Six players on a portrait phone.** The rail becomes three columns of two
  rows. Each card is about 115 × 44 pixels with a 40-pixel portrait, and the
  rail is about 94 pixels tall, less than four players take today. Long names
  are truncated, and the card drops the development-card count. Four-player
  games keep today's two-column layout.
- **Six players on a landscape phone.** One tight column, with 38-pixel
  portraits, 44-pixel cards and 3-pixel gaps, ending above the dice and the
  hand dock. In the mock-up on an 812 × 375 screen, the last card ends at 290
  pixels and the dock starts at 303. Desktop fits six cards unchanged: on
  1440 × 900, the last card ends at 672 pixels and the dock starts at 812. On a
  1366 × 768 laptop the last card still clears the dock, but runs under the
  dice of the last roll, so the build should check that size (see the
  [maps plan](BIGGER-MAPS-AND-MODES.md)).
- **Mode picker.** A "Game mode" section at the top of Room setup, using the
  dialog's existing option cards: Classic; Big Table, "for five and six
  players"; and Open Sea. While Big Table is selected, its turn style (Paired
  turns or Between-turns build) shows under it. The lobby also shows the chosen
  mode. Proposed and mocked up; the section needs its own icon.
- **Ships and the pirate.** Ships are small upright boats in the player's
  colour with cream sails, drawn on the edge they occupy. The pirate is a ship
  with black sails. In Open Sea, harbour markers drop their painted boat and
  keep only the pier and the trade badge, so a harbour cannot be mistaken for a
  ship. Proposed and mocked up.
- **Gold field art.** A painted tile in the Storybook style: one large rock and
  a wide, glowing seam of gold above a pool with nuggets. It was chosen from
  drafts because it read best at board size. The final tile is to be made with
  the high-quality image model when Open Sea is built, as a seventh cell of the
  terrain atlas.

## The variations

Every official variation of the base game, what it adds, and what we think of
it.

### Base game (what we have)

Nineteen land hexes, three or four players (two in our own two-player option),
ten points. This is ruleset `base-3-4-v1`, with our balanced island and balanced
dice as the defaults. In the mode picker it is Classic.

### Five–six player expansion

Thirty hexes in rows of 3-4-5-6-5-4-3, two deserts, 28 number tokens, eleven
harbours, 24 cards of each resource, a 34-card development deck, and the same
ten points.

How the extra players take part has changed. Editions up to 2020 used a
between-turns build: after each turn, every other player could build or buy,
but not trade or play cards. On 9 March 2021 the publisher declared a paired
turn the official replacement, and the 5–6 rulebooks have printed it since their
2022 revisions; the 2025 edition has no other rule. In a paired turn, the player
three seats on takes an action phase after the player on turn: bank and harbour
trades, building and one development card, but no roll and no trading with
players. Wikipedia and some online versions still describe the between-turns
build as the rule.

Big Table offers both, with paired turns as the default. It is the smallest real
expansion and the best one to start with. **M** for the board and seats, **M**
for paired turns, **S** for the classic option, which reuses most of the paired
work. The rules are in the [Big Table rulebook](RULEBOOK-BIG-TABLE.md).

### Seafarers

The board becomes islands in a sea.

- **Ships** (Timber and Sheep) run along edges that touch the sea, much like
  roads. They are the only pieces that can move once placed.
- **Gold fields** pay a resource of the holder's choice.
- **A pirate** on the sea steals from ships and blocks them.
- **The longest road** becomes a longest route of roads and ships. A road and a
  ship join only at a settlement or city of their owner.

The official box is played as eight numbered scenarios and a variant for laying
out your own islands, each with its own map. Seven are won on points, with
targets from 12 to 14. Two are not: one is won by capturing your own pirate
fortress with at least 10 points, the other by finishing a wonder, or by having
at least 10 points and the most advanced wonder. Several give 1 or 2 bonus
points for settling a new island.

Open Sea does not copy those maps. Its first scenario, Outer Isles, is our own
shape, shuffled every game. **L** for the core, **M** for Outer Isles. The rules
are in the [Open Sea rulebook](RULEBOOK-OPEN-SEA.md), and the engineering in
[BIGGER-MAPS-AND-MODES.md](BIGGER-MAPS-AND-MODES.md).

### Cities & Knights

**Parked** by the owner on 25 September 2026. The summary below and
[Knights, in detail](#knights-in-detail) are kept for scoping only.

The deepest expansion, played to 13 points.

- **Commodities.** Cities on forest, pasture and mountain also make paper,
  cloth and coin.
- **City upgrades.** Commodities pay for upgrades on three tracks, with a
  special ability at level three and a metropolis at level four.
- **A third die** moves the barbarians and decides who draws progress cards.
- **Progress cards.** 54 of them, in three decks, replace development cards.
- **Knights** are built, activated and promoted, and defend against barbarians
  who otherwise pillage cities.
- **City walls** raise your hand limit.
- **Removed:** development cards and the largest army.

**XL**.

### Traders & Barbarians

Not one expansion but a box of nine variations, most of them small.

| Variation            | What it adds                                                               | Verdict                                              |
| -------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| Friendly robber      | The robber can't block a player with two points or fewer                   | Yes, tiny                                            |
| Harbour master       | +2 points for the most harbour points (settlement 1, city 2, at least 3)   | Yes, small; the target goes up by one                |
| Event cards          | A deck replaces the dice, with events on the cards                         | Partly done: balanced dice are a deck without events |
| Two-player rules     | Neutral players who build too, and trade tokens                            | Later; we have our own two-player option             |
| Fishermen            | Fishing grounds and a lake give fish, spent on small actions; an old boot  | Maybe, **M**                                         |
| Rivers               | Rivers and bridges that pay coins; richest and poorest settler             | Maybe, **M**                                         |
| Caravans             | Camel lines from an oasis; bonus points, and roads along them count double | Maybe, **M**                                         |
| Barbarian attack     | Barbarians land on the coast and knights drive them off                    | Later, **L**                                         |
| Traders & Barbarians | Wagons carry goods between special sites, past barbarians                  | Later, **L**                                         |

### Explorers & Pirates

Close to a different game on the same engine. The sea is unexplored and revealed
as you sail. Ships carry settlers and crews, and there are harbour settlements,
fish, spice and pirate lairs. It is played through missions: Land Ho!, Fish for
Catan, Spices for Catan, Pirate Lairs, and all of them together. It needs hidden
board state and moving ships on top of everything the sea needs. **XL**, and not
before sea and fog exist.

### Combinations

Seafarers and Cities & Knights combine officially, and each expansion has its
own five–six player extension. The official five–six Seafarers uses the paired
turn too, with one ship move for the second player. Open Sea for five and six
players is planned after Outer Isles; combinations with knights are parked with
knights. If every mode is a feature switch rather than a fork, a combination is
mostly a board, a target and testing. **M** each, once the parts exist.

### Online and house variants

These aren't official expansions, but they are common in online play and cheap
for us:

- **Quick game.** A lower target (8, the lowest our setting allows) and a
  shorter clock. We already have both settings, so this is a preset.
- **Discard limit.** Seven is standard; 8–10 makes sevens gentler. One
  setting.
- **Seven and eight players.** Unofficial, and bigger than six in every way.
  Not planned.
- **Teams (2 against 2).** Unofficial: shared victory, private hands. Maybe
  later.
- **Custom maps.** A map editor and shared layouts. Later, once scenarios are
  data.

### Not modes

Rivals (the two-player card game), Starfarers (in space), the dice game and the
other branded spin-offs are separate games, not variations of this one. Out of
scope.

## What a mode is, in the code

### One ruleset, chosen in the room, frozen at the start

The host picks a mode in Room setup, beside the target and the dice. The choice
is part of `RoomSettings` and, when the game starts, is frozen into the game as
its ruleset. `Game.ruleset` already exists as a string (`base-3-4-v1`) on every
saved game, though nothing reads it yet; it becomes a structured, versioned
description:

```ts
type Ruleset = {
  id: string; // 'base-3-4-v1', 'big-table-v1', 'open-sea-v1'
  board: BoardPresetId; // from Phase 0 of the maps plan
  seats: { min: number; max: number }; // 2–4, 5–6, 3–4
  victoryPoints: { default: number; min: number; max: number }; // 10 (8–15), 10 (8–15), 14 (10–18)
  supply: Supply; // bank per resource, development deck, pieces per player
  bots: boolean; // true only in Classic, for now
  turns?: 'paired' | 'betweenTurnsBuild'; // Big Table, chosen by the host
  sea?: { scenario: ScenarioId }; // 'outer-isles'
  variants: {
    friendlyRobber?: true;
    discardLimit?: number;
    harbourBonus?: true;
  };
};
```

A saved game keeps the ruleset it started with. No schema bump is needed to tell
games apart, because every game already records `base-3-4-v1`. A bump would also
not protect much: some server paths read saved games without checking the schema
(presence recovery at start-up, and SQL that reads game JSON). The real risk is
rolling back to a server that knows only Classic while Big Table or Open Sea
games are saved. So the reader ships before the writer: first a release that
refuses an unknown ruleset on every path that reads a game, then a release that
can create one.

In the lobby:

- changing mode is refused while the lobby holds more players than the new mode
  allows, or while bots are seated and the new mode allows none;
- a mode change resets the points target to the new mode's default (10 for
  Classic and Big Table, 14 for Open Sea), and a lobby with too few players may
  switch and wait;
- Start requires the mode's minimum (five for Big Table, three for Open Sea);
- the room deals its board when it is created, so a mode change re-deals it, and
  Start refuses a board whose preset does not match the ruleset.

### Features, not forks

The rules engine stays one reducer (`applyAction` in
`packages/rules/src/game.ts`). Each mode is a module that adds state, phases and
actions, and is consulted only when the ruleset turns it on: `variants.ts`,
`big-table.ts`, `sea.ts`. A Classic game never enters their code. The check is
strict: every journaled Classic game in the fixtures must replay to the same
states after each module lands.

Four things every mode touches, so they get one home early:

- **Who is owed a move.** Today one player acts at a time, apart from discards
  and trade replies. The Partner's phase, the between-turns build windows and
  gold picks all ask a player who is not on turn for an answer. A small
  `pending` list of `{ player, question }`, answered in order or together,
  replaces one-off phases. The turn clock, the absence rule, the bot driver's
  `owedBy` and the client's "your move" state all read from it.
- **Scoring.** `score()` becomes a sum of named terms: buildings, cards, awards
  and island bonuses (and later, perhaps, a harbour bonus). The game view, the
  win check, player records and the admin analytics all read it. The results
  screen needs the terms by name: today it labels any point it cannot explain as
  a Victory Point card, so island bonuses would show as cards.
- **Supply and costs.** One table per ruleset instead of constants: 19, 24 and
  19 cards of each resource; 25, 34 and 25 development cards; 15 roads, 5
  settlements and 4 cities per player, plus 15 ships in Open Sea. Three places
  cap one resource at 19 (the action parser, the resource picker and the trade
  panel), which a 24-card bank outgrows. Costs stay per ruleset too: a ship in a
  global cost table would make Classic bots think ships are buildable.
- **Board bounds.** The action parser rejects any intersection from 54, edge
  from 72 and hex from 19 before the rules see a move. Bounds move into the
  rules and are checked against the game's own board.

### Server

- **Seats.** The four-seat cap sits in seven places: `createGame`,
  `Store.enter` (ROOM_FULL), the bot seat in `Store.lobby`,
  `RoomInvites.openRoom`, `RoomInvitePanel`, the lobby's `SEATS` and its "/4"
  label. Tests pin it too. All of them read the ruleset.
- **Journal.** The compact journal stores states and copes with any board shape,
  so Big Table and Open Sea need no change. The admin's game analytics replays
  journals, so it learns each new action as it lands (ships, ship moves, gold
  picks, the pirate). A fog scenario would break the journal's assumption that
  the board never changes during a game.
- **Clock.** Classic gives each player who must discard their own full
  duration. The new windows get their own clocks: the Partner's phase, each
  between-turns build window and each player owed gold. Every new phase needs a
  timeout move before it ships, because a phase the clock cannot finish throws
  CLOCK_STATE and halts automatic play in that room.
- **Absence.** Classic covers an empty seat with a stand-in bot after 30
  seconds. In modes without bots the stand-in is off and the absence rule takes
  its place. It has to act in rooms with no turn timer too.
- **Rooms.** A rematch keeps the ruleset. Invitations and previews show the
  mode. An older open tab that saves settings without a mode must not turn a
  room back into Classic, so the server keeps the stored mode when the field is
  missing.
- **Clients.** A client that cannot draw a mode must not start a game in it. A
  capability flag, like the one that already gates Start on `preloadGame`, does
  this without bumping the protocol version, which would disconnect every open
  tab.

### Client

- **Room setup** gets a "Game mode" section at the top, using the dialog's
  existing option cards, with a line of explanation per mode ("Big Table, for
  five and six players"), the turn structure under Big Table while it is
  selected, and the target range each mode allows. The lobby shows the chosen
  mode. Outside Classic, "Add a bot" is shown disabled, with the reason. See
  [Interface decisions for the build](#interface-decisions-for-the-build).
- **Board.** Sea tiles, ships, gold fields and the pirate; later, fog. Ships
  are upright boats in the player's colour, the pirate a black-sailed ship, and
  Open Sea's harbour markers lose their boat. The renderer changes are in the
  maps plan.
- **Hand dock and build shelf.** A ship to build and a ship to move, and a way
  to choose road or ship on an edge that takes both, laid out for phones first.
- **Rail.** Today, on a portrait phone the rail is a two-column grid, so six
  players would make three rows, and on landscape phones the rail is one
  column that six cards overflow. With six players, a portrait phone
  gets three columns of two smaller cards, a landscape phone one tight column
  that ends above the dock, and desktop stays as it is; four-player games keep
  today's layout (see
  [Interface decisions for the build](#interface-decisions-for-the-build)). In
  Big Table the Lead and the Partner are both marked, and the Partner sees why
  player trades are off in their phase.
- **Your move.** Every "is it my move" check assumes one actor. The Partner, a
  player in a build window and a player owed a gold pick each need their own.
- **Guide.** A section per mode, written like the rest of the guide.

### Bots

Bots list the legal moves in code and let the decision model rank them
(`packages/bot/src`: heuristics, plan, decide and the Jev client). Every mode
needs new move lists and new questions: what to do as Partner, where a ship goes
and when to move one, which resource to take from gold. Until then bots would
play a new mode badly, so bots stay in Classic for now. Big Table and Open Sea
allow no bots, and a lobby with a bot seated cannot switch to them. Each mode
gets its own bot milestone later. The model never invents a move, so a new mode
can make bots weak but never lets them cheat.

### Admin and analytics

Stats and Growth gain a mode filter, and the retention report counts by mode.
Match records have no ruleset column yet, so the player hub cannot say which
mode a game was. Turn times are keyed by the player on turn, so a Partner's time
would be counted to the Lead unless it is keyed by who acted. The restore
verifier checks Classic's numbers (two to four players, 19 of each resource, a
25-card deck, the phase list) and would flag every Big Table or Open Sea game as
corrupt; it must read them from the ruleset. This is cheap if it is done as each
mode lands.

### Tests

For each mode:

- rule tests for every new action;
- resource and piece conservation, as the base game already has;
- full games across many seeds, as the base game has, driven by scripted legal
  moves until the mode has bots;
- screenshots at phone, landscape phone and desktop sizes for every new panel.

Tests that pin Classic's numbers (19 hexes, 54 intersections, 72 edges, four
seats) get a version per mode rather than an edit.

## The roadmap

### Step 1: the mode system (M)

**Ships**, with nothing visible to players:

- a mode field in room settings, kept by the server when an older client omits
  it;
- the frozen ruleset, read by the rules engine;
- seats, supply, the target range and bots taken from the ruleset, including
  all seven seat caps;
- the room's board dealt by mode, and checked at Start;
- the lobby's mode-change refusals;
- stand-ins off, and the absence rule on, in modes without bots;
- a capability flag for clients that can play a mode;
- the release that refuses unknown rulesets, before any release that writes
  one;
- the restore verifier reading the ruleset.

**Done when** a hidden test mode can be picked, started, played and replayed end
to end (room setup, the frozen ruleset, rules, clock, journal, admin), and a
Classic room is unchanged.

It is not glamorous, and it is what makes every later mode cheap.

### Step 2: the board becomes data (M)

Phase 0 of the maps plan: board presets, shapes as data, a coastal test that
survives sea tiles, a world box worked out from the board, and more than one
coastline. Nothing visible changes. **Done when** every seed still produces the
island it produced before.

### Step 3: Big Table (M, then M, then S)

First the 30-hex board, six seats and the larger supply, merged but not offered
to players: a five- or six-player game with no second actor would be a house
rule, since the official rule has had a paired turn since 2021. Then paired
turns, with the Lead, the Partner, the Partner's clock and the win rule; Big
Table opens here. Then the between-turns build as the host's classic option,
with its 20-second windows. **Done when** six people can finish a game on phones
with either turn structure, without the rail or the dock overflowing, including
a game where a player drops out and comes back.

### Step 4: Open Sea core (L)

In the order the maps plan gives:

1. sea tiles and their rendering, with no new rules (a ring of sea that plays
   like Classic);
2. ships, moving ships and the Longest Route award;
3. gold fields and gold picks;
4. the pirate, and the choice between robber and pirate;
5. island bonuses.

None of these is offered alone; they open with Outer Isles.

### Step 5: Outer Isles (M)

Open Sea's first scenario, for three and four players, with separate templates
for each count. The map writer defines the templates and fairness rules in
[Map generation](MAP_GENERATION.md). **Done when** three or four people can
finish a game on phones, with a reproducible map for each seed that meets every
fairness rule across many seeds. The target of 14 and the 2-point island bonus
are to playtest after release; that is a balance question, not a rules one.

### Step 6: more Open Sea (M each)

Scenarios become data. After Outer Isles, and under names already reserved:

- **Sister Isles:** four islands and no main one, with home islands;
- **Sand Divide:** a desert barrier, which needs region ids stored per hex,
  because a region can be joined to the main island by land;
- **Veiled Waters:** fog, which brings hidden board state, the one new
  mechanic.

Then Open Sea for five and six players, on Big Table's paired turn with one ship
move for the Partner.

### Step 7: bots in the new modes (M each)

Move lists and questions for Big Table (the Partner's phase, the build windows)
and for Open Sea (ships, gold, the pirate). A mode stays without bots until its
own are ready.

### Step 8: by appetite

- Small variants: friendly robber, discard limit, a harbour bonus, and a
  quick-game preset (8 points, the 40-second clock) (**S** together)
- Fishermen, rivers and caravans (**M** each)
- Exploration and pirates (**XL**)
- A map editor (**L**)
- Teams (**M**)

### Parked: knights (XL, in four parts)

See [Knights, in detail](#knights-in-detail). Combinations with knights are
parked with it.

## Knights, in detail

Parked by the owner on 25 September 2026. Nothing here is scheduled. It is kept
so the scope does not have to be worked out again, and it was not rechecked
against the 2025 editions with the rest of this plan.

### The rules, in our own words

- **Target.** 13 points. There are no development cards and no largest army.
- **Commodities.** A city on forest makes one Timber and one paper; on pasture,
  one Sheep and one cloth; on mountain, one Rock and one coin. Cities on hills
  and fields still make two of their resource. Commodities are cards in your
  hand: they count toward discards, and they can be traded and stolen.
- **City upgrades.** Three tracks of five levels: trade (paid in cloth),
  politics (coin) and science (paper). Level n costs n of its commodity, and
  you need a city to build any.
  - Level three gives an ability. Trade lets you trade commodities 2 : 1 for
    anything. Politics lets you promote knights to the top strength. Science
    gives you a resource of your choice when a roll other than seven gives you
    nothing.
  - The first player to reach level four on a track takes its metropolis: one of
    their cities becomes worth four points and can't be pillaged. Whoever
    reaches level five first takes it from them.
- **Event die.** It is rolled with the two production dice.
  - Three of its faces move the barbarian ship.
  - The other three show one track each. Everyone with at least one upgrade on
    that track draws a progress card of its colour if the red die shows at most
    their level plus one.
- **Progress cards.** 54, in three decks of 18. You may hold four; the two
  point cards are played as soon as they are drawn. Most are played on your own
  turn after the roll; the one that lets you choose the production dice is
  played before it.
- **Knights.** Each player has two knights of each strength.
  - Building one costs Sheep and Rock and gives strength 1. Promoting it costs
    Sheep and Rock again for strength 2, and strength 3 needs the politics
    ability.
  - A knight does nothing until it is activated for one Hay. An active knight
    can move along your roads, drive off a weaker opponent's knight, or chase
    the robber away. Each of these deactivates it.
  - A knight stands on a corner: opponents can't build on it or through it, and
    it breaks their longest road.
- **Barbarians.** The ship moves one step per ship face and attacks after its
  seventh step. The barbarians' strength is the number of cities on the board,
  metropolises included. The defence is the sum of every active knight's
  strength.
  - If the barbarians win, whoever has the least active strength loses a city,
    which becomes a settlement. Metropolises are safe, and players without a
    city are not affected.
  - If the defence wins, the player who contributed most gets a point card; if
    players tie, each draws a progress card of their choice.
  - Either way, every knight is then deactivated and the ship starts again.
- **Robber.** A seven makes players discard from the first turn, but the robber
  only starts to move after the first barbarian attack.
- **City walls.** A wall costs two Clay and raises your hand limit by two, up
  to three walls. A pillaged city loses its wall.
- **Merchant.** A progress card places it beside your buildings. Its hex's
  resource then trades 2 : 1 for you, and it is worth a point until someone
  else takes it.

### How to build it

**K1: the economy (L).**

- commodities and the event die;
- city upgrades with their three abilities;
- metropolises and the 13-point target;
- development cards and the largest army switched off.

With knights not built yet, the barbarians can be off too, which gives a
playable "economy only" version to test early.

**K2: knights and barbarians (L).**

- knights and their three actions;
- the barbarian track and the attack;
- the robber waking after the first attack;
- city walls.

The attack is the first rule where several players gain or lose at once, and it
goes through the `pending` answers described above.

**K3: progress cards (L).** Fifty-four cards and a few dozen distinct effects.
Each card is a small rule with its own test, and often its own prompt: choose a
player, a hex, a resource or a card to take. Build them card by card behind the
deck, so the deck can ship before every card does.

**K4: bots and polish (M).**

- move lists and questions for upgrades, knights and cards;
- the guide and a tutorial;
- balance checks from full bot games.

**On phones.** Knights add the most to the screen: a third die, a barbarian
track, commodity cards, a progress-card hand and three upgrade tracks. The dock
needs a second row or a drawer for commodities and progress cards, and the
upgrade tracks belong in a panel, not on the board. This is the part of the plan
most likely to need a design pass before any code.

## Names

CATAN and the names of its expansions are trademarks of their owner. Game
mechanics are not, which is why the rulebooks describe them in our own words.
So modes get their own names in the game. The guide may say which published
expansion a mode resembles, sparingly, in the same way the homepage calls
Catanova a Catan alternative.

Decided on 25 September 2026:

| Resembles                 | Name in Catanova                                                                       | Ruleset        |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| Base game                 | Classic                                                                                | `base-3-4-v1`  |
| 5–6 player expansion      | Big Table, always with "for five and six players"                                      | `big-table-v1` |
| Seafarers                 | Open Sea, always two words, never "OpenSea"                                            | `open-sea-v1`  |
| Cities & Knights (parked) | Not chosen; an "X & Y" name, with Guilds & Guards and Raiders & Ramparts as candidates | none yet       |

Inside the modes:

- **Big Table.** In a paired turn the player on turn is the **Lead** and the
  second player is the **Partner**; the Partner's part of the turn is **the
  Partner's phase**. The two turn structures are **Paired turns** and
  **Between-turns build**.
- **Open Sea scenarios.** **Outer Isles** (`outer-isles`) in v1. Reserved for
  later: **Sister Isles** (four islands), **Sand Divide** (a desert barrier)
  and **Veiled Waters** (fog). Scenario names carry no numbers, because an
  island count changes with the player count.
- **Awards.** Classic and Big Table keep **Longest Road** and **Largest Army**.
  Open Sea calls the road award **Longest Route**, because ships count.

Dropped from the earlier list: Six Seats; Archipelago, which is an existing
board game; Raiders and Barbarian Tide, which do not follow the "X & Y" pattern;
Keeps & Knights, which reuses "Knights". The small variants will need names of
our own when they are built: Gentle Robber and Harbour Master track the official
variant names too closely.

Artwork, card text and rule wording stay ours, as they are today.

## Still open

The rules questions this section used to list are settled. Absence during
setup, free roads left in the Partner's phase and the 45-second Partner clock
are under
[Rules settled on 26 September 2026](#rules-settled-on-26-september-2026).
Open Sea's timeout defaults (the clock always moves the robber, and owed Road
Building pieces become roads where possible, otherwise ships) and the paused
clock of the player on turn during gold picks are in sections 15.3 and 9.2 of
the [Open Sea rulebook](RULEBOOK-OPEN-SEA.md).

What remains:

1. **The knights mode's name**, when it is unparked.
2. **Open Sea balance**, to playtest after release: the target of 14 and the
   2-point island bonus on Outer Isles. It is not a rules question.

## Sources

- [CATAN game rules index (official)](https://www.catan.com/understand-catan/game-rules),
  for the 2025 rulebooks: the 5–6 Player Expansion (CN3082, 2025) and the
  Seafarers Expansion (CN3083, 2025)
- [The new 5–6 player rule, 9 March 2021 (official)](https://www.catan.com/catan-fans/news/catan-universe-5-6-player-extension-new-rule-now-available)
- [The 5–6 player rule as a download, 2 August 2021 (official)](https://www.catan.com/catan-fans/news/new-5-6-player-extensions-rule-available-download-now)
- [Seafarers FAQ (official)](https://www.catan.com/faq/seafarers)
- [Catan: Cities & Knights (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Cities_%26_Knights)
- [Cities & Knights rules (Colonist)](https://colonist.io/catan-rules/cities-and-knights)
- [Catan: Traders & Barbarians (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Traders_%26_Barbarians)
- [Catan: Explorers & Pirates (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Explorers_%26_Pirates)
- Seafarers and the five–six player extension: the sources in
  [BIGGER-MAPS-AND-MODES.md](BIGGER-MAPS-AND-MODES.md#sources), and the Big
  Table and Open Sea rulebooks.
