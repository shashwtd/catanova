# Catanova Open Sea rulebook

Ruleset: `open-sea-v1` · Written 25 September 2026

Open Sea is Catanova's sea mode. It aims to reproduce the core mechanics of the official Seafarers expansion for three and four players: ships, gold fields, the pirate, a longest route that counts ships, and bonus points for settling new islands. Catanova is an independently developed browser game, and this is an independently written explanation, with original organization, maps and examples. It is not an official CATAN publication. The reference edition is the English 2025 rulebook of the Seafarers expansion (CN3083), played with the English 2025 base game, supplemented by the publisher's Seafarers FAQ where it settles a point the book leaves open. See [sources and compatibility decisions](RULE_SOURCES.md); Open Sea rows are in its [Big Table and Open Sea](RULE_SOURCES.md#big-table-and-open-sea) part, keyed to the section numbers in this book.

This book is a companion to the [Classic rulebook](RULEBOOK.md) (ruleset `base-3-4-v1`). Everything in the Classic rulebook applies unless this book changes it. Where the official texts leave a gap, or where Catanova departs from them, the rule is marked as a Catanova decision. Section 17 lists the points the official texts and the first decisions left open, says where each is now settled, and names the one still open.

This is the rules target for the mode. The engine does not implement it yet.

## 1. Scope

### 1.1 What version 1 contains

`open-sea-v1` has one scenario, Outer Isles (`outer-isles`), for three or four players. There is no Open Sea game for two players, and none for five or six in this version. Outer Isles is Catanova's own map: a main island where everyone starts, several small islands that can be reached only by ship, and a ring of sea around it all (section 4). It is not an official layout.

### 1.2 Choosing the mode

The host picks the mode in Room setup. The modes are Classic (`base-3-4-v1`), Big Table (`big-table-v1`, for five and six players) and Open Sea (`open-sea-v1`). The ruleset is frozen into the game when it starts, and a saved game keeps it for good. Section 15 covers the lobby rules.

### 1.3 The goal

Be the first player with at least **14 victory points during your own turn**. The host may set the target anywhere from 10 to 18. Your first settlement on each small island earns 2 bonus points on top of the settlement's own point (section 12).

### 1.4 What changes from Classic

| Topic                   | Classic                                  | Open Sea                                             | Section |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------- | ------- |
| Players                 | 2–4                                      | 3 or 4                                               | 1.1     |
| Board                   | One island of 19 land hexes              | Outer Isles: a main island, small islands, sea hexes | 2, 4    |
| Route pieces            | Roads                                    | Roads and ships; ships can move                      | 7, 8    |
| Production              | Five resource terrains                   | Plus gold fields, which pay resources of your choice | 9       |
| After a seven or Knight | Move the robber                          | Move the robber or the pirate                        | 10      |
| Route award             | Longest Road                             | Longest Route, counting roads and ships              | 11      |
| Points                  | Target 10                                | Target 14 (10–18); island bonuses                    | 12      |
| Road Building           | Two roads                                | Two roads or ships, in any mix                       | 13.2    |
| Bots and stand-ins      | Allowed                                  | None                                                 | 15.4    |
| An absent player        | A stand-in bot takes the seat after 30 s | The clock makes only forced moves, after 2 minutes   | 15.5    |

Everything else is Classic: the resource bank, the development deck, building costs other than the ship, the distance rule, the bank shortage rule, sevens and discards, trading, harbours, Year of Plenty, Monopoly, Victory Point cards, Largest Army and what players may see.

## 2. The board

### 2.1 Hexes

The board is a grid of hexes of two kinds:

- Land hexes: forest, hills, pasture, fields, mountains, desert and gold field. A desert and a gold field are land for every rule about land.
- Sea hexes: they produce nothing, never carry a number token and never hold the robber.

Every space on the board is one or the other. Catanova decision: there is no separate frame around the board. The outermost hexes are all sea hexes, and they are part of the board like any other sea hex.

### 2.2 Islands

An island is a group of land hexes joined by shared edges, as the map marks it. Outer Isles has one main island and several small islands. Islands never touch: there is always sea between two islands. Every intersection that touches land therefore belongs to exactly one island.

### 2.3 Intersections

An intersection is a corner where hexes meet.

- A land intersection touches at least one land hex. Settlements and cities go only on land intersections.
- A coastal intersection is a land intersection that also touches at least one sea hex.
- A sea intersection touches only sea hexes. Ships may pass through it; nothing can be built on it.

The distance rule of Classic section 8.2 counts every kind of edge. Two settlements on either side of a narrow strait conflict if a single sea edge joins their intersections.

### 2.4 Edges

| Edge         | On either side                | Road | Ship                                               |
| ------------ | ----------------------------- | ---- | -------------------------------------------------- |
| Land edge    | Land and land                 | Yes  | No                                                 |
| Coastal edge | Land and sea                  | Yes  | Yes, but it holds one piece only: a road or a ship |
| Sea edge     | Sea and sea                   | No   | Yes                                                |
| Rim edge     | Sea and the edge of the board | No   | No                                                 |

The outer rim is the outline of the whole board: the edges of the outermost sea hexes that border no other hex. Catanova decision: nothing is ever placed on a rim edge. The reference edition lets ships use the edges between its board and its frame; Catanova's board has no frame, and its rim takes nothing. No land hex has a rim edge, because the outermost hexes are all sea.

### 2.5 Harbours

The Classic rulebook calls them ports. A harbour sits on a coastal edge and works exactly as in Classic section 7.2: only your own settlement or city on one of that edge's two intersections gives you its rate. A ship on a harbour edge, or next to one, gives nothing.

Catanova decision: a harbour edge is an ordinary coastal edge. It may hold a road or a ship, and a piece there does not stop anyone else using the harbour. The reference edition states this for one of its scenarios only.

## 3. Supply and components

| Item                    | Open Sea                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resource cards          | 19 of each resource, 95 in total, as in Classic                                                                                                                    |
| Development cards       | 25, as in Classic: 14 Knights, 2 Road Building, 2 Year of Plenty, 2 Monopoly, 5 Victory Point                                                                      |
| Pieces for each player  | 15 roads, 15 ships, 5 settlements, 4 cities                                                                                                                        |
| Land hexes, numbers     | As the Outer Isles template for the player count lays down: 24 land hexes and 23 number tokens with three players, 30 and 29 with four (section 4)                 |
| Harbours                | All on the main island's coast (section 4.1): 8 with three players (three 3:1 and one 2:1 for each resource), 9 with four (four 3:1 and one 2:1 for each resource) |
| Dice, robber and pirate | Two six-sided dice, one robber, one pirate                                                                                                                         |
| Awards                  | Longest Route and Largest Army, 2 points each                                                                                                                      |
| Island bonuses          | No limit: every bonus earned is paid (Catanova decision)                                                                                                           |

Resource names are Catanova's: Timber, Clay, Sheep, Hay and Rock. Their storage ids stay `wood`, `brick`, `sheep`, `wheat` and `ore`. Gold is not a resource (section 9.1).

Building costs are Classic's plus the ship:

| Purchase         | Timber | Clay | Sheep | Hay | Rock |
| ---------------- | -----: | ---: | ----: | --: | ---: |
| Road             |      1 |    1 |     0 |   0 |    0 |
| Ship             |      1 |    0 |     1 |   0 |    0 |
| Settlement       |      1 |    1 |     1 |   1 |    0 |
| City upgrade     |      0 |    0 |     0 |   2 |    3 |
| Development card |      0 |    0 |     1 |   1 |    1 |

A ship is worth no points and counts toward Longest Route. When all 15 of your ships are on the board, you cannot build another.

## 4. Outer Isles

### 4.1 What the map guarantees

Outer Isles is a Catanova map preset, not an official layout. Its templates and generator are specified in [map generation](MAP_GENERATION.md). Every Outer Isles board guarantees:

1. A separate template for three players and for four. The game uses the template for the number of players seated when it starts. Section 15.1 covers the board a room holds before the game starts.
2. One main island. Every starting settlement goes there.
3. Several small islands, each separated from the main island and from each other by sea.
4. Gold fields only on small islands. A gold field never carries a 6 or an 8.
5. At least one desert, because the robber starts on one.
6. A ring of sea hexes around everything, which is part of the board.
7. Every small island reachable by ship: a chain of legal ship edges leads from the main island's coast to its coast.
8. Harbours only on the main island's coast, spaced so that no two harbours share an intersection or sit on neighbouring intersections.
9. A starting sea hex for the pirate, fixed by the template, away from the places where starting settlements can go.

### 4.2 Shuffled every game

Terrain, number tokens and harbour types are shuffled for every game inside the template, under fairness rules in the spirit of Catanova's balanced island: at least the `balanced-v2` number rules wherever they apply, plus the guarantees above. As with the balanced island, the map seed is public and reproduces the board. It never determines dice, thefts or the development deck. If no valid board is found within the search limits, generation fails rather than weakening a rule.

### 4.3 Starting positions of the robber and the pirate

The robber starts on a desert chosen at random from the map seed. The pirate starts on its template's sea hex (4.1, item 9).

## 5. Setup

### 5.1 Starting player

Everyone rolls, as in Classic section 3.2. The highest total starts, and a tie for highest is re-rolled among the tied players.

### 5.2 Placement order

The snake draft of Classic section 3.3: 1, 2, 3, 3, 2, 1 with three players and 1, 2, 3, 4, 4, 3, 2, 1 with four.

### 5.3 Starting settlements

Both starting settlements go on land intersections of the main island and obey the distance rule. They cost nothing.

### 5.4 A road or a ship

After each starting settlement, place one road touching it. If the settlement is on a coastal intersection, you may place one ship touching it instead. The ship goes on a coastal or sea edge at that settlement, never on an edge of the pirate's hex. You may choose a ship for either settlement, both or neither.

### 5.5 Starting resources

For your second settlement, take one matching resource for each adjacent land hex that produces one. A desert or a sea hex gives nothing. Catanova decision: an adjacent gold field gives one resource of your choice per gold field, chosen as in section 9. Outer Isles never produces this case, because gold fields are only on small islands, but the rule belongs to the ruleset.

### 5.6 During setup

Starting settlements never earn an island bonus, because they are all on the main island. There is no trading, no development-card play and no ship move during setup. Setup is not a turn: a ship placed during setup may move on its owner's first turn. Section 15.5 says how the clock places for a player who has been absent for 2 minutes.

## 6. Your turn in Open Sea

The turn keeps its Classic shape (Classic section 4):

1. You may play one eligible development card before rolling. A Knight moves the robber or the pirate (section 10).
2. Roll both dice. On a total other than 7, ordinary hexes produce, then any gold picks are made (section 9). On a seven, players discard as in Classic section 6.1, then you move the robber or the pirate (section 10).
3. In your action phase, trade, build (ships included), buy development cards and play one eligible development card if you have not already played one. You may also move one ship (section 8). Do these in any order, as often as the rules allow.
4. End your turn. The next player clockwise begins.

Other players still cannot build or use harbours during your turn, and they cannot build or move ships either.

## 7. Ships

### 7.1 Building a ship

Pay 1 Timber and 1 Sheep and place a ship on an empty coastal or sea edge. The new ship must:

- touch, at one of its two intersections, one of your settlements or cities, or one of your ships;
- not pass an opponent's building: where another player's settlement or city stands on an intersection, your ship there does not connect to your other ships there, just as your roads do not; and
- not be on any edge of the pirate's hex.

A ship never uses a road as its connection, and a road never uses a ship. Lines of ships may branch and form loops.

### 7.2 One piece per coastal edge

A coastal edge holds a road or a ship, never both.

### 7.3 Where roads and ships meet

Your roads and your ships join only at an intersection that holds one of your own settlements or cities.

- A road and a ship may both end at the same empty intersection, but they stay separate there. Neither counts as the connection for the other kind: a new road from that intersection must attach to your road, and a new ship to your ship.
- If the distance rule allows, you may build a settlement on that intersection. From then on, your roads and ships join there.
- An opponent's building never joins your road to your ship.

### 7.4 Settling by ship

A settlement must go on an empty land intersection that touches at least one of your roads or ships, and must obey the distance rule. This is how you reach the small islands: sail a line of ships to a coastal intersection of the island and build there. Once you have a settlement on an island, roads can grow from it across that island.

### 7.5 Examples

Example (a point of land). Your settlement stands at P, a corner where one forest hex meets two sea hexes. Of the three edges at P, P–Q and P–R are coastal (forest on one side, sea on the other) and P–S runs between the two sea hexes. Your road is on P–Q. You may build a road or a ship on P–R, but not both. You may build a ship on P–S. You may not add a ship on P–Q, because your road is already there.

Example (a road meets a line of ships where nobody can build). Your roads run A–B–C–J along a coast from your settlement at A, and your ships run H–K–L–M–J from your settlement at H, so both reach the empty coastal intersection J. Another player's settlement stands at N, one edge from J, so the distance rule keeps J empty for good. Your roads and ships never join there: your longest route here is 4, the ships, not 7. A new road at J must continue your road C–J, and a new ship at J must continue your ship M–J. Neither may start from the other kind. Had J been free and another player built there, the result would be the same.

## 8. Moving ships

### 8.1 The rule in brief

Once per turn, in your action phase, you may move one of your ships. The ship must:

- not have been built this turn;
- not be on an edge of the pirate's hex;
- not be part of a closed line (8.2); and
- have an open end (8.2), or be one of the ships the loop and ring rules free (8.3).

Lift it and place it on a different edge where you could legally build a new ship right now (8.5). There is no distance limit. A move costs nothing and is not a build.

### 8.2 Open ends and closed lines

Each ship has two ends, one at each of its intersections. An end is open when that intersection holds none of your settlements or cities and none of your other ships that connect to it there, and the end has not been recorded as closed (below).

- Your own road at that intersection does not close the end. Catanova follows the 2025 wording, which counts only your ships and buildings.
- Other players' roads, ships and buildings never close an open end.
- Catanova decision: when two of your ships meet at an intersection that holds another player's settlement or city, they do not connect through it. If the building was there before your ships met there, each of them has an open end there.

A closed line is a continuous line of your ships joining two of your settlements or cities. No ship of a closed line can move. A line that was closed stays closed if another player later builds on it, even though your route is now broken there for Longest Route (section 11).

Catanova decision, following the publisher's FAQ: when another player places a settlement on a line of yours that was still open, the ships beside it do not become open either. At the moment the settlement is placed, every end of your ships that met another of your ships at that intersection is recorded as closed. It stays closed for as long as that ship stays on its edge, although your ships no longer connect there for building or for Longest Route (section 8.7, step 0). So ships meeting at an opponent's building have open ends there only when the building was there first.

### 8.3 Loops and rings

These follow the publisher's Seafarers FAQ.

- A loop is a line of your ships that leaves one of your settlements or cities and returns to the same one, with no other building on it. Only the two ships touching that building may move.
- A ring is a circuit of your ships with no building on it at all. Every ship of the ring may move.
- A ship that links a ring to one of your buildings is not part of the ring, and the ring rule does not free it.
- If you build a settlement on a loop or a ring so that it joins two of your buildings, it becomes a closed line and none of it moves.
- Catanova decision: your ships do not connect through another player's building (section 8.2), so a loop or a ring that passes through one is broken there. It is then neither a loop nor a ring, and these rules do not free its ships.
- Catanova decision: the FAQ covers a single loop and a single ring. In any larger network, such as two rings side by side, three lines between the same two sea intersections, or a ring hanging off a loop, every ship on a cycle with none of your buildings is free, and so are the two end ships of a loop through one of your buildings. Section 8.7 gives the exact check.

### 8.4 Timing

- At most one ship move per turn, and only in your action phase: after the roll has been fully resolved, in any order with trading and building. Never before the roll, never during setup and never on another player's turn.
- Catanova decision: not between the two placements of a Road Building card (section 13.2).
- A ship built this turn cannot move this turn. That includes a ship placed free with Road Building.
- After a move you may build a settlement beside the ship's new position in the same turn, if the rules allow.

### 8.5 Where a moved ship may go

The destination must be an edge where you could build a new ship at that moment, judged with the moving ship already lifted:

- an empty coastal or sea edge, never a land edge or a rim edge;
- not an edge of the pirate's hex; and
- touching one of your settlements or cities, or another of your ships that connects there. The ship cannot use its own former position as its connection.

A move must also not detach another of your ships. Call a ship attached when it touches one of your buildings, or another of your ships that connects to it. Every other ship of yours that was attached before the move must still be attached after it. A ship that was already cut off before the move, for example by an opponent's settlement, never stops a move. Catanova decision: this second check is how Catanova reads the rule that ships attach to your ships or buildings, so a move may not detach another of your ships. It matters only where an opponent's building has split one of your lines.

### 8.6 Longest Route after a move

Treat the lift and the placement as one action. Longest Route is recalculated once, after the ship is placed. Following the publisher's FAQ, moving a ship never costs you the award if your longest route afterwards is at least as long as before. If it is shorter, the broken-route rules of Classic section 10 apply.

### 8.7 Decision procedure

This is the check an engine runs. Let p be the moving player and x one of p's ships.

Terms:

- p's buildings are p's settlements and cities.
- Two of p's ships connect at an intersection when both touch it and it holds no other player's settlement or city.
- A ship of p is attached when one of its ends is at one of p's buildings, or another ship of p connects to it at one of its ends.
- L(p) is the set of p's ships locked by history (step 0). It starts empty.
- E(p) is the set of ends of p's ships recorded as closed (step 0). It starts empty.

Step 0, kept in the game state: whenever another player places a settlement at an intersection v:

- Compare p's closed ships (rule 3) just before and just after that placement. Add every ship that was closed before and is not closed after to L(p). Nothing ever leaves L(p). This is how a closed line stays closed after an opponent builds on it.
- Add to E(p) every end of p's ships at v where another ship of p connected just before the placement. An end leaves E(p) only when its ship moves off that edge. This is how the ships beside a new settlement stay closed there, as the publisher's FAQ has it.

Only another player's new settlement can break a closing path or split two of p's ships at an intersection, so nothing else needs to update L(p) or E(p).

x may move when all four hold:

1. x was not built this turn.
2. x is not on an edge of the pirate's hex.
3. x is not closed. x is closed if it is in L(p), or if it lies on a path of p's ships from one of p's buildings to a different one of p's buildings that never visits an intersection twice and has no building at any intersection between its two ends.
4. At least one of these is true:
   1. Open end: one end of x is at an intersection that holds no building of p, where no other ship of p connects to x, and that end is not in E(p).
   2. Loop: one end of x touches one of p's buildings, b, and x lies on a cycle of p's ships through b that never visits an intersection twice and has no building at any intersection other than b.
   3. Ring: x lies on a cycle of p's ships that never visits an intersection twice and has no building at any of its intersections.

Then check the destination (8.5), and check that no other ship of p that was attached before the move is unattached after it. Move the ship, recalculate Longest Route (8.6) and record that p's ship move for this turn is used.

Consequences worth testing:

- A ship at a dead end can never lie on a path between two buildings, so rule 3 matters only for lines that join buildings, and rules 4.2 and 4.3 only for cycles.
- A cycle through an opponent's building is neither a loop nor a ring for you, because your ships do not connect there.
- If the end ship of a line sits on an edge of the pirate's hex, it cannot move (rule 2), and the ship behind it has no open end. Nothing in that line moves until the pirate leaves.
- A cycle that another player later builds on stops being a loop or a ring, and the ends at the new settlement go into E(p). Its ships may then move only if another cycle or an open end elsewhere frees them.
- A ship already cut off never blocks another move. Take ships H–a, a–b, b–c and c–d from your settlement H, where c is a coastal intersection and d is in open sea. Another player builds at c, so the ends of b–c and c–d at c go into E(p). Now c–d touches nothing of yours, but it was unattached before any move, so the tip of a separate line of yours may still move. c–d may move too, through its open end at d. b–c may not: its end at c is recorded as closed, and its end at b meets a–b.

### 8.8 Examples

Example (a line and a branch). From your settlement H, ships run H–a, a–b and b–c, and c is an empty sea intersection. Only b–c may move: its end at c is open. Add a ship b–d. Now b–c and b–d may each move. a–b may not, because both of its ends meet your ships, and H–a may not, because one end is your settlement and the other meets a–b.

Example (your road at the end). Your ships H–a, a–b and b–C end at the coastal intersection C, where one of your roads also ends and nobody has built. b–C may move, because a road does not close an end.

Example (an open line, then an opponent). Take the line H–a, a–b, b–c of the first example, without the branch. Only b–c may move. Another player then builds a settlement at b, a coastal intersection. The line never joined two of your buildings, so no ship is locked by history, but the ends of a–b and b–c at b are recorded as closed (section 8.7, step 0). a–b still may not move. b–c still may, through its open end at c. H–a still may not. This follows the publisher's FAQ: the ships beside a new settlement do not become open.

Example (a closed line, then an opponent). Ships H–a, a–b, b–c and c–T join your settlements H and T. None of them may move. If another player later builds a settlement at b, a coastal intersection, the line stays closed and still cannot move. For Longest Route, your route is broken at b.

Example (meeting at a building that was already there). Another player's settlement stands at the coastal intersection X. Your line from H reaches X with the ship g–X, and a separate line from your settlement T reaches X with the ship k–X. The lines do not connect through X, so they never formed a closed line: g–X and k–X each have an open end at X, and either may move. Compare the two previous examples, where the building came after the ships met.

Example (a loop). Six of your ships circle one sea hex. One corner of that hex is your settlement H, and no other corner holds a building. That is a loop: only the two ships touching H may move.

Example (a ring under the pirate). Ten of your ships run right round the outside of two neighbouring sea hexes, away from the edge of the board, with no building at any of their corners. Two more ships, T–u and u–v, join your settlement T to the ring at its corner v. The pirate stands on one of the two hexes. Five of the ring ships lie on its edges and cannot move (section 10.6). The pirate does not break the ring, so the other five may each move. Neither T–u nor u–v may move: each of their ends meets your settlement or another of your ships.

## 9. Gold fields

### 9.1 What a gold field pays

When a gold field's number is rolled and the robber is not on it, each adjacent settlement earns its owner 1 resource of their choice, and each adjacent city earns 2, in any mix. Gold itself is not a resource. There are no gold cards, and gold cannot be traded, spent or stolen.

### 9.2 Order of production

Catanova decision:

1. Ordinary hexes produce first, as in Classic section 5, including the shortage rule for each resource. Gold fields take no part in this step, and nothing owed from gold counts toward a shortage.
2. Then the gold picks. Players owed gold choose one player at a time, in turn order, starting with the active player. Each player makes all of their picks when their turn to pick comes. Each card chosen must be one the bank holds at that moment, after everything taken before it.
3. If the bank holds no resource cards at all, any remaining picks lapse. Missing picks are not owed later.
4. Picks cannot be declined. Like all production, they are compulsory (Classic section 5).
5. If a player owed gold resigns before their picks are made, their picks lapse. The remaining picks go on in order, from the bank as it then stands, including the cards the resigned player's hand returned. This holds even when the player who resigned is the active player; the turn then passes on after the last pick.
6. The active player's turn clock pauses while picks are made, as it does during discards, and resumes when the last pick is made. Each player's picks, the active player's own included, run on that player's own clock (section 9.5).

The action phase begins once every pick is made.

For example, the bank holds 2 Rock, and a 10 is rolled. Blue's city and Red's settlement touch the mountains numbered 10, so together they are owed 3 Rock. Only 2 remain, so nobody receives Rock from this roll (Classic section 5). Green has a settlement on the gold field numbered 10. Green then picks from the bank as it stands, and may take one of the 2 Rock.

### 9.3 Gold at setup

A second starting settlement next to gold fields gets 1 resource of its owner's choice per adjacent gold field (section 5.5).

### 9.4 The robber and the pirate

The robber on a gold field stops it producing, as on any land hex. The pirate can never stand on a gold field, because it stays on sea hexes.

### 9.5 The pick clock

Catanova decision: each player owed gold has one 20-second clock for all of their picks. It runs in every room, whether or not the room has a turn timer. If it runs out, the server makes their remaining picks: the resource they hold fewest of among the types the bank still holds, with ties broken in the order Timber, Clay, Sheep, Hay, Rock. When several cards are still owed, it takes them one at a time by the same rule, counting the cards just taken.

For example, Green is owed 2 picks and holds 2 Timber, 0 Clay, 1 Sheep, 0 Hay and 3 Rock, and the bank holds every type. The first default is Clay: Clay and Hay tie at 0, and Clay comes first. With 1 Clay in hand, the second is Hay.

## 10. The pirate and the robber

### 10.1 Where each may stand

The robber stands only on land hexes: any island, any terrain, deserts and gold fields included. The pirate stands only on sea hexes, including the outer ring. Section 4.3 gives their starting places.

Catanova decision: the reference edition also lets the pirate stand on the frame around its board, where it steals nothing. Catanova's board has no frame (section 2.1), so the pirate is always on a sea hex, and moving it always means choosing a sea hex.

### 10.2 After a rolled seven

Players first discard as in Classic section 6.1. Then the active player moves either the robber or the pirate. Exactly one of them moves: never both, and never neither.

### 10.3 After a Knight

A Knight gives the same choice, with no discards. A seven and a Knight in the same turn each make their own choice, so one may move the robber and the other the pirate. A Knight may be played before the roll, as in Classic.

### 10.4 Moving the robber

As in Classic section 6.2: the robber moves to a different land hex, on any island. Choose one opponent with a settlement or city touching that hex and take one random resource card from them. The robber does not affect ships.

### 10.5 Moving the pirate

Move the pirate to a different sea hex. Then choose one other player who has a ship on an edge of that hex and take one random resource card from them. This theft is compulsory whenever such a player exists, as the 2025 text words it.

- A player with several ships on that hex still loses only one card.
- A settlement or city on the coast of that hex does not make its owner a target. Only ships do.
- A ship on a sea edge borders two sea hexes, so the pirate on either of them can reach it.
- Your own ships there do not make you a target. If no other player has a ship there, nothing is stolen.
- Choosing a player with no resource cards is allowed and steals nothing, as with the robber.
- Resigned players are never targets, of the pirate or of the robber. If the only other ships on the hex are theirs, nothing is stolen.

### 10.6 What the pirate blocks

While the pirate is on a sea hex, no ship may be built on any of that hex's six edges, moved onto one or moved off one. This includes starting ships (section 5.4) and ships placed with Road Building. Ships already on those edges stay where they are, stay connected and still count for Longest Route. The pirate never blocks roads, settlements, cities, harbours or production.

### 10.7 What the robber blocks

As in Classic section 6.2: the production of its hex, gold included, and nothing else.

## 11. Longest Route

### 11.1 The award

Catanova decision: in Open Sea the route award is called Longest Route, because ships count toward it. Classic and Big Table keep the name Longest Road. It is worth 2 points and needs a continuous route of at least 5 roads and/or ships. Who takes it, who keeps it on a tie and what happens when a route is broken all follow Classic section 10.

### 11.2 What counts as continuous

- Two of your roads continue through an intersection unless another player's settlement or city stands there.
- Two of your ships continue through an intersection on the same condition.
- A road and a ship continue through an intersection only if your own settlement or city stands there.
- Everything else is as in Classic section 10: each piece counts once, a loop can count, separate branches are not added together, and unconnected parts are measured separately.

### 11.3 Closed lines and the pirate

An opponent's settlement placed on one of your closed lines breaks your route there, although those ships stay locked for moving (section 8.2). The pirate has no effect on any route.

### 11.4 When to recalculate

After every road or ship is built, after a ship move is complete (section 8.6) and after any settlement that changes connectivity, including your own settlement joining your roads to your ships.

## 12. Island bonuses and winning

### 12.1 Points

| What you own                                 |                            Victory points |
| -------------------------------------------- | ----------------------------------------: |
| Each settlement on the board                 |                                         1 |
| Each city on the board                       | 2 total, replacing its settlement's point |
| Each hidden Victory Point development card   |                                         1 |
| Longest Route award                          |                                         2 |
| Largest Army award                           |                                         2 |
| Each island bonus                            |                                         2 |
| Roads, ships or played Knights by themselves |                                         0 |

### 12.2 The island bonus

Catanova decision:

- Your first settlement on each small island earns you 2 bonus points.
- Each island counts once for each player. Every player earns it independently, whoever else has already settled there.
- Later settlements of yours on the same island earn nothing more.
- The bonus stays when that settlement becomes a city.
- The main island never earns a bonus, so starting settlements never do.
- Bonuses are public, and there is no limit to how many can be paid.

### 12.3 Winning

The target is 14 points by default. The host may set it anywhere from 10 to 18 in Room setup. Otherwise winning works exactly as in Classic section 1: you win as soon as you have at least the target during your own turn, hidden Victory Point cards count, and there is no final round. If you reach the target on another player's turn, for example because Longest Route passes to you, you win only if you still have it during your own turn.

For example, you have 11 points, and your ships reach a small island where Red already has a settlement. You build your first settlement there: 1 point for the settlement and 2 for the island bring you to 14, and with a target of 14 you win at once. Red's settlement on that island does not affect your bonus.

## 13. Development cards

### 13.1 Knight

Move the robber or the pirate (section 10). Nobody discards. The Knight counts toward Largest Army as in Classic section 11.

### 13.2 Road Building

Place two roads, two ships, or one of each, free, one straight after the other. Each placement follows the rules for its own kind of piece and comes from your own supply. A second ship may attach to the first ship, and a second road to the first road, but a ship never attaches to a road or a road to a ship.

- No trade, paid build or ship move may come between the two placements. The ship move is a Catanova decision (section 8.4).
- A ship placed this way counts as built this turn, so it cannot move this turn.
- Longest Route and victory are checked after each placement.
- Classic section 9's provisional handling of the extreme cases applies, reading "road" as "road or ship": the card needs a legal first placement, and a second is placed whenever a legal site and a piece remain.

### 13.3 The other cards

Year of Plenty, Monopoly and Victory Point cards are unchanged. So are the limit of one card per turn and the rule that a card bought this turn cannot be played this turn (Classic section 9).

## 14. Information at the table

Classic section 12 applies. In addition:

- Ships, their moves, the pirate's position and every island bonus are public. The move history records each ship move with where it came from and where it went.
- Which of a player's ships may move follows from public information, so the interface may mark your movable ships and say why the others cannot move.
- Catanova decision: gold picks are public once made, as Year of Plenty's cards are today.
- The gold picker offers only the types the bank can still pay. As with Classic's shortage check, the bank's remaining cards may be counted for this; the standard interface still adds no always-visible bank tracker.
- A card stolen by the pirate stays as private as one stolen by the robber.

## 15. Online rules

### 15.1 Choosing Open Sea

Catanova decision: in the lobby, a change of mode is refused while the seated players do not fit the new mode, or while bots are seated and the new mode allows none. For Open Sea that means more than four players, or any bot. Fewer players is fine: a room with fewer than three players may switch to Open Sea and then wait for more. Open Sea can start only with three or four seated players, and, as in Classic, only when every other player is ready and every seat is connected.

Catanova decision: changing the mode resets the points target to the new mode's default, even if the host had chosen another: 14 for Open Sea, 10 for Classic and Big Table.

Catanova decision: as in Classic, the room deals its board when it is created, and Start uses that board; a change of mode deals a new one. The lobby does not draw it; players first see the island when the game starts. In an Open Sea lobby, the board uses the four-player template while four players are seated and the three-player template otherwise. Whenever the seated count moves between three and four, the board is dealt again from the same seed on the other template. Nobody has seen the board yet, so this is not a settings change and does not reset anyone's readiness. Start refuses a board whose template was made for a different number of players than are seated. The board records its template's player count next to its preset, because both templates share the preset `outer-isles-v1` (section 4.1).

### 15.2 Room options

The target slider runs from 10 to 18, with 14 as the default. Changing the mode resets it to the new mode's default (section 15.1). The dice mode and the turn timer work as in Classic.

### 15.3 Clocks

The game server owns every deadline, as the [turn clock](TURN_CLOCK.md) document describes.

| What the game is waiting for | Clock                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A turn                       | The room's turn timer, as in Classic: off, or 40, 65, 90, 115 or 140 seconds                                                 |
| A discard after a seven      | As in Classic: each player who must discard gets the full room time, and the active player's clock pauses                    |
| Gold picks                   | 20 seconds for each player owed gold, for all their picks, in every room (section 9.5), and the active player's clock pauses |
| Setup                        | Untimed, as in Classic; the clock places for a player absent for 2 minutes (section 15.5)                                    |

When a clock runs out:

- A turn: the Classic defaults apply, with the two Open Sea defaults below. The server rolls if the player has not rolled, resolves a pending robber-or-pirate move, places any pieces still owed from a Road Building card already played, then ends the turn and withdraws any open trade offer. If the roll it makes pays gold, the picks are still made, each player's on their own clock, and the turn ends after the last one.
- A discard: as in Classic, the required number of cards is discarded at random from the player's hand.
- Gold picks: the default of section 9.5 for every card still owed.

Catanova decision, the two Open Sea defaults:

1. A pending robber-or-pirate move: the clock always moves the robber, never the pirate. As in Classic, it moves the robber to a random land hex other than its current one, then takes a random legal victim with a settlement or city on that hex, if there is one. If the pirate has already been moved and only its victim is still to be chosen, the clock takes a random legal victim among the other players with a ship on an edge of its hex. Resigned players are never victims (section 10.5).
2. Road Building pieces still owed: for each piece, the clock places a road on a random legal road site if the player has a road left and such a site exists. Otherwise it places a ship on a random legal ship edge, never an edge of the pirate's hex, if the player has a ship left. Otherwise that piece is dropped.

The clock never buys a piece, makes an optional build, moves a ship, spends resources on an optional action, accepts a trade, plays a development card the player did not choose, or resigns anyone. The only pieces it places are those still owed from a Road Building card the player already played.

### 15.4 No bots

Catanova decision: bots are allowed only in Classic for now. Open Sea allows no bots at all, and no stand-in bots.

### 15.5 Disconnected players

Catanova decision, shared with Big Table:

1. A disconnected player is shown as disconnected, and the game waits for them. No bot takes the seat.
2. For the first 2 minutes of their absence, nothing is played for them, except what one of their ordinary clocks does if it runs out in that time: the turn timer and a discard's clock, when the room has a timer, and the 20-second clock for their gold picks, which runs in every room.
3. Once they have been offline for 2 minutes, the clock acts for them whenever the game waits on them, exactly as if their time had run out (section 15.3). That covers their setup placements (below), their turns, any discard they owe and any gold picks they owe. This applies whether or not the room has a turn timer.
4. This continues until they reconnect. Reconnecting gives them the seat back at once. It does not reset a clock that is already running.

Catanova decision, shared with Big Table: setup stays untimed, but a setup placement is compulsory, so it counts as a forced move. Once a player has been offline for 2 minutes, whenever the draft waits on them, the clock places for them. First it places a settlement on the legal intersection of the main island with the most production pips, counting the pips of the number tokens on the hexes it touches. The server breaks ties at random. Then it places the setup piece: a road on a random legal edge touching that settlement, or, if no road is legal there, a ship on a random legal edge touching it. If the player placed the settlement before the 2 minutes ran out, the clock places only the road or ship.

What differs from Classic, where a stand-in bot covers an absent player (see [bots](BOTS.md)):

| Moment                | Classic                                                                                                                  | Open Sea                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First 30 seconds away | The seat is shown as disconnected. The game waits; the room timer, if any, runs as usual.                                | The same.                                                                                                                                                                                                |
| From 30 seconds       | A stand-in bot takes the seat and plays it fully: it trades with the bank and at harbours, builds, buys and plays cards. | No bot. The seat stays shown as disconnected, and the game keeps waiting.                                                                                                                                |
| From 2 minutes        | The stand-in carries on.                                                                                                 | Whenever the game waits on this player, the clock makes only the forced moves of section 15.3, and their setup placements. It never buys, trades, plays a card, moves a ship or makes an optional build. |
| The player returns    | The seat is handed back at once.                                                                                         | The clock stops acting for them at once.                                                                                                                                                                 |

### 15.6 Resignation, pausing and abandonment

Everything else about reconnect grace, resignation and pausing follows the [turn clock](TURN_CLOCK.md) document, as the server applies it in Classic today:

1. Leaving, or being removed by the host, resigns a player at once and for good.
2. An absent player is not resigned while any other remaining player is connected. In Classic a stand-in covers them; in Open Sea the clock does (section 15.5).
3. When every remaining player is offline, automatic play pauses, including the clock's moves for absent players. Each absent player's deadline becomes at least three minutes from the moment the table emptied, then runs continuously. Once every remaining player's deadline has passed, the game closes as Abandoned, with no winner. If someone returns within their grace, the current clocks restart with their full duration.
4. A resigned player's pieces stay on the board, ships included, and keep occupying their sites and edges. Their resource cards return to the bank, their unplayed development cards are retired, their buildings stop producing, and they no longer qualify for either award. Future turns and setup slots skip them.

The turn clock document sets out these rules for both modes without bots in its section on [modes without bots](TURN_CLOCK.md#modes-without-bots).

## 16. What later versions add

None of this is part of `open-sea-v1`.

### 16.1 More scenarios

Three further scenarios have reserved names: Sister Isles (four islands), Sand Divide (a desert barrier) and Veiled Waters (fog). Each will have its own map, and any rule it adds will come with a new ruleset version. Nothing about them is specified here.

### 16.2 Open Sea for five and six players

An outline only:

- It will use Big Table's paired turns, with a Lead and a Partner (see the [Big Table rulebook](RULEBOOK-BIG-TABLE.md)).
- In the Partner's phase, the Partner may also build ships and move one of their own ships, under the limits of section 8. A paired turn then has at most two ship moves, one for each role.
- Production, gold picks and the seven happen only on the Lead's roll.
- Its maps, supply, target and every other detail will be decided in its own ruleset.

### 16.3 Not planned for Open Sea

- A two-player Open Sea game.
- Bots or stand-in bots, until they are allowed outside Classic.
- A knights mode. It is parked, and it would be a separate mode.

## 17. Completeness and open questions

This book covers the complete Open Sea flow for Outer Isles on top of the Classic rulebook: board, supply, setup, ships and their moves, gold, the pirate and the robber, Longest Route, island bonuses, winning and the online rules. It is a rules target, not a certified engine.

### 17.1 Departures from the reference edition

These are Catanova decisions that knowingly differ from the 2025 reference:

1. The map. Outer Isles is Catanova's own shuffled map, not an official layout (section 4).
2. No frame. The outermost hexes are sea hexes on the board; nothing goes on the rim, and the pirate is always on a sea hex (sections 2.1, 2.4 and 10.1).
3. The target can be changed, from 10 to 18 (section 12.3).
4. Island bonuses have no supply limit (section 12.2).
5. Ships that meet at an opponent's building do not connect there. If the building was there first, each ship has an open end there (section 8.2). Read literally, the 2025 wording would lock both ships, because each touches the other. For a settlement placed later on your line of ships, Catanova follows the publisher's FAQ: the ships beside it do not become open, whether the line was closed or still open (sections 8.2 and 8.7, step 0).
6. No two-player game and, in this version, no five- or six-player game.

### 17.2 Gaps in the reference settled by Catanova

The official texts leave these open. Catanova has decided them as follows:

1. Gold at setup: 1 resource of choice per adjacent gold field (sections 5.5 and 9.3).
2. Gold and the bank: ordinary production and its shortage rule first, then picks from what remains (section 9.2).
3. The order of gold picks: one player at a time in turn order, starting with the active player (section 9.2).
4. The bank size: 19 of each resource, as in the base game (section 3).
5. Loops and rings: the publisher's FAQ is followed (section 8.3).
6. A ship end at your own road only: open, as the 2025 wording gives it (section 8.2).
7. No ship move between Road Building's two placements (section 8.4).
8. Ships may stand on harbour edges (section 2.5).
9. The pirate's theft is compulsory, as the 2025 wording gives it (section 10.5).
10. The robber stands on land only (section 10.1).
11. A broken route that leaves the holder tied: the holder keeps the award, as in Classic (section 11.1).

### 17.3 Open questions

The points below were not settled by the official sources or by the first decisions. Items marked closed have been decided since, most of them by Catanova decisions made on 26 September 2026 under the owner's delegation, and each says which section now states the rule. They keep their numbers so that the numbering in the [ledger](RULE_SOURCES.md) still matches. Item 14 is the only one still open.

1. Gold clock in a room without a turn timer. Closed. Catanova decision: the 20-second pick clock is always on, whether or not the room has a turn timer, as Big Table's build-window clock is (sections 9.5 and 15.3).
2. The active player's clock during gold picks. Closed: it pauses while picks are made, as during discards (section 9.2).
3. The clock's default for a pending robber-or-pirate move, and for the pirate's victim. Closed: the clock always moves the robber, and picks a random legal victim if only the pirate's victim is still owed (section 15.3).
4. The clock's default for Road Building pieces still owed. Closed: a road on a random legal site if possible, otherwise a ship on a random legal edge, otherwise nothing (section 15.3).
5. An absent player during the setup draft. Closed. Catanova decision, as in Big Table: once they have been offline for 2 minutes, the clock places for them. It puts a settlement on the legal intersection of the main island with the most production pips, with ties broken at random by the server. The setup piece is then a road on a random legal edge touching the settlement, or a ship if no road is legal (section 15.5).
6. The attachment check on a ship move. Closed. Catanova decision: a move may not detach another of your ships. One that was attached before the move must still be attached after it, and a ship already cut off never blocks a move (sections 8.5 and 8.7).
7. Complex ship networks. Closed. Catanova decision: the procedure of section 8.7 applies to any network, such as two rings side by side, three lines between the same two sea intersections, or a ring hanging off a loop. Every ship on a cycle with none of your buildings is free, and so are the two end ships of a loop through one of your buildings (sections 8.3 and 8.7).
8. A loop or ring through an opponent's building. Closed. Catanova decision: it is broken there, because your ships do not connect through that building, so it is neither a loop nor a ring (sections 8.3 and 8.7).
9. Gold picks from an empty bank. Closed. Catanova decision: when the bank is empty, remaining picks lapse, and a player must always pick a type the bank still has (section 9.2).
10. Visibility of gold picks. Closed. Catanova decision: gold picks are public once made, as Year of Plenty's cards are today (section 14).
11. Changing mode and the target. Closed. Catanova decision: changing mode resets the target to the new mode's default, 14 for Open Sea and 10 for Classic and Big Table. "Do not fit" means too many seated players, so a room with fewer than three players may switch to Open Sea and wait for more before starting (section 15.1).
12. The Outer Isles templates. Closed. Both templates are now written in [map generation](MAP_GENERATION.md#open-sea-outer-isles), and section 4.1 has been checked against them. Each has one main island holding every starting settlement, three or four small islands set apart by sea, both gold fields on small islands and never on a 6 or 8, one desert, a sea ring, every small island reachable by ship, harbours spaced along the main island's coast, and a pirate start that touches no land. Three players get 24 land hexes and 8 harbours, four players 30 land hexes and 9 harbours (section 3).
13. Balance. Closed here: it is not a rules question. The target of 14 and the 2-point bonus have not been playtested on Outer Isles, and the [game modes plan](GAME-MODES.md#still-open) keeps them to playtest after release.
14. Classic's open items carry over, notably the extreme cases of Road Building and Year of Plenty listed in the [ledger](RULE_SOURCES.md).
15. A settlement placed later on an open line of ships. Closed. Catanova decision, following the publisher's FAQ: step 0 of section 8.7 records the ends at a newly placed opponent settlement as closed, so the two ships beside it do not become open (sections 8.2, 8.7 and 8.8).

To report a rules issue, identify the section, describe the exact game state, and link the official rule or clarification. Changes that alter legal moves or hidden information require a new ruleset version (`open-sea-v2`); wording-only corrections do not.
