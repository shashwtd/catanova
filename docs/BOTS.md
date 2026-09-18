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

## Configuration

Bots work with no configuration: without a key they play from their
deterministic fallbacks, which is also what happens whenever the decision
service is slow or unreachable. A bot never stalls a table.

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

On the production VM, add `TYPESAFE_API_KEY` to `/etc/catanova/production.env`
using `sudoedit`, then recreate the `game` service with that env file and
`deploy/single-vm/compose.yaml`. A plain container restart does not reload env
values. Never commit the key or put it in a client-side environment variable.

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
- **Games between bots often do not finish.** In the measured set only one of
  four reached ten points inside a 400-turn cap; the others stalled around seven
  to nine points each. A human game takes 60 to 80 turns. The cause is that
  bots convert resources far too slowly: with no player trading and only 4:1
  bank rates, a board that blocks expansion leaves everyone hoarding. This is
  the first thing to fix, and it matters more than any tuning of the questions.
- Bots are therefore good opponents for filling a seat in a game with people in
  it, and not yet good at playing each other.
- Knight play is simple: a knight is played when it is the best available move,
  not as part of a plan to take largest army.
- A bot's plan lives in server memory. A restart costs one turn of re-planning
  and nothing else.
