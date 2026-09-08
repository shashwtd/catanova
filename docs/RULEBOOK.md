# Catanova base-game rulebook

Ruleset: `base-3-4-v1` · Written 9 September 2026

Catanova aims to reproduce the mechanics of the three- and four-player CATAN base game. This is an independently written explanation, with original organization and examples. It is not an official CATAN publication. The reference edition is the English sixth edition (2025), supplemented by applicable official clarifications. See [sources and compatibility decisions](RULE_SOURCES.md).

This document specifies the base-game target. An early playable engine now implements the ordinary flow. The app defaults to a separately named [balanced island preset](MAP_GENERATION.md); [playtest notes](PLAYTEST.md) list setup/UI differences and two provisional rare-card decisions. Extensions, expansions and tournaments remain separate rulesets.

## 1. What you are trying to do

Be the first player with at least **10 victory points during your own turn**. The game ends immediately when that happens. Players do not get an equalizing final round.

| What you own | Victory points |
| --- | ---: |
| Each settlement on the board | 1 |
| Each city on the board | 2 total, replacing its settlement's point |
| Each hidden Victory Point development card | 1 |
| Longest Road award | 2 |
| Largest Army award | 2 |
| Roads or played knights by themselves | 0 |

You can have both awards. An award's points belong only to its current holder. Moving an award also moves its two points.

Your hidden Victory Point cards count toward your actual total. If you begin your turn with 10 or more points, you win before rolling. If you reach 10 on someone else's turn, you must wait until your own turn and still have enough points then. Once you have won on your turn, overlooking the win does not undo it.

## 2. Resources, pieces, and the island

Catanova uses these player-facing resource names:

| Catanova name | Produced by | Also called in CATAN editions |
| --- | --- | --- |
| **Timber** | Forest | Lumber, wood |
| **Clay** | Hills | Brick |
| **Sheep** | Pasture | Wool |
| **Hay** | Fields | Grain, wheat |
| **Rock** | Mountains | Ore |

These are label changes only. A sheep card functions exactly as a wool card. The desert produces nothing.

The standard supply contains:

- 19 cards of each resource: 95 resource cards in total.
- 25 development cards: 14 Knights, 2 Road Building, 2 Year of Plenty, 2 Monopoly, and 5 Victory Point cards.
- For each player: 15 roads, 5 settlements, and 4 cities.
- 19 land hexes: 4 forest, 3 hills, 4 pasture, 4 fields, 3 mountains, and 1 desert.
- 18 number tokens: one each of 2 and 12; two each of 3, 4, 5, 6, 8, 9, 10, and 11.
- Nine ports: four general 3:1 ports and one 2:1 port for each resource.
- Two ordinary six-sided dice, one robber, and the two scoring awards.

Resources returned through spending, discarding, or bank trading become available again. There are no extra cards or pieces beyond these limits in this ruleset.

The land forms five rows of 3, 4, 5, 4, and 3 hexes, surrounded by sea. A **hex** is a terrain tile; an **edge** is one side of a land hex; an **intersection** is a corner of one or more land hexes. Coastal corners and coastal edges are legal building locations. Roads go on edges; buildings go on intersections. One edge can hold only one road, and one intersection can hold only one building, regardless of owner.

## 3. Starting a game

### 3.1 Prepare the supply

Choose three or four players and give each a distinct color and their complete piece supply. Separate the five resource types. Shuffle the development cards into a single hidden deck. Nobody starts with a development card. Set both awards aside with no owner.

### 3.2 Variable island setup

Arrange the six coastal frame sections in a shuffled order, retaining the port locations printed on each section. Randomly fill the island with the 19 land hexes.

Choose an outer corner and follow a counterclockwise spiral through the land hexes, finishing toward the center. Skip the desert without consuming a number token. Place the following sequence on the remaining hexes:

| Token | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Number | 5 | 2 | 6 | 3 | 8 | 10 | 9 | 12 | 11 | 4 | 8 | 10 | 9 | 4 | 5 | 6 | 3 | 11 |

Put the robber on the desert. The desert never receives a number. The standard spiral is the setup procedure; an unrestricted shuffle of all number tokens is not interchangeable with it. Any additional board-balancing algorithm must be a separately labeled option.

Each player rolls both dice to determine the starting player; the highest total starts. Re-roll a tie for highest among the tied players. This starting-player roll produces no resources and does not activate the robber. Turns will proceed clockwise from the starting player.

### 3.3 Place the initial settlements and roads

Setup consists of two passes:

1. In clockwise order from the starting player, each player places one settlement and then one road touching that settlement.
2. Starting with the last player from the first pass, work backward. Each player places their second settlement and one road touching that second settlement.

With four players numbered in turn order, placement order is **1, 2, 3, 4, 4, 3, 2, 1**. With three it is **1, 2, 3, 3, 2, 1**.

Both initial settlements obey the distance rule: no neighboring intersection may already contain anyone's settlement. Your second settlement need not connect to your first settlement or road. Each setup road must touch the settlement you just placed. Setup placements cost no resources. Ports and coastal intersections are valid setup choices. There is no trading or development-card play during setup.

For each land hex touching your **second** settlement, take one matching resource from the bank. The desert contributes no card. A coastal or desert-adjacent second settlement may therefore start with fewer than three resources. You receive nothing from your first settlement.

After setup, each player has two settlements, two roads, two visible points, and the resources from their second settlement. The starting player takes the first normal turn.

### 3.4 Fixed beginner setup

The official base game also provides a fixed beginner board with preselected settlements and roads. It bypasses the placement draft, while retaining the same normal-turn rules. Its terrain, numbers, starting pieces, and starting resources are recorded separately in [the fixed setup reference](SETUP.md). In a three-player beginner game, omit the fourth color and its pieces; keep all 19 terrain hexes. Determine the starting player by rolling.

## 4. Your turn

First check whether you already have enough points to win. Otherwise:

1. You may play one eligible development card before rolling.
2. Roll both dice once. Resolve production, or resolve the complete robber sequence if the total is seven.
3. Take as many legal trade and build actions as you choose, in any order. You may play an eligible development card here if you have not already played one this turn.
4. End your turn when finished. The next player clockwise begins.

You may trade, build, trade again, and build again. You may also do none of these actions. Ordinary trading and paid building cannot occur before the production roll or in the middle of resolving that roll. A development card's effect must finish before another ordinary action begins. Victory can end the game as soon as its condition is met.

During your turn, other players may receive production, fulfill robber discards, lose stolen or monopolized resources, and negotiate or trade with you at the permitted time. They cannot take their own build actions, use their own ports, trade with one another, or play development cards.

## 5. Production and a limited bank

For any roll other than seven, every unblocked hex with that number produces its resource. All players collect simultaneously according to their buildings, even when it is someone else's turn.

- Each adjacent settlement receives one card from that hex.
- Each adjacent city receives two cards from that hex.
- Multiple buildings give separate entitlements.
- A building touching two producing hexes collects from both.
- A hex occupied by the robber produces nothing for anyone.

Production is mandatory. You cannot decline it to keep your hand small. A new building does not collect retroactively from a roll that has already been resolved.

Check the bank independently for each resource type before handing out any of that type:

- If enough cards exist, everyone receives their full entitlement.
- If there are too few cards and two or more players are entitled to that resource, nobody receives that resource from this roll.
- If only one player is entitled to that resource, give that player as many cards as the bank has, up to their entitlement.

For example, if two players together need five sheep but the bank has four, neither collects sheep. Timber production from the same roll still happens normally. If one player alone needs five sheep and the bank has four, that player receives four. Missing production is not owed later.

There is no ordinary maximum hand size. Seven cards is a discard threshold for a particular dice result, not a permanent hand limit.

## 6. Rolling seven and using the robber

### 6.1 Discard first

Seven produces no resources. Every player, including the roller, checks their resource hand. Anyone with **more than seven** resource cards chooses and returns half of those cards, rounded down, to the bank. With 11 resources, discard five and keep six. With seven, discard none. With 17, discard eight once; do not repeat because nine remain.

Development cards do not count and cannot be discarded for this requirement. Players choose their own resource mix. Nobody can trade, build, or play a development card to reduce their hand after the seven has been rolled and before its consequences finish. Complete everyone's required discard before moving the robber.

### 6.2 Move, then steal

The active player must move the robber to a **different land hex**. The destination may be the desert, a hex with no buildings, or a hex next to the active player's own buildings. The robber cannot stay where it is or move to the sea.

Choose one opponent with at least one settlement or city touching the destination hex and take one randomly selected resource from that opponent's hand. If several opponents qualify, choose one. A city or multiple buildings do not increase the theft: it is still at most one resource from one opponent. You cannot steal from yourself. If the chosen opponent has no resource cards, nothing is stolen; if no opponent has a building there, there is no victim. An empty-handed adjacent opponent is still a permissible choice under the official FAQ.

The victim cannot substitute a chosen card for the random theft. Development cards cannot be stolen. Other players do not learn the stolen resource's identity from the theft itself.

The robber remains on its new hex until moved again. It blocks that hex's future production only. It does not remove existing cards, block building, disable a port, prevent resource trading, or stop other hexes of the same terrain or number from producing.

After the sequence, continue your action phase. A Knight moves the robber and steals in the same way, but never causes discards. A Knight and a rolled seven can each move the robber during the same turn.

## 7. Trading

### 7.1 Player-to-player trades

During the active player's action phase, that player may exchange resources with another willing player at any mutually accepted ratio. Offers can request or include multiple resource types. Other players may propose offers and counteroffers, but every completed trade must include the active player.

Only resource cards can be traded. Both sides must give at least one resource immediately, and a resource type cannot appear on both sides of the same trade. You cannot give cards away, exchange three Timber for one Timber, lend cards, pay later, trade buildings or development cards, or pay resources solely for a promise such as avoiding the robber. A trade's contents are public; secret exchanges are not permitted.

Negotiation does not reserve cards. Players may refuse offers. You can discuss future cooperation or bluff about your resources, but promises do not create enforceable future payments. You may trade and then play Monopoly, provided that card is eligible. Non-active players cannot trade with each other, including as one step of an arrangement that later benefits the active player.

### 7.2 Bank trades

On your action phase, you may always return **four matching resources** to the bank for **one different resource** available there. You need no port or coastal building.

With a settlement or city on either marked intersection of a port, you may use that port:

- A **3:1 port** accepts three of any one resource type for one different resource.
- A **2:1 port** accepts two of its depicted resource type for one different resource.

The port's symbol identifies what you pay, not what you must receive. A sheep port exchanges two sheep for one Timber, Clay, Hay, or Rock. Two different resources do not satisfy a matching pair. A city does not improve a port's ratio. Merely reaching a port with a road is insufficient. You cannot directly use somebody else's port.

Each received card requires its own complete matching payment group. You may make multiple exchanges and use different eligible ratios, but cannot combine partial groups of different resources. You can use a newly occupied port immediately during the same action phase. A bank trade cannot take a card that is not available. Returned resources re-enter the bank.

## 8. Building and buying development cards

Return the full cost to the bank for each action:

| Purchase | Timber | Clay | Sheep | Hay | Rock |
| --- | ---: | ---: | ---: | ---: | ---: |
| Road | 1 | 1 | 0 | 0 | 0 |
| Settlement | 1 | 1 | 1 | 1 | 0 |
| City upgrade | 0 | 0 | 0 | 2 | 3 |
| Development card | 0 | 0 | 1 | 1 | 1 |

There is no general limit on the number of purchases during your action phase, provided you have the resources, legal locations, and remaining pieces/cards. Pieces stay where they are placed. You cannot relocate, sell, or demolish them. A city upgrade is the exception that returns a settlement piece to your personal supply.

### 8.1 Roads

A road occupies an empty land edge and must connect at an endpoint to your own building or another of your roads. Connecting through an opponent's settlement or city is forbidden. Roads may branch or form loops; they need not be straight. Coastal edges are legal.

An opponent's building can divide your existing road network. Roads beyond that building remain yours, and you can extend that existing section using normal attachment rules. It need not retain a connection all the way back to one of your buildings. No player can reserve a location by announcing future plans.

You cannot build a sixteenth road. Roads contribute no points except through the Longest Road award.

### 8.2 Settlements

A settlement must occupy an empty intersection adjacent to at least one of your roads. The setup draft is the only exception to this road requirement.

**Distance rule:** every intersection directly connected to the chosen intersection by one edge must be free of all settlements and cities, including your own. There must be at least two edges between any two buildings. You may build along the middle of your road, at a branch, on a port, or beside a disconnected section you still own, as long as these conditions hold.

You must have a settlement piece available. If all five are in use, upgrade one to a city before placing another. You cannot skip the need for an available settlement piece by paying for a settlement and city together.

### 8.3 Cities

A city replaces one of your settlements at that exact intersection. Pay the upgrade cost, return the settlement piece to your supply, and place an available city there. The returned settlement can be built elsewhere later by paying its normal cost and following normal placement rules.

You may upgrade before using all five settlements. You cannot build directly on an empty intersection or upgrade an opponent's building. You have at most four cities. A city scores two points total and collects two resources per producing adjacent hex; it does not collect both settlement and city production.

### 8.4 Development-card purchases

Pay the development-card cost and privately draw the top card of the shuffled deck. You do not choose its type. You may buy multiple cards if you can afford them and cards remain. Spent development cards never return to the deck. Once it is empty, purchases stop.

## 9. Playing development cards

Keep unplayed development-card identities secret. They cannot be traded, given away, stolen, or used to pay costs or discards.

You may play at most **one non-Victory-Point development card per turn**, either before rolling or during your action phase. A card bought this turn cannot be played this turn. If you already owned one copy and buy another of the same type, the old copy is still eligible. Track the purchase turn of each card.

A card is revealed when played. Resolve its effect completely. Played Knights remain visible for army scoring; played progress cards remain out of circulation. Playing a card before rolling uses the same one-card allowance as playing after rolling.

### Knight — 14 cards

Move the robber to a different land hex and resolve the theft described in section 6.2. This is mandatory even if you would prefer its current location. Nobody discards because of a Knight. You may play it even when the robber is not blocking you. The revealed Knight permanently counts toward your played-knight total.

### Road Building — 2 cards

Place two roads without paying resources. Each placement follows normal road rules and consumes a road from your remaining supply. Place them one at a time; the second may extend the first or go elsewhere legally. Recalculate Longest Road and victory after each placement.

If only one road piece remains in your supply, you may play the card and place that road. You cannot exceed your piece supply or use the card to place a settlement. There is no trade or paid build between the two free placements. The playtest provisionally requires a legal first road and places a second whenever a legal site and piece remain; otherwise the effect ends after one. Zero-road play and voluntarily forgoing a legal road remain source questions in the ledger.

### Year of Plenty — 2 cards

Choose two available resource cards from the bank and add them to your hand. You may choose two of the same type or one each of two types. This is the effect called **Invention** in the sixth edition. Complete the selection before spending either card; you cannot use the first choice to build and then decide the second. The bank cannot provide cards it does not have. The playtest provisionally takes the one remaining card if only one exists, and rejects use against an empty bank. This extreme-case interpretation remains tracked in the source ledger.

### Monopoly — 2 cards

Name exactly one resource type. Every opponent must give you every resource card they hold of that type. You keep your own cards of that type. The bank is unaffected. Opponents cannot hide a matching card, refuse, or interrupt the effect by trading or spending it. The transfer may be zero. You cannot demand to inspect the rest of an opponent's hand.

### Victory Point — 5 cards

Each is worth one point while hidden. Reveal your Victory Point cards when they demonstrate that you have won on your own turn. You may reveal several at once, including cards bought this turn, even if you already played a different development card this turn. They are exempt from both the purchase-turn restriction and the one-card-per-turn play limit when declaring victory. Otherwise keep them hidden.

## 10. Longest Road

The first player with a continuous route of at least five of their own roads takes the award and its two points. Another player takes it only by having a strictly longer qualifying route. A tie leaves the award with its current qualifying holder.

Measure a player's longest single continuous traversal of their roads:

- Each road segment can be counted at most once in that traversal.
- You may turn, and a loop can count. A complete six-edge ring can count as six.
- Do not add separate branches together if they cannot be traversed continuously without reusing an edge.
- Your own buildings do not interrupt the route.
- An opponent's settlement or city blocks passage through that intersection. A route can end there.
- Unconnected sections are measured separately; take the longest valid traversal.

Recalculate whenever a road is added or a settlement changes connectivity. If the current holder's route is interrupted, apply these rules to the resulting lengths:

1. If the holder still has at least five and is tied for, or alone in, the greatest length, the holder keeps it.
2. Otherwise, if one player alone has the greatest length and it is at least five, that player receives it.
3. Otherwise the award has no owner. It remains unowned until one player alone has a qualifying longest route.

For example, if the holder drops from eight to four and two opponents each have six, neither receives the award yet. If the holder drops to six and an opponent also has six, the holder keeps it. Losing the award subtracts two points immediately.

## 11. Largest Army

The first player to have played three Knights takes the award and two points. It transfers when another player has played strictly more Knights than the holder. Equal totals do not transfer it. Unplayed Knights do not count. Used Knights remain counted and are not spent when the robber moves again.

## 12. Information at the table

The board, turn, dice, public actions, public trade contents, award holders, and played development cards are observable. A player's number of resource cards must be disclosed truthfully; resource identities stay private. Unplayed development-card identities stay private, including hidden points. Catanova will show the count of held development cards, never identify which are points or eligible card types to opponents.

Keep your resource faces hidden, including when someone is choosing a robber victim. A player cannot voluntarily show their hand to prove that robbing them is unattractive. Players may talk and negotiate at any time, but talking does not authorize an action outside its legal phase. Publicly obtained information can be remembered; the client must not reveal additional hidden state.

The bank's precise remaining stacks may be counted to resolve a possible production shortage immediately after a roll. The standard interface should not add an always-visible bank-count tracker as though it were a base-game entitlement.

## 13. What is not a base-game rule

This ruleset does not add a friendly robber, an opening grace period without sevens, extra resources, forced balanced dice, resource hand caps, undo after revealed information, automatic forfeits, turn timers, special building phases, or two-player rules. All may be considered as explicit options or separate rulesets later.

Network loss is also not a game action. It must not change a dice result, reroll a theft, remove a building, discard a hand, or transfer a seat. [Online behavior](ARCHITECTURE.md) is specified separately so recovery does not change the board-game rules.

## 14. Completeness and corrections

This draft covers the complete ordinary base-game flow and the applicable published edge cases recorded in the [coverage ledger](RULE_SOURCES.md). It is not yet a certified 1:1 rules engine. A few uncommon situations are not settled by the reviewed sources; they are listed openly rather than filled with an unmarked house rule. Resolve those entries and add executable scenarios before declaring full conformance.

To report a rules issue, identify the section, describe the exact game state, and link the official rule or clarification. Changes that alter legal moves or hidden information require a new ruleset version; wording-only corrections do not.
