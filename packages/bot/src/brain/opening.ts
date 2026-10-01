/**
 * The opening: the single most consequential decision of a game.
 *
 * Research on Catan bots measured placement alone as worth thirteen points of win
 * rate between otherwise identical bots, and top players put it at a fifth to a
 * half of the result. So the bot does not just take the corner with the most pips.
 * For each strong corner it plays out the rest of the placement round several
 * times, with the other players choosing the way people do (strong corners, not
 * always the very best one) and its own second pick made knowing its first, and it
 * scores each finished opening with the race to ten points.
 */

import { RESOURCES } from '../../../rules/src/index.js';
import type { Resource } from '../../../rules/src/index.js';
import { pips, seededRandom } from '../../../rules/src/board.js';
import type { Board } from '../../../rules/src/board.js';
import { roadSites, settlementSites } from '../../../rules/src/game.js';
import type { Game, GameAction, Hand } from '../../../rules/src/game.js';
import { boardSupply, cornerIncome, emptyHand, openCorner } from './table.js';
import type { Table } from './table.js';
import { value } from './search.js';
import { TUNING } from './tuning.js';
import type { Thinker } from './search.js';

/** How much each resource is worth on this board: the scarcer, the more. */
function scarcity(board: Board): Hand {
  const supply = boardSupply(board);
  const mean = RESOURCES.reduce((n, r) => n + supply[r], 0) / RESOURCES.length;
  const out = emptyHand();
  for (const r of RESOURCES) out[r] = Math.max(0.75, Math.min(1.5, mean / Math.max(1, supply[r])));
  return out;
}

/**
 * A quick opinion of a corner for a player who already owns `owned`: pips
 * weighted by scarcity, variety, a harbour that fits, and for a second
 * settlement, what it adds that the first lacks. This is how the other players
 * are imagined choosing; the bot's own choice is scored by the full race.
 */
export function quickCorner(board: Board, vertex: number, owned: readonly number[], weight: Hand): number {
  const corner = board.vertices[vertex];
  if (!corner) return -Infinity;
  const have = new Set<Resource>();
  const numbers = new Set<number>();
  for (const v of owned)
    for (const h of board.vertices[v]?.hexes ?? []) {
      const hex = board.hexes[h];
      if (hex && (RESOURCES as readonly string[]).includes(hex.terrain)) {
        have.add(hex.terrain as Resource);
        numbers.add(hex.number);
      }
    }
  let score = 0;
  const kinds = new Set<Resource>();
  for (const h of corner.hexes) {
    const hex = board.hexes[h];
    if (!hex || !(RESOURCES as readonly string[]).includes(hex.terrain)) continue;
    const r = hex.terrain as Resource;
    score += pips(hex.number) * weight[r];
    if (numbers.has(hex.number)) score -= 1;
    if (!have.has(r) && owned.length) score += 1.2;
    kinds.add(r);
  }
  score += kinds.size * 1.5;
  const port = board.ports.find((p) => corner.edges.includes(p.edge));
  if (port) score += port.resource === 'any' ? 1 : kinds.has(port.resource) || have.has(port.resource) ? 2 : 0.3;
  return score;
}

const setupSeat = (n: number, index: number) => (index < n ? index : 2 * n - 1 - index);

/** Pick a corner the way a person might: usually one of the best, not always the best. */
function humanPick(board: Board, t: Table, owned: number[], weight: Hand, random: () => number): number | null {
  const options = board.vertices
    .filter((v) => openCorner(t, v.id))
    .map((v) => ({ v: v.id, s: quickCorner(board, v.id, owned, weight) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  if (!options.length) return null;
  const top = options[0]!.s;
  const weights = options.map((o) => Math.exp((o.s - top) / 1.5));
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return options[i]!.v;
  }
  return options[0]!.v;
}

/** The starting cards a second settlement brings. */
function startingHand(board: Board, vertex: number): Hand {
  const out = emptyHand();
  for (const h of board.vertices[vertex]?.hexes ?? []) {
    const hex = board.hexes[h];
    if (hex && (RESOURCES as readonly string[]).includes(hex.terrain)) out[hex.terrain as Resource]++;
  }
  return out;
}

/**
 * The opening settlement. Candidates are the strongest corners by the quick
 * opinion; each is tried in several imagined placement rounds and scored by the
 * bot's chance of winning once everybody has placed.
 *
 * With `TUNING.openingRounds`, every candidate meets the same imagined rounds
 * (sample `s` draws the other players' picks from the same dice for every
 * candidate), so two corners are compared on the same futures rather than on
 * luck, and the effort goes where it decides something: many corners get a few
 * rounds, the best of them more, and the last few many more.
 */
export function chooseOpening(g: Game, th: Thinker, samples = 6, candidates = 12): { vertex: number; value: number } {
  const board = g.board;
  const weight = scarcity(board);
  const n = g.players.length;
  const owned = (id: string) =>
    Object.entries(g.buildings)
      .filter(([, b]) => b.player === id)
      .map(([v]) => Number(v));
  const legal = settlementSites(g, th.me, true);
  const ranked = legal
    .map((v) => ({ v, s: quickCorner(board, v, owned(th.me), weight) }))
    .sort((a, b) => b.s - a.s)
    .map((c) => c.v);
  const seed = TUNING.openingRounds ? Math.floor(th.random() * 2 ** 31) : 0;
  const playOut = (vertex: number, sample: number): number => {
    const random = TUNING.openingRounds ? seededRandom(seed + sample * 7919) : th.random;
    const buildings = { ...g.buildings, [vertex]: { player: th.me, kind: 'settlement' as const } };
    const players = g.players.map((p) => ({ ...p, hand: { ...p.hand }, cards: [...p.cards] }));
    const me = players.find((p) => p.id === th.me)!;
    if (g.setupIndex >= n) me.hand = { ...me.hand, ...add(me.hand, startingHand(board, vertex)) };
    const t: Table & { setupIndex: number } = {
      ...g,
      buildings,
      players,
      setupIndex: g.setupIndex + 1,
    };
    // The rest of the placement round.
    for (let i = g.setupIndex + 1; i < 2 * n; i++) {
      const seat = players[setupSeat(n, i)]!;
      const mine = Object.entries(t.buildings)
        .filter(([, b]) => b.player === seat.id)
        .map(([v]) => Number(v));
      let pick: number | null;
      if (seat.id === th.me) {
        // Its own second pick: the best by the quick opinion, knowing the first.
        const options = board.vertices
          .filter((v) => openCorner(t, v.id))
          .map((v) => ({ v: v.id, s: quickCorner(board, v.id, mine, weight) }))
          .sort((a, b) => b.s - a.s);
        pick = options[0]?.v ?? null;
      } else pick = humanPick(board, t, mine, weight, random);
      if (pick === null) break;
      t.buildings = { ...t.buildings, [pick]: { player: seat.id, kind: 'settlement' } };
      if (i >= n) seat.hand = add(seat.hand, startingHand(board, pick));
    }
    return value({ ...t, active: 0, turn: 1 }, th, false) - starved(t, th.me);
  };
  const tally = new Map<number, { sum: number; n: number }>();
  const mean = (v: number) => {
    const s = tally.get(v);
    return s && s.n ? s.sum / s.n : -Infinity;
  };
  const sampleUpTo = (v: number, upTo: number) => {
    const s = tally.get(v) ?? { sum: 0, n: 0 };
    for (; s.n < upTo; s.n++) s.sum += playOut(v, s.n);
    tally.set(v, s);
  };
  // Rounds of (corners kept, rounds each by then): the champion's default
  // plays 30 corners 4 times, the best 8 of them 16 times, the best 3 48 times.
  const rounds: [number, number][] = TUNING.openingRounds
    ? TUNING.openingRounds
    : [[candidates, samples]];
  let pool = ranked.slice(0, rounds[0]![0]);
  for (const [keep, upTo] of rounds) {
    pool = pool.length > keep ? [...pool].sort((a, b) => mean(b) - mean(a)).slice(0, keep) : pool;
    for (const v of pool) sampleUpTo(v, upTo);
  }
  const best = [...pool].sort((a, b) => mean(b) - mean(a))[0] ?? ranked[0] ?? legal[0]!;
  return { vertex: best, value: mean(best) };
}

/**
 * A start that cannot produce timber, clay or hay at all is a trap the race
 * underrates: every road and settlement then goes through the bank at four to
 * one, and in a real game a bot with two rock corners built its first road on
 * turn 57. Each of those three missing costs the opening dearly; missing rock or
 * wool costs less, since cities and cards can wait.
 */
export function starved(t: Table, me: string): number {
  const made = emptyHand();
  for (const [v, b] of Object.entries(t.buildings)) {
    if (b.player !== me) continue;
    const corner = cornerIncome(t.board, Number(v), null);
    for (const r of RESOURCES) made[r] += corner[r];
  }
  let cost = 0;
  for (const r of ['wood', 'brick', 'wheat'] as const) if (made[r] <= 0) cost += TUNING.starvedKey;
  for (const r of ['ore', 'sheep'] as const) if (made[r] <= 0) cost += TUNING.starvedOther;
  return cost * TUNING.gainScale;
}

const add = (a: Hand, b: Hand): Hand => {
  const out = { ...a };
  for (const r of RESOURCES) out[r] += b[r];
  return out;
};

/** The starting road: whichever edge leaves the bot closest to the corners it wants next. */
export function chooseOpeningRoad(g: Game, th: Thinker): GameAction {
  const options = roadSites(g, th.me, g.setupVertex);
  let best = options[0]!,
    bestValue = -1;
  for (const edge of options) {
    const t: Table = { ...g, roads: { ...g.roads, [edge]: th.me } };
    const v = value(t, th, false);
    if (v > bestValue) {
      bestValue = v;
      best = edge;
    }
  }
  return { kind: 'road', edge: best };
}
