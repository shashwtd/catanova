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
- **Big Table, found while building it.** When fewer than five players remain
  part-way through a Lead's part, no Partner's phase begins, but the paired turn
  keeps its markers until the Lead's part ends, so the Partner can still win in
  it. Under Between-turns build, a robber move left owing by the player whose
  turn ended is made after the windows, by the next player on turn before they
  roll. Only the clock leaves a Partner's free roads unplaced; a Partner at the
  table places them, as a Classic player must. See sections 6.8, 9.3 and 9.6 of
  the [Big Table rulebook](RULEBOOK-BIG-TABLE.md).
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
  the high-quality image model when Open Sea is built, as a new terrain in both
  board themes. How it joins the art is under
  [Matching the existing look](#matching-the-existing-look).

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
is `mode` in `RoomSettings`, a ruleset id, and when the game starts it is frozen
into the game as its ruleset. `Game.ruleset` stays the id string it has always
been on every saved game (`base-3-4-v1`). Since Release A the id is read: it
names a structured description in `packages/rules/src/rulesets.ts`, and
`findRuleset(id)` returns it (no id means Classic, an unknown id nothing):

```ts
type Ruleset = {
  id: string; // 'base-3-4-v1', 'big-table-v1', 'open-sea-v1'
  name: string; // Classic, Big Table, Open Sea
  summary: string; // the line under the name in Room setup
  board: BoardPresetId; // the preset that deals its boards
  earlierBoards?: BoardPresetId[]; // presets whose boards a lobby may still hold
  seats: { min: number; max: number }; // 2–4, 5–6, 3–4
  victoryPoints: { default: number; min: number; max: number }; // 10 (8–15), 10 (8–15), 14 (10–18)
  supply: {
    bank: number; // cards of each resource: 19, 24, 19
    deck: Record<CardKind, number>; // 25, 34, 25 development cards
    pieces: { roads: number; settlements: number; cities: number }; // 15, 5, 4
  };
  costs: Record<Purchase, Hand>; // per mode, so a ship never reaches Classic
  bots: boolean; // true only in Classic, for now
  standIns: boolean; // a stand-in bot covers an absent player; Classic only
};
```

Classic is written out from the constants it has always used. A mode that ships
is added to the registry in `rulesets.ts`; `registerRuleset()` exists for tests,
which register a hidden test mode (`tests/test-ruleset.ts`), and no environment
setting or request can add one. Later modes add their own fields when they need
them: Big Table added its turn structures (`turns?: readonly TurnStructure[]`,
`'paired'` and `'betweenTurnsBuild'`, the default first), whose host's choice is
frozen into the game as `Game.turns`. Open Sea added its scenario
(`sea?: { scenario }`), which turns on the sea's rules, with its ships in
`supply.pieces.ships` and their price in `costs.ship`. The small variants will
follow.

A saved game keeps the ruleset it started with. No schema bump is needed to tell
games apart, because every game already records `base-3-4-v1`. A bump would also
not protect much: some server paths read saved games without checking the schema
(presence recovery at start-up, and SQL that reads game JSON). The real risk is
rolling back to a server that knows only Classic while Big Table or Open Sea
games are saved. So the reader ships before the writer: first a release that
refuses an unknown ruleset on every path that reads a game, then a release that
can create one.

In the lobby (built in Release A):

- changing mode is refused while the lobby holds more players than the new mode
  allows (`MODE_SEATS`), or while bots are seated and the new mode allows none
  (`MODE_BOTS`), and a mode the host may not pick is refused as
  `MODE_UNAVAILABLE`;
- a mode change resets the points target to the new mode's default (10 for
  Classic and Big Table, 14 for Open Sea), whatever target came with it, and a
  lobby with too few players may switch and wait. Room setup shows the new
  mode's default, and the host moves the target once the mode is applied;
- a settings change without `mode`, as a tab from before modes sends, keeps the
  room's mode. A Classic room stores no `mode`, so its settings are unchanged;
- Start requires the mode's minimum (five for Big Table, three for Open Sea),
  checks again that the host may pick the mode and that no bot is seated in a
  mode without them, and freezes the ruleset into the game;
- the room deals its board when it is created, so a mode change re-deals it. A
  lobby's board belongs to no game yet, so one the mode does not play (from a
  preset a later release dealt, left behind by a rollback) is dealt again
  whenever the lobby is read, which includes every settings save and Start;
  nothing is refused. `createGame` still refuses such a board. A rematch keeps
  the mode and deals a board for it.

Built with Big Table: its turn structure is `turns` in `RoomSettings`. A change
without it, as a tab from before Big Table sends, keeps the room's; a mode
change drops it unless it comes with the new mode; it is saved only when it is
not the mode's default, as `mode` is only when it is not Classic; a mode with no
choice refuses one (`INVALID_SETTINGS`); and Start freezes it into the game.

### Features, not forks

The rules engine stays one reducer (`applyAction` in
`packages/rules/src/game.ts`). Each mode adds state, phases and actions that are
consulted only when the ruleset turns them on. Open Sea's rules are modules of
their own, `sea.ts` and `gold.ts`, which the reducer reaches through small hooks
guarded by the ruleset's `sea`, and `variants.ts` is to be one too. Big Table's turn structures changed the turn flow
itself, so they live in `game.ts` beside it, and every branch of theirs is
guarded by the game's frozen `turns`, `pair` or `windows`, which a Classic game
never has. The check is strict: every journaled Classic game in the fixtures
must replay to the same states after each mode lands, and after Big Table they
do.

Four things every mode touches, so they get one home early:

- **Who is owed a move.** Today one player acts at a time, apart from discards
  and trade replies. The Partner's phase, the between-turns build windows and
  gold picks all ask a player who is not on turn for an answer. Built in Release
  A as `owedMoves(game)` in `packages/rules/src/owed.ts`: a list of
  `{ player, kind }`, one entry per player the game waits on now. In Classic the
  kind is the phase (setup, roll, actions, robber, free roads) for the player on
  turn, or `discard` for each player who must discard. Trade replies are never
  owed, since nothing waits for them. The turn clock's discard clocks, the
  absence rule, the bot driver's `owedBy`, `timeoutAction` and the client's
  "your move" cue read from it. A later kind is added there with its timeout
  move in `timeout.ts`, and whatever must be answered in order lists only the
  player whose turn it is to answer. Big Table added `partner` and
  `buildWindow`, each owed by the player acting. Open Sea's `goldPick` is built
  the same way: owed by the player picking now, whoever is on turn, its timeout
  the default picks.
- **Scoring.** `score()` is a sum of named terms (built in Release A, as
  `scoreTerms()` in `game.ts`): settlements, cities, the two awards, victory
  point cards and Open Sea's island bonuses (`islandBonus`), with perhaps a
  harbour bonus later. A new term is one more entry there, read from its mode's
  own state. The game view, the win check, player records and the admin
  analytics all read it. The game view sends each player's terms, with cards
  hidden as in their points, and results keep them, so the results screen names
  each part. Results saved before terms still work their parts out as before.
- **Supply and costs.** One table per ruleset instead of constants: 19, 24 and
  19 cards of each resource; 25, 34 and 25 development cards; 15 roads, 5
  settlements and 4 cities per player, plus 15 ships in Open Sea. Built in
  Release A: the rules read the bank, deck, pieces and costs from the game's
  ruleset. The action parser caps one resource at the largest bank of any
  ruleset, and the rules then hold each game to its own; the resource picker and
  the trade panel read the game's bank. Costs stay per ruleset too: a ship in a
  global cost table would make Classic bots think ships are buildable. Bots read
  Classic's table, since they play only Classic.
- **Board bounds.** The action parser rejects any intersection from 54, edge
  from 72 and hex from 19 before the rules see a move. Bounds move into the
  rules and are checked against the game's own board.

### Server

- **Seats.** The four-seat cap sat in seven places: `createGame`,
  `Store.enter` (ROOM_FULL), the bot seat in `Store.lobby`,
  `RoomInvites.openRoom`, `RoomInvitePanel`, the lobby's `SEATS` and its "/4"
  label. Tests pin it too. Since Release A all of them read the ruleset, as do
  the loading screen's minimum and the lobby's Start button, and Classic's
  errors keep their wording ("Start with two to four players").
- **Journal.** The compact journal stores states and copes with any board shape,
  so Big Table and Open Sea need no change. The admin's game analytics replays
  journals, so it learns each new action as it lands (ships, ship moves, gold
  picks, the pirate). A fog scenario would break the journal's assumption that
  the board never changes during a game.
- **Clock.** Classic gives each player who must discard their own full
  duration. The new windows get their own clocks, built with their modes: the
  Partner's phase, each between-turns build window and each player owed gold,
  all kept in the room's one saved turn clock. Every new phase needs a
  timeout move before it ships, because a phase the clock cannot finish throws
  CLOCK_STATE and halts automatic play in that room.
- **Absence.** Classic covers an empty seat with a stand-in bot after 30
  seconds. In modes without bots the stand-in is off and the absence rule takes
  its place. It has to act in rooms with no turn timer too. Built in Release A:
  the ruleset's `standIns` decides, and the rule is in
  [Modes without bots](TURN_CLOCK.md#modes-without-bots).
- **Rooms.** A rematch keeps the ruleset. Invitations and previews show the
  mode. An older open tab that saves settings without a mode must not turn a
  room back into Classic, so the server keeps the stored mode when the field is
  missing. Release A does all of this but the invitation text; previews carry
  the room's settings, mode included.
- **Clients.** A client that cannot draw a mode must not start a game in it. A
  capability, like the one that already gates Start on `preloadGame`, does this
  without bumping the protocol version, which would disconnect every open tab.
  Built in Release A: the join message's `rulesets` lists every ruleset the
  tab's build contains; a tab that sends none draws Classic only.

### Client

- **Room setup** gets a "Game mode" section at the top, using the dialog's
  existing option cards, with a line of explanation per mode ("Big Table, for
  five and six players"), the turn structure under Big Table while it is
  selected, and the target range each mode allows. The lobby shows the chosen
  mode. Outside Classic, "Add a bot" is shown disabled, with the reason. See
  [Interface decisions for the build](#interface-decisions-for-the-build).
  Release A built all of this but the turn structure, which Big Table built:
  two more cards under Big Table's, and the turn style on the lobby's chip. The
  section shows only when the host may pick more than Classic or the room is
  already in another mode, so with Classic alone nothing on screen changes.
- **Board.** Sea tiles, ships, gold fields and the pirate; later, fog. Ships
  are upright boats in the player's colour, the pirate a black-sailed ship, and
  Open Sea's harbour markers lose their boat. The renderer changes are in the
  maps plan.
- **Hand dock and placement.** A ship to build and a ship to move, and a way
  to choose road or ship on an edge that takes both, laid out for phones first.
  The live game has no build shelf: players tap a legal site and confirm it, so
  the road-or-ship choice belongs in the placement confirmation, and Move ship
  in the dock's utility actions.
- **Rail.** Today, on a portrait phone the rail is a two-column grid, so six
  players would make three rows, and on landscape phones the rail is one
  column that six cards overflow. With six players, a portrait phone
  gets three columns of two smaller cards, a landscape phone one tight column
  that ends above the dock, and desktop stays as it is; four-player games keep
  today's layout (see
  [Interface decisions for the build](#interface-decisions-for-the-build)). In
  Big Table the Lead and the Partner are both marked, and the Partner sees why
  player trades are off in their phase (built with Big Table).
- **Your move.** Every "is it my move" check assumed one actor. Big Table keeps
  `active` on the player acting, the Partner or the player in a build window,
  so the checks read them. A player owed a gold pick is the one `owedMoves`
  lists, whoever is on turn, and the prompt and the cue read it from there.
- **Guide.** A section per mode, written like the rest of the guide. Big
  Table's is in the quick rules.

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
mode a game was. Turn times were keyed by the player on turn, which would have
counted a Partner's time to the Lead; since Big Table they go to whoever acted,
with a Partner's phases timed apart (`partnerTime`) and build windows left out,
and other players' Open Sea gold picks are left out of a turn's time, since the
time is theirs. The restore verifier reads seats, the bank, the deck and the
pieces from the ruleset (Release A), knows Big Table's phases, markers and
windows, and checks Open Sea's ships, pirate, robber, gold picks and island
bonuses. This is cheap if it is done as each mode lands.

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

**Status on 26 September 2026.** Built on `feature/modes-a/2026-09-26` as
Release A, not yet merged. `tests/test-mode-e2e.test.ts` picks the hidden test
mode, starts it, plays it through a seven, replays its journal move by move, and
passes it through the restore verifier and the admin's game analytics. The
Classic fixtures are byte for byte what they were, and the lobby, Room setup,
rail and results screens are pixel for pixel what they were at 375 × 812,
812 × 375, 1366 × 768 and 1440 × 900.

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

**Status on 26 September 2026.** Built on `feature/big-table/2026-09-26`, with
the board presets (`feature/map-presets/2026-09-26`) and the six-seat layouts
(`feature/six-seats/2026-09-26`) merged in, and not yet merged into main. The
three parts landed together, so Big Table ships whole, as one release (see
[The staged rollout](#the-staged-rollout)). `big-table-v1` is in the registry
with both turn structures. Rule tests name the rulebook section each checks;
whole five- and six-player games under both structures play through the store
with a player who leaves, a player away long enough for the clock to act, and
Partners whose clock runs out, and their journals replay and pass the restore
verifier and the admin's analytics. In the browser, each player in a window of
their own at phone and desktop sizes, six finished a game under paired turns
(the Partner won), and five and then six finished games under the between-turns
build, the six with a player who dropped out, was covered by the clock and came
back through the room's link. Each win was hurried, once the game had run a
while, by handing a player Victory Point cards. The Classic fixtures are byte
for byte what they were.

### Step 4: Open Sea core (L)

In the order the maps plan gives:

1. sea tiles and their rendering, with no new rules (a ring of sea that plays
   like Classic);
2. ships, moving ships and the Longest Route award;
3. gold fields and gold picks;
4. the pirate, and the choice between robber and pirate;
5. island bonuses.

None of these is offered alone; they open with Outer Isles.

**Status on 26 September 2026.** Built on `feature/open-sea/2026-09-26`, not
yet merged, with the sea rules (`sea.ts`, `gold.ts`), the board presets and the
sea renderer merged into it. `open-sea-v1` is registered, and a whole game can
be played through `applyAction` and the server: starting settlements on the
main island with a road or a ship, ships bought, free and moved, gold picks in
turn order after production with their 20-second clock, the robber or the
pirate after a seven or a Knight, Longest Route, island bonuses as the score
term `islandBonus`, and the clock's and the absence rule's defaults for each.
Classic never reaches the new code: its fixtures are unchanged, and every
client surface the build touched renders a Classic game character for
character as before.

The in-game controls followed on the same branch: the road-or-ship choice in the
placement confirmation, Move ship in the dock, the gold-pick panel, the
robber-or-pirate step, the island bonus's celebration and the Mode fact in the
results, with the guide, the card text and the move history in Open Sea's words
(how each is built is in [Every planned element](#every-planned-element)). Three
and four players have played whole games with them through the real interface,
and each control has been screenshotted at the four sizes of [Checking a
change](#checking-a-change) in both board themes. Classic renders as before, in
markup and in pixels. With these controls Open Sea can go to testers once a
build containing them is deployed. Opening it stays the owner's, by the release
steps below.

### Step 5: Outer Isles (M)

Open Sea's first scenario, for three and four players, with separate templates
for each count. The map writer defines the templates and fairness rules in
[Map generation](MAP_GENERATION.md). **Done when** three or four people can
finish a game on phones, with a reproducible map for each seed that meets every
fairness rule across many seeds. The target of 14 and the 2-point island bonus
are to playtest after release; that is a balance question, not a rules one.

**Status on 26 September 2026.** Both templates deal from `outer-isles-v1`
(`feature/map-presets/2026-09-26`), and the room deals by its seated count on
`feature/open-sea/2026-09-26`: the four-player template while four are seated,
the three-player one otherwise, dealt again from the same seed as the count
moves, within the 100 ms budget (a board takes a few milliseconds). Like the
re-deal of a board the mode does not play, this happens whenever the lobby is
read, so Start always meets the board for its count; `createGame` still
refuses one dealt for another count.

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

## How the modes ship

Checked on 26 September 2026 against the code, the runbook and the Phase 0
branch (`feature/board-data/2026-09-25`, step 2 above, which was built first).
This section says how each step reaches players, and which steps need the
owner.

### Merging, the gate and the VM

- **Merging never deploys.** There is no deploy job, and the VM never pulls on
  its own. A change reaches catanova.io only when the owner deploys a reviewed
  commit over SSH.
- **The gate is local.** GitHub Actions has not run since 20 September 2026, so
  the check is `npm run ci` on the owner's computer, on the exact commit, with
  no uncommitted changes. Deploy only a run that ends in `RESULT: PASS`.
  Without Docker it reports 9 passed and 1 skipped (the Compose check). Run it
  from a normal checkout: the main checkout detached at the commit after
  `npm ci`, or a fresh clone. Never run it from `.claude/worktrees`. The
  Phase 0 worktree's `node_modules` is a link to the main checkout's, so the
  gate's installed-tree check flags every `@catanova/*` package there.
  `npm run ci -- --docker` proves that the image builds and serves on Node 24,
  but it uses the development Compose file. The production container settings
  are first exercised on the VM.
- **The VM update** follows
  [Deploy a reviewed update](../deploy/single-vm/OPERATIONS.md#deploy-a-reviewed-update):
  finish active games where possible, confirm a backup that reports success,
  run the deploy subshell with the full hash, then check the logs and HTTPS
  health and reconnect a test room. On top of the runbook, deploy at a quiet
  hour after a fresh backup, and check afterwards that the admin System page
  shows the new Revision. Keep the old image until the new release is proven.
  Every swap disconnects all players for a few seconds, and the runbook says
  what that does to tables in progress.
- **Which release is live** is known only on the VM. The repository records
  only the first release, `8741e44`. Before the first deploy below, the owner
  reads the running container's image label, as the runbook shows. If it is
  older than `6af5762`, deploy `6af5762` on its own first and let it run a day,
  so Phase 0 is not bundled with other unreleased work. If it is older than
  `7e86098`, the admin console comes first: its Cloudflare and Access setup
  and status directory in [Admin console](ADMIN.md#cloudflare-setup), and its
  five values (`TUNNEL_TOKEN` and the four `ADMIN_*` settings) in
  `production.env`. Without them the deploy stops at `compose config`, after
  the checkout and `CATANOVA_REVISION` have already moved. If it is older than
  `88cad52`, run the game-avatar cleanup in
  [Accounts](AUTH.md#username-and-portrait-ownership) after that deploy.
- **The docs merge** publishes on public GitHub but changes nothing on the
  site. The image copies no docs, and the public pages are built from React
  components, not from `docs/`. Once merged, the rulebooks, the plans and the
  wiki pack are public, and the live `llms.txt` link to `docs/RULEBOOK.md` on
  main shows the planned modes, marked as not yet playable. No VM deploy is
  needed; the next code deploy carries the docs. Merge it before Phase 0.
- **Phase 0 can deploy on its own**, with no visible change. What was checked:
  - Saved games and lobby boards are stored as full JSON and never re-dealt
    from their seed, and every board ever saved has a preset field
    (`balanced-v1` since 9 September 2026, `balanced-v2` since 23 September
    2026). `topology()` gives byte-identical JSON before and after.
  - The restore verifier passes across versions both ways: Phase 0 verified 5
    of 5 played games written by main, and main verified 5 of 5 written by
    Phase 0. Rolling back is safe.
  - `PROTOCOL_VERSION` stays 1 and message shapes are unchanged. Real moves
    give the same payload hashes, so retries sent across the swap are still
    recognised. An off-board id is still refused with `ILLEGAL_ACTION`.
  - Old tabs keep working on Classic boards until they are reloaded.
  - Classic is pixel-identical in 18 screenshots, and a fixture pins 607 seeds
    byte for byte, plus whole bot games.
  - The terrain shader takes up to 128 hexes, within what WebGL 2 guarantees,
    and falls back to the SVG ground if it fails to compile.

  After the deploy, open a game in progress and start a new one, on a phone
  and on desktop, including an older Android phone and an iPhone. The board
  should show painted terrain, not the flat fallback, with no "Terrain
  renderer unavailable" warning in the console.

### The staged rollout

Each mode reaches players in several releases, each gated and deployed as
above. The reader ships before the writer, so a rollback never meets a game it
cannot read.

1. **Release A: reader and switch** (step 1). No player can start a game in
   another mode yet. It contains:
   - the mode field in room settings. The server keeps the stored mode when an
     older tab leaves the field out, and re-deals the board on any mode
     change;
   - unknown rulesets refused on every path that reads a saved game: `loadGame`
     (with `VERSION_MISMATCH`, beside its schema check), `initializePresence`
     at start-up, the journal compactor, the restore verifier and the admin
     reads. Start-up and the compactor leave such a game untouched;
   - stand-in bots that depend on the ruleset: none in a mode without bots;
   - a check at Start that the board's preset matches the ruleset. As built, a
     lobby holding a board its mode does not play is dealt a new one instead,
     since the board belongs to no game yet;
   - a restore verifier that reads seats and supply from the ruleset;
   - a capability flag in the join message, like `preloadGame`. The server
     refuses to start, join or watch a non-Classic room from a tab without it,
     with the existing `CLIENT_UPDATE_REQUIRED`, and the tab shows the reason:
     "Refresh to play Big Table". `PROTOCOL_VERSION` stays 1, because bumping
     it would cut off every open tab;
   - two environment switches, read at start-up. `CATANOVA_MODES` lists the
     modes any host may pick; unset means Classic only.
     `CATANOVA_MODE_TESTERS` lists account ids whose rooms may pick any mode
     the build contains. An unknown mode id is logged and treated as
     unavailable. It never stops the server: otherwise a rollback to A with
     `big-table-v1` still in `production.env` would crash-loop. The server
     enforces both switches when settings change (`MODE_UNAVAILABLE`) and
     again at Start. Room setup shows the Game mode section only when the host
     may pick more than Classic, so everyone else sees today's screens;
   - both variables added to `deploy/single-vm/compose.yaml` and
     `deploy/single-vm/.env.example`, to `SCRUBBED_VARIABLES` in
     `scripts/ci.ts` and to the `env -u` list of the runbook's
     `catanova_compose` helper.

   Built on `feature/modes-a/2026-09-26`, as listed. What it adds beyond the
   list:
   - the switches live in `apps/server/src/modes.ts`. An unknown id in
     `CATANOVA_MODES` is logged as `mode_unavailable`, and a server that opens
     more than Classic logs `modes` at start-up. Only the host's snapshot
     lists the modes they may pick (`RoomState.modes`), and only when that is
     more than Classic;
   - the capability is `rulesets` in the join message: the ruleset ids the
     tab's build contains. The field never costs a tab its handshake, so a
     later client can always reconnect after a rollback: the server drops
     anything that is not a ruleset id and any repeat, keeps at most 32, and
     ignores a value that is not a list. A game in a mode this server does not
     know is refused with `VERSION_MISMATCH`, not `CLIENT_UPDATE_REQUIRED`,
     since refreshing cannot help;
   - start-up and the compactor leave a game in an unknown mode exactly as it
     is, the account history skips it, and the clock stops asking about it. Game
     analytics refuses it, the dice statistics leave its rolls out and the
     retention report reads no ending from it;
   - no production code path or setting can reach the test mode, which only
     tests register. The design preview at `/dev/lounge` fakes one of its own.

   The watchdog, the backup pings and the weekly drill are not installed on
   the VM yet. Switch them on
   ([Alerts](../deploy/single-vm/OPERATIONS.md#alerts)), deploy A, and let one
   restore drill pass before any mode opens, so tester games are checked.
   Release A is where every later rollback lands. Once any mode game exists,
   never roll back past it.

2. **Release B: Big Table**, testers first. The plan was two releases, the
   board, seats and supply first and hidden, then paired turns; they were built
   together (`feature/big-table/2026-09-26`), so they ship together, with the
   Between-turns build option as well. A five- or six-player game with no
   second actor would be a house rule, so nothing is lost by not shipping the
   board alone. The release leaves `CATANOVA_MODES` as it is, so nobody can pick
   Big Table until the owner adds testers. Before that, measure the deal time
   in the production container on the VM, as
   [Map generation](MAP_GENERATION.md#measurements-so-far) asks: the server
   deals a room's board on its main thread when the room is created, returns to
   the lobby or changes mode, so every deal must stay under 100 ms there, or
   dealing moves to a worker. After the deploy, the owner adds their own
   account id and a few friends' to `CATANOVA_MODE_TESTERS` (the id is in the
   admin console's player address) and recreates the container. The host must
   be a tester; the others join by code with up-to-date tabs. A tester may pick
   every mode the build contains, and the build with Big Table carries Open
   Sea's engine too: the two were brought together on
   `feature/modes-all/2026-09-26`. So add testers only from a build that also
   has Open Sea's in-game controls for ships, gold picks and the
   robber-or-pirate choice (step 5). Test:
   - several full five- and six-player games under each turn structure, on
     portrait and landscape phones and on desktop, including 1366 × 768;
   - a player who drops out and comes back (the 2-minute absence rule), a
     Partner's clock that runs out, and build windows in a room without a
     timer;
   - rematch and invitations;
   - the admin Games and Stats pages;
   - a manual restore drill (`systemctl start catanova-drill.service`) that
     verifies the Big Table games;
   - locally, Release A on a copy of a database with Big Table games: it must
     refuse those games, not misplay them, and their players must still be
     able to create, join and play Classic rooms.
3. **Opening to everyone.** Add `big-table-v1` to `CATANOVA_MODES` and recreate
   the container. In the same window, ship the release that changes the copy
   saying "two to four" or "2–4". The public pages are prerendered when the
   image is built, so this is a code release, not an environment edit. Setting
   `CATANOVA_MODES` in `production.env` before running the deploy subshell
   makes both one container swap. Today the copy is in:
   - `apps/client/src/PublicPages.tsx`: the home page's description, the FAQ
     answers to "What is Catanova?" and "How many players do you need?"
     ("Two to four."), the structured data's `numberOfPlayers`
     (`maxValue: 4`), and the player guide's subtitle, "Players 2–4" row and
     opening paragraph;
   - `apps/client/src/EntryScreen.tsx` ("A Catan alternative for 2–4
     friends.") and `apps/client/src/LandingFeatures.tsx` ("gather 2–4
     friends");
   - `scripts/render-public-pages.ts`: `llms.txt`, twice;
   - `apps/client/public/site.webmanifest`, `README.md` (twice) and the
     `package.json` description;
   - the rules error "Start with two to four players" in
     `packages/rules/src/game.ts`, which should read the ruleset anyway; tests
     in two files match its wording.

   Search again on the day with `git grep -n -i -E "two to four|2–4"`. The
   same release changes every line in `docs/` that says the mode is not
   playable yet or still being built (the rulebook, the turn clock, map
   generation and the wiki pages), with the wiki pack rebuilt. The
   Between-turns build option opens with it: the host of any Big Table room
   chooses.

4. **The kill switch.** Take the mode out of `CATANOVA_MODES`, clear
   `CATANOVA_MODE_TESTERS`, and recreate the container. Taking it out of
   `CATANOVA_MODES` alone leaves it open to testers. Started games keep their
   frozen ruleset and play on; no new game can start in the mode.
5. **Open Sea follows the same path.** Its engine and its in-game controls
   for ships, gold picks and the robber-or-pirate choice are in the same build
   as Big Table. The build registers `open-sea-v1`, so it advertises the mode
   in every tab's `rulesets`, and any tester can pick it, Big Table's testers
   included. Outer Isles goes to testers once the owner is happy with its look,
   then to everyone, with its own capability value ("Refresh to play Open Sea"),
   its own copy changes and the same kill switch.

### What needs the owner

- Every push and pull request, because the repository is public.
- Every merge into main.
- Every deploy, over SSH.
- Every change to `production.env`: adding testers, opening a mode, the kill
  switch.
- Switching on the watchdog, the backup pings and the restore drill.
- Generating more than about five images for the new art.

Writing the code, running the gate and taking screenshots need no approval.

## Matching the existing look

Checked on 26 September 2026 against the stylesheets, the art and the real
renderer. Every mode screen and piece follows the rules below. The table after
them says where each planned element stands and how it is to be built.

### What the real renderer shows

Big Table was drawn by the real renderer on the Phase 0 branch, from a
throwaway preset. It matches Classic in WebGL and in the SVG fallback, on a
phone and on desktop: the same tiles and sand paths, the same number tokens,
the same harbours with piers and badges, and the same water band fading into
the table. Its hexes are 87% of Classic's size on a 390-pixel phone (43.3
against 49.5 pixels across; tokens 15.6 against 17.9 pixels) and 79% on a
1440 × 900 desktop (87.2 against 109.9 pixels; tokens 31.5 against 39.7).
Tokens stay readable.

Outer Isles is drawn by the sea renderer on `feature/sea-render/2026-09-26`,
not yet merged, in WebGL and the SVG fallback and in both themes. Each island
keeps the beach, foam and shallows of the land-only picture, the sea fills the
whole frame, and the fade into the table starts just outside the rim. On a
phone the board opens on its islands, with tokens about 15 pixels against
Classic's 18; the whole frame is a pinch away. Classic draws exactly as before:
its 18-screenshot comparison differs in no pixel. How it is built is in the
[maps plan](BIGGER-MAPS-AND-MODES.md#sea-hexes-and-the-ring-of-sea).

### Rules

1. **One owner per component.** Each new component gets one stylesheet of its
   own, as `room-seats.css` owns the seat card, imported last in
   `apps/client/src/main.tsx`, after `table-light.css`. Never add to
   `style.css`, `polish.css` or the other layered sheets. Many rules win by
   source order: 21 sheets load after `mobile-layout.css`.
2. **Same specificity.** Reuse the classes of the rule you mirror, or match its
   selector shape. No extra `:not()`, no IDs, no `!important`. Layouts for five
   and six seats hang off a data attribute set only then, so four-player
   screens stay pixel-identical.
3. **The right scope.** In a game, `.game-world.playing` with the ink-green
   `--game-*` values of `lounge.css`. Before a game, `.game-world.player-home`
   and `.lobby` with the walnut `--game-*` values of `lounge-tabletop.css`. In
   every dialog and popover, the parchment `--dialog-*` values of
   `game-dialogs.css`. Read colours from these. A colour that is truly new
   becomes a scoped custom property, not a loose hex value.
4. **Type.** Cinzel 600 for titles only. Barlow 400, 500 or 600 for everything
   else, board numbers included. Barlow loads only those three weights (Cinzel
   loads 600 and 700) and font synthesis is off, so Barlow at 700 or 800 looks
   like 600. No new family or weight without its `@fontsource` import.
5. **Buttons.** Copy the neighbouring button: hub gold, walnut or slate before
   a game, the olive `.gold-button` in parchment, the teal `.icon-button` in
   the game. Every one has a light inset top line and most a dark inset bottom
   lip. Of the pre-game and parchment buttons, only the lobby's Start and
   Leave and the olive button have a hard ledge; the hub gold, walnut, slate
   and teal buttons have a soft shadow. Warm means you can act. Disabled
   buttons fade to 0.4 (`button:disabled` in `style.css`); a disabled card or
   seat control fades to 0.45, like `.seat-fill`.
6. **Icons.** `GameIcon` only: an existing painted name (boat, road,
   settlement, dice, trophy and others) or a 24 × 24 `CONTROL_PATHS` line icon
   with stroke 1.8, round caps and `currentColor`. A new painted symbol follows
   `docs/art/painted-ui-icons.md` and goes into the icon atlas, never a loose
   file or an emoji.
7. **Pieces.** Flat SVG in world units with the house contour: a seat-colour
   fill, a `#31453e` stroke at 1.7 (roads `#33463f` at 1.1), a soft ground
   shadow with no stroke, and a sheen or roof line. Colours come from
   `seatColorMap` by player id. Previews and guides reuse
   `.build-site-preview`, `.build-ghost` and `.site-guide`.
8. **No hard lines on water.** No rims, hex outlines or dark borders on the
   sea. Water is the painted environment art with the existing blend by
   distance from the coast, the foam line and the sand bank. New constants go
   through `scene.ts`, so WebGL and the SVG fallback stay in step.
9. **Both board themes.** Storybook and Classic (`board-theme.ts`). New
   terrain, pieces and icons are made and checked in both.
10. **Motion.** Finite effects only, on `--ease-smooth-out` and the existing
    `.t-dropdown`, `.t-panel-slide`, `.t-digit` and `.t-acc`. Every animation
    has both opt-outs, `@media (prefers-reduced-motion: reduce)` and
    `[data-motion='reduced']`. The server never waits for an animation.
11. **Art.** New bitmaps follow the Storybook prompt in
    `docs/art/terrain-concept.md` or the icon prompt: calm, light edges and
    square cells. The prompt, references and SHA-256 go in `docs/art`. Drafts
    on gpt-image-2.5-flare, finals on sunburst, and the owner is asked before
    more than about five images.
12. **Don't.** No emoji, no rope or wood-frame art stretched onto buttons, no
    glow that never stops, no competing banners, no new backdrop. Before a
    game the screen stays on the walnut backdrop; the game stays on the lit
    walnut table.

### Every planned element

| Element                                     | Status            | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game mode section in Room setup             | Built (Release A) | Built in `RoomConfiguration` with the same fieldset and `label.settings-dice-option` cards, so today's selected and hover rules apply. Shown only when the host may pick more than Classic, or the room is already in another mode. The legend's icon is a line icon (`game-mode`, three tiles) until its painted icon is made.                                                                                                                                                                                                                                                                                                                                                                            |
| Big Table turn style                        | Built (Big Table) | Two cards inside the Game mode fieldset, after Big Table, indented to its text (38 pixels: the card's padding, its radio and the gap), under a `.settings-caption` line "Turn style" and opened with `.t-acc` while Big Table is picked. The copy: "After each turn, the Partner gets a full action phase, with no roll and no player trades", and for the older rule, "The older rule: after each turn, everyone else in turn may build and buy, with no trading." The lobby chip reads "Big Table **Paired**" or "Big Table **Build windows**".                                                                                                                                                          |
| A blocked mode, and the points range        | Built (Release A) | A `data-disabled` state on the same card selector: opacity 0.45, `--dialog-muted` text, the reason in `<small>` ("Bots play Classic only", "For up to four players"). The existing range takes its limits and Standard label from the ruleset; while a new mode is picked it shows that mode's default, waiting, with a `.settings-caption` saying why.                                                                                                                                                                                                                                                                                                                                                    |
| Mode chip in the lobby                      | Built (Release A) | A `button.lobby-mode` first in `.lobby-room-options`, shaped like the goal, timer and dice chips: an 18-pixel icon, Barlow 500 at 14 px, opening Room setup. Shown when the room is not Classic or its host could pick another mode. On phones the four chips sit two by two (`game-mode.css`), so no divider floats at the start of a wrapped row.                                                                                                                                                                                                                                                                                                                                                        |
| Six-seat lobby                              | Built             | Built in `room-seats.css`, off `data-places` on the seat row, which is set only at five or six places. Phones get three columns of cards 112 pixels wide and 140 tall, with 56-pixel portraits; the row with your own card, which shows your colour, is 165 tall. A short row of two sits centred. A landscape phone keeps one row, and a laptop's row of six gets portraits of 82 to 88 pixels. The remove button shrinks to 22 pixels, clear of the frame. The lobby and the invitation read the seat count from one `seats` prop, four by default. Still to come with the mode: "Add a bot" uses the disabled `.seat-fill` with its reason, and "Big Table needs five players" goes in the launch hint. |
| Mode in history, invitations and results    | Needs work        | No new badge. Built with Big Table: a Mode row in `.game-over-facts` ("Big Table · Paired turns", "Open Sea"), and log lines for the new situations ("Ann's turn, with Dan as Partner.", "Dan begins the Partner's phase.", "Ben's build window.", "Dan wins as Partner with 10 points!"). Still to do: the small line of `.match-row` and the invitation text, which need a ruleset column in match records first.                                                                                                                                                                                                                                                                                        |
| An out-of-date tab                          | Built (Release A) | `CLIENT_UPDATE_REQUIRED` with a reason the player sees, "Refresh to play Big Table" or "Refresh to play Open Sea", through the existing error path. The server builds it from the mode's name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Six-player rail, portrait phone             | Built             | Built in `six-seat-rail.css`, off `data-seats` on the rail, which is set only at five or six. Three columns of 115 × 44-pixel cards with 40-pixel portraits; the rail is 94 pixels tall. Names are 12 px with an ellipsis. The rank hides while the turn chip shows. The award counts become a second line under the score, and the development-card count goes. Medals are 22 px. The friend button still waits for a hover, focus or tap, then shows at 22 px off the portrait's corner. An absent player's portrait shows the mark alone.                                                                                                                                                               |
| Six-player rail, landscape phone            | Built             | Built in the same stylesheet and query. One column of 44-pixel cards with 38-pixel portraits and 3-pixel gaps. On a shorter screen the portrait shrinks, so the last card always ends at least 8 px above the hand dock: at 812 × 375 it ends at 289 and the dock starts at 297; at 844 × 390, 290 and 312. Measured with a live timer and an absent player. Check the Partner chip once it exists.                                                                                                                                                                                                                                                                                                        |
| Six-player rail, desktop                    | Built             | Built in the same stylesheet. At 1440 × 900 six cards are unchanged, ending at 672. On a shorter screen the portrait shrinks just enough for the last card to end 8 px above the dice of the last roll: 78 px at 1366 × 768 (the card ends at 638, the dice start at 646) and 70 px at 1280 × 720 (590 and 598). Five cards stay unchanged down to about 700 pixels high. As on phones, the leader's badge steps aside while the turn chip shows, since the chip and its timer covered it.                                                                                                                                                                                                                 |
| Seat colours 5 and 6                        | Built             | Fixed: each colour is on the fallback list once, so seats five and six get jade and rose. A test over every table of up to four seats shows they resolve exactly as before. Jade and rose roads and houses read on forest, pasture and the coast, and rose beside coral, in both themes at 375 × 812, so the order stays. Ships are not drawn yet; check them when they are.                                                                                                                                                                                                                                                                                                                               |
| Lead and Partner markers                    | Built (Big Table) | `playerTurnActivity` gives both marker holders the existing `.profile-turn` chip and `.active`, labelled "Lead" and "Partner" with the unused `.profile-turn-label`; the clock shows only on the one acting. On the small cards of five and six on a phone, a labelled chip starts at its card's edge and drops its phase icon, so it stays on its card (`big-table.css`).                                                                                                                                                                                                                                                                                                                                 |
| Partner's phase prompt and trade lock       | Built (Big Table) | `.action-prompt`: "Your Partner's phase: build, buy, trade with the bank, play one card", for the Partner only. The attention cue for the Partner only. The trade panel opens on Bank & ports; its Players tab greys the offer with the muted line "No trades with players in the Partner's phase". The end button reads "End phase".                                                                                                                                                                                                                                                                                                                                                                      |
| Between-turns build windows                 | Built (Big Table) | For the player in the window: `.action-prompt` "Build window: build or buy, no trading", the timer in their chip, and the end button labelled "Done". Everyone else sees only the chip move along the rail, with no sound and no prompt; the tab title says whose window it is. The player in the window gets no cue either, since a window follows every turn.                                                                                                                                                                                                                                                                                                                                            |
| Turn clock in the new phases                | Built             | The same `.turn-timer`, reading its deadline from whoever is owed a move. Its title and visible label, which say "Discards" while discards pause the clock, say "Partner" and "Build window" in Big Table's phases, and "Gold picks" while Open Sea's picks pause it. The picker's own 20 seconds (`turnClock.goldDeadlines`) count in the gold-pick panel and on their card.                                                                                                                                                                                                                                                                                                                              |
| Absent player with no stand-in              | Built (Release A) | Reuse `.offline-mark` and `.profile-absence`. Change the visible "Away" and the tooltip, which says a bot takes the seat: "Auto moves in 1:32", then "Clock plays forced moves". On the smallest cards, the mark only: the in-game rail already hides the label's words and shows only the countdown.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Big Table island                            | Blends            | Measured above. The fallback's water outline peaks about 436 units out, just inside `waterOutline`'s 440-unit reach, so nothing is cut; a wider band would need the reach raised. Screenshot the 11 harbours on both themes, in WebGL and the fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tokens and harbour badges on smaller hexes  | Built             | A sea board keeps 72 units round its rim, not 112, and where the whole board would draw tokens under 16 px it opens zoomed on its islands: 16.5 px with three players and 15.5 with four on a 390 × 844 phone (Classic 17.9), badges and pieces with them. Desktops open on the whole board, its tokens 23.7 px. Bigger tokens alone were dropped.                                                                                                                                                                                                                                                                                                                                                         |
| Sea                                         | Built             | Painted water, never a hex grid, from the land-only picture: each island keeps its shallows, foam and sand, and water fills the frame. One-hex channels have no dark seam, and the open sea is painted in patches so its tile shows no kaleidoscope. Sea hexes have targets; `.site-guide` lines will mark where a ship goes.                                                                                                                                                                                                                                                                                                                                                                              |
| The board's outer edge                      | Built             | The outer ring stays opaque deep water. The fade into the table starts just outside the rim on the frame's smooth outline, with waves keyed on the position: no frame and no stepped edge. The SVG fallback feathers the same outline. The stage casts no shadow on a sea board; each island casts it on the water.                                                                                                                                                                                                                                                                                                                                                                                        |
| Ships                                       | Built             | The painted wooden ship of [Open Sea's ship](art/ship.md), lying along its edge about a road's length, 9 units out to sea on a coast, its sail dyed the seat colour through the sail's mask and the hull left as wood. It replaced the first, flat ship, which the owner did not like.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pirate                                      | Built             | The same painted ship a tenth larger, turned across its sea hex, its hull darkened and its sail dyed the robber's near-black `#172231`. On a harbour's sea hex it steps aside to clear the badge (`piratePlacement`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Harbours in Open Sea                        | Built             | Piers and the resource badge, no boat sprite when the board has sea. Mocked with two ships and the pirate on the harbour's sea hex: the badge moved in from the sea hex's middle to 30 units out, between the piers' ends. Ships draw above it, and the pirate stands clear of it.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Gold field, Storybook theme                 | Built             | Redone with the Storybook prompt: the rock, seam, pool and nuggets moved up clear of the number token, on a muted warm stone ground, with calm edges. A 512-pixel tile of its own beside the atlas ([gold field tiles](art/gold-field.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Gold field, Classic theme and fallback      | Built             | A Classic tile in the denser style of `terrain-fantasy`, and the warm stone fallback `#8f7f5a`, labelled Gold. Gold is a second texture, loaded only for a board with a gold field, so the 3 × 2 atlases and Classic's pixels are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| New icons                                   | Not designed yet  | Game mode, pirate, gold and island bonus, painted with the icon prompt. Repack the atlas to 8 × 7 with a clean gutter of at least 4 px, a new hash and new sizes. Move ship has a line icon. Stand-ins, named in `SEA_ICONS`: line icons for ships and the pirate (not the painted boat, whose look is being redone), the spark for gold, the trophy.                                                                                                                                                                                                                                                                                                                                                      |
| Road or ship on a coastal edge              | Built             | The live game has no build shelf: players tap a site and confirm it. A coastal edge that takes either piece is one site, where `PlacementConfirmation` offers Road or Ship, each with its cost when bought: in play, in setup and for Road Building (`PlacementChoice`). A sea edge is a ship site, the ship's ghost its preview.                                                                                                                                                                                                                                                                                                                                                                          |
| Moving a ship                               | Built             | "Move ship" in the dock's `.utility-actions`, made like Trade, its visible word "Move" as "Move ship" wraps at Trade's width; tapping your own ship also starts a move. Movable ships get the dashed orbit, destinations the site guide, and `PlacementConfirmation` confirms. The card tooltip's parchment says why a ship cannot move.                                                                                                                                                                                                                                                                                                                                                                   |
| Gold pick                                   | Built             | Built from Year of Plenty's picker in `DevelopmentCards` ("Gold field: choose N", buttons limited by the bank) in a `.robber-flow` panel, with the discard waiting list for the order of picks and `TurnTimer` for the 20 seconds, which the picker's card also counts. Everyone else sees who is picking and who is next (`GoldPick.tsx`).                                                                                                                                                                                                                                                                                                                                                                |
| Robber or pirate                            | Built             | A first step with two `.robber-victim` buttons, robber and pirate, each with a title and one line, offered only where legal. Then the existing target selection, on sea hexes with the robber's outline for the pirate; the two are never targetable at once. The pirate robs a player with a ship on the hex's edges (`RobberChoice.tsx`).                                                                                                                                                                                                                                                                                                                                                                |
| Island bonus                                | Built             | One celebration through `.award-celebration-layer`, +2 in the score tooltip ("Island bonus +2") and the log, and "Island bonus × n" with its icon in the results. The trophy stands in for its icon. No permanent board marker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Results screen                              | Built             | Points named by score term, built in Release A. A Mode fact, "Big Table · Paired turns" or "Open Sea", built with Big Table. "Longest Route" in Open Sea in the facts, the point breakdown, the standings and the medal's label, built with Open Sea's engine. Six players fit: checked at 375 × 812 and 1440 × 900, the list scrolls and nothing is cut off.                                                                                                                                                                                                                                                                                                                                              |
| Trade and robber panels with five opponents | Built             | Built in `six-seat-trade.css` and `six-seat-robber.css`. `data-partners` marks a trade row of four or five partners; on an upright phone it wraps two by two or three and two, and a wider panel keeps one row. A partner's offered cards no longer squeeze the portrait, and their counts use the panel's ink. At five or six seats the discard list wraps two to a line. The victim list needs nothing, as at most three players touch a tile. The Partner as a trade partner during the Lead's part is left for paired turns.                                                                                                                                                                           |
| Copy, history and labels                    | Built             | For Big Table: its quick rules section, log lines and history names for the new situations, the notice when it drops below five players ("Fewer than five players remain, so turns go one player at a time from now on, with no Partner."), and accessible names for the Lead and the Partner. For Open Sea: its quick-rules section, the ship among the costs, card text ("robber or pirate", "roads or ships"), prompts, move-history names and icons, and accessible names for sea, gold, ships and the pirate.                                                                                                                                                                                         |

### Checking a change

Every change to a screen or the board is checked before it merges:

- Screenshots before and after at 375 × 812, 812 × 375, 1366 × 768 and
  1440 × 900.
- The other controls on the screen measured with `getComputedStyle` and their
  boxes, and shown not to have moved. Four-player screens must not change at
  all.
- Both board themes.
- WebGL and the SVG fallback. To force the fallback, make
  `getContext('webgl2')` return null, the app's own path without WebGL 2.
- A change to the terrain art or the shader also re-runs the 18-screenshot
  Classic comparison.

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
3. **Outer Isles on phones.** Its number tokens draw at about 11 pixels on a
   390-pixel phone, too small to read without zooming. The owner picks the
   framing when the sea renderer is built; the options are under
   [Matching the existing look](#matching-the-existing-look).

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
