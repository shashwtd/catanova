# Catanova Big Table rulebook

Ruleset: `big-table-v1` · Written 25 September 2026

Big Table, for five and six players, is Catanova's mode for larger groups. It aims to reproduce the mechanics of the official 5–6 player expansion to the base game. Catanova is an independently developed browser game, and this is an independently written explanation, with original organization and examples. It is not an official CATAN publication. The reference edition is the English 2025 rulebook of the official 5–6 player expansion (CN3082), played with the English 2025 base game. See [sources and compatibility decisions](RULE_SOURCES.md); Big Table rows are in its [Big Table and Open Sea](RULE_SOURCES.md#big-table-and-open-sea) part, keyed to the section numbers in this book.

This book is a companion to the [Classic rulebook](RULEBOOK.md) (ruleset `base-3-4-v1`). Everything in the Classic rulebook applies unless this book changes it, and this book says exactly what changes. Where the official texts leave a gap, or where Catanova departs from them, the rule is marked as a Catanova decision. Section 11 lists the points that the official texts and the first decisions left open, and says where each is now settled.

This is the rules target for the mode. Since 26 September 2026 the engine implements it as ruleset `big-table-v1`, which is not yet open to players; the tests that check each rule name the section they check.

## 1. Scope

### 1.1 Players

A Big Table game has exactly five or six players, all invited people. There is no Big Table game for two, three or four players, and no seventh or eighth seat. Bots cannot take a seat, and no stand-in bot covers an absent player (section 9).

### 1.2 Choosing the mode

The host picks the mode in Room setup. The modes are Classic (`base-3-4-v1`), Big Table (`big-table-v1`) and Open Sea (`open-sea-v1`). In the app, the name Big Table always appears with its short description, "for five and six players".

Catanova decision: in the lobby, a change of mode is refused only while more players are seated than the new mode allows, or while bots are seated and the new mode allows none. Fewer players is fine: the room's seat limit becomes the new mode's maximum, and the minimum is checked only when the game starts. A Classic room, which holds at most four, can therefore switch to Big Table and then wait for its fifth and sixth players. Each mode has its own island, so changing the mode also deals a new island. Catanova decision: a change of mode resets the points target to the new mode's default, even if the host had chosen another: 10 for Classic and Big Table, 14 for Open Sea. The game can start only with five or six seated players, and, as in Classic, only when every other player is ready and every seat is connected. When the game starts, its ruleset is frozen into it. A saved game keeps its ruleset for good.

### 1.3 What changes from Classic

| Topic              | Classic                                  | Big Table                                          | Section  |
| ------------------ | ---------------------------------------- | -------------------------------------------------- | -------- |
| Players            | 2–4                                      | 5 or 6                                             | 1.1      |
| Island             | 19 land hexes in rows of 3-4-5-4-3       | 30 land hexes in rows of 3-4-5-6-5-4-3             | 3        |
| Resource bank      | 19 of each resource                      | 24 of each resource                                | 2        |
| Development deck   | 25 cards                                 | 34 cards                                           | 2        |
| Harbours           | 9                                        | 11                                                 | 3.3      |
| Turn structure     | One player at a time                     | Paired turns (default) or Between-turns build      | 5–7      |
| When you can win   | Only during your own turn                | Depends on the turn structure                      | 6.7, 7.5 |
| Bots and stand-ins | Allowed                                  | None                                               | 9        |
| An absent player   | A stand-in bot takes the seat after 30 s | The clock makes only forced moves, after 2 minutes | 9.4      |

Everything else is Classic: costs, placement, production, the bank shortage rule, sevens and discards, the robber, trading, development-card effects, the awards and what players may see (section 8).

## 2. Supply and components

Big Table uses Catanova's resource names: Timber, Clay, Sheep, Hay and Rock. Their storage ids stay `wood`, `brick`, `sheep`, `wheat` and `ore`.

| Item                    | Classic                                                                        | Big Table                                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Resource cards          | 19 of each resource, 95 in total                                               | 24 of each resource, 120 in total                                              |
| Development cards       | 25: 14 Knights, 2 Road Building, 2 Year of Plenty, 2 Monopoly, 5 Victory Point | 34: 20 Knights, 3 Road Building, 3 Year of Plenty, 3 Monopoly, 5 Victory Point |
| Pieces for each player  | 15 roads, 5 settlements, 4 cities                                              | Unchanged                                                                      |
| Land hexes              | 19                                                                             | 30 (section 3.2)                                                               |
| Number tokens           | 18                                                                             | 28 (section 3.2)                                                               |
| Harbours                | 9                                                                              | 11 (section 3.3)                                                               |
| Dice, robber and awards | Two six-sided dice, one robber, Longest Road, Largest Army                     | Unchanged. There is still one robber, although the island has two deserts.     |

The bank shortage rule of Classic section 5 still works resource by resource, now with 24 cards of each. A player can therefore hold more than 19 cards of one resource. The development deck is never refilled; once it is empty, nobody can buy a development card.

The awards keep their Classic names and rules: Longest Road for a continuous route of at least five roads, and Largest Army for at least three played Knights, each worth 2 points. Catanova decision: the 2025 edition calls the first award Longest Route, but Big Table has only roads, so Catanova keeps the Classic name here. Open Sea, where ships count too, calls it Longest Route.

## 3. The island

### 3.1 Shape

Thirty land hexes form seven rows of 3, 4, 5, 6, 5, 4 and 3 hexes, surrounded by sea. The middle row is the longest. It has an even number of hexes, so the centre of the island falls between two hexes rather than on one.

The outline is a stretched hexagon. Its top and bottom sides each run along 3 hexes, and each of its four slanted sides runs along 4. Six hexes sit at its corners: both ends of the top row, of the middle row and of the bottom row.

Hex, edge and intersection mean what they mean in Classic section 2. Coastal edges and coastal intersections are legal building sites, as in Classic.

### 3.2 Terrain, numbers and counts

| Terrain   | Produces | Hexes |
| --------- | -------- | ----: |
| Forest    | Timber   |     6 |
| Pasture   | Sheep    |     6 |
| Fields    | Hay      |     6 |
| Hills     | Clay     |     5 |
| Mountains | Rock     |     5 |
| Desert    | Nothing  |     2 |
| Total     |          |    30 |

That leaves 28 producing hexes, and each gets one of 28 number tokens: two each of 2 and 12, and three each of 3, 4, 5, 6, 8, 9, 10 and 11. Deserts get no token. Six tokens are red numbers (three 6s and three 8s). Counting, for each token, how many of the 36 dice combinations roll its number, the tokens carry 88 pips in all, against 58 in Classic.

The graph of the island follows from its shape:

| Count                                          | Classic      | Big Table    |
| ---------------------------------------------- | ------------ | ------------ |
| Land hexes                                     | 19           | 30           |
| Intersections                                  | 54           | 80           |
| Intersections touching one, two or three hexes | 18 / 12 / 24 | 22 / 16 / 42 |
| Edges (road sites)                             | 72           | 109          |
| Coastal edges                                  | 30           | 38           |
| Inland edges                                   | 42           | 71           |
| Coastal intersections                          | 30           | 38           |
| Sea spaces bordering the coast                 | 18           | 22           |

A coastal edge is an edge of exactly one land hex. A coastal intersection touches one or two land hexes and lies on two coastal edges.

### 3.3 Harbours

There are 11 harbours: five general 3:1 harbours, two Sheep 2:1 harbours, and one 2:1 harbour each for Timber, Clay, Hay and Rock. The Classic rulebook calls them ports. They work exactly as Classic section 7.2 describes. Each harbour sits on one coastal edge, and a settlement or city on either of that edge's two intersections may use it.

Catanova decision: harbours are placed by Catanova's generator, not by the official shuffled frame. They go on 11 of the 38 coastal edges, with their types shuffled. No two harbours share an intersection or sit on neighbouring intersections, so at least two empty coastal edges separate any two harbours. The exact placement rules are in [map generation](MAP_GENERATION.md). By our count, a uniformly shuffled official frame puts two harbours on one intersection in about 80% of games; the spacing rule avoids that.

## 4. Setting up

### 4.1 Room setup

Before the game starts, the host chooses:

1. The mode: Big Table.
2. The turn structure: Paired turns (the default) or Between-turns build (section 5).
3. The points target: 10 by default. The target slider works as in Classic. Changing the mode resets it to the new mode's default (section 1.2).
4. The dice mode, as in Classic.
5. The turn timer, as in Classic (section 9.2).

These settings follow the Classic lobby rules in the [turn clock](TURN_CLOCK.md) document: only the host changes them, each change resets the other players' readiness, and all of them lock when the game starts.

### 4.2 The board

Catanova decision: every Big Table game uses the preset `big-table-balanced-v1`, Catanova's balanced generator adapted to the 30-hex island. It is the default and the only board in `big-table-v1`. It is labelled as Catanova's own preset, not as the official setup. Its rules and tests are in [map generation](MAP_GENERATION.md#big-table-islands). Catanova decision: it keeps Classic's cap of 11 production pips on any intersection, and the cap is not raised. The preset ships only when a tuned search keeps every board under the 100 ms limit over 20,000 seeds, or, if it cannot, when boards are generated off the server's main thread, in a worker, with a longer limit written down in [map generation](MAP_GENERATION.md#measurements-so-far). As in Classic, the map seed is public and never decides dice, steals or the development deck.

Catanova decision: the robber starts on one of the two deserts, chosen at random from the map seed, so the same seed always gives the same start. The official texts do not settle which desert or who chooses. Later the robber may move to any different land hex, including the other desert.

Catanova decision: there is no fixed first-game layout. The official expansion has one, with a special rule that leaves one colour's settlements on the board in a five-player game. Neither is part of `big-table-v1`.

For reference only: in the official variable setup, the sea frame is shuffled, the 30 terrain hexes go down at random, and 28 lettered number tokens are laid counterclockwise from a corner hex, spiralling inward ring by ring (16 hexes, then 10, then 4) and skipping both deserts. Catanova does not use this procedure in `big-table-v1`. Catanova decision: `big-table-v1` offers no spiral preset. One is recorded only as a possible later option. It would first need the value on each letter settled, because no 2025 source prints it.

### 4.3 Starting player

As in Classic section 3.2, each player rolls both dice and the highest total starts. If several players tie for highest, only they roll again. The official texts do not cover a tie; the re-roll is Catanova's convention, carried over from Classic. The roll produces nothing and does not move the robber. Play then proceeds clockwise.

### 4.4 Setup draft

The draft is Classic section 3.3 with more players. The first pass runs clockwise from the starting player; the second runs back.

- Five players: 1, 2, 3, 4, 5, 5, 4, 3, 2, 1.
- Six players: 1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1.

Everything else is Classic: the distance rule for both settlements, a road touching the settlement just placed, resources from the second settlement only, no cost, and no trading or development cards. Setup is untimed. Section 9.4 says how the clock places for a player who has been absent for 2 minutes.

Under Paired turns, the Lead and Partner markers play no part in setup. The first paired turn begins after setup, with the starting player as Lead (section 6.1). Under Between-turns build, the starting player takes an ordinary first turn, and no build window comes before it (section 7.2).

## 5. Two turn structures

The host chooses one of two turn structures in Room setup. It is saved with the game and cannot change once the game starts.

1. Paired turns, the default. This is the current official rule. Since 2021 the official 5–6 rules have paired two players in every turn, replacing the older build phase. See section 6.
2. Between-turns build, the older official rule, offered as a labelled option: Room setup marks it as the older rule. Players take ordinary turns, and after each turn every other player gets a short window to build. See section 7.

Both use the same island, supply, setup and Classic rules. They differ only in who may act when, and in when a player can win.

## 6. Paired turns

### 6.1 Lead and Partner

Every paired turn has two roles, each shown by a marker. The official rulebook calls them player 1 and player 2; Catanova calls them Lead and Partner.

- The **Lead** is the player on turn. The Lead marker starts with the starting player.
- The **Partner** is the third player to the Lead's left. Catanova decision: count only players still in the game, skipping any who have resigned. With five players, the Partner sits two seats to the Lead's right. With six, the Partner sits directly opposite.

Each paired turn runs through the same three phases:

1. The Lead's production phase.
2. The Lead's action phase.
3. The Partner's phase: one action phase for the Partner.

Phases 1 and 2 are the Lead's part. The Lead must finish their whole part before the Partner's phase begins.

Over one round in which nobody resigns, every player is Lead once and Partner once, and never both in the same paired turn. With six players, a player is Partner three turns after being Lead, and Lead again three turns after that. With five players, a player is Partner two turns after being Lead, and Lead again three turns after that.

### 6.2 The Lead's part

The Lead plays exactly a normal Classic turn (Classic section 4):

1. Optionally play one eligible development card before rolling.
2. Roll both dice once, unless the Lead has already won (section 6.7). Resolve production, or the whole seven sequence (section 6.5).
3. In any order: trade with any willing player, the Partner included; trade with the bank and at their own harbours; build; buy development cards; and play one eligible development card if they did not play one before rolling.
4. End the part.

If nobody has won, the Partner's phase begins. Trade offers still open when the Lead ends their part expire, as when a Classic turn ends.

### 6.3 The Partner's phase

The Partner never rolls and has no production phase. In their phase, in any order and as often as they can afford, the Partner may:

- trade with the bank: four matching resources for one, or 3:1 or 2:1 at a harbour where they have a settlement or city;
- build roads, settlements and cities, following every Classic placement rule;
- buy development cards;
- play one eligible development card of any type: Knight, Road Building, Year of Plenty or Monopoly;
- reveal Victory Point cards to win, including cards bought in this phase.

The Partner may not trade with any player, the Lead included. Every action is optional, and the Partner may end the phase at once.

The Partner plays development cards only in their own phase. They cannot play one before the Lead's roll, or at any other time during the Lead's part.

If the game is still going after the Partner's phase, the next paired turn starts. The Lead marker passes to the next remaining player on the old Lead's left. The Partner marker does not pass on its own: the new Partner is recounted as the third remaining player to the new Lead's left (section 6.1). While nobody resigns, both markers simply move one seat to the left. After a resignation, a player may be Partner twice in that round, or not at all.

### 6.4 Everyone else during a paired turn

During the Lead's part, the Partner is an ordinary non-active player. They collect production, discard on a seven, can be robbed, and may trade with the Lead during the Lead's action phase. They cannot build, trade with the bank or at harbours, or play a card until their own phase.

Players holding neither marker are non-active for the whole paired turn, as in Classic. They collect production, discard on a seven, can be robbed, give up cards to a Monopoly, and may trade with the Lead during the Lead's action phase. They never trade with each other or with the Partner, and never build or play cards.

During the Partner's phase, no trade between players happens at all. The Lead is then a non-active player too. The Partner's Knight may rob the Lead, and the Partner's Monopoly takes from the Lead as from everyone else. A Monopoly played by either marker holder takes the named resource from every other player, the other marker holder included.

### 6.5 Sevens, discards, the robber and Knights

- Only the Lead rolls, so a seven can come only in the Lead's production phase. It is resolved exactly as in Classic section 6. Everyone with more than seven resource cards discards half, rounded down, the Partner included. Then the Lead moves the robber to a different land hex and robs one player with a building there. The Partner is a legal victim.
- The Partner's phase has no roll, so it never causes discards.
- A Knight played by the Partner works exactly as a Classic Knight. The Partner moves the robber to a different land hex and takes one random resource from one player with a building there; the Lead is a legal victim. Nobody discards. The Knight counts toward the Partner's Largest Army.
- The robber can therefore move up to three times in one paired turn: for a rolled seven, for the Lead's Knight and for the Partner's Knight.
- There is one robber for the whole island. It may be moved to either desert.

### 6.6 Development cards across the roles

The limits of Classic section 9 apply to each part separately. Here a part means either the Lead's part (phases 1 and 2) or the Partner's phase.

- The Lead may play at most one development card other than Victory Point cards in their part, before or after rolling. The Partner may play at most one in their phase. Both may play one in the same paired turn.
- A card cannot be played in the part in which it was bought.
- A card bought as Lead may be played as Partner in a later part, and a card bought as Partner may be played as Lead in a later part. Nobody holds both markers in one paired turn, so a card bought in one part is always playable in the player's next part.
- Victory Point cards revealed to win are exempt from both limits, as in Classic.

### 6.7 Winning

The target is 10 points unless the host set another on the slider. Hidden Victory Point cards count toward a player's total, as in Classic.

The official rules settle two cases. A Lead who reaches the target during their part wins at once, and the game ends before the Partner's phase. A Partner who reaches the target during their phase wins at once. The official texts leave the other cases open. Catanova decision: the following rules cover every case. They keep both official cases, with one exception: when a single action in the Partner's phase brings both marker holders to the target, the Lead wins (case 5).

1. Both the Lead and the Partner are on turn for the whole paired turn, from the moment the markers reach them until the Partner's phase ends.
2. After every action, check both marker holders. If exactly one of them has at least the target, that player wins at once. If both do, the Lead wins. A resignation counts as an action here: when one moves Longest Road or Largest Army, the check is made straight away.
3. The same check is made when a paired turn begins, before the Lead's first action. A marker holder who already has the target then wins at once, without rolling or acting, as a Classic player who begins their turn at the target does. No separate check is made when the Partner's phase begins, because rule 2 has already checked both marker holders after the Lead's last action.
4. A player holding neither marker cannot win during that paired turn, even when someone else's action puts them at the target. They win when the next paired turn in which they hold the Lead or Partner marker begins (rule 3), if they still have the target then. If they have dropped below it by then, they do not win. Because a marker holder is on turn from the moment the marker reaches them (rule 1), this is also true of a new Partner: they win before the Lead rolls, not when the Partner's phase begins.

The cases this settles:

1. The Lead reaches the target during their own part. The Lead wins at once, and there is no Partner's phase. (Official.)
2. The Partner reaches the target during their own phase. The Partner wins at once, unless the same action also brings the Lead to the target (case 5). (Official, with that exception.)
3. The Partner reaches the target during the Lead's part without acting. For example, the Lead's new settlement splits a third player's road, and the Partner is left alone with the longest road. The Partner wins at once, unless the Lead also has the target, in which case the Lead wins. (Catanova.)
4. The Lead reaches the target during the Partner's phase without acting. For example, the Partner's new settlement splits a third player's road, and the Lead is left alone with the longest road. The Lead wins at once. (Catanova.)
5. One action puts both marker holders at the target. The Lead wins. (Catanova. The 2021 paired-turn rule, the English 2022 text and the German 2022 and 2025 editions also give player 1 a same-turn tie; the English 2025 text prints no tie clause. When the action comes in the Partner's phase, this departs from the reference edition, whose text gives the win to a Partner who reaches the target in their phase. Catanova applies the tie clause there too.)
6. A player holding neither marker reaches the target. They do not win now. They win when the next paired turn in which they hold the Lead or Partner marker begins, if they still have the target then (rule 4). (Catanova.)
7. A marker holder already has the target when the paired turn begins. They win at once, without rolling or acting. If both marker holders do, the Lead wins. (Catanova.)

### 6.8 Fewer than five players

The paired turn is defined only for five and six players. Catanova decision: when resignations leave fewer than five players in the game, the Partner's phase stops. From then on, turns continue one player at a time in the same clockwise order, each an ordinary Classic turn with no Partner. The island, the supply and the deck stay those of Big Table. Catanova decision: "stops" means that no Partner's phase begins while fewer than five players remain, but one already under way finishes (section 9.6).

Once turns are single, only the player on turn acts, so a player wins only during their own turn, as in Classic section 1. While five or six players remain, the Partner is recounted over the players still in the game, so a resigned player is never Lead or Partner.

Catanova decision, made on 26 September 2026 while building the mode: when the count drops below five during the Lead's part, no Partner's phase begins, but the paired turn keeps its markers until the Lead's part ends. The Partner, if still in the game, stays on turn until then and can still win in it (section 6.7, rule 1). Single turns begin with the next turn.

## 7. Between-turns build

This is the older official rule, offered as a labelled option. Since 2021 the official rules have used paired turns instead, first printed in the base game's 5–6 rulebooks in their 2022 revisions. The 2025 edition has no build phase.

### 7.1 Turns

Each turn is an ordinary Classic turn for one player: an optional development card before the roll, the roll, production or the seven sequence, then trading with any willing player and with the bank, building, buying and one development card. Only the player on turn acts during it, as in Classic.

### 7.2 Build windows

After each turn, before the next turn begins, every other player gets one build window. The windows run one at a time in clockwise order. The first goes to the player to the left of the one who just finished, who is also the next to take a turn. The last goes to the player on the finished player's right. The player who just finished gets no window.

Windows follow every turn, whether or not anyone built during it. No window follows setup. Resigned players are skipped. Catanova decision: once Between-turns build is chosen, windows continue at any player count, even after resignations leave fewer than five players (section 9.6).

In their window, a player may, using only the resource cards already in their hand:

- build roads, settlements and cities, following every Classic placement rule;
- buy development cards.

In a window, a player may not:

- trade with any player;
- trade with the bank, whether four for one or at a harbour;
- play any development card, Road Building included;
- win (section 7.5).

Every window is optional; a player may end theirs at once. Catanova decision: the game never skips a window on its own, even for a player who cannot afford anything, because skipping would tell the table something about a hidden hand. When the last window ends, the next player begins their turn.

### 7.3 Sevens, the robber and Knights

These are exactly as in Classic. A seven or a Knight can happen only during a turn, never in a window, so the robber never moves during a window.

### 7.4 Development cards

A card bought in a window was not bought during anyone's turn. Its buyer may play it from their next turn onward. That includes the turn that follows straight after the window, when the buyer is the next player. No card is ever played in a window, and the Classic limit of one card per turn applies to turns.

### 7.5 Winning

As in Classic section 1, a player wins only during their own turn. A player who reaches the target in a window, whether by their own build or because an award moves to them, does not win then. They win at the start of their next turn, before rolling, if they still have the target. Awards change hands during a window whenever the Classic award rules say so.

## 8. What stays Classic

Unless a section above says otherwise, these rules are exactly those of the [Classic rulebook](RULEBOOK.md):

1. Building costs, placement rules, the distance rule and piece limits (Classic section 8).
2. Production, with the bank shortage rule checked resource by resource (section 5), now with 24 cards of each.
3. The seven: anyone with more than seven resource cards discards half, rounded down; the robber moves to a different land hex; one random resource is stolen (section 6).
4. Trading (section 7). Only the player on turn trades with other players, and non-active players never trade with each other. Under Paired turns that player is the Lead, during the Lead's action phase.
5. Development-card effects (section 9), including the provisional rare-card decisions in the [playtest notes](PLAYTEST.md).
6. Longest Road (section 10) and Largest Army (section 11).
7. Information at the table (section 12). In Big Table, who holds the Lead and Partner markers and whose window is running are also public.

## 9. Online rules

### 9.1 Room options and bots

The target slider, the dice mode and the turn timer work as in Classic. Catanova decision: bots are allowed only in Classic for now. Big Table allows no bots at all, and no stand-in bots.

### 9.2 Clocks

The game server owns every deadline, as the [turn clock](TURN_CLOCK.md) document describes.

| What the game is waiting for | Clock                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A turn, or the Lead's part   | The room's turn timer, as in Classic: off, or 40, 65, 90, 115 or 140 seconds.                                                                                                                                                                                                    |
| A discard after a seven      | As in Classic: each player who must discard gets the full room time, and the clock of the player on turn pauses.                                                                                                                                                                 |
| The Partner's phase          | Its own clock: half the room's turn time, rounded up to a whole second, and at least 30 seconds. In a room without a timer, 45 seconds, started only when the Partner is absent during the phase, and then running to the end of the phase even if they reconnect (section 9.4). |
| A build window               | 20 seconds, in every room, whether or not it has a turn timer.                                                                                                                                                                                                                   |

Catanova decision: half-second clocks round up, so half of 65 seconds gives 33 and half of 115 gives 58. At each timer stop, the Partner's phase lasts:

| Room turn timer | 40 s | 65 s | 90 s | 115 s | 140 s | Off                                                                                                                 |
| --------------- | ---- | ---- | ---- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Partner's phase | 30 s | 33 s | 45 s | 58 s  | 70 s  | No clock unless the Partner is absent during the phase; then 45 s, which keeps running if they return (section 9.4) |

Catanova decision: the 20-second build-window clock is always on. It runs in a room without a turn timer too, so a window never holds up the table.

Only the acting player's clock is shown prominently: the Lead's during the Lead's part, the Partner's during the Partner's phase, and the current builder's during a build window. On a seven, each discarding player sees their own. Setup stays untimed; section 9.4 covers a player absent during setup.

### 9.3 When a clock runs out

- A turn, or the Lead's part: the Classic defaults apply. The server rolls if the player has not rolled, moves a pending robber to a random different hex and picks a legal victim, places any free roads still owed from a Road Building card already played on random legal sites, then ends the turn or part and withdraws any open trade offer. Under Paired turns, the Partner's phase then begins.
- The Partner's phase: the phase simply ends and the next paired turn begins (Catanova decision). Nothing is bought, built or traded, and no card is played. Catanova decision on card effects left unfinished: free roads still owed from a Road Building card played in the phase stay unplaced, unlike at the end of a Classic turn. If the Partner has already played a Knight and not yet moved the robber, the server completes that move as in Classic, because a played Knight must move the robber. Only the clock leaves free roads unplaced: a Partner who is still at the table places them before ending the phase, as a Classic player must.
- A build window: the window ends, and the next window or turn begins. Nothing is built or bought.
- A discard: as in Classic, the server discards the required number of cards at random from the player's hand.

The clock never buys a piece, spends resources on an optional action, accepts a trade, plays a development card the player did not choose, or resigns anyone.

### 9.4 Disconnected players

Catanova decision, shared with Open Sea:

1. A disconnected player is shown as disconnected, and the game waits for them. No bot takes the seat.
2. For the first 2 minutes of their absence, nothing is played for them, except what an ordinary clock does if it runs out in that time: the room's turn timer and a discard's clock, when the room has a timer, and the Partner's-phase clock or a build window's clock.
3. Once they have been offline for 2 minutes, the clock acts for them whenever the game waits on them, exactly as if their time had run out (section 9.3). That covers their setup placements (below), their turns and their Lead's part, their Partner's phase, their build windows and any discard they owe. This applies whether or not the room has a turn timer.
4. This continues until they reconnect. Reconnecting gives them the seat back at once. It does not reset a clock that is already running.

Catanova decision, shared with Open Sea: setup stays untimed, but a setup placement is compulsory, so it counts as a forced move. Once a player has been offline for 2 minutes, whenever the draft waits on them, the clock places for them. First it places a settlement on the legal intersection with the most production pips, counting the pips of the number tokens on the hexes it touches. The server breaks ties at random. Then it places a road on a random legal edge touching that settlement. If the player placed the settlement before the 2 minutes ran out, the clock places only the road.

Catanova decision: in a room without a turn timer, the Partner's phase has a 45-second clock only for an absent Partner. The 45-second clock starts when the Partner's phase begins, if the Partner is disconnected then, or when the Partner disconnects during the phase. Once started, it runs until the phase ends, even if they reconnect, and it never restarts within the phase. The phase ends at whichever comes first: the 45 seconds, or the Partner's 2 minutes offline. An absent player's own turn in such a room has no clock; only the 2-minute rule ends it.

What differs from Classic, where a stand-in bot covers an absent player (see [bots](BOTS.md)):

| Moment                | Classic                                                                                                                  | Big Table                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First 30 seconds away | The seat is shown as disconnected. The game waits; the room timer, if any, runs as usual.                                | The same.                                                                                                                                                                                 |
| From 30 seconds       | A stand-in bot takes the seat and plays it fully: it trades with the bank and at harbours, builds, buys and plays cards. | No bot. The seat stays shown as disconnected, and the game keeps waiting.                                                                                                                 |
| From 2 minutes        | The stand-in carries on.                                                                                                 | Whenever the game waits on this player, the clock makes only the forced moves of section 9.3, and their setup placements. It never buys, trades, plays a card or makes an optional build. |
| The player returns    | The seat is handed back at once.                                                                                         | The clock stops acting for them at once.                                                                                                                                                  |

### 9.5 Resignation, pausing and abandonment

Everything else about reconnect grace, resignation and pausing follows the [turn clock](TURN_CLOCK.md) document, as the server applies it in Classic today. Its [modes without bots](TURN_CLOCK.md#modes-without-bots) section describes these rules and Big Table's 2-minute rule.

1. Leaving, or being removed by the host, resigns a player at once and for good.
2. An absent player is not resigned while any other remaining player is connected. In Classic a stand-in covers them; in Big Table the clock does (section 9.4).
3. When every remaining player is offline, automatic play pauses, including the clock's moves for absent players. Each absent player's deadline becomes at least three minutes from the moment the table emptied, then runs continuously. Once every remaining player's deadline has passed, the game closes as Abandoned, with no winner. If someone returns within their grace, the current clocks restart with their full duration.
4. A resigned player's pieces stay on the island and keep occupying their sites. Their resource cards return to the bank, their unplayed development cards are retired, their buildings stop producing, and they no longer qualify for either award. Future turns, build windows and setup slots skip them.
5. Under Paired turns, a resigned player no longer counts when finding the Partner (section 6.1). If fewer than five players remain, the Partner's phase stops (section 6.8).

### 9.6 Resignation in the middle of a turn

The first decisions and the turn clock document do not say what happens when a player resigns part-way through a turn. Catanova decision:

1. The Lead resigns during their part. Their part ends there. If five or more players remain, the Partner's phase follows as usual. If not, the next turn is a single turn (section 6.8).
2. The Partner resigns before their phase begins. That paired turn has no Partner's phase, and nobody is recounted to take it. The next paired turn finds its Partner afresh (section 6.3).
3. The Partner resigns during their phase. The phase ends, and the next turn begins.
4. Another player resigns during a Partner's phase and fewer than five remain. The phase under way finishes. Single turns begin with the next turn.
5. A robber move owed by a resigned player is made by the next player to act, reading "the next remaining player" in the turn clock document's Classic rule that way. When the Lead resigns and a Partner's phase follows, that is the Partner, at the start of their phase. In every other case it is the next Lead, or the next player on turn, before they roll.
6. As in Classic, discards owed by a resigned player disappear with their hand, and free roads still owed from their Road Building card are abandoned.
7. Under Between-turns build, windows continue at any player count: after each turn, every other remaining player still gets one. A turn ended by a resignation is followed by windows as usual. A player who resigns during their window loses it, and the next window begins. Catanova decision, made on 26 September 2026 while building the mode: a robber move left owing by the player whose turn ended is made after the windows, by the next player on turn before they roll (rule 5), since the robber never moves in a window (section 7.3).
8. As in Classic, a resignation declares no absent player the winner, even one it leaves at the target: as the turn clock document has it, absence never awards a win. Catanova decision, made on 26 September 2026 after review: such a player still wins in their own part of the turn, at the next move made in it, their own or the clock's. That is the roll, for a paired turn or a turn that began inside the resignation, or the end of their turn or Partner's phase, before the markers move on. The same holds in Classic.

## 10. What is not included

`big-table-v1` does not include:

- games for two, three or four players, or for seven or more;
- bots or stand-in bots;
- the official fixed first-game layout, its five-player rule for an unused colour, or any fixed layout of Catanova's own;
- the official lettered spiral or the official shuffled frame as a selectable board;
- the first-edition form of the build phase, where only players who ask to build take part (Between-turns build gives every other player a window);
- sea, ships or gold fields. Open Sea is a separate ruleset, and Open Sea for five and six players is planned for later;
- a knights mode, which is parked;
- any variant not in Classic, such as a friendly robber or a changed discard limit.

## 11. Completeness and open questions

This book covers the complete Big Table flow on top of the Classic rulebook: supply, island, setup, both turn structures, winning in each, and the online rules. It is a rules target, not a certified engine.

The points below were not settled by the official sources or by the first decisions. Each is now closed by a Catanova decision, made on 26 September 2026 under the owner's delegation, and each says which section now states the rule. They keep their numbers so that the numbering in the [ledger](RULE_SOURCES.md) still matches.

1. The balanced board's pip cap. Closed. Catanova decision: `big-table-balanced-v1` keeps the cap of 11 production pips per intersection, and the cap is not raised. The preset ships only when a tuned search keeps every board under the 100 ms limit over 20,000 seeds. If it cannot, boards are generated off the server's main thread, in a worker, with a longer limit written down in [map generation](MAP_GENERATION.md#measurements-so-far) (section 4.2).
2. An official-style spiral preset. Closed. Catanova decision: `big-table-v1` offers none. One is recorded only as a possible later option. It would first need the value on each lettered token settled, because no 2025 source prints it, and where each inner ring of the spiral starts is derived from figures rather than printed (section 4.2).
3. Resignations during a paired turn. Closed. Catanova decision: section 9.6 stands as written. The Partner's phase still follows a Lead who resigns, if five or more remain. A Partner who resigns before their phase is not replaced that paired turn. A Partner's phase already under way finishes when the count drops below five. A robber move owed by a resigned player falls to the next player to act.
4. A resignation that moves an award. Closed. Catanova decision: a resignation counts as an action, so when it hands Longest Road or Largest Army to someone, the win check runs at once (section 6.7, rule 2).
5. Between-turns build with fewer than five players. Closed. Catanova decision: once Between-turns build is chosen, windows continue at any player count (sections 7.2 and 9.6).
6. Skipping unusable build windows. Closed. Catanova decision: every other player always gets a window, and nothing skips one automatically, because skipping would reveal something about a hidden hand. A player may pass at once (section 7.2).
7. Build-window clock in a room without a timer. Closed. Catanova decision: the 20-second window clock is always on, whether or not the room has a turn timer (section 9.2).
8. The 45-second Partner's phase. Closed. Catanova decision: section 9.4 stands as written. The clock starts when the phase begins with the Partner absent, or when the Partner disconnects during the phase, and keeps running if they reconnect. An absent player's own turn in a room without a timer has no clock besides the 2-minute rule.
9. Half-second clocks. Closed. Catanova decision: they round up to whole seconds, so 32.5 seconds becomes 33 and 57.5 becomes 58 (section 9.2).
10. Unfinished card effects when the Partner's phase expires. Closed. Catanova decision: free roads still owed from Road Building stay unplaced, and the clock completes a robber move still owed from a Knight (section 9.3).
11. An absent player during the setup draft. Closed. Catanova decision: once they have been offline for 2 minutes, the clock places for them. It puts a settlement on the legal intersection with the most production pips, with ties broken at random by the server, then a road on a random legal edge touching it (section 9.4).
12. Changing mode and the target. Closed. Catanova decision: changing mode resets the target to the new mode's default, 10 for Classic and Big Table and 14 for Open Sea (section 1.2).
13. When a player who held no marker wins. Closed. Catanova decision: they win when a later paired turn begins in which they hold the Lead or Partner marker, if they still have the target then. A new Partner therefore wins before the Lead rolls (section 6.7, rule 4).

To report a rules issue, identify the section, describe the exact game state, and link the official rule or clarification. Changes that alter legal moves or hidden information require a new ruleset version (`big-table-v2`); wording-only corrections do not.
