# Game modes: a plan for a bigger Catanova

A plan, not a commitment. It lists the official variations of the game Catanova
is modelled on, says which are worth building and in what order, and describes
how a mode fits the code. The engineering detail for bigger boards and the sea
is in [Bigger maps, and modes like Seafarers](BIGGER-MAPS-AND-MODES.md); this
document sits over it and covers the rest, most of all the knights expansion.

Rules are described in our own words, as in the [rulebook](RULEBOOK.md).
Official product names appear here only to say which published variation a mode
resembles; [Names](#names) covers what we call them in the game.

## The short version

Today Catanova plays the base game for two to four players, with a points target
from 8 to 15, natural or balanced dice, a turn clock and three bot levels.
Everything below adds to that without changing it: a room that picks nothing new
plays exactly as it does now.

Build in this order:

| Step | What players get                                                                  | Size   |
| ---- | --------------------------------------------------------------------------------- | ------ |
| 1    | A mode picker, and small variants: friendly robber, discard limit, harbour master | S      |
| 2    | The board becomes data (no visible change)                                        | M      |
| 3    | Big table: five and six players on a 30-hex island, then the between-turns build  | M + M  |
| 4    | Sea: sea tiles, ships, gold fields, the pirate, island bonuses                    | L      |
| 5    | Sea scenarios, starting with a main island and two small ones                     | M      |
| 6    | Knights: commodities, city upgrades, knights, barbarians, progress cards          | XL     |
| 7    | Combinations: sea with knights, and five–six players for each                     | M      |
| 8    | By appetite: fishermen, rivers, caravans, exploration, a map editor, teams        | Varies |

Sizes are for one developer working with AI help, counting tests, both screen
sizes and bots: **S** a few days, **M** one to two weeks, **L** two to four
weeks, **XL** one to two months. They are rough; the order matters more than the
numbers.

Sea comes before knights on purpose. Sea is mostly geometry on top of rules we
already have. Knights touch nearly every rule, add a second economy, and bring
54 cards that each do something different.

## The variations

Every official variation of the base game, what it adds, and what we think of
it.

### Base game (what we have)

Nineteen land hexes, three or four players (two in our own two-player option),
ten points. This is ruleset `base-3-4-v1`, with our balanced island and balanced
dice as the defaults.

### Five–six player extension

Thirty hexes in rows of 3-4-5-6-5-4-3, two deserts, more number tokens and
harbours, more pieces, and the same ten points. It adds one rule: between turns,
every other player may build, but not trade or play cards. It is the smallest
real expansion and the best one to start with. **M**, plus **M** for the
between-turns build.

### Seafarers

The board becomes islands in a sea.

- **Ships** (timber and wool) run along sea edges like roads. They are the only
  pieces that can move once placed.
- **Gold fields** pay a resource of the holder's choice.
- **A pirate** on the sea steals from ships and blocks them.
- **The longest road** becomes the longest trade route: roads and ships
  together.

It is played as scenarios, each with its own map and a target of 12 to 14
points, many with bonus points for settling a new island. There are nine
scenarios; four are worth building first. **L** for the core, **M** for the
first scenarios. The detail is in
[BIGGER-MAPS-AND-MODES.md](BIGGER-MAPS-AND-MODES.md).

### Cities & Knights

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

**XL**. The detail is in [Knights, in detail](#knights-in-detail).

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
own five–six player extension. If every mode is a feature switch rather than a
fork, a combination is mostly a board, a target and testing. **M** each, once
the parts exist.

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
its ruleset. `Game.ruleset` already exists as a string (`base-3-4-v1`); it
becomes a structured, versioned description:

```ts
type Ruleset = {
  id: string; // 'base-3-4-v1', 'big-5-6-v1', 'sea-v1', 'knights-v1', ...
  board: BoardPresetId; // from Phase 0 of the maps plan
  seats: { min: number; max: number };
  victoryPoints: number;
  sea?: { scenario: ScenarioId };
  knights?: true;
  variants: {
    friendlyRobber?: true;
    discardLimit?: number;
    harbourMaster?: true;
    betweenTurnsBuild?: true;
  };
};
```

A saved game keeps the ruleset it started with. `Game.schema` goes up once so
that an older game is read as the base ruleset. Nothing already in the database
changes meaning.

### Features, not forks

The rules engine stays one reducer (`applyAction` in
`packages/rules/src/game.ts`). Each expansion is a module that adds state,
phases and actions, and is consulted only when the ruleset turns it on:
`variants.ts`, `big-table.ts`, `sea.ts`, `knights.ts`. A base game never enters
their code. The check is strict: every journaled base game in the fixtures must
replay to the same states after each module lands.

Four things every expansion touches, so they get one home early:

- **Who is owed a move.** Today one player acts at a time, apart from discards.
  The between-turns build, gold choices, barbarian attacks and several progress
  cards all ask several players, or a player who is not active, for an answer.
  A small `pending` list of `{ player, question }`, answered in order or
  together, replaces one-off phases. The turn clock, the bot driver's `owedBy`
  and the client's "your move" state all read from it.
- **Scoring.** `score()` becomes a sum of named terms: buildings, cards,
  awards, island bonuses, metropolises, merchant, defender and harbour master.
  The results screen already shows a breakdown that must add up.
- **Supply and costs.** One table per ruleset instead of constants.
- **Dice.** The roll step returns everything rolled, including a third, event
  die, so the dice animation and the statistics stay one path.

### Server

- **Seats.** The four-seat guard in `Store.enter` and `Store.lobby` reads the
  ruleset's maximum.
- **Journal.** The compact journal stores states, and new fields travel with
  them. The admin's game analytics replays journals, so it learns each new
  action as it lands (ships, knights, commodities).
- **Clock.** Answers owed by several players share one shorter clock, the way
  discards work today. The between-turns build gets its own short window.
- **Rooms.** A rematch keeps the ruleset. Invitations and previews show the
  mode.

### Client

- **Room setup** gets a mode picker with a line of explanation per mode, and
  hides the settings a mode fixes (a scenario sets its own target).
- **Board.** Sea tiles, ships, the pirate, knights (three strengths, active or
  not), walls and metropolises. The renderer changes are in the maps plan.
- **Hand dock and build shelf.** New cards (commodities, progress cards) and
  new builds (ship, knight, wall, city upgrade), laid out for phones first.
- **Rail.** Six players on a phone is a 3 × 2 grid. Knights add a strength
  count to each card, beside the road and knights plate already there.
- **Guide.** A section per mode, written like the rest of the guide.

### Bots

Bots list the legal moves in code and let the decision model rank them
(`packages/bot/src`: heuristics, plan, decide and the Jev client). Every mode
needs new move lists and new questions: where a ship goes and when to move one,
which city to upgrade, when to build or activate a knight, which progress card
to play. Until then bots play a new mode badly. So a mode launches with bots
marked as learning, or with bots off, and gets its own bot milestone. The model
never invents a move, so a new mode can make bots weak but never lets them
cheat.

### Admin and analytics

Stats and Growth gain a mode filter, the dice statistics include the event die,
and the retention report counts by mode. This is cheap if it is done as each
mode lands.

### Tests

For each mode:

- rule tests for every new action;
- resource and piece conservation, as the base game already has;
- full bot games across many seeds, as the base game has;
- screenshots at phone, landscape phone and desktop sizes for every new panel.

## The roadmap

### Step 1: mode picker and small variants (S)

**Ships:**

- a mode field in room settings;
- friendly robber, discard limit and harbour master as switches;
- a quick-game preset (8 points, 60-second clock).

**Done when** a room can pick them, bots respect them, the guide explains them,
and a base room is unchanged.

It is small on purpose. It proves the ruleset path end to end (room setup, the
frozen ruleset, rules, bots, journal, admin) before anything big depends on it.

### Step 2: the board becomes data (M)

Phase 0 of the maps plan: board presets, shapes as data, a coastal test that
survives sea tiles, a world box worked out from the board, and more than one
coastline. Nothing visible changes. **Done when** every seed still produces the
island it produced before.

### Step 3: big table (M, then M)

First the 30-hex board and six seats without the between-turns build, which
keeps the first PR clean. Then the build window, with its own clock, bot
support and stand-in support. **Done when** six people can finish a game on
phones without the rail or the dock overflowing.

### Step 4: sea core (L)

In the order the maps plan gives:

1. sea tiles and their rendering, with no new rules (a sea frame that plays
   like the base game);
2. ships and the trade route award;
3. gold fields;
4. the pirate;
5. island bonuses.

Each part ships behind the scenario that needs it.

### Step 5: sea scenarios (M)

Scenarios become data. The first is a main island with two small ones. Then
four islands, through the desert, and the fog islands, which bring hidden board
state, the one new mechanic.

### Step 6: knights (XL, in four parts)

See [Knights, in detail](#knights-in-detail).

### Step 7: combinations (M)

Sea with knights, and five–six players for sea and for knights.

### Step 8: by appetite

- Fishermen, rivers and caravans (**M** each)
- Exploration and pirates (**XL**)
- A map editor (**L**)
- Teams (**M**)

## Knights, in detail

### The rules, in our own words

- **Target.** 13 points. There are no development cards and no largest army.
- **Commodities.** A city on forest makes one timber and one paper; on pasture,
  one wool and one cloth; on mountain, one ore and one coin. Cities on hills and
  fields still make two of their resource. Commodities are cards in your hand:
  they count toward discards, and they can be traded and stolen.
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
  - Building one costs wool and ore and gives strength 1. Promoting it costs
    wool and ore again for strength 2, and strength 3 needs the politics
    ability.
  - A knight does nothing until it is activated for one grain. An active knight
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
- **City walls.** A wall costs two brick and raises your hand limit by two, up
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
mechanics are not, which is why the rulebook describes them in our own words.
So modes get their own names in the game. The guide may say which published
expansion a mode resembles, in the same way the homepage calls Catanova a Catan
alternative. Suggestions, to be chosen:

| Resembles            | Possible names                           |
| -------------------- | ---------------------------------------- |
| 5–6 player extension | Big Table, Six Seats                     |
| Seafarers            | Open Sea, Archipelago                    |
| Cities & Knights     | Raiders, Keeps & Knights, Barbarian Tide |
| Friendly robber      | Gentle Robber                            |
| Harbour master       | Harbour Master (a generic phrase)        |

Artwork, card text and rule wording stay ours, as they are today.

## Decisions for the owner

1. **Names** for each mode.
2. **Step 1 first.** It is small and not glamorous, and it is what makes every
   later mode cheap.
3. **Bots in new modes.** Launch them marked as learning, or keep bots off
   until their milestone.
4. **Sea before knights.** Recommended: sea reuses our rules and is mostly
   geometry; knights touch every rule.
5. **Phones.** Six players and knights both need phone layouts designed before
   they are built.

## Sources

- [Catan: Cities & Knights (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Cities_%26_Knights)
- [Cities & Knights rules (Colonist)](https://colonist.io/catan-rules/cities-and-knights)
- [Catan: Traders & Barbarians (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Traders_%26_Barbarians)
- [Catan: Explorers & Pirates (Wikipedia)](https://en.wikipedia.org/wiki/Catan:_Explorers_%26_Pirates)
- Seafarers and the five–six player extension: the sources in
  [BIGGER-MAPS-AND-MODES.md](BIGGER-MAPS-AND-MODES.md#sources).
