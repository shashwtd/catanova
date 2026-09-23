# Bot players

A host can fill an empty seat with a bot from the lobby. Bots follow the same
rules, take the same turns and appear in the roster and move history like any
other player. They exist so a room of two can play a game of four, and so a
table does not need a fourth friend awake.

## What thinks, and what counts

Bots decide with **Jev**, a model from TypeSafe AI that does not write text. It
takes a state and a set of typed questions and returns a chosen option with a
probability distribution over the alternatives. Every option it is ever offered
was enumerated first by `packages/rules`, so a bot cannot invent a move: the
worst it can do is prefer a legal move you would not have picked.

Anything that can be counted is counted in code, in `packages/bot/heuristics.ts`:
production pips per corner, what a hand can afford, the distance from a road to
a target corner, who is winning, which tile the robber hurts most, what to throw
away on a seven, and whether a bank trade is available and in stock. A decision
model is poor at arithmetic and this is all arithmetic.

What is left is judgement, and only that is asked: which of these good corners
is best, what should we be saving for, is the field worth blocking, which
development card to play.

## The plan

Jev answers one request at a time and nothing carries between them, so a bot
that only ever asked "what now?" would restart its thinking every turn. Each bot
therefore keeps a small typed plan in `packages/bot/plan.ts`: an archetype, what
it is saving for, the corner it is building toward, what it still needs, and
what it is worried about.

The plan is not free text, because Jev cannot write a sentence. Every field is
either an option the model picked from a fixed set or a number derived from the
board, and the line a player reads is rendered from those fields by code. That
means the explanation can never disagree with the plan it describes.

A plan is rewritten only when it goes stale: the target corner was taken, the
threat changed, or four turns have passed. When it is rewritten, its questions
ride along in the request the turn was going to make anyway, so planning ahead
costs no extra round trip. One thing is corrected without asking: a plan that
can no longer happen, such as saving for a settlement on a board with no legal
corner left, is redirected in code. That was the main way early games stalled.

## What a game costs

Measured over four three-bot games on `typesafe/jev-1.13-20260917`, played end
to end through `scripts/bot-game.ts`:

|                           | per game    |
| ------------------------- | ----------- |
| Turns                     | 358         |
| Decisions                 | 976         |
| Settled without the model | 67%         |
| Model requests            | 320         |
| Input tokens              | 314,294     |
| Cost                      | $0.0132     |
| Wall clock                | 136 seconds |

Two thirds of all decisions never reach the model, because most Catan turns have
nothing to decide: no resources, nothing affordable, one legal road. Of the
requests that are made, the opening placement is the most expensive at roughly
3,000 tokens, since it weighs every legal corner with its own production facts.
A normal turn is closer to 1,000.

A game that finishes quickly is much cheaper than the average: the one game in
that set that ended on turn 107 cost $0.0053 and 118 requests. The average is
carried by long games, which is the limitation described at the end of this
page.

Output tokens are free on this model, so cost tracks input alone.

Taking over a seat costs one request on top of that, once, whatever happens
afterwards: reading how the absent player was playing is 714 input tokens, about
$0.00003, measured against `jev-latest`. It is charged per handover, not per
turn, and a player who reconnects and drops again is read again.

## Configuration

Bots work with no configuration: without a key they play from their
deterministic fallbacks, which is also what happens whenever the decision
service is slow or unreachable. A bot never stalls a table.

When a request fails — a timeout, an error status, or a reply that is not a
well-formed answer to every question asked — the bot answers that same decision
exactly as a bot with no key would, and the move is counted as degraded. After
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

They differ only in how much attention they pay to the rest of the table. All of
it is arithmetic in `contests()` in `packages/bot/decide.ts`, so the differences
hold even with no decision service reachable.

|                                                                      | Steady                                           | Sharp                                                 | Champion                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| Robber tile                                                          | wherever the most production is, whoever owns it | the leader's tiles count double                       | the leader's tiles count double                          |
| Robbed player                                                        | whoever is on the tile                           | the leader, when they are on it                       | the leader, when they are on it                          |
| Counts as a threat                                                   | a leader one point from winning                  | a leader three points out, or an award held elsewhere | a leader **four** points out, or an award held elsewhere |
| Rethinks its plan                                                    | every four turns                                 | every four turns                                      | every **two** turns                                      |
| Options weighed each move                                            | 12 corners, 8 roads                              | 12 corners, 8 roads                                   | **16 corners, 12 roads**                                 |
| Will end a turn it could spend                                       | yes                                              | yes                                                   | **no, while anything useful is affordable**              |
| Knows the award standings                                            | no                                               | no                                                    | **yes**                                                  |
| Spends a knight before the dice to clear the robber off its own land | no                                               | no                                                    | **yes**                                                  |

A steady bot plays its own game and you mostly notice it when it takes a corner
you wanted. A sharp bot follows you round the board once you start to lead. A
champion plays to win: it is told where longest road and largest army stand and
how many points it still needs, it rethinks its plan twice as often — which is
what lets it answer a road being cut off by going after something else rather
than pushing at the block — and it never sits on resources it could spend.

### Development cards

Every bot is told which cards it is holding and what each one does. It was not,
which is why they so rarely played any: they were being asked whether to play a
development card without being shown the hand. With no decision service to ask,
a bot now plays a card rather than ending the turn on one — knights first, since
a knight is never wasted and counts toward largest army — because a card still
in hand when the game ends was worth nothing.

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
knights played, harbours — is what every other player at the table can see. A
champion's advantage is entirely in what it does with public information — the
standings already on the portraits, the numbers already on the board, and the
length of its own shortlist. A champion that beats you beat you with what was on
the table.

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
npx tsx scripts/bot-game.ts --offline          # fallbacks only
npx tsx scripts/bot-game.ts --seats 4 --quiet  # totals only
```

This runs the rules engine and the decision layer directly, with no server and
no sockets. It prints each bot's plan as the game goes and reports calls,
tokens, cost and wall clock at the end, which is where the figures above come
from.

## Known limits

- Bots do not trade with players, only with the bank and harbours. Player
  trading is the single biggest gap in their play.
- **Games between bots with the model were slow to finish.** In the measured
  set only one of four reached ten points inside a 400-turn cap; the others
  stalled around seven to nine points each. A human game takes 60 to 80 turns.
  The cause was that bots converted resources far too slowly. Part of it has
  since been found and fixed: what a bot was short of was only worked out when
  the model answered, so without it a bot never traded at all, and a seven
  threw away the rock and hay it was saving. In 200 simulated four-bot games
  without the model, bots now trade with the bank or a harbour about 27 times
  a game, every game finishes, and the median game is 122 turns (it was 196,
  with 4 of 200 unfinished at 1,000 turns). The set with the model has not
  been measured again since.
- Bots are therefore good opponents for filling a seat in a game with people in
  it, and still slower than people at playing each other.
- Knight play is simple: a knight is played when it is the best available move,
  not as part of a plan to take largest army.
- A bot's plan lives in server memory. A restart costs one turn of re-planning
  and nothing else.
