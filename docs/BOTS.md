# Bot players

A host can fill an empty seat with a bot from the lobby. Bots follow the same
rules, take the same turns and appear in the roster and move history like any
other player. They exist so a room of two can play a game of four, and so a
table does not need a fourth friend awake.

## What thinks, and what counts

Bots think with their own engine, in `packages/bot/src/brain/`. It does what the
research on Catan programs found the strong ones do (see
[Catan AI research](BOT-RESEARCH.md) and
[The strongest bot we can build](BOT-ENGINE-PLAN.md)):

- **The race to ten points** (`race.ts`). From what each player produces per
  roll and the harbours they own, how many rolls until each purchase is
  affordable, and how many until ten points if they buy the cheapest points
  first. Races become a chance of winning for every player, and that chance is
  the one currency every decision is priced in. Three accounting rules keep it
  honest, each learnt from a bot that hoarded cards in a real game: a bank
  trade only half-counts until it is a whole trade; cards traded away to buy
  something are gone, so the same sheep never pay for two purchases; and the
  part of the race estimated in bulk never costs less per point than the part
  planned step by step. With those, building an affordable city or settlement
  never scores below waiting, which a check over self-play positions confirms,
  except where the same cards buy something better (longest road, say).
  The race also prices expansion properly. A corner is worth what the rest of
  the race costs with the income mix it brings, so the clay the bot lacks beats
  more of the timber it has. A harbour corner is weighed, and owning it changes
  the rates for the rest of the race. The race also checks, at every step,
  whether one purchase would finish the game (an award is two points), since a
  greedy plan can overshoot. Together these won 111 of 198 self-play games
  against the version without them, with a tenth more settlements.
- **Card counting** (`belief.ts`, `facts.ts`, `watch.ts`). The driver replays
  every move from the journal to each bot, state by state. Everything public
  (income, building, trades, discards, Monopoly, Year of Plenty) is counted
  exactly; a steal the bot was not part of splits an opponent's hand into a few
  possibilities, and spending narrows them again. Development cards are counted
  by kind as they are played, so the chance an opponent holds hidden points
  follows from the cards nobody has seen.
- **Search** (`search.ts`). Whole turns are tried on imagined copies of the game
  played by the real rules (`simulateAction`, which shares the board instead of
  copying it). The bot scores where each sequence of trades, purchases and
  cards leaves it at the end of the turn and plays the first move of the best,
  then thinks again. A development card is averaged over every card it could
  be; a steal over every card the victim could be holding.
- **The opening** (`opening.ts`). For each strong corner, the rest of the
  placement round is played out several times, with the others choosing the
  way people do, and each finished opening is scored by the race. A start with
  no timber, clay or hay is marked down hard: in a real game a bot on two rock
  corners built its first road on turn 57.
- **Trading** (`trade.ts`). Selfish: see below.

Robber, discards, knights, Monopoly, Year of Plenty and Road Building are all
chosen by the same search, not by fixed rules. A knight goes before the dice
when the robber sits on the bot's own production or when it takes largest army.
While nobody is clearly ahead, the robber does not hit the same person twice in
a row. In self-play it robs a leader on points four times in five and never
touches its own tiles.

The race counts a tile under the robber as only a quarter lost: the robber
moves on at the next seven or knight, a few rolls away, while a race runs for
dozens. Counted as lost for good, every robber move swung the race, and the
race was more confident about who would win than the results bore out; fitted
to who won a hundred self-play games, a quarter is about right. In self-play it won 113 of 198 games against the same bot counting the tile as lost for good.

### Trading

A bot never offers a trade and never haggles. It only answers the offers people
make it, yes or no, for its own reasons and nobody else's. Each offer is priced
for both sides in chance of winning, plus a little for every roll it takes off a
race.

- **An offer for its cards:** it accepts only when the trade helps it more than
  it helps the other player, and never trades with anyone within three points of
  winning. At a table of three or more it also refuses whoever is clearly
  leading.
- **Cards for anything** (an open offer, which asks for a proposal): it
  declines.

It used to make offers of its own. Players found them bad trades and nagging,
however carefully they were priced, so every level has them switched off. The
code for making and managing offers is still in `trade.ts`, behind the `offers`,
`open` and `counter` switches in `decide.ts`.

Bots answer offers after a pause of their own (one and a half to four seconds),
and answering is never owed: a person can take an offer first.

### Reactions

A bot reacts only to moments worth a face: it gloats now and then when it robs
someone or plays a big Monopoly, laughs at a big discard, smirks when it takes
an award off you, rages at someone who keeps robbing it, and celebrates a win.
Never for routine play: at least forty-five seconds apart, eight a game at
most, one face at a time, one bot at a table. An earlier version reacted every
few turns, and players found it cringe. Reactions go through the same rate
limit as a player's, and a bot still never chats.

### Jev, as an advisor

Jev is asked only when the engine's own numbers leave a choice open and it
matters:

- **the long game**, after the opening and every four turns, when two plans
  (cities, expansion, development, road) race to ten points within a tenth of
  each other; the chosen plan then leans the race;
- **a close trade with a person**, when the engine finds it good but only just,
  or good for both;
- **the robber**, when two placements score almost the same and hit different
  people: who is the real threat?

There is no quota: a game where nothing is close asks nothing. Jev sees the
engine's shortlist with its numbers, the public table and what the bot has
learnt about a trading partner, with players only as "me" and "opponent 1" to
"opponent 3". Its answer shifts a close choice and never overrides a clear one.
If the service is slow or down, the engine's own answer stands.

### Levels

The three levels are the same engine held back:

|                          | Steady | Sharp | Champion |
| ------------------------ | ------ | ----- | -------- |
| Positions scored a move  | 350    | 900   | 2,000    |
| Turn search depth        | 2      | 3     | 4        |
| Opening rehearsals       | 2 × 6  | 4 × 10 | 8 × 14  |
| Makes trade offers       | no     | yes   | yes      |
| Asks Jev                 | no     | yes   | yes      |
| Settles for a good move  | often  | now and then | never |

All three count cards and answer trades.

## Configuration

Bots work with no configuration: without a key the engine decides everything
alone, which is also what happens whenever the decision service is slow or
unreachable. A bot never stalls a table.

When a request fails — a timeout, an error status, or a reply that is not a
well-formed answer to every question asked — the engine's own answer stands.
After
three failures in a row the client stops asking for a minute, so a service that
hangs costs one eight-second timeout per minute across the whole server rather
than one per decision; then a single request goes out to see whether it is
back, and a success opens it up again. In a local simulation of 100 four-bot
games against a service that timed out every request, every game finished
within 600 turns and a game made about 8 requests.

To let them think, set a TypeSafe API key in the server environment:

```sh
TYPESAFE_API_KEY=...           # https://console.typesafe.ai/settings/keys
CATANOVA_BOT_MODEL=jev-1.13.0  # optional: pin a build; the -latest alias moves
```

Requests go straight to `api.typesafe.ai/v1/systemone`. Gateways resell the same
model, but there is deliberately no fallback to one: a direct account is the one
that holds the credits, and a silent switch to a different biller is worse than
a bot playing from its heuristics for a few turns.

TypeSafe bills input tokens only and does not return a cost, so cost is computed
from the token count at the published rate of $0.042 per million.

Keys stay on the server. The browser never sees one, and the bot package is
never bundled into the client.

Usernames stay on the server too. The service is told about players only as
"me" and "opponent 1" to "opponent 3", in seat order, with their points, card
counts, knights and buildings: no decision depends on what anybody is called.

On the production VM, add `TYPESAFE_API_KEY` to `/etc/catanova/production.env`
using `sudoedit`, then recreate the `game` service with that env file and
`deploy/single-vm/compose.yaml`. A plain container restart does not reload env
values. Never commit the key or put it in a client-side environment variable.

## Who sits down

There are three of them, and the host does not choose. Filling a seat draws one
on the server. Since 1 October 2026 the draw always gives a champion: steady
and sharp are disabled rather than removed (their odds in
`packages/protocol/src/bots.ts` are zero), so a bot already seated at one keeps
playing it, and setting the odds back brings them back. Each level is marked by
its own machine beside its name; the seat itself says only "bot".

How each one plays is under [Levels](#levels).

### Covering a seat somebody left

A dropped connection used to end a game: three minutes of grace, then the absent
player resigned, and on a two-player table the person still connected won a game
nobody had played. That ruined the match for everyone left at it, and it was the
most common way a game ended badly.

Now a seat that has been empty for thirty seconds is picked up by a bot. The
player keeps their pieces, their hand, their cards and their place in the order:
nothing is transferred and nothing is surrendered. The moment they reconnect the
seat is theirs again, inside the same transaction that records their return, so
there is never a window where both the person and the bot believe the seat is
theirs. Both halves of the handover go into the match's log, because a game
somebody won while a bot played four of their turns should say so afterwards.

Resignation still exists, and still ends a game — it is just what it says it is.
Leaving is a resignation. Being removed by the host is a resignation. A table
that nobody at all is sitting at still pauses, and is filed as abandoned once
the long grace runs out; a bot is never left playing to an empty room.

Before its first move, a stand-in reads how the player was playing: what they
had built, how long their road was, how many knights they had played, which
harbours their corners touched. The code counts those; the model is asked one
question, with five answers, about which style that record fits, and whether
they were playing against whoever was in front. That answer biases the seat's
plan for the rest of the absence, so the stand-in finishes the game it inherited
rather than starting a different one in somebody else's chair. It costs one
decision per handover, not one per turn, and if the service is unreachable the
same question is answered from the same numbers and the answer is marked as a
guess.

### It is not cheating

Every bot is handed the same filtered view of the game the browser is handed:
`gameView(game, seatId)`. No opponent's hand, no peeking at the development
deck, no adjusted dice, and no shared plans between bots at the same table. A
stand-in is the same: it holds the seat's own cards because it _is_ that seat
for the moment, and the record it is profiled from — pieces, road length,
knights played, harbours — is what every other player at the table can see.

Card counting is held to the same line. The bot's memory is fed only public
facts: `brain/facts.ts` compares two consecutive states and keeps what every
player saw, so a steal the bot was not part of reads as "a card moved", never
as which card (`tests/bot-brain.test.ts` checks exactly that). Its imagined
games draw every hidden card from that counting. In a room with balanced dice
it also counts the dice deck from the public rolls (`brain/dice.ts`), as a
player with a notepad could: which of the 36 pairs are left before the refill,
and so how likely a seven is before its next turn. It never reads the server's
deck; a test checks that the count from public rolls matches it exactly. A
champion that beats you beat you with what was on the table, remembered better
than most people remember it.

## How a bot behaves at the table

A bot is marked with a small machine beside its name, in the lobby and on its
portrait during play, so nobody wonders why a seat never chats — and the machine
says which of the three it is.

It also pauses before every move. Without that it answered the instant the rules
allowed, which is the single thing that made it read as software rather than an
opponent. The pause is matched to the decision: under a second to roll, a beat
or two to build, longest over the opening placement, which is the longest
decision in a real game too. Occasionally it takes noticeably longer, the way a
distracted player does. Time already spent deciding counts towards the pause, so
a slow model call is absorbed rather than added on top, and a bot never bursts
several moves out at once.

## Operational notes

- Bots think in a worker thread (`apps/server/src/bot-worker.ts`, driven by
  `bot-thinker.ts`). A Champion scores up to two thousand positions a move,
  most of a second on the production machine; on the main thread that would
  hold every room's sockets. The worker has its own decision service client.
  Card counting stays on the main thread, which watches every move; a decision
  made in the worker brings back only what it decides (the long plan, offers
  made, whom it robbed), so a move made while it was thinking is never lost. A
  worker that dies is replaced on the next request, and one that takes over
  twenty seconds is abandoned like any failed decision. Tests and tools think
  inline.

- A bot seat has no socket and is treated as permanently present, so it is never
  marked disconnected and never resigned for absence.
- A room whose only present seats are bots is **paused**. Bots do not play a
  game out when nobody is watching.
- Each bot action carries a command id derived from the room, seat and revision,
  so a retry after a crash replays as a duplicate rather than moving twice.
- Bot moves appear in the move history as ordinary moves. Only the turn clock
  marks history as automatic.
- Removing a bot uses the existing host kick control; there is no separate
  command for it.
- If a bot cannot move — its decision throws, or the rules refuse the move it
  chose — the room is retried after a second, then two, then four, doubling up
  to a minute, never on every tick. After three failed attempts at the same
  position the bot makes the move the turn clock would: roll, end the turn,
  discard what it must, move the robber or place a free road, and in the
  opening, which has no clock, the most productive corner and a road beside
  it. That move goes through the same commit path as any other, so a table
  never waits on a bot for good, even with the turn timer off.
- A finished game or a paused table is recognised before any other work for
  it, so a room that owes nothing costs a read or two per tick and never a
  decision.

## Playing a game without a server

```sh
npx tsx scripts/bot-game.ts --games 3          # three bots, with the model
npx tsx scripts/bot-game.ts --offline          # the engine alone, no Jev
npx tsx scripts/bot-game.ts --seats 4 --quiet  # totals only
```

This runs the rules engine and the decision layer directly, with no server and
no sockets. It prints each bot's plan as the game goes and reports calls,
tokens, cost and wall clock at the end.

### Measuring a change

The brain's hand-set numbers live in `packages/bot/src/brain/tuning.ts`, and a
change is kept only when it measures better:

```sh
npx tsx scripts/bot-lab.ts duel --a '{"robberBlock":0.25}' --b '{}' --games 11 --offset 0
npx tsx scripts/bot-lab.ts record --games 40 --out positions.json
npx tsx scripts/bot-lab.ts calibrate --files positions.json --variants '{"robber":{"robberBlock":0.25}}'
```

`duel` plays Champions with one tuning against Champions with another, every
board twice with the sides swapped and the same dice in both games, and prints
the paired result. A few points of difference needs a few hundred games, so run
several with different offsets side by side. `record` and `calibrate` measure
how well the race predicts who wins self-play games, which is quicker than a
duel for anything that changes the race. A better prediction is not a better
player, though: counting a player's open corners predicted winners on games it
was not fitted on, and lost a duel 13 to 24. A duel decides.

## Known limits

- **Measured against other bots, not yet against people.** In four-player games
  on our own rules, one new Champion against three of the previous Champions
  won 40 of 64 (a fair share is 16). Results against people will be read from
  production games.
- Card counting starts when the driver first sees a room. After a server
  restart mid-game it counts from the public card counts until the hands
  settle again.
- Bots play Classic only, as decided for the modes.
- A bot's memory (plans, counting, what it has learnt about the table) lives in
  server memory. A restart loses it, and costs a few turns of sharper play.
