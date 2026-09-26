/**
 * Big Table at random: seeded games of five and six players under both turn structures, with development
 * cards, trades, moves the rules refuse, the clock's moves and resignations, checked after every step. However
 * a game goes, it owes a move until it ends and takes the clock's move for everyone it waits on; every resource
 * card, development card and piece stays accounted for; the restore verifier finds nothing wrong; and a win goes
 * to a player on turn, the Lead before the Partner, never to one in a build window. A bounded version of the
 * review's fuzzer: the same games every run, in a few seconds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RuleError,
  activePlayer,
  applyAction,
  createGame,
  emptyHand,
  gameView,
  pieces,
  resignPlayers,
  robberVictims,
  score,
  total,
} from '../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { BIG_TABLE_BALANCED_V1, generateBoard, seededRandom } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { BIG_TABLE } from '../packages/rules/src/rulesets.js';
import type { TurnStructure } from '../packages/rules/src/rulesets.js';
import { gameInvariantProblems } from '../scripts/verify-restored-games.js';
import { seats } from './big-table-helpers.js';

const { bank: BANK, deck: DECK, pieces: SUPPLY } = BIG_TABLE.supply;
const DECK_SIZE = Object.values(DECK).reduce((n, count) => n + count, 0);
const TARGET = 8;
const STEPS = 2500;
const boards = [101, 202].map((seed) => generateBoard(seed, BIG_TABLE_BALANCED_V1));

/** Who may win now: both marker holders in a paired turn, nobody in a build window, else the player on turn. */
const onTurn = (g: Game) =>
  g.pair
    ? [g.players[g.pair.lead]!, g.players[g.pair.partner]!]
    : g.phase === 'buildWindow'
      ? []
      : [activePlayer(g)];

/** `count` cards drawn at random from a hand. */
function someOf(hand: Hand, count: number, rng: () => number): Hand {
  const cards = RESOURCES.flatMap((r) => Array<(typeof RESOURCES)[number]>(hand[r]).fill(r));
  const out = emptyHand();
  for (let i = 0; i < count && cards.length; i++)
    out[cards.splice(Math.floor(rng() * cards.length), 1)[0]!]++;
  return out;
}

/** A move someone might try: mostly the builds, buys, cards and trades their view offers, sometimes a refused one. */
function randomMove(g: Game, player: string, rng: () => number): GameAction {
  const me = g.players.find((p) => p.id === player)!;
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rng() * xs.length)];
  const r = rng();
  if (r < 0.6) {
    // Only these moves need what the player's view offers.
    const { legal } = gameView(g, player);
    if (r < 0.15 && legal.settlements.length) return { kind: 'settlement', vertex: pick(legal.settlements)! };
    if (r < 0.22 && legal.cities.length) return { kind: 'city', vertex: pick(legal.cities)! };
    if (r < 0.32 && legal.roads.length) return { kind: 'road', edge: pick(legal.roads)! };
    if (r < 0.4 && legal.canBuyCard) return { kind: 'buyCard' };
    const card =
      r < 0.5 ? pick(me.cards.filter((c) => rng() < 0.15 || legal.playableCards.includes(c.id))) : undefined;
    if (card?.kind === 'yearOfPlenty') {
      const resources = emptyHand();
      for (let i = 0; i < Math.min(2, total(g.bank)); i++)
        resources[pick(RESOURCES.filter((res) => g.bank[res] > resources[res]))!]++;
      return { kind: 'playCard', cardId: card.id, resources };
    }
    if (card?.kind === 'monopoly') return { kind: 'playCard', cardId: card.id, resource: pick(RESOURCES)! };
    if (card) return { kind: 'playCard', cardId: card.id };
    const give = pick(RESOURCES.filter((res) => me.hand[res] >= legal.rates[res])) ?? pick(RESOURCES)!;
    return { kind: 'bankTrade', give, receive: pick(RESOURCES.filter((res) => res !== give))! };
  }
  if (r < 0.66) {
    const give = someOf(me.hand, 1 + Math.floor(rng() * 2), rng);
    const want = emptyHand();
    want[pick(RESOURCES.filter((res) => !give[res]))!] = 1;
    return rng() < 0.5 ? { kind: 'openTrade', give } : { kind: 'offerTrade', give, want };
  }
  if (r < 0.72 && g.trade) {
    const t = rng();
    if (t < 0.4) return { kind: 'acceptTrade', tradeId: g.trade.id };
    if (t < 0.6) return { kind: 'declineTrade', tradeId: g.trade.id };
    if (t < 0.8) return { kind: 'proposeTrade', tradeId: g.trade.id, give: someOf(me.hand, 1, rng) };
    const proposal = pick(g.trade.proposals ?? []);
    if (proposal) return { kind: 'acceptProposal', tradeId: g.trade.id, player: proposal.player };
  }
  if (r < 0.75) {
    const hex = pick(g.board.hexes.filter((h) => h.id !== g.robber))!;
    const victim = pick(robberVictims(g, player, hex.id));
    return { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
  }
  if (r < 0.77 && g.discards[player])
    return { kind: 'discard', resources: someOf(me.hand, g.discards[player]!, rng) };
  if (r < 0.8)
    return pick<GameAction>([
      { kind: 'roll' },
      { kind: 'endPhase' },
      { kind: 'endPhase', expired: true },
      { kind: 'endWindow' },
      { kind: 'endTurn' },
    ])!;
  // Otherwise whatever finishes the player's part.
  if (g.phase === 'partner') return { kind: 'endPhase' };
  if (g.phase === 'buildWindow') return { kind: 'endWindow' };
  if (g.phase === 'roll') return { kind: 'roll' };
  return { kind: 'endTurn' };
}

type Ledger = { played: number; retired: number };
/** Everything that must hold between moves, whoever made the last one. */
function check(
  g: Game,
  ledger: Ledger,
  where: string,
  rng: () => number,
  { verify, probe }: { verify: boolean; probe: boolean },
) {
  for (const r of RESOURCES) {
    assert.equal(g.bank[r] + g.players.reduce((n, p) => n + p.hand[r], 0), BANK, `${where}: ${r}`);
    assert.ok(g.bank[r] >= 0 && g.players.every((p) => p.hand[r] >= 0), `${where}: no count below 0`);
  }
  assert.equal(g.deck.length + g.nextCard, DECK_SIZE, `${where}: the deck and the cards bought`);
  const held = g.players.reduce((n, p) => n + p.cards.length, 0);
  assert.equal(
    held + ledger.played + ledger.retired,
    g.nextCard,
    `${where}: every card bought is accounted for`,
  );
  for (const p of g.players) {
    const own = pieces(g, p.id);
    assert.ok(
      own.roads <= SUPPLY.roads && own.settlements <= SUPPLY.settlements && own.cities <= SUPPLY.cities,
      `${where}: ${p.id}'s pieces`,
    );
  }
  if (verify) assert.deepEqual(gameInvariantProblems(g), [], where);
  if (g.phase === 'finished') return;
  const owed = owedMoves(g);
  assert.ok(owed.length, `${where}: the game waits on someone`);
  // The clock can make every move the game waits on.
  if (probe)
    for (const move of owed) {
      const action = timeoutAction(g, move.player, rng);
      assert.ok(action, `${where}: a move for ${move.player}'s ${move.kind}`);
      applyAction(g, move.player, action, rng);
    }
  if (g.turn)
    for (const p of onTurn(g))
      assert.ok(p.resigned || score(g, p) < TARGET, `${where}: ${p.id}, on turn at the target, has not won`);
}

function play(seed: number, players: number, turns: TurnStructure) {
  const rng = seededRandom(seed * 7919 + 17);
  const board = boards[seed % boards.length]!;
  let g = createGame(seats(players), board.seed, seededRandom(seed), {
    ruleset: BIG_TABLE.id,
    turns,
    board,
    victoryPoints: TARGET,
  });
  const ledger: Ledger = { played: 0, retired: 0 };
  const resigning = 1 + (seed % 3);
  let resigned = 0;
  let lastOwed = '';
  const seen = new Set<string>();
  for (let step = 0; step < STEPS && g.phase !== 'finished'; step++) {
    const where = `${players} players, ${turns}, seed ${seed}, step ${step} (turn ${g.turn}, ${g.phase})`;
    const owed = owedMoves(g);
    // The clock's moves are tried whenever the game waits on something new, the verifier every tenth step.
    const key = owed.map((m) => `${m.player}:${m.kind}`).join();
    check(g, ledger, where, rng, { verify: step % 10 === 0, probe: key !== lastOwed });
    lastOwed = key;
    let next: Game;
    const r = rng();
    if (g.turn && resigned < resigning && r < 0.006) {
      // The player acting, a marker holder, one owing a discard, or anyone.
      const alive = g.players.filter((p) => !p.resigned);
      let who = alive[Math.floor(rng() * alive.length)]!;
      const choice = rng();
      if (choice < 0.35) who = activePlayer(g);
      else if (choice < 0.55 && g.pair && !g.players[g.pair.partner]!.resigned)
        who = g.players[g.pair.partner]!;
      else if (choice < 0.7 && Object.keys(g.discards).length)
        who = g.players.find((p) => p.id === Object.keys(g.discards)[0])!;
      ledger.retired += who.cards.length;
      next = resignPlayers(g, [who.id], { reason: 'leave' });
      resigned++;
      seen.add('resignation');
    } else {
      let actor: string, action: GameAction;
      if (r < 0.3) {
        const move = owed[Math.floor(rng() * owed.length)]!;
        actor = move.player;
        action = timeoutAction(g, actor, rng)!;
      } else {
        // Mostly someone the game waits on, sometimes anyone, whom the rules must refuse.
        const pool =
          rng() < 0.85 ? owed.map((m) => m.player) : g.players.filter((p) => !p.resigned).map((p) => p.id);
        actor = pool[Math.floor(rng() * pool.length)]!;
        action = randomMove(g, actor, rng);
      }
      try {
        next = applyAction(g, actor, action, rng);
      } catch (error) {
        assert.ok(
          error instanceof RuleError,
          `${where}: ${action.kind} failed with ${(error as Error).stack}`,
        );
        continue;
      }
      seen.add(action.kind);
      if (action.kind === 'playCard') ledger.played++;
      const acting = g.pair ? (g.active === g.pair.partner ? 'partner' : 'lead') : g.phase;
      assert.ok(
        !(
          g.phase === 'buildWindow' &&
          ['bankTrade', 'offerTrade', 'openTrade', 'playCard'].includes(action.kind)
        ),
        `${where}: ${action.kind} in a build window`,
      );
      assert.ok(
        !(acting === 'partner' && ['offerTrade', 'openTrade', 'acceptProposal'].includes(action.kind)),
        `${where}: ${action.kind} in the Partner's phase`,
      );
    }
    if (next.phase === 'finished' && next.winner && next.finishReason !== 'resignation') {
      const winner = next.players.find((p) => p.id === next.winner)!;
      assert.ok(onTurn(next).includes(winner), `${where}: ${winner.id} won off turn`);
      // Only as the turn after the windows begins, never in one.
      if (g.phase === 'buildWindow') assert.ok(next.turn > g.turn, `${where}: ${winner.id} won in a window`);
      assert.ok(score(next, winner) >= TARGET, `${where}: ${winner.id} won short of the target`);
      if (next.pair) {
        const lead = next.players[next.pair.lead]!;
        assert.ok(
          lead.resigned || score(next, lead) < TARGET || next.winner === lead.id,
          `${where}: both at the target, and the Lead did not win`,
        );
      }
      seen.add(next.pair && next.winner !== next.players[next.pair.lead]!.id ? 'Partner won' : 'won');
    }
    g = next;
  }
  check(g, ledger, `${players} players, ${turns}, seed ${seed}, at the end`, rng, {
    verify: true,
    probe: true,
  });
  return { game: g, seen };
}

/** Two games for each table: seeds whose games end within the steps, with every kind of move below in them. */
const GAMES: [players: number, turns: TurnStructure, seeds: number[]][] = [
  [5, 'paired', [1, 7]],
  [5, 'betweenTurnsBuild', [4, 1]],
  [6, 'paired', [2, 3]],
  [6, 'betweenTurnsBuild', [2, 4]],
];
for (const [players, turns, seeds] of GAMES)
  test(`${players} players under ${turns === 'paired' ? 'paired turns' : 'Between-turns build'} play at random without breaking a rule`, () => {
    const seen = new Set<string>();
    let finished = 0;
    for (const seed of seeds) {
      const result = play(seed, players, turns);
      for (const kind of result.seen) seen.add(kind);
      if (result.game.phase === 'finished') finished++;
    }
    // The games reach the moves that matter, and end.
    for (const kind of ['playCard', 'bankTrade', 'buyCard', 'discard', 'robber', 'resignation'])
      assert.ok(seen.has(kind), `no ${kind} in these games`);
    assert.ok(seen.has(turns === 'paired' ? 'endPhase' : 'endWindow'));
    assert.ok(finished >= 1, 'a game ends');
  });
