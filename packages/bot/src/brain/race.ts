/**
 * The race to ten points.
 *
 * JSettlers' idea, and the best-tested way of judging a Catan position: from what
 * a player produces each roll and the harbours they own, how many rolls until
 * each purchase is affordable, and how many rolls until they win if they buy the
 * cheapest points first. A move is good when it shortens the bot's own race and
 * lengthens everybody else's.
 *
 * Everything is measured in rolls of the dice, because income arrives on every
 * roll, whoever rolls it. `winChances` turns the races into a chance of winning
 * for every player, which is the one currency every decision is priced in.
 */

import { RESOURCES } from '../../../rules/src/index.js';
import type { Hand } from '../../../rules/src/game.js';
import {
  COSTS,
  canAfford,
  cityCount,
  cornerIncome,
  emptyHand,
  handSize,
  income,
  incomeTotal,
  openCorner,
  plus,
  rates,
  roadCount,
  roadDistances,
  settlementCount,
  target,
} from './table.js';
import type { Table } from './table.js';
import { longestTrail } from '../../../rules/src/game.js';

/** How the long game is being played. The advisor's plan leans the race toward one. */
export type Strategy = 'cities' | 'expansion' | 'development' | 'road';

/** What the brain knows or expects about a player beyond the table: hidden points, knights in hand. */
export type Knowledge = {
  /** Points counted for the player, hidden ones included (expected, for an opponent). */
  points: number;
  /** Knights in hand, not yet played (expected, for an opponent). */
  knightsHeld: number;
  /** Development cards that are neither knights nor points: worth a couple of resources each. */
  otherCards: number;
};

export type Step = {
  kind: 'city' | 'settlement' | 'army' | 'road' | 'card';
  rolls: number;
  points: number;
  site?: number;
  vertex?: number;
  roads?: number;
};

export type Race = { rolls: number; steps: Step[] };

const MAX_ROLLS = 400;

/**
 * Rolls until `cost` is affordable from `hand`, with `perRoll` arriving each roll
 * and any surplus converted at the player's bank or harbour rates. Continuous, so
 * that a little more income always shortens it a little.
 */
function shortfallAt(hand: Hand, cost: Hand, perRoll: Hand, rate: Hand, t: number): number {
  let s = 0;
  for (let i = 0; i < 5; i++) {
    const r = RESOURCES[i]!;
    const have = hand[r] + perRoll[r] * t;
    s += have < cost[r] ? cost[r] - have : -(have - cost[r]) / rate[r];
  }
  return s;
}

export function rollsToAfford(hand: Hand, cost: Hand, perRoll: Hand, rate: Hand): number {
  // Short of cards on resource r while hand + income·t < cost; beyond that the
  // surplus converts at the rate. shortfall(t) = deficit − convertible is
  // piecewise linear and falling, with a kink where each resource stops being
  // short, so the root is found exactly between two kinks.
  let covered = true;
  const kinks: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = RESOURCES[i]!;
    const gap = cost[r] - hand[r];
    if (gap > 0) {
      covered = false;
      if (perRoll[r] > 0) kinks.push(gap / perRoll[r]);
    }
  }
  if (covered) return 0;
  kinks.sort((a, b) => a - b);
  kinks.push(MAX_ROLLS);
  let lo = 0,
    fLo = shortfallAt(hand, cost, perRoll, rate, 0);
  if (fLo <= 0) return 0;
  for (const hi of kinks) {
    if (hi <= lo) continue;
    const fHi = shortfallAt(hand, cost, perRoll, rate, Math.min(hi, MAX_ROLLS));
    if (fHi <= 0) return lo + (fLo * (hi - lo)) / (fLo - fHi);
    lo = hi;
    fLo = fHi;
    if (lo >= MAX_ROLLS) break;
  }
  return MAX_ROLLS;
}

const scale = (h: Hand, k: number): Hand => ({
  wood: h.wood * k,
  brick: h.brick * k,
  sheep: h.sheep * k,
  wheat: h.wheat * k,
  ore: h.ore * k,
});
const roadsCost = (n: number) => scale(COSTS.road as Hand, n);

/**
 * The race for one player: rolls until ten points, and the purchases on the way.
 *
 * Greedy, as JSettlers' is, but each purchase is weighed with what it does to the
 * rest of the race: a settlement that adds production shortens every later step,
 * so it can beat a slightly cheaper point that adds none.
 */
/** Work shared by every player's race in one position: road distances and road lengths. */
export type Shared = { dist: Map<string, Map<number, number>>; trail: Map<string, number> };

export function shared(t: Table): Shared {
  const dist = new Map<string, Map<number, number>>();
  const trail = new Map<string, number>();
  for (const p of t.players) {
    if (p.resigned) continue;
    dist.set(p.id, roadDistances(t, p.id, 3));
    trail.set(p.id, longestTrail(t as never, p.id));
  }
  return { dist, trail };
}

export function race(t: Table, id: string, know: Knowledge, lean?: Strategy, common: Shared = shared(t)): Race {
  const player = t.players.find((p) => p.id === id);
  if (!player || player.resigned) return { rolls: MAX_ROLLS * 4, steps: [] };
  const goal = target(t);
  let need = goal - know.points;
  if (need <= 0) return { rolls: 0, steps: [] };

  const rate = rates(t, id);
  let perRoll = income(t, id);
  // Year of Plenty, Monopoly and Road Building are worth a couple of cards each.
  let hand: Hand = plus(player.hand, scale(averageCard(perRoll), know.otherCards * 2));
  let settlements = settlementCount(t, id);
  let citiesLeft = 4 - cityCount(t, id);
  let settlementsLeft = 5 - settlements;
  let roadsLeft = 15 - roadCount(t, id);

  // Corners the player can reach, with the roads each needs, best first.
  const dist = common.dist.get(id) ?? roadDistances(t, id, 3);
  const theirs = t.players
    .filter((p) => p.id !== id && !p.resigned)
    .map((p) => common.dist.get(p.id) ?? new Map<number, number>());
  let sites = [...dist.entries()]
    .filter(([v]) => openCorner(t, v))
    .map(([v, d]) => {
      // A corner an opponent is closer to will probably be gone.
      const rival = Math.min(99, ...theirs.map((m) => m.get(v) ?? 99));
      return { vertex: v, roads: d, gain: cornerIncome(t.board, v, t.robber), contested: rival < d };
    })
    .filter((s) => !s.contested)
    .sort((a, b) => incomeTotal(b.gain) - incomeTotal(a.gain));
  // The settlement worth upgrading first: the most productive one.
  let upgrades = Object.entries(t.buildings)
    .filter(([, b]) => b.player === id && b.kind === 'settlement')
    .map(([v]) => ({ vertex: Number(v), gain: cornerIncome(t.board, Number(v), t.robber) }))
    .sort((a, b) => incomeTotal(b.gain) - incomeTotal(a.gain));

  // Awards: what it would take to claim one that is held elsewhere.
  const holderKnights = t.largestArmy
    ? (t.players.find((p) => p.id === t.largestArmy)?.knights ?? 0)
    : 2;
  let knightsNeeded =
    t.largestArmy === id ? Infinity : Math.max(0, holderKnights + 1 - player.knights - know.knightsHeld);
  const holderRoad = t.longestRoad ? (common.trail.get(t.longestRoad) ?? longestTrail(t as never, t.longestRoad)) : 4;
  const myRoad = common.trail.get(id) ?? longestTrail(t as never, id);
  let roadsNeeded = t.longestRoad === id ? Infinity : Math.max(1, holderRoad + 1 - myRoad);

  let rolls = 0;
  const steps: Step[] = [];
  // Rolls per point at a given income: what the rest of the race costs, roughly.
  const perPoint = (inc: Hand) =>
    Math.min(
      rollsToAfford(emptyHand(), COSTS.city as Hand, inc, rate),
      rollsToAfford(emptyHand(), plus(COSTS.settlement as Hand, COSTS.road as Hand), inc, rate),
    );
  const bias = (kind: Step['kind']) => {
    if (!lean) return 1;
    const favoured: Record<Strategy, Step['kind'][]> = {
      cities: ['city'],
      expansion: ['settlement'],
      development: ['army', 'card'],
      road: ['road', 'settlement'],
    };
    return favoured[lean].includes(kind) ? 0.92 : 1;
  };

  // Six purchases are planned one by one; the rest is costed at the income reached.
  for (let guard = 0; need > 0 && guard < 6; guard++) {
    const options: (Step & { after: Hand; score: number; cost: Hand })[] = [];
    // What a point costs at today's income; more income makes every later point
    // cheaper in proportion.
    const pointNow = perPoint(perRoll);
    const incomeNow = Math.max(0.05, incomeTotal(perRoll));
    const consider = (step: Omit<Step, 'rolls'>, cost: Hand, gain: Hand) => {
      const r = rollsToAfford(hand, cost, perRoll, rate);
      if (r >= MAX_ROLLS) return;
      const after = plus(perRoll, gain);
      const rest = (Math.max(0, need - step.points) * pointNow * incomeNow) / Math.max(0.05, incomeTotal(after));
      options.push({ ...step, rolls: r, after, cost, score: (r + rest) * bias(step.kind) });
    };
    if (citiesLeft > 0 && upgrades.length)
      consider({ kind: 'city', points: 1, vertex: upgrades[0]!.vertex }, COSTS.city as Hand, upgrades[0]!.gain);
    if (settlementsLeft > 0)
      for (const site of sites.slice(0, 3))
        if (site.roads <= roadsLeft)
          consider(
            { kind: 'settlement', points: 1, site: site.vertex, roads: site.roads },
            plus(COSTS.settlement as Hand, roadsCost(site.roads)),
            site.gain,
          );
    if (Number.isFinite(knightsNeeded)) {
      // A knight is 14 cards in 25; buying for one costs about 1.8 cards' worth each.
      const buys = Math.max(0, knightsNeeded) / 0.56;
      consider({ kind: 'army', points: 2 }, scale(COSTS.developmentCard as Hand, Math.max(0.01, buys)), emptyHand());
    }
    if (Number.isFinite(roadsNeeded) && roadsNeeded <= roadsLeft && roadsNeeded <= 6)
      consider({ kind: 'road', points: 2, roads: roadsNeeded }, roadsCost(roadsNeeded), emptyHand());
    // Cards for their points alone: one in five is a point, so a point costs five cards.
    consider({ kind: 'card', points: 1 }, scale(COSTS.developmentCard as Hand, 5), emptyHand());

    if (!options.length) {
      rolls += need * 60;
      break;
    }
    // Anything affordable right now costs no time, so it is bought first.
    const now = options.filter((o) => o.rolls === 0);
    const best = (now.length ? now : options).reduce((a, b) => (b.score < a.score ? b : a));
    rolls += best.rolls;
    steps.push({ kind: best.kind, rolls: best.rolls, points: best.points, site: best.site, vertex: best.vertex, roads: best.roads });
    need -= best.points;
    // What is left after the purchase. Bought straight from the hand, the rest of
    // the hand is still there. Saved up for, the surplus went into bank trades on
    // the way (that is how the wait ended), so the next purchase starts from
    // nothing, as JSettlers' estimate does.
    if (best.rolls === 0) {
      const left = emptyHand();
      for (const r of RESOURCES) left[r] = Math.max(0, hand[r] - best.cost[r]);
      hand = left;
    } else hand = emptyHand();
    perRoll = best.after;
    if (best.kind === 'city') {
      citiesLeft--;
      settlements--;
      settlementsLeft++;
      upgrades = upgrades.slice(1);
    } else if (best.kind === 'settlement') {
      settlementsLeft--;
      settlements++;
      roadsLeft -= best.roads ?? 0;
      const chosen = sites.find((s) => s.vertex === best.site)!;
      upgrades = [...upgrades, { vertex: chosen.vertex, gain: chosen.gain }].sort(
        (a, b) => incomeTotal(b.gain) - incomeTotal(a.gain),
      );
      const near = new Set([chosen.vertex, ...(t.board.vertices[chosen.vertex]?.neighbors ?? [])]);
      sites = sites.filter((s) => !near.has(s.vertex)).map((s) => ({ ...s, roads: s.roads + 1 }));
    } else if (best.kind === 'army') knightsNeeded = Infinity;
    else if (best.kind === 'road') {
      roadsNeeded = Infinity;
      roadsLeft -= best.roads ?? 0;
    }
  }
  // Whatever is still missing costs what points cost at the income reached.
  if (need > 0) rolls += need * Math.min(60, perPoint(perRoll));
  return { rolls, steps };
}

/** An average card from this income, for valuing cards of no fixed kind. */
function averageCard(perRoll: Hand): Hand {
  const total = incomeTotal(perRoll);
  if (!total) return { wood: 0.2, brick: 0.2, sheep: 0.2, wheat: 0.2, ore: 0.2 };
  return scale(perRoll, 1 / total);
}

/**
 * The chance of losing half the hand to a seven before this player's next turn,
 * as rolls of the race. Only counted when the turn is over and the hand is big.
 */
export function sevenRisk(t: Table, id: string, rollsUntilMyTurn: number): number {
  const player = t.players.find((p) => p.id === id);
  if (!player) return 0;
  const n = handSize(player.hand);
  if (n <= 7) return 0;
  const chance = 1 - (5 / 6) ** Math.max(0, rollsUntilMyTurn);
  const perRoll = Math.max(0.15, incomeTotal(income(t, id)));
  return (chance * Math.floor(n / 2)) / perRoll;
}

export type Standing = { id: string; rolls: number; chance: number; race: Race };

/**
 * Every player's chance of winning from here.
 *
 * Races are turned into rounds of the table (a player builds only on their own
 * turn), the player who moves sooner is slightly ahead, and the rounds become
 * chances through a softmax whose temperature says how much luck is left. A
 * player already on the target has won.
 */
export function winChances(
  t: Table,
  know: (id: string) => Knowledge,
  options: { endOfTurn?: boolean; lean?: Record<string, Strategy | undefined> } = {},
): Standing[] {
  const seats = t.players.filter((p) => !p.resigned);
  const n = Math.max(1, seats.length);
  const goal = target(t);
  const order = t.players.map((p) => p.id);
  const common = shared(t);
  const races = seats.map((p) => {
    const k = know(p.id);
    const r = race(t, p.id, k, options.lean?.[p.id], common);
    // Seats after the one on turn get their next build sooner.
    const seat = order.indexOf(p.id);
    const wait = (seat - t.active + t.players.length) % t.players.length;
    let rolls = r.rolls + (wait / n) * n * 0.5;
    if (options.endOfTurn) rolls += sevenRisk(t, p.id, wait === 0 ? n : wait);
    return { id: p.id, rolls, race: r, won: k.points >= goal };
  });
  const winner = races.find((r) => r.won);
  if (winner) return races.map((r) => ({ id: r.id, rolls: r.rolls, race: r.race, chance: r.id === winner.id ? 1 : 0 }));
  // Rounds of the table, and how much luck is left: a long race is less certain.
  const rounds = races.map((r) => r.rolls / n);
  const least = Math.min(...rounds);
  const temperature = 1.2 + 0.18 * least;
  const weights = rounds.map((r) => Math.exp(-(r - least) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  return races.map((r, i) => ({ id: r.id, rolls: r.rolls, race: r.race, chance: weights[i]! / sum }));
}
