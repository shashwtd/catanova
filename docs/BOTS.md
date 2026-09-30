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
  the one currency every decision is priced in.
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
  way people do, and each finished opening is scored by the race.
- **Trading** (`trade.ts`). Selfish: see below.

Robber, discards, knights, Monopoly, Year of Plenty and Road Building are all
chosen by the same search, not by fixed rules. A knight goes before the dice
when the robber sits on the bot's own production or when it takes largest army.
While nobody is clearly ahead, the robber does not hit the same person twice in
a row.

### Trading

A bot trades for its own reasons and nobody else's. Every trade is priced for
both sides in chance of winning, plus a little for every roll it takes off a
race.

- **Answering an offer:** it accepts only when the trade helps it more than it
  helps the other player, and never trades with anyone within three points of
  winning. At a table of three or more it also refuses whoever is clearly
  leading.
- **Offered cards for anything** (an open offer): it proposes the least it can
  give that still moves the other player's own race forward, never a resource
  they are giving, and never the cards its next purchase needs.
- **Making offers:** only when a card or two stands between it and a purchase,
  priced against the best it could do this turn with the bank and harbours;
  only to players the counting says probably hold the card and who would see
  the trade as progress; at most two a turn, never the same refused offer twice
  in a turn, and less often at a table that keeps turning it down. With a pile
  of one resource it cannot use and several it could, it may open the pile to
  proposals instead.
- **Its own offer on the table:** it takes the answer best for itself, waits up
  to nine seconds for more, and withdraws if none is good.

Bots answer offers after a pause of their own (one and a half to four seconds),
and answering is never owed: a person can take an offer first.

### Reactions

Games are long and the end screen is brief, so a bot's personality lives in the
middle of the game, and it is a little toxic, the way friends at a table are.
It gloats or laughs when it robs you, laughs when a seven eats your hand, plays
an evil face when it rolls the seven itself, smirks when it takes an award off
you, rolls its eyes or honks a clown when an offer is turned down, begs now and
then when it makes one, and cackles over a big Monopoly. When it is the one
hurt, it rages, sulks or eyes you suspiciously, and a player who robs it twice
gets double rage. A win is a burst of two or three faces.

It stays a player, not a slot machine: at least twelve seconds between
reactions, twenty-four a game at most, only the moment that matters most to it
in any stretch of play, and only one bot at a table. In simulated four-player
games that came to about eleven faces a game, one every four turns or so.
Reactions go through the same rate limit as a player's. A bot still never
chats: a talkative bot reads as a threat.

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
| Makes trade offers       | no     | yes   | yes, and open offers |
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
on the server — steady and sharp two in five each, a champion one in five — so
you find out who you have by playing them, the same way you would with a
stranger. Each is marked by its own machine beside its name; the seat itself
says only "bot", because naming the difficulty would give away a game nobody
has played yet.

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
games draw every hidden card from that counting, and in a room with balanced
dice it knows nothing of the dice deck. A champion that beats you beat you with
what was on the table, remembered better than most people remember it.

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

## Known limits

- **Measured against other bots, not yet against people.** In four-player games
  on our own rules, one new Champion against three of the previous Champions
  won 40 of 64 (a fair share is 16). Results against people will be read from
  production games.
- Card counting starts when the driver first sees a room. After a server
  restart mid-game it counts from the public card counts until the hands
  settle again.
- Bots play Classic only, as decided for the modes.
- Thinking runs on the server's main thread: a Champion's move holds it for up
  to about a third of a second, bounded by the positions it may score and by a
  time cap. Moving the engine to a worker thread is the next step if bot games
  become a large share of the load.
- A bot's memory (plans, counting, what it has learnt about the table) lives in
  server memory. A restart loses it, and costs a few turns of sharper play.
