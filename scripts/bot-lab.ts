/**
 * The bot lab: measure a change to the bot before keeping it.
 *
 *   npx tsx scripts/bot-lab.ts duel --a '{"robberBlock":0.25}' --b '{}' --games 11 --offset 0
 *   npx tsx scripts/bot-lab.ts record --games 20 --out positions.json
 *   npx tsx scripts/bot-lab.ts calibrate --files positions.json --variants '{"robber":{"robberBlock":0.25}}'
 *
 * Options common to `duel` and `record`: --seats (4), --positions (300 for a duel, 150 to record), and
 * --dice classic|balanced (balanced, as rooms default to).
 *
 * duel: champions with one tuning (A, overrides of `TUNING`) against champions with another (B), seats
 * alternating A, B, A, B. Every board is played twice with the sides swapped, and both games of a pair meet
 * the same dice in the same order whatever the bots decide (common random numbers), so the board and the
 * dice, which decide most of a game, cancel out. Prints one line of JSON; run several with different
 * --offset values side by side for more games, and add up `pairs`. A difference of a few points needs a
 * few hundred games.
 *
 * record: self-play games with every seat the same bot, saving the table at the start of every turn and
 * the winner, as JSON for `calibrate`.
 *
 * calibrate: how well the race predicts who wins. For each variant (overrides of `TUNING`), every player's
 * race at every saved turn, and the softmax that turns races into chances fitted to the winners
 * (temperature = a + b × the leader's rounds, w rolls of head start per seat): the log-loss it reaches, at
 * the current numbers and at the fitted ones. With --test, the race with `TUNING.features` is also scored
 * on games it was not fitted on, which is the only score of a correction worth trusting: every position of
 * a game shares one winner, so a few dozen games are a few dozen data points.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { applyAction, createGame, gameView, score } from '../packages/rules/src/game.js';
import type { Board } from '../packages/rules/src/board.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan, newMind, respond, watch } from '../packages/bot/src/index.js';
import type { BotPlan, Mind } from '../packages/bot/src/index.js';
import { TUNING } from '../packages/bot/src/brain/tuning.js';
import type { Tuning } from '../packages/bot/src/brain/tuning.js';
import { features, race, shared } from '../packages/bot/src/brain/race.js';
import type { Feature, Knowledge } from '../packages/bot/src/brain/race.js';
import type { Table } from '../packages/bot/src/brain/table.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const DEFAULTS: Tuning = { ...TUNING };
const tune = (change: Partial<Tuning>) => Object.assign(TUNING, DEFAULTS, change);

type Position = Pick<
  Table,
  'buildings' | 'roads' | 'robber' | 'longestRoad' | 'largestArmy' | 'victoryPoints' | 'bank' | 'active' | 'turn'
> & { players: Table['players'] };
type Recorded = { seed: number; board: Board; winner: string | null; positions: Position[] };

/** One game between bots, every seat thinking with the tuning `side` gives it. */
async function play(
  seed: number,
  seats: number,
  dice: 'classic' | 'balanced',
  positions: number,
  side: (id: string) => Partial<Tuning>,
  diceStream: () => number,
  otherStream: () => number,
  record?: Position[],
): Promise<{ game: Game; ms: number; decisions: number; trades: Record<string, number> }> {
  const ids = Array.from({ length: seats }, (_, i) => `p${i}`);
  let game = createGame(
    ids.map((id) => ({ id, name: id })),
    seed,
    seededRandom(seed),
    dice === 'balanced' ? { diceMode: 'balanced' } : {},
  );
  const minds = new Map<string, Mind>(ids.map((id) => [id, newMind()]));
  const plans = new Map<string, BotPlan>(ids.map((id) => [id, initialPlan(0)]));
  const trades: Record<string, number> = {};
  let clock = 0,
    ms = 0,
    decisions = 0,
    lastTurn = -1;
  const apply = (id: string, action: GameAction) => {
    const random = action.kind === 'roll' ? diceStream : otherStream;
    let next: Game;
    try {
      next = applyAction(game, id, action, random);
    } catch {
      const rescue = timeoutAction(game, id, otherStream);
      if (!rescue) return false;
      next = applyAction(game, id, rescue, rescue.kind === 'roll' ? diceStream : otherStream);
    }
    if (action.kind === 'acceptProposal' || (action.kind === 'acceptTrade' && !next.trade))
      trades[id] = (trades[id] ?? 0) + 1;
    for (const s of ids) watch(minds.get(s)!, s, game, next);
    game = next;
    return true;
  };
  for (let step = 0; step < 5000 && !game.winner; step++) {
    const owed = owedMoves(game)[0];
    if (!owed) break;
    if (record && game.phase === 'roll' && game.turn !== lastTurn) {
      lastTurn = game.turn;
      record.push(
        structuredClone({
          buildings: game.buildings,
          roads: game.roads,
          robber: game.robber,
          longestRoad: game.longestRoad,
          largestArmy: game.largestArmy,
          victoryPoints: game.victoryPoints,
          bank: game.bank,
          active: game.active,
          turn: game.turn,
          players: game.players.map((p) => ({ id: p.id, hand: p.hand, cards: p.cards, knights: p.knights, resigned: p.resigned })),
        }),
      );
    }
    const me = owed.player;
    clock += 1500;
    tune(side(me));
    const started = performance.now();
    const decision = await decide({
      view: gameView(game, me),
      board: game.board,
      meId: me,
      plan: plans.get(me)!,
      jev: null,
      level: 'champ',
      mind: minds.get(me),
      now: clock,
      positions,
      budgetMs: 60_000,
    });
    ms += performance.now() - started;
    decisions++;
    plans.set(me, decision.plan);
    if (decision.hold) clock += 3000;
    else if (!apply(me, decision.action)) break;
    if (game.trade)
      for (const s of ids) {
        if (!game.trade || s === game.trade.player) continue;
        tune(side(s));
        const answer = await respond({
          view: gameView(game, s),
          board: game.board,
          meId: s,
          plan: plans.get(s)!,
          jev: null,
          level: 'champ',
          mind: minds.get(s),
          now: clock,
        });
        if (answer.action) apply(s, answer.action);
      }
  }
  tune({});
  return { game, ms, decisions, trades };
}

async function duel() {
  const A = JSON.parse(arg('a', '{}')) as Partial<Tuning>;
  const B = JSON.parse(arg('b', '{}')) as Partial<Tuning>;
  const games = Number(arg('games', '4')),
    offset = Number(arg('offset', '0')),
    seats = Number(arg('seats', '4')),
    positions = Number(arg('positions', '300'));
  const dice = arg('dice', 'balanced') === 'classic' ? 'classic' : 'balanced';
  const out = { games: 0, A: 0, B: 0, unfinished: 0, turns: 0, ms: 0, decisions: 0, pairs: [] as number[] };
  const built = { settlementsA: 0, settlementsB: 0, citiesA: 0, citiesB: 0, roadsA: 0, roadsB: 0, tradesA: 0, tradesB: 0 };
  for (let n = 0; n < games; n++)
    for (const swap of [false, true]) {
      const seed = 5000 + offset + n;
      const sideOf = (id: string) => ((Number(id.slice(1)) % 2 === 0) !== swap ? 'A' : 'B');
      const result = await play(
        seed,
        seats,
        dice,
        positions,
        (id) => (sideOf(id) === 'A' ? A : B),
        seededRandom(seed * 7),
        seededRandom(seed * 7 + (swap ? 1 : 0) + 100_003),
      );
      const g = result.game;
      if (!swap) out.pairs.push(0);
      out.games++;
      out.turns += g.turn;
      out.ms += result.ms;
      out.decisions += result.decisions;
      if (!g.winner) out.unfinished++;
      else out[sideOf(g.winner)]++;
      out.pairs[out.pairs.length - 1]! += !g.winner ? 0.5 : sideOf(g.winner) === 'A' ? 1 : 0;
      for (const p of g.players) {
        const s = sideOf(p.id);
        const mine = Object.values(g.buildings).filter((b) => b.player === p.id);
        built[`settlements${s}`] += mine.filter((b) => b.kind === 'settlement').length;
        built[`cities${s}`] += mine.filter((b) => b.kind === 'city').length;
        built[`roads${s}`] += Object.values(g.roads).filter((o) => o === p.id).length;
        built[`trades${s}`] += result.trades[p.id] ?? 0;
      }
      process.stderr.write(`seed ${seed}${swap ? ' swapped' : ''}: turn ${g.turn}, winner ${g.winner ? sideOf(g.winner) : '-'}\n`);
    }
  const pairs = out.pairs;
  const mean = pairs.reduce((a, b) => a + b, 0) / Math.max(1, pairs.length);
  const sd = Math.sqrt(pairs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pairs.length - 1));
  console.log(
    JSON.stringify({
      ...out,
      ...built,
      shareA: +(mean / 2).toFixed(3),
      pairSe: +(sd / 2 / Math.sqrt(Math.max(1, pairs.length))).toFixed(3),
      msPerDecision: +(out.ms / Math.max(1, out.decisions)).toFixed(1),
    }),
  );
}

async function recordGames() {
  const games = Number(arg('games', '4')),
    offset = Number(arg('offset', '0')),
    seats = Number(arg('seats', '4')),
    positions = Number(arg('positions', '150'));
  const dice = arg('dice', 'balanced') === 'classic' ? 'classic' : 'balanced';
  const out: Recorded[] = [];
  for (let n = 0; n < games; n++) {
    const seed = 9000 + offset + n;
    const saved: Position[] = [];
    const { game } = await play(seed, seats, dice, positions, () => ({}), seededRandom(seed * 7), seededRandom(seed * 7 + 1), saved);
    out.push({ seed, board: game.board, winner: game.winner, positions: saved });
    process.stderr.write(`seed ${seed}: turn ${game.turn}, ${saved.length} positions\n`);
  }
  writeFileSync(arg('out', 'positions.json'), JSON.stringify(out));
}

type Row = { race: number[]; wait: number[]; bonus: number[]; winner: number; seats: number };

/** Every player's race (and correction, if `TUNING.features` is set) at every saved turn of finished games. */
function rows(games: Recorded[]): Row[] {
  const out: Row[] = [];
  for (const game of games) {
    if (!game.winner) continue;
    for (const position of game.positions) {
      const t: Table = { ...position, board: game.board };
      const n = t.players.length;
      const common = shared(t);
      const row: Row = { race: [], wait: [], bonus: [], winner: -1, seats: n };
      t.players.forEach((p, i) => {
        const held = (kind: string) => p.cards.filter((c) => c.kind === kind).length;
        const know: Knowledge = {
          points: score(t as never, p as never, true),
          knightsHeld: held('knight'),
          otherCards: held('yearOfPlenty') + held('monopoly') + held('roadBuilding'),
        };
        row.race.push(race(t, p.id, know, undefined, common).rolls);
        row.wait.push((i - t.active + n) % n);
        let bonus = 0;
        if (TUNING.features) {
          const f = features(t, p.id, know, common);
          for (const [name, weight] of Object.entries(TUNING.features)) bonus += (weight ?? 0) * f[name as Feature];
        }
        row.bonus.push(bonus);
        if (p.id === game.winner) row.winner = i;
      });
      out.push(row);
    }
  }
  return out;
}

function logLoss(data: Row[], a: number, b: number, w: number): number {
  let total = 0;
  for (const d of data) {
    const rounds = d.race.map((x, i) => (x + d.wait[i]! * w) / d.seats);
    const least = Math.min(...rounds);
    const scores = rounds.map((x, i) => -(x - least) / (a + b * least) + d.bonus[i]!);
    const top = Math.max(...scores);
    const weights = scores.map((x) => Math.exp(x - top));
    total -= Math.log(Math.max(1e-12, weights[d.winner]! / weights.reduce((p, q) => p + q, 0)));
  }
  return total / Math.max(1, data.length);
}

function fitTemperature(data: Row[]) {
  let best = { a: 1, b: 0, w: 0.5, loss: Infinity };
  for (const a of [0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.7, 2, 2.5, 3, 4])
    for (const b of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.3])
      for (const w of [0, 0.25, 0.5, 0.75, 1, 1.5]) {
        const loss = logLoss(data, a, b, w);
        if (loss < best.loss) best = { a, b, w, loss };
      }
  return best;
}

function calibrate() {
  const load = (list: string) =>
    list
      .split(',')
      .filter(Boolean)
      .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as Recorded[]);
  const train = load(arg('files', ''));
  const test = load(arg('test', ''));
  const variants = JSON.parse(arg('variants', '{"now":{}}')) as Record<string, Partial<Tuning>>;
  console.log(`${train.filter((g) => g.winner).length} games, ${train.reduce((n, g) => n + g.positions.length, 0)} positions`);
  for (const [name, change] of Object.entries(variants)) {
    tune(change);
    const data = rows(train);
    const now = logLoss(data, TUNING.temperatureBase, TUNING.temperaturePerRound, TUNING.waitPerSeat);
    const fit = fitTemperature(data);
    let line = `${name.padEnd(16)} loss now ${now.toFixed(4)}, fitted ${fit.loss.toFixed(4)} (a ${fit.a}, b ${fit.b}, w ${fit.w})`;
    if (test.length) {
      const held = rows(test);
      line += `; held out ${logLoss(held, fit.a, fit.b, fit.w).toFixed(4)}`;
    }
    console.log(line);
  }
  tune({});
}

const command = process.argv[2];
if (command === 'duel') await duel();
else if (command === 'record') await recordGames();
else if (command === 'calibrate') calibrate();
else {
  console.error('usage: npx tsx scripts/bot-lab.ts duel|record|calibrate [options]; see the comment at the top');
  process.exitCode = 1;
}
