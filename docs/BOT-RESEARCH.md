# Catan AI research

What every notable Catan program does, how strong it really is, and what made
the strong ones strong. Written on 1 October 2026 as the research behind
[The strongest bot we can build](BOT-ENGINE-PLAN.md). A second round the same
day covered research frameworks, newer work, commercial bots and hard numbers
about the game; see [Second round](#second-round-frameworks-new-work-and-numbers).

Figures come from the primary source (paper, thesis, code or the author's own
post) unless marked _second-hand_, which means another source reports them and
the original could not be opened. Where no source gives a number, none is given.
Win rates always come with their setup: in a four-player game where one bot
plays three others, a fair share is 25%; head to head it is 50%.

## The short answer

1. **No Catan program has been shown to beat strong people.** The best
   evidence with people is JSettlers (a lone human against three bots still won
   about half of 4,000 online games) and a small study where experienced players
   won 18% of 11 games against the Edinburgh bot. A bot built on Catanatron,
   played in ranked games on Colonist, won 12.5 to 15% of 40 games and stalled
   around a rating of 1,200 while the top player sat near 2,000. Every author
   who played their own bot says a good player beats it.
2. **The strongest bot-against-bot results are search on top of good Catan
   knowledge.** Edinburgh's search agents win 53 to 54% against three copies of
   their strong rules-based bot. A search bot that also looks for trades won 58%
   against three JSettlers bots.
3. **The best evaluation is a race to ten points.** JSettlers estimates how many
   turns each purchase takes with the dice income and harbours a player has,
   then how many turns to win. A move is worth how much it shortens your race
   plus how much it lengthens everyone else's.
4. **The opening is the largest single lever that has been measured.** Better
   placement alone moved an otherwise identical bot from 15% to 28%. Top human
   players put placement at 20 to 50% of the result.
5. **Trading cuts both ways.** Among bots, one that never trades wins about 13%
   against three that do. Against people, JSettlers' first trading logic cost it
   about 4 points, and search bots that offered without limit annoyed people and
   won less. A bot that trades at random almost never wins.
6. **Counting cards removes nearly all the hidden information.** A bot allowed
   to see every hand did no better than one that counted (24.4% against 25%).
   When a hand was uncertain there were three possibilities at the median.
7. **Learning from scratch has not produced a strong full-game player.** The
   largest attempt ran a month on a 32-core machine and a high-end GPU and was,
   by its author's account, well short of a good player. Every learning result
   that improved did so by adding search.
8. **Language models are weak move-by-move players and useful offline.** Per-turn
   agents averaged about four points in games against Catanatron's AlphaBeta. A
   system in which the model writes and refines bot code instead reached 54%
   against it. Persuasive chat from a bot made people gang up on it.
9. **Commercial bots publish nothing measurable.** The Xbox Live Arcade game
   (2007) is the best regarded: its AI came from Klaus Teuber's own tactics, had
   personalities, and on hard only traded for an advantage.

## Has any bot beaten strong people?

No. What has actually been measured:

| Study                   | Opponents                     | Games           | Result                                        |
| ----------------------- | ----------------------------- | --------------- | --------------------------------------------- |
| JSettlers (2003)        | Online players of mixed skill | 4,000, 1 v 3    | The human won 44–51%; parity is 25%           |
| Edinburgh (2017)        | Experienced volunteers        | 11 for best bot | The humans won 18.2%                          |
| Catanatron-based (2025) | Colonist ranked, four players | 40              | The bot won 12.5–15%, rating about 1,200      |
| SmartSettlers (2009)    | Its author                    | informal        | He could beat it consistently (_second-hand_) |
| Charlesworth (2022)     | Its author                    | informal        | Not close to a good player, in his words      |
| Catanatron              | Its author's judgement        | —               | About the strength of a casual player         |

The honest state of the art for four-player Catan with trading is a bot about
as good as an average online player. Nothing published is better against
people.

## The programs

### JSettlers (Robert Thomas, 2003)

The classic Catan bot, from a PhD thesis at Northwestern, still maintained as
open source (GPL-3.0). Thomas aimed for a believable, cheap opponent rather
than maximum strength.

**How it estimates.** For each resource it works out how many rolls it takes
to receive one, from the dice numbers the player touches. It then simulates
income roll by roll, converting surplus through the best harbour or the bank,
until a purchase is covered: that is the estimated time to build a road,
settlement, city or card. A more accurate version runs the real dice
probabilities and takes the median. The estimated time to win strings these
together: repeatedly buy the cheapest two points (two cities, a city and a
settlement, or two settlements; longest road and largest army once past five
points) until ten.

**How it chooses.** The "fast" strategy compares the speedup from the best city
and the best settlement (with its roads). The "smart" strategy scores every
build by how much it cuts the bot's own time to win plus how much it raises each
opponent's, weighted one to one (Thomas found more or less aggression worse),
and discounts builds that take longer at 13% per turn. Development cards are
valued by the chance of a knight or a point. Decisions took about 7 ms on 2003
hardware.

**Trading.** It offers one unneeded card for one needed, then one for one, then
two for one, and only if the offer beats what the bank or a harbour would give,
someone probably holds the card, and the partner is neither close to winning
nor racing for the same corner. It refuses offers from players close to winning
and embargoes anyone on 8 points.

**Other rules.** The robber targets whoever is closest to winning. Discards keep
what the plan needs. Monopoly names the resource that yields the most tradeable
cards.

**Against people** (1 human against 3 bots, 4,000 games): the human won about
51% against the first planner, 44% against the revised one, and 48% when the
bots traded. Thomas listed its weaknesses himself: longest road ignores room to
grow, it stops contesting awards once it holds them, it fails to block a player
on 9 points, and a boxed-in bot hoards.

### The Edinburgh rules bot, "Stac" (Guhe and Lascarides, 2013–2014)

JSettlers improved one change at a time and tested each change over 10,000
games of one against three:

- **Opening.** Weighting that avoids duplicate numbers, avoids both settlements
  on one tile, and values the combinations each purchase needs: the old bot won
  15.2% against three of the new, which won 28.3%.
- **Ranking builds by time to build** instead of a fixed order (city, then
  settlement, then army, road, card) reached 29.9%. It then bought too many
  development cards; penalising them again produced the strongest agent,
  43.0% against three original JSettlers bots. This became the "Stac" baseline.
- **Cheap and well tuned beat expensive.** The slower smart planner lost to the
  tuned fast one.
- **Trading is worth a lot among bots.** A bot that never trades won 12.7%; one
  that never offers, 16.2%; one that picks build plans at random, 2.2%. Bots
  that could see every hand or every plan did no better than 25%, because
  counting already told them almost everything.
- **Embargoes.** Refusing to trade with the leader works best from about 7
  points; JSettlers' 8 is too late. Even a bot that could persuade anyone
  reached only about 38%, because the bank and harbours are always there.

Against experienced people (Keizer and others, 2017), the humans won 70% of 10
games against the original bot and 27–29% against Stac: the better game
strategy mattered far more than the negotiator. With a trade negotiator trained
by reinforcement learning, humans won 18.2% of 11 games. The authors say the
sample is too small for strong claims.

### SmartSettlers: Monte Carlo tree search (Szita, Chaslot and Spronck, 2009)

The first well-known search bot. The paper is paywalled, so this is
_second-hand_ from four citing sources. It played a simplified game: no trading
between players and every hand visible. Search was steered with Catan knowledge:
new settlement and city moves started with "virtual wins", and simulated games
strongly preferred building. Against three JSettlers bots it won 27% with 1,000
simulations and 49% with 10,000 (about 12 seconds per 10,000 random games in
Java). Its author, a skilled player, could beat it consistently. A later
reimplementation under full rules won about 10 points less.

### Typed search and belief (Dobre and Lascarides, 2015–2018)

The most thorough search work, built on Stac and tested with 2,000 games each.

- **Why plain search fails in Catan.** With random play a trade offer is legal
  99.8% of the time, with about 65 possible offers. Random simulated games
  therefore run for about 11,600 moves and are mostly trade offers. Choosing
  the kind of action first (build, buy, trade, end) and then the action itself
  cut games to 420 moves and made them 68 times faster.
- **Typed Monte Carlo tree search** (every hand visible, trading allowed) against
  three Stac bots: 22% at 5,000 simulations, 34% at 10,000, 46% at 20,000, 53.4%
  at 50,000. Without player trades it stopped at about 43%. At 1.5 seconds a
  move, plain search won 6.6% and typed search 28%.
- **Offer spam.** Only 15% of the search bot's offers were accepted; unlimited it
  made 527 offers a game. Capping them improved results, and later work capped
  offers at three a turn so as not to annoy people.
- **Hidden information (POMCP).** Each opponent's hand was tracked as a small
  set of possibilities, a full state was sampled at the start of each search,
  and the simulated games were played in that sampled state. With a prior on
  which kind of action people choose, taken from only 60 human games, it won
  40.7% against three Stac at 10,000 iterations (about 2.2 seconds on four cores)
  and 53.7% at 40,000. The prior only helped when it was conditioned on what was
  legal; unconditioned it was worse than none.
- **Belief methods compared.** POMCP, information-set search and sampling a state
  at the root all did about the same. Simulating inside the belief itself did
  clearly worse, mainly because hidden victory point cards make it unclear
  whether a simulated game has ended.
- **How much is hidden.** Over 9,211 decisions, at least one opponent's hand was
  partly unknown in about half; when it was, there were 5.4 possible hands on
  average and 3 at the median.
- **Human data for one decision.** Seeding the second settlement's search with
  60 human games raised it from 28.7% to 30.4%. Inside the JSettlers engine,
  1,000 simulations took five minutes, which is why every serious search bot
  has its own fast simulator.

Dobre's conclusion: Catan has little direct interaction, and a player can do
well concentrating on their own plan. None of these agents was tested against
people.

### Trade-optimistic search (Rubin, Paz and Meneguzzi, 2017)

Full rules with hidden cards, against three JSettlers bots. Opponents' cards
were counted until a steal or discard made them unknown, then filled in at
random once per search; dice were chance nodes. Moves were pruned hard: only
cities if a city was possible, otherwise only settlements, otherwise the rest.
That beat SmartSettlers' virtual wins by about 10 points, but it ignored a
longest road race late in the game. The trade idea: also consider purchases
that become affordable with one-for-one trades, and if the search picks one,
offer that trade to everyone once. Win rates against three JSettlers at 10,000
simulations: 38.4% without trading, **58.2%** with it (±7%, 100 games per
point).

### A learned trade negotiator (Cuayáhuitl, Keizer and Lemon, 2015)

A small neural network trained by reinforcement learning to make, accept,
reject and counter offers, with Stac's rules playing everything else. Against
three bots with the hand-written trader: 53.4% over 10,000 games, where the
hand-written trader itself wins 25%. A trader choosing at random won 0.01%:
bad trading loses the game.

### Learning from scratch

- **Pfeiffer (2004)**, _second-hand_: pure Q-learning failed to beat simple
  baselines; hand-written high-level strategy was essential.
- **Xenou and others (2018)**, _second-hand_: a learned trader on JSettlers,
  about 52–53% against three JSettlers.
- **QSettlers** (student project): could not make full-game learning work; the
  trading-only version usually came second.
- **Gendre and Kaneko (2020)**: 56.5% against JSettlers, but only head to head,
  with no player trading, after about five weeks of training on 32 cores and
  two GPUs with a Rust engine.
- **Henry Charlesworth (2021–22)**: the most ambitious attempt. Full four-player
  game with trading, opponents' hands encoded as possible minimum and maximum
  counts, about a month on a 32-core machine and an RTX 3090 (roughly 450
  million decisions). By his own account well short of a good player, though he
  nearly lost to it once. Its trading spammed offers people could not accept,
  and he would drop trading if starting again. Adding a search at the root (10
  seconds a move on 32 processes) won 47 of 100 games against three copies of
  the learned policy.
- **Driss and Cazenave, "Deep Catan"**: expert iteration with value networks,
  four players, no trading. Only compared with its own earlier versions.
- **catan-rl (2026, Rust)**: 87–221 ns per game step. A learned policy plateaued
  at 65% against three weak rules bots (first to 7 points); adding search guided
  by the policy took it to 82%.
- Student projects: a phase-by-phase learned bot won 16 of 50 against Colonist's
  bots; a self-trained three-player network reached beginner level.

No peer-reviewed AlphaZero-style Catan program tested against an outside
opponent was found.

### Language models (2025–2026)

- **Agents of Change** (Belle, Barnes and others, UCSB), all games in Catanatron,
  head to head against AlphaBeta. A model choosing every move averaged 3.6 to
  4.4 points a game (random play scores 2.3), so it lost almost every game. The
  best prompt-evolving version, with Claude 3.7, averaged 7.2 points. The later
  version, **HexMachina**, has the model write and repeatedly improve a Python
  bot instead: with GPT-5-mini that bot won 54.1% of 1,000 games against
  AlphaBeta. A move-by-move agent in the same paper won 16.4% of 20 games. The
  winning bots used phase-aware priorities, production variety, robber pressure
  and short simulations: ordinary engine ideas, written by a model.
- **Piszczek (Leiden, 2025)**: a Catanatron-based search bot reading Colonist
  from the screen, in ranked four-player games with no player trading. It won
  12.5% of 40 games, 15% when it baited opponents into errors, and 9.1% of 22
  when it chatted persuasively with a language model: chat made it look
  threatening and people ganged up on it. Its search could not cover the 13,320
  combinations of the two opening placements, and habits from head-to-head play
  (valuing all five resources, open space) hurt it at a table of four.
- **Sarukkai (2026)**: a GPT-5.2 agent improved by drills built from its own
  mistakes, tested only against its author in a handful of games.
- LLM arenas exist (LLM against LLM only); none compares with a search bot or
  people.

Where language models failed: long-game consistency, invented heuristics, cost
(about 70 calls a game), and chat that backfired with people. Where they
helped: writing and refining bot code offline.

### Commercial and platform bots

- **Xbox Live Arcade Catan (Big Huge Games, 2007).** Brian Reynolds built the AI
  from spreadsheets of tactics supplied by Klaus Teuber, the game's designer. It
  has 13 personalities with quirks: a favourite award, a favourite rare
  resource, grabbing corners or upgrading to cities, and whether it settles for
  a second choice. Easy bots trade anything; hard ones only trade for an
  advantage and block leaders. Reviewers called it the best Catan AI of its
  time. No measured win rates exist.
- **Catan Universe and Catan Classic.** Long-running complaints of rigged dice
  and bots ganging up; a developer statement says the dice are random. No
  design information.
- **Colonist.** Nothing public about its bots. Players ask for bots that refuse
  to trade with a near-winning leader and stop giving two-for-ones, which
  suggests their trading is exploitable. A student's learned bot won 32% of 50
  games against three of them. Colonist's balanced dice are a deck of all 36
  combinations, reshuffled when 10 to 15 remain.

### Catanatron

Catanatron is the engine we measured our bots against, so it was read in full
rather than surveyed. See the next section. From its author's own posts: he
rates it at about the strength of a casual player, and his Monopoly study over
1,000 bot games found a three-card Monopoly early is weak and five or more late
is the mark to aim for. Its documentation leaderboard uses only 15 to 25 games
per pairing.

## Catanatron, read in full

[Catanatron](https://github.com/bcollazo/catanatron) (Bryan Collazo, GPL-3.0,
Python) is the most complete open-source Catan engine and the one we measured
our bots against. Everything below comes from reading its code at commit
`ecf9311` and its author's own notes (`docs/RESULTS_LOG.md`, `docs/BLOG_POST.md`,
the draft of "5 Ways NOT to Build a Catan AI").

### The bots

| Key | Bot             | How it decides                                                                 |
| --- | --------------- | ------------------------------------------------------------------------------ |
| R   | Random          | Any legal move                                                                 |
| W   | Weighted Random | Random, but a city, settlement or card is 10,000, 1,000 or 100 times as likely |
| VP  | Victory Point   | Whatever gives the most points right now, ties at random                       |
| F   | Value Function  | Tries every legal move on a copy and keeps the one with the best score         |
| G   | Greedy Playouts | Plays 25 random games after each move and keeps the move that won most         |
| M   | MCTS            | Monte Carlo tree search with random playouts, 10 simulations by default        |
| AB  | AlphaBeta       | Two actions of lookahead with chance averaged, then the Value Function score   |
| SAB | Same-Turn AB    | AlphaBeta that stops looking when its own turn ends                            |

AlphaBeta is the strongest. The author measured it 53 to 47 against the Value
Function bot; we measured 52 to 48. Weighted Random beats Random about 61 to 38
(10,000 games). Value Function beat Random and Weighted Random 991 games of
1,000 in a three-player test.

### What makes the Value Function score work

The whole of `players/value.py` is one sum. Its weights are orders of magnitude
apart, so it behaves like a checklist in priority order:

| Weight | Feature                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| 3×10¹⁴ | Public victory points                                                          |
| 10⁸    | Own production, minus one opponent's production                                |
| 10⁴    | Production of free corners reachable with one more road                        |
| 10³    | Number of corners the player could build on                                    |
| 10²    | Hand synergy: how close the hand is to a city and to a settlement              |
| 10–12  | Knights played, development cards held, longest road when nothing is buildable |
| 1–5    | Number of tiles touched, cards in hand, a penalty for holding more than seven  |

Production is expected cards per roll: each number's chance (a 6 or 8 is
5 in 36), counted twice for a city, with the robber's tile removed. A bonus for
each resource produced at all rewards variety.

Why this beats our bots: every legal move goes through the same score, so it
never passes with a point affordable and never makes a pointless move. Taking
an opponent's production off its own means it settles where others want to and
robs where it hurts. Reachable production sends roads somewhere useful. Hand
synergy decides what to keep on a seven and what to trade away. None of that is
clever; all of it is consistent.

### What AlphaBeta adds

`players/minimax.py` searches two actions deep. At chance events it averages
over the outcomes instead of picking one (`tree_search_utils.py`): the eleven
dice totals weighted by probability, each card the development deck could
produce, and each resource a steal could take. Opponents are treated as
minimisers of its score.

Its limits, read from the code and the author's notes:

- **Depth counts single actions.** Two actions is usually "this build, then end
  the turn", or one action and the next player's roll. The author found three
  levels played worse than two.
- **It sees every hand.** Catanatron's bots are handed the whole game, so the
  opponents' cards are known exactly during search. Ours saw only its own view
  in our tests.
- **Built for two players.** The score counts one opponent (the next seat), and
  the optional robber pruning looks only at one enemy. With four players the
  other two barely register.
- **No player trading.** The rules include offers, but no bot ever makes one.
- **No long-term plan.** The author notes it plays Monopoly as soon as it can.

### What the author tried that did not work

From the results log and the blog draft:

- Reinforcement learning (cross-entropy method, DQN, a TensorForce agent):
  learnt to beat Random, never approached the Value Function bot. Causes he
  suspects: training on random games, a flat action space of over 5,000 moves,
  and "end turn" dominating the data.
- Supervised value networks trained on random games: low error on the training
  labels, weak play. Good predictions of random games do not make good moves.
- Monte Carlo search with random playouts: wins against random players but loses
  to Value Function, and was too slow in Python (about 3 seconds for 100
  simulations). Greedy playouts beat MCTS at the same budget.
- Bayesian optimisation of the weights: too slow, and it did not help. SPSA, a
  simpler tuning method from chess engines, looked promising (November 2021).
- A random game from a position is a fair judge of who is ahead: about 50
  random games give a stable estimate.

His conclusion is that a hand-written score with search, improved step by step
the way Stockfish was, is the promising route.

### Engine facts worth copying

- Copying the game was 45% of the Value Function bot's time until the state was
  flattened to plain primitives. Move generation and applying moves are then
  about half each, like a chess engine.
- Random games average about 275 turns and 960 actions; a player makes about 70
  decisions a game. The median decision has one option; the largest seen had 279.
- Discards are taken one card at a time, and development card outcomes are
  expanded from the cards the player has not seen.

## Side by side

| Program                    | Approach                                   | Hidden cards                  | Player trading                 | Strength                                          |
| -------------------------- | ------------------------------------------ | ----------------------------- | ------------------------------ | ------------------------------------------------- |
| JSettlers                  | Time-to-build and time-to-win planner      | Counted; unknown after steals | Offers, counters, embargo at 8 | About an average online player                    |
| Stac                       | JSettlers, retuned                         | Counted                       | As JSettlers                   | 43% against 3 JSettlers                           |
| SmartSettlers (_2nd-hand_) | Tree search steered by Catan knowledge     | All visible                   | None                           | 49% against 3 JSettlers; beaten by its author     |
| Typed tree search          | Pick the kind of action, then the action   | All visible                   | Offers, accept, reject         | 53% against 3 Stac at 50,000 simulations          |
| POMCP with human prior     | Typed search over sampled hands            | Small sets of possible hands  | Up to 3 offers a turn          | 41% at 10,000 (2 s), 54% at 40,000 against 3 Stac |
| Trade-optimistic search    | Pruned tree search, trades as extra moves  | Counted, filled in at random  | One-for-one offers to all      | 58% against 3 JSettlers                           |
| Learned negotiator         | Rules for play, a small network for trades | —                             | Learned                        | 53% against 3 rule-based traders                  |
| Charlesworth               | Self-play learning, then root search       | Minimum and maximum counts    | Learned, spammy                | Short of a good player                            |
| Gendre and Kaneko          | Self-play learning                         | Not modelled                  | None                           | 56.5% against JSettlers, head to head only        |
| Catanatron AlphaBeta       | Hand-tuned score, two actions of lookahead | Sees everything               | None                           | Casual-player strength                            |
| HexMachina                 | A language model writes the bot            | Via Catanatron                | Via Catanatron                 | 54% against AlphaBeta, head to head               |
| catan-rl                   | Learned policy plus search                 | —                             | Small fixed menu               | 82% against 3 weak rules bots, first to 7         |
| Xbox Live Arcade Catan     | Designer's tactics, personalities          | —                             | Hard bots trade for advantage  | Anecdotes only                                    |

## What made the strong ones strong

1. **Valuing moves as a race to ten points.** How much a move speeds you up and
   slows the leader is cheap to compute and has the best record against people.
2. **A good opening.** Placement alone was worth 13 points of win rate between
   otherwise identical bots.
3. **Ranking every option in context** instead of a fixed order of preference,
   with development cards calibrated by testing rather than guessed.
4. **Search that knows Catan.** Choosing the kind of action before the action,
   pruning hopeless moves, and simulating with sensible play. Strength rose
   steadily with more simulations.
5. **Trading well.** Among bots, trading roughly doubles a player's share. The
   good traders only trade toward a purchase they can make now, beat what the
   bank would give, refuse the leader and anyone racing them for a corner, and
   think about whether the other side can and will accept.
6. **Counting instead of guessing.** Exact counting of public card movements,
   with a few possible hands after steals, was as good as seeing every hand.
7. **A little human data.** Sixty human games, used as a prior on what kind of
   move people make, gave a search bot seven points at no extra cost.
8. **Search on top of whatever else there is.** Every learned bot that got
   stronger did so by adding search.

## What failed

1. **Learning from scratch.** Huge action spaces, sparse rewards, training on
   random games, and too few games to learn from.
2. **Search with random simulations.** They wander into endless trade offers and
   say little about who is ahead.
3. **Simulating inside a belief** rather than in one sampled full state.
4. **Deeper without better judgement.** Catanatron at three actions was worse
   than at two; JSettlers' expensive planner lost to its tuned cheap one.
5. **Naive trading with people.** Deals that favoured the people, resources
   given away, unfulfillable offers, and offer spam that annoyed everyone.
6. **Rigid rules.** A fixed build order that never buys cards, pruning that
   misses a late longest road race, and awards abandoned once held.
7. **Habits carried from two players to four.** A four-player table blocks
   and gangs up in ways a head-to-head game never does.
8. **Talking.** A chatty bot looked like a threat and lost more.
9. **Small samples.** Several published comparisons rest on 10 to 25 games. In a
   four-player test, 2,000 games tell 25% from about 22.5–27.5%; 10,000 are
   needed for about 1%.

## How strong players think

From interviews and guides by top Colonist and tournament players: Treeckosaurus
(ranked first on Colonist, two-time champion), Bo Peng (2021 US national
champion) and DyLighted (regional champion), plus Colonist's strategy guides.

**Opening.**

- Pips (6 and 8 are 5, 5 and 9 are 4, down to 1 for 2 and 12), and spread the
  numbers: duplicates across your corners make you streaky.
- Count each resource's pips on the actual board. Rock and clay usually have
  three tiles to everyone else's four, so they are often scarce; break ties
  toward the scarce one.
- Rock, hay and wool on 6, 5 and 9 is the strongest city start. Hay is the most
  flexible resource; going without it is a common way to lose.
- The second placement fills the first's gaps, or deliberately goes narrow on
  great numbers. When choosing the first corner, check which second corners will
  still be free.
- A second settlement on timber and clay guarantees a starting road, which wins
  races to the next corner. Point roads at open land, and do not aim them at
  corners a later player will take first.
- Players without a good harbour rarely win at the top level. A 2:1 harbour pays
  when you own a strong tile of that resource.
- Check where the desert is first.
- How much placement decides: 20% (Treeckosaurus), about 25% (DyLighted), about
  half (Bo Peng).
- Five settlements and longest road is only seven points: cities are required.

**Each turn** (Treeckosaurus's checklist): pick the objective; knight before
the roll?; roll; is the plan still best?; what are opponents about to do;
good trades; settlements or cities; the risk of losing cards to a seven; roads
or cards; small trades to get under eight cards; end. Bo Peng works out the
chance of a seven before his next turn from the hand he would end with.

**Robber.** Hit the leader's most important tile, judging the leader by points,
production (cities double), unplayed cards, road and army prospects, harbours,
and whether any roll could win them the game. When nobody is clearly ahead,
avoid hitting the same player twice in a row: people retaliate.

**Trading.** Do not trade with the leader or anyone racing you. Price by
scarcity. A card usable this turn is worth more, so ask more from someone
trading on their own turn. Two-for-one gifts are how leaders are made: Bo Peng
won from four visible points after a two-for-one gave him the last cards he
needed. Strong players also run harbour services, promise future trades, and
trade away a resource just before playing Monopoly on it.

**Development cards.** The deck is 14 knights, 5 points, and 2 each of
Monopoly, Road Building and Year of Plenty. Play a knight before rolling to
clear the robber. Keep point cards hidden. Monopoly for five or more.

**Awards.** Keep extending longest road after taking it, leave room to grow,
prefer open roads to dead ends, and contest an award when it would let someone
win.

**Counting.** Track every hand, the bank, who can take longest road with the
timber and clay they hold, and unplayed cards: four unplayed cards can hide
three points.

**Table manners.** Do not make enemies needlessly: yield a contested corner that
matters more to someone else. People gang up on whoever looks strongest.

## Second round: frameworks, new work and numbers

A second sweep, also on 1 October 2026, looked for what the first missed:
research frameworks and competitions, work since 2019, commercial bots, newer
open-source projects, and hard numbers about the game itself.

**Research frameworks.** Queen Mary's Tabletop Games framework (TAG) has a full
Catan with player trading. Its only published Catan results (Goodman,
Perez-Liebana and Lucas, IEEE Transactions on Games, 2025) found that plain tree
search with no Catan-specific judgement played very poorly. With a learned
judgement of positions it worked. In three-player games the first player won
only 22% (a fair share is 33%). The board mattered far more than the dice. That
learned judgement is four linear models, one per phase of the game, over 52
features:

- Counting for a position in the opening model: the smallest income of any
  resource (+0.67), roads (+0.49), and cards for a road or a city in hand.
- Counting against it: two settlements on one tile (−0.98) and a generic 3:1
  harbour (−1.16).

Neither OpenSpiel, Ludii nor PettingZoo has Catan. No game-AI competition
(CIG/CoG, through 2026) has had a Catan track; only course tournaments exist.

**Benchmarks against Catanatron's bots.**

- CatanBench (2026), bots only: AlphaBeta won 19 of 32 four-player games and the
  simpler value bot 13.
- CatanBench with one frontier language model seated with random, the value bot
  and AlphaBeta: the models won 23 of 24 games, at $2–10 a game.
- Another benchmark: AlphaBeta wins 36% against three value bots (a fair share
  is 25%). It buys a development card on only 1.5% of the turns it could.

**The robber alone is worth about eight points.** A Kochi University of
Technology thesis (2025) ran 4,000 four-player games between otherwise identical
bots:

- A knowledge-based robber won 27.0% of games; a robber learned by trial and
  error won 19.2%.
- The knowledge-based robber hit the leader's tiles 92% of the time, and its
  own 0.2%.

**Learning projects, self-reported.**

- CatanZero (two players, no trading, AlphaZero-style): its network alone won
  about 31% against AlphaBeta. When its placement search spread too few samples
  over too many options, 74.6% of its losses were placement blowouts. An
  earlier claimed result was withdrawn after a leak of hidden information was
  found.
- catanatron-1v1: imitation learning and reinforcement learning top out around
  36% against the value bot; tree search at 100 ms got 5–10%.

**Commercial bots.**

- Colonist added bot difficulty levels in 2024. Bot games were 30% of its 60
  million games in 2025. Nothing public says how its bots work.
- Catan Universe has three levels. Players report that its AI rarely builds
  roads and hoards cards, and one experienced player reported 24 straight wins
  on the hardest level.
- In the console edition (2023) the AI only trades true surplus, and games run
  about twice as long.

**Numbers about the game.**

- Seat order matters, but the effect depends on the board, so every comparison
  should rotate seats.
- Colonist one-on-one games average 69 turns, and a third end in resignation.
- With Largest Army uncontested, the development cards it takes on average to
  gain points from Largest Army and point cards: 2.95 for one point, 4.43 for
  two, 6.39 for three and 9.40 for four.

**Techniques from other games that fit Catan.**

- Searching past the bot's own turn, with quick models of the next turns, won
  57–85% against searching the bot's own turn alone, in a game where a turn has
  several actions (FH-EMCTS).
- Fitting a program's judgement to game results by logistic regression ("Texel
  tuning") was worth about 100 Elo in chess.
- Mirrored deals, where both sides of a comparison see the same cards (common
  random numbers), cut the games a comparison needs by four times or more in
  poker.
- In four-player games, judge a move by the best reply of the strongest
  opponent rather than every opponent's (Best-Reply Search).

**What we did with it.** Each idea was tried in our engine and kept only if it
won. The test was about 200 four-player self-play games, two seats against two,
with every board played twice with the sides swapped, the same dice in both
games, and balanced dice as rooms use them:

- **Kept: the race prices expansion.** A new corner is worth what the rest of
  the race costs with the resources and harbour it brings. The race also checks
  for overshooting the target. Won 111–87, with a tenth more settlements.
- **Kept: the robber moves on.** Fitting the race to who won about 200
  self-play games showed it was too sure of itself, mostly because it counted a
  tile under the robber as lost for good. Counting a quarter of it lost fixed
  most of that, and won 113–85.
- **Kept: paired dice** for every comparison. They cut the error of a
  comparison by about a tenth.
- **Not kept: a refitted temperature.** 100–98, and 103–95 with the trading
  thresholds rescaled to match.
- **Not kept: looking past the turn** with quick models of the opponents'
  turns. 102–96, at twice the thinking time.
- **Not kept: a learned correction for room to expand.** Counting open corners
  within two roads predicted the winners of games it was not fitted on. In play
  it lost 13–24, and the duel was stopped. Corrections for resource variety, the
  weakest income and awards held did not even hold up on unseen games.

## Our bots, read in full

Today's bots (`packages/bot/src`, described in [Bot players](BOTS.md)) are a
ladder of rules with Jev choosing from shortlists. Reading the code next to the
match statistics shows why they lose.

In 200 head-to-head games against AlphaBeta (Champion level, without Jev), per
game:

|                      | Ours | AlphaBeta |
| -------------------- | ---- | --------- |
| Points at the end    | 5.83 | 9.35      |
| Settlements          | 2.63 | 2.79      |
| Cities               | 0.54 | 2.41      |
| Points from cards    | 0.94 | 0.04      |
| Largest army (share) | 0.46 | 0.00      |
| Longest road (share) | 0.14 | 0.85      |

The causes, in the order they cost games:

1. **No score and no lookahead.** Corners are ranked by pips plus a bonus for
   variety and a harbour; roads by distance to a target. Nothing compares one
   whole move with another, so the bot cannot tell that a city now beats a road
   now.
2. **The plan never changes without Jev.** A new plan saves for a settlement,
   and only Jev rewrites it. Without the service the bot saves for settlements
   all game: it trades rock and hay away for timber and clay, does not protect rock on
   a seven, and almost never builds a city. With Jev it built more cities (0.93
   a game) but did not win more.
3. **Development cards as a default.** When nothing better is affordable it buys
   a card, and plays one when nothing else is left to do. Largest army comes
   from that, not from a plan.
4. **Roads without a destination.** Without Jev the target corner is never set,
   so roads go toward whatever corner looks best from where they stand, and
   AlphaBeta takes longest road in 85% of games.
5. **Monopoly on the wrong resource.** It names what its own plan needs, not
   what the other players are holding.
6. **No player trading.** Bots never answer an offer and never make one.
7. **The opening ignores the rest of the table.** Each corner is scored alone:
   no pairing of the two settlements, no room to expand, no thought for which
   corners the next players will take.

None of this is Jev's fault. Jev chooses among options the code has already
narrowed, so it can only be as good as the shortlist and the plan it is shown.

## Sources

JSettlers

- Thomas, R. S. (2003), _Real-time Decision Making for Adversarial Environments
  Using a Plan-based Heuristic_, PhD dissertation, Northwestern University:
  https://sourceforge.net/projects/jsettlers/files/Dissertation/Version%201.0/
- JSettlers2 source (`soc.robot`): https://github.com/jdmonin/JSettlers2

Edinburgh

- Guhe and Lascarides (2014), Game strategies for The Settlers of Catan, CIG:
  https://homepages.inf.ed.ac.uk/alex/papers/cig2014_gs.pdf
- Guhe and Lascarides (2014), The effectiveness of persuasion in The Settlers of
  Catan, CIG: https://www.pure.ed.ac.uk/ws/portalfiles/portal/19353900/CIG2014.pdf
- Guhe, Lascarides, O'Connor and Rieser (2013), Effects of belief and memory on
  strategic negotiation, SEMDIAL:
  https://www.semdial.org/anthology/Z13-Guhe_semdial_0012.pdf
- Dobre and Lascarides (2015), Online learning and mining human play in complex
  games, CIG: https://homepages.inf.ed.ac.uk/alex/papers/cig_2015.pdf
- Dobre and Lascarides (2017), Exploiting action categories in learning complex
  games, IntelliSys: https://homepages.inf.ed.ac.uk/alex/papers/intellisys.pdf
- Dobre and Lascarides (2018), POMCP with human preferences in Settlers of Catan,
  AIIDE: https://cdn.aaai.org/ojs/13014/13014-52-16531-1-2-20201228.pdf
- Dobre (2018), Low-resource learning in complex games, PhD thesis:
  https://era.ed.ac.uk/handle/1842/35534
- Keizer and others (2017), Evaluating persuasion strategies and deep
  reinforcement learning methods for negotiation dialogue agents, EACL:
  https://www.aclweb.org/anthology/E17-2077.pdf
- Cuayáhuitl, Keizer and Lemon (2015), Strategic dialogue management via deep
  reinforcement learning: https://arxiv.org/abs/1511.08099
- Code: https://github.com/sorinMD/StacSettlers and https://github.com/sorinMD/MCTS

Search

- Szita, Chaslot and Spronck (2010), Monte-Carlo tree search in Settlers of
  Catan, ACG 2009 (not opened; paywalled):
  https://link.springer.com/chapter/10.1007/978-3-642-12993-3_3
- Roelofs (2012), Monte Carlo tree search in a modern board game framework:
  https://project.dke.maastrichtuniversity.nl/games/files/bsc/Roelofs_Bsc-paper.pdf
- Rubin, Paz and Meneguzzi (2017), Optimizing UCT for Settlers of Catan, SBGames:
  https://www.sbgames.org/sbgames2017/papers/ComputacaoFull/175405.pdf
- Driss and Cazenave, Deep Catan:
  https://www.lamsade.dauphine.fr/~cazenave/papers/DeepCatan.pdf

Learning

- Gendre and Kaneko (2020), Playing Catan with cross-dimensional neural network:
  https://arxiv.org/abs/2008.07079
- Charlesworth, Learning to play Settlers of Catan with deep reinforcement
  learning: https://settlers-rl.github.io/ and
  https://github.com/henrycharlesworth/settlers_of_catan_RL
- QSettlers: https://akrishna77.github.io/QSettlers/
- Kim and Li (2021), Re-L Catan, Stanford CS230:
  http://cs230.stanford.edu/projects_fall_2021/reports/103176936.pdf
- Asher, Modeling Catan through self-play: https://justinasher.me/catan_ai
- catan-rl: https://github.com/Eli6th/catan-rl

Catanatron

- Repository: https://github.com/bcollazo/catanatron (read at `ecf9311`)
- 5 Ways NOT to Build a Catan AI (2021):
  https://medium.com/@bcollazo2010/5-ways-not-to-build-a-catan-ai-e01bc491af17
- When should you play the monopoly card? (2022):
  https://medium.com/@bcollazo2010/catan-data-analysis-when-should-you-play-the-monopoly-card-7e00c85f6ea1

Language models

- Belle, Barnes and others, Agents of Change: Self-Evolving LLM Agents for
  Strategic Planning: https://arxiv.org/abs/2506.04651
- Piszczek (2025), Improving Settlers of Catan agents with natural language,
  Leiden: https://theses.liacs.nl/pdf/2024-2025-PiszczekWWiktor.pdf
- Sarukkai (2026), Human-in-the-loop agent development for Catan:
  https://vsanimator.substack.com/p/human-in-the-loop-agent-development

Commercial and platforms

- Interview with Brian Reynolds (2007):
  https://www.engadget.com/2007-02-22-off-the-grid-interviews-brian-reynolds-of-big-huge-games.html
- Colonist balanced dice: https://blog.colonist.io/designing-balanced-dice/

Strong players

- Treeckosaurus: https://blog.colonist.io/catan-strategies-with-treeckosaurus/
- Bo Peng: https://blog.colonist.io/bo-peng-interview/
- DyLighted: https://blog.colonist.io/interview-series-1-dylighted/
- Colonist strategy guides:
  https://blog.colonist.io/catan-strategies-beginner-intermediate-advanced/ and
  https://blog.colonist.io/guide-to-catan-starting-strategies/

Second round

- Goodman, Perez-Liebana and Lucas (2025), Seeding for success, IEEE
  Transactions on Games: https://arxiv.org/abs/2503.02686
- TAG's Catan and its learned judgement:
  https://github.com/GAIGResearch/TabletopGames/tree/master/src/main/java/games/catan
- CatanBench: https://github.com/SoumilRathi/catanbench and
  https://catanbench.com/api/leaderboard
- catan-llm (AlphaBeta against three value bots):
  https://github.com/taziksh/catan-llm
- Robber thesis, Kochi University of Technology (2025):
  https://www.kochi-tech.ac.jp/library/ron/pdf/2025/03/13/a1260319.pdf
- CatanZero:
  https://github.com/nickita-khylkouski/catan-zero-public/blob/HEAD/docs/CATAN_ZERO_SYSTEM_PAPER_2026-07-06.md
- catanatron-1v1: https://github.com/PeterLP123/catanatron-1v1
- Canopy (move ordering, dominated moves):
  https://github.com/cullback/canopy/blob/HEAD/examples/catan/OPTIMIZATIONS.md
- Colonist 2024 and 2025 summaries:
  https://blog.colonist.io/colonist-io-2024-summary/ and
  https://blog.colonist.io/colonist-io-2025-summary/
- Colonist one-on-one strategy and balanced sevens:
  https://blog.colonist.io/ranked-1v1-comprehensive-strategy-guide-colonist-io/
  and https://blog.colonist.io/balancing-7s-on-1v1/
- Development cards per point:
  https://boardgameanalysis.com/the-143-ways-to-win-at-catan-part-ii
- Best-Reply Search:
  https://dke.maastrichtuniversity.nl/m.winands/documents/BestReplySearch.pdf
- Searching past the turn (FH-EMCTS): https://ceur-ws.org/Vol-3305/paper3.pdf
- Texel tuning: https://www.chessprogramming.org/Texel%27s_Tuning_Method
- Common random numbers in tuning (RSPSA):
  https://www.jhuapl.edu/SPSA/PDF-SPSA/Kocsis_acg05.pdf

Not found: the full text of the Szita, Xenou and Pfeiffer papers; any design
document or measured win rate for Colonist, Catan Universe or the Catan apps;
any test of the Edinburgh search agents against people; and any peer-reviewed
AlphaZero-style Catan program measured against an outside opponent.
