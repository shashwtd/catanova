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
import type { Resource } from '../../../rules/src/index.js';
import type { Board } from '../../../rules/src/board.js';
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
import { TUNING } from './tuning.js';

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
/**
 * Cards still missing for `cost` after `t` rolls: what income has not covered,
 * less what spare cards buy at the bank: four spare of a kind (fewer with a
 * harbour) buy one card, and a part-filled trade counts for a little. Counting
 * spare cards in full as fractions of a card made a hand of rock look a few rolls
 * from a city when the bot had no way to get the hay, and it sat on that hand for
 * fifty turns.
 */
function shortfallAt(hand: Hand, cost: Hand, perRoll: Hand, rate: Hand, t: number): number {
  let deficit = 0,
    convertible = 0;
  for (let i = 0; i < 5; i++) {
    const r = RESOURCES[i]!;
    const have = hand[r] + perRoll[r] * t;
    if (have < cost[r]) deficit += cost[r] - have;
    else {
      // Whole trades count in full; a part-filled trade counts for a little,
      // because more of that resource is on the way.
      const trades = (have - cost[r]) / rate[r];
      const whole = Math.floor(trades + 1e-9);
      // Counting it in full made a hand of rock look a few rolls from a city; not at
      // all made the score so lumpy the search lost a fifth of its games.
      convertible += whole + TUNING.partialTrade * (trades - whole);
    }
  }
  return deficit - convertible;
}

/**
 * Rolls until `cost` is affordable from `hand`, with `perRoll` arriving each roll
 * and spare cards traded at the bank or a harbour in whole trades. Income is an
 * average, so the answer is continuous. It is solved exactly: the shortfall falls
 * in straight lines, and drops a little each time a pile of spare cards makes
 * another whole trade, so the solve walks from one such moment to the next.
 */
export function rollsToAfford(hand: Hand, cost: Hand, perRoll: Hand, rate: Hand): number {
  let f = shortfallAt(hand, cost, perRoll, rate, 0);
  if (f <= 0) return 0;
  const part = TUNING.partialTrade;
  // For each resource: its slope now, and when it next changes (turns spare, or
  // completes another whole trade).
  let slope = 0;
  const next = [Infinity, Infinity, Infinity, Infinity, Infinity];
  const spare = [false, false, false, false, false];
  for (let i = 0; i < 5; i++) {
    const r = RESOURCES[i]!;
    const p = perRoll[r];
    const x = hand[r] - cost[r];
    if (x < 0) {
      slope -= p;
      if (p > 0) next[i] = -x / p;
    } else {
      spare[i] = true;
      slope -= (part * p) / rate[r];
      if (p > 0) next[i] = ((Math.floor(x / rate[r] + 1e-9) + 1) * rate[r] - x) / p;
    }
  }
  let t = 0;
  for (let guard = 0; guard < 1000; guard++) {
    let i = 0;
    for (let j = 1; j < 5; j++) if (next[j]! < next[i]!) i = j;
    const at = next[i]!;
    // (A little slack: the last missing card often arrives exactly at a turning point.)
    if (slope < 0 && t + f / -slope <= at + 1e-9) return Math.min(MAX_ROLLS, t + f / -slope);
    if (at >= MAX_ROLLS) return MAX_ROLLS;
    f += slope * (at - t);
    t = at;
    const r = RESOURCES[i]!;
    const p = perRoll[r];
    if (!spare[i]) {
      // No longer missing: from here it piles up toward trades.
      spare[i] = true;
      slope += p - (part * p) / rate[r];
    } else f -= 1 - part;
    next[i] = t + rate[r] / p;
    if (f <= 1e-9) return t;
  }
  return MAX_ROLLS;
}

/** The same, by halving: kept to check the exact solve against. */
export function rollsToAffordByHalving(hand: Hand, cost: Hand, perRoll: Hand, rate: Hand): number {
  if (shortfallAt(hand, cost, perRoll, rate, 0) <= 0) return 0;
  let lo = 0,
    hi = 4;
  while (shortfallAt(hand, cost, perRoll, rate, hi) > 0) {
    if (hi >= MAX_ROLLS) return MAX_ROLLS;
    lo = hi;
    hi = Math.min(MAX_ROLLS, hi * 2);
  }
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (shortfallAt(hand, cost, perRoll, rate, mid) > 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The harbour each corner gives, if any, per board. */
const harbourCache = new WeakMap<Board, Map<number, Resource | 'any'>>();
function harbours(board: Board): Map<number, Resource | 'any'> {
  let out = harbourCache.get(board);
  if (!out) {
    out = new Map();
    for (const port of board.ports ?? []) {
      const edge = board.edges[port.edge];
      if (edge) for (const v of [edge.a, edge.b]) out.set(v, port.resource);
    }
    harbourCache.set(board, out);
  }
  return out;
}

/** Trade rates once a harbour is owned. */
function withHarbour(rate: Hand, harbour: Resource | 'any' | undefined): Hand {
  if (!harbour) return rate;
  if (harbour !== 'any') return { ...rate, [harbour]: Math.min(rate[harbour], 2) };
  const out = { ...rate };
  for (const r of RESOURCES) out[r] = Math.min(out[r], 3);
  return out;
}

/**
 * Rolls until `cost` is affordable from nothing, trading every spare part-card at
 * the bank: a quick estimate, for pricing the rest of a race. Solved exactly: the
 * shortfall falls in straight lines between the rolls at which each resource
 * turns from missing to spare.
 */
export function roughRolls(cost: Hand, perRoll: Hand, rate: Hand): number {
  // shortfall(t) = a − b·t between turning points.
  let a = 0,
    b = 0;
  const turns: { t: number; r: Resource }[] = [];
  for (const r of RESOURCES) {
    if (cost[r] > 0) {
      a += cost[r];
      b += perRoll[r];
      if (perRoll[r] > 0) turns.push({ t: cost[r] / perRoll[r], r });
    } else b += perRoll[r] / rate[r];
  }
  turns.sort((x, y) => x.t - y.t);
  for (const { t, r } of turns) {
    if (b > 0 && a / b <= t) return Math.min(MAX_ROLLS, a / b);
    // Past this point the resource is spare: no longer missing, and trading at its rate.
    a += cost[r] / rate[r] - cost[r];
    b += perRoll[r] / rate[r] - perRoll[r];
  }
  return b > 0 ? Math.min(MAX_ROLLS, a / b) : MAX_ROLLS;
}

/**
 * What a corner makes per roll over the race. The robber's tile is only partly
 * lost: the robber moves on at the next seven or knight, a few rolls away, while
 * a race runs for dozens.
 */
function raceCorner(t: Table, vertex: number): Hand {
  const lost = TUNING.robberBlock;
  if (lost >= 1) return cornerIncome(t.board, vertex, t.robber);
  const open = cornerIncome(t.board, vertex, null);
  if (lost <= 0 || !t.board.hexes[t.robber]?.vertices.includes(vertex)) return open;
  return mix(open, cornerIncome(t.board, vertex, t.robber), lost);
}

/** A player's income over the race, the robber's tile partly lost (see `raceCorner`). */
function raceIncome(t: Table, id: string): Hand {
  const lost = TUNING.robberBlock;
  if (lost >= 1) return income(t, id);
  const open = income(t, id, null);
  return lost <= 0 ? open : mix(open, income(t, id), lost);
}

const mix = (a: Hand, b: Hand, w: number): Hand => ({
  wood: a.wood + (b.wood - a.wood) * w,
  brick: a.brick + (b.brick - a.brick) * w,
  sheep: a.sheep + (b.sheep - a.sheep) * w,
  wheat: a.wheat + (b.wheat - a.wheat) * w,
  ore: a.ore + (b.ore - a.ore) * w,
});

const scale = (h: Hand, k: number): Hand => ({
  wood: h.wood * k,
  brick: h.brick * k,
  sheep: h.sheep * k,
  wheat: h.wheat * k,
  ore: h.ore * k,
});
const roadsCost = (n: number) => scale(COSTS.road as Hand, n);
const SETTLEMENT_AND_ROAD = plus(COSTS.settlement as Hand, COSTS.road as Hand);

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
    dist.set(p.id, roadDistances(t, p.id, TUNING.reach));
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

  let rate = rates(t, id);
  let perRoll = raceIncome(t, id);
  // Year of Plenty, Monopoly and Road Building are worth a couple of cards each.
  let hand: Hand = plus(player.hand, scale(averageCard(perRoll), know.otherCards * TUNING.progressCardWorth));
  let settlements = settlementCount(t, id);
  let citiesLeft = 4 - cityCount(t, id);
  let settlementsLeft = 5 - settlements;
  let roadsLeft = 15 - roadCount(t, id);

  // Corners the player can reach, with the roads each needs, best first.
  const dist = common.dist.get(id) ?? roadDistances(t, id, TUNING.reach);
  const theirs = t.players
    .filter((p) => p.id !== id && !p.resigned)
    .map((p) => common.dist.get(p.id) ?? new Map<number, number>());
  let sites = [...dist.entries()]
    .filter(([v]) => openCorner(t, v))
    .map(([v, d]) => {
      // A corner an opponent is closer to will probably be gone.
      const rival = Math.min(99, ...theirs.map((m) => m.get(v) ?? 99));
      // How likely the corner is still ours by the time we get there.
      const odds =
        TUNING.contest === 'skip'
          ? rival < d
            ? 0
            : 1
          : rival < d
            ? TUNING.contestBehind
            : rival === d
              ? TUNING.contestLevel
              : rival === d + 1
                ? TUNING.contestAhead
                : 1;
      const harbour = TUNING.raceHarbours ? harbours(t.board).get(v) : undefined;
      return { vertex: v, roads: d, gain: raceCorner(t, v), odds, harbour };
    })
    .filter((s) => s.odds > 0)
    .sort((a, b) => incomeTotal(b.gain) * b.odds - incomeTotal(a.gain) * a.odds);
  // The settlement worth upgrading first: the most productive one.
  let upgrades = Object.entries(t.buildings)
    .filter(([, b]) => b.player === id && b.kind === 'settlement')
    .map(([v]) => ({ vertex: Number(v), gain: raceCorner(t, Number(v)) }))
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
  let steps: Step[] = [];
  // The quickest way seen to finish in one more purchase, from some point on the way.
  let finish: { rolls: number; at: number; step: Step } | null = null;
  // Rolls per point at a given income: what the rest of the race costs, roughly.
  const perPoint = (inc: Hand) =>
    Math.min(
      rollsToAfford(emptyHand(), COSTS.city as Hand, inc, rate),
      rollsToAfford(emptyHand(), plus(COSTS.settlement as Hand, COSTS.road as Hand), inc, rate),
    );
  const roughPoint = (inc: Hand, at: Hand) =>
    Math.min(roughRolls(COSTS.city as Hand, inc, at), roughRolls(SETTLEMENT_AND_ROAD, inc, at));
  const bias = (kind: Step['kind']) => {
    if (!lean) return 1;
    const favoured: Record<Strategy, Step['kind'][]> = {
      cities: ['city'],
      expansion: ['settlement'],
      development: ['army', 'card'],
      road: ['road', 'settlement'],
    };
    return favoured[lean].includes(kind) ? TUNING.leanBias : 1;
  };

  // Six purchases are planned one by one; the rest is costed at the income reached.
  for (let guard = 0; need > 0 && guard < TUNING.raceSteps; guard++) {
    const options: (Step & { after: Hand; score: number; cost: Hand })[] = [];
    // What a point costs at today's income; more income makes every later point
    // cheaper in proportion.
    const pointNow = perPoint(perRoll);
    const incomeNow = Math.max(0.05, incomeTotal(perRoll));
    const roughNow = TUNING.restPriced ? roughPoint(perRoll, rate) : 0;
    const consider = (step: Omit<Step, 'rolls'>, cost: Hand, gain: Hand, odds = 1, harbour?: Resource | 'any') => {
      // A corner that may be taken first costs, on average, the tries it takes.
      const r = rollsToAfford(hand, cost, perRoll, rate) / odds;
      if (r >= MAX_ROLLS) return;
      const after = plus(perRoll, gain);
      const left = Math.max(0, need - step.points);
      // The rest of the race at the income (and harbours) this purchase leaves. Priced
      // properly, a corner with the clay the bot lacks beats one with more of what it
      // has; scaled by total income alone, the two looked the same.
      const rest = !left
        ? 0
        : !TUNING.restPriced
          ? (left * pointNow * incomeNow) / Math.max(0.05, incomeTotal(after))
          : incomeTotal(gain) > 0 || harbour
            ? // The quick solve is optimistic, so only its ratio is used, on the
              // careful price of a point today.
              (left * pointNow * roughPoint(after, withHarbour(rate, harbour))) / Math.max(1e-6, roughNow)
            : left * pointNow;
      options.push({ ...step, rolls: r, after, cost, score: (r + rest) * bias(step.kind) });
    };
    if (citiesLeft > 0 && upgrades.length)
      consider({ kind: 'city', points: 1, vertex: upgrades[0]!.vertex }, COSTS.city as Hand, upgrades[0]!.gain);
    if (settlementsLeft > 0) {
      const shortlist = sites.slice(0, TUNING.sitesConsidered);
      // The best harbour in reach is weighed too, though its tiles may be poorer.
      const harbour = TUNING.raceHarbours ? sites.find((s) => s.harbour) : undefined;
      if (harbour && !shortlist.includes(harbour)) shortlist.push(harbour);
      for (const site of shortlist)
        if (site.roads <= roadsLeft)
          consider(
            { kind: 'settlement', points: 1, site: site.vertex, roads: site.roads },
            plus(COSTS.settlement as Hand, roadsCost(site.roads)),
            site.gain,
            site.odds,
            site.harbour,
          );
    }
    if (Number.isFinite(knightsNeeded)) {
      // A knight is 14 cards in 25; buying for one costs about 1.8 cards' worth each.
      const buys = Math.max(0, knightsNeeded) / TUNING.knightShare;
      consider({ kind: 'army', points: 2 }, scale(COSTS.developmentCard as Hand, Math.max(0.01, buys)), emptyHand());
    }
    if (Number.isFinite(roadsNeeded) && roadsNeeded <= roadsLeft && roadsNeeded <= 6)
      consider({ kind: 'road', points: 2, roads: roadsNeeded }, roadsCost(roadsNeeded), emptyHand());
    // Cards for their points alone: one in five is a point, so a point costs five cards.
    consider({ kind: 'card', points: 1 }, scale(COSTS.developmentCard as Hand, TUNING.cardsPerPoint), emptyHand());

    if (!options.length) {
      rolls += need * 60;
      break;
    }
    // Greedy picks the cheapest next point, which can overshoot: a settlement and
    // then the army (three points) when the army alone was the two needed. So the
    // race also remembers finishing with one purchase from here.
    if (TUNING.raceFinish)
      for (const o of options)
        if (o.points >= need && (!finish || rolls + o.rolls < finish.rolls))
          finish = { rolls: rolls + o.rolls, at: steps.length, step: { kind: o.kind, rolls: o.rolls, points: o.points, site: o.site, vertex: o.vertex, roads: o.roads } };
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
    if (best.rolls === 0) hand = afterPaying(hand, best.cost, rate);
    else hand = emptyHand();
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
      rate = withHarbour(rate, chosen.harbour);
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
  // Whatever is still missing costs what points cost at the income reached, and
  // never less than the last planned point did. The quick estimate assumes a
  // cheap corner is always free; letting it undercut the planned steps made a race
  // with points still to estimate look shorter than one that had planned them, so
  // building a city the bot could afford looked worse than waiting.
  if (need > 0) {
    const last = steps[steps.length - 1];
    const planned = last && last.points > 0 ? last.rolls / last.points : 0;
    rolls += need * Math.min(60, Math.max(perPoint(perRoll), planned));
  }
  if (finish && finish.rolls < rolls) {
    rolls = finish.rolls;
    steps = [...steps.slice(0, finish.at), finish.step];
  }
  return { rolls, steps };
}

/**
 * The hand left after paying `cost` from it, bank trades included. Missing cards
 * are bought with whole trades from the biggest spare piles first, and a missing
 * card the whole trades cannot cover uses up what spare is left. Without this a
 * hand that could trade its way to a city kept every card it traded, the same
 * sheep paid for the city and then for a settlement, and the bigger the hand the
 * better holding it looked: the bots sat on eleven cards and fed the sevens.
 */
export function afterPaying(hand: Hand, cost: Hand, rate: Hand): Hand {
  const left = { ...hand };
  let missing = 0;
  for (const r of RESOURCES) {
    left[r] -= cost[r];
    if (left[r] < 0) {
      missing += -left[r];
      left[r] = 0;
    }
  }
  while (missing > 0) {
    // The spare pile that buys a card soonest: most whole trades in hand.
    let pick: (typeof RESOURCES)[number] | null = null;
    for (const r of RESOURCES)
      if (left[r] >= rate[r] && (!pick || left[r] / rate[r] > left[pick] / rate[pick])) pick = r;
    if (!pick) {
      // No whole trade left: whatever spare remains goes toward the rest.
      for (const r of RESOURCES) left[r] = 0;
      break;
    }
    left[pick] -= rate[pick];
    missing--;
  }
  return left;
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
export function sevenRisk(
  t: Table,
  id: string,
  rollsUntilMyTurn: number,
  sevens: (rolls: number) => number = (rolls) => 1 - (5 / 6) ** rolls,
): number {
  const player = t.players.find((p) => p.id === id);
  if (!player) return 0;
  const perRoll = Math.max(0.15, incomeTotal(income(t, id)));
  // The hand that will meet the seven: what is held now plus what arrives first.
  const n = handSize(player.hand) + perRoll * Math.max(0, rollsUntilMyTurn - 1) * TUNING.sevenIncomeShare;
  if (n <= TUNING.sevenThreshold) return 0;
  const chance = sevens(Math.max(0, rollsUntilMyTurn));
  return (chance * Math.floor(n / 2)) / perRoll;
}

export type Standing = { id: string; rolls: number; chance: number; race: Race };

/**
 * What the race misses, measured. Fitting who actually won self-play games
 * against the race alone found it undervalues producing many kinds of resource,
 * room to expand and cards in hand, and overvalues an award already held (it
 * treats them as permanent; they change hands). These are the public facts
 * about a player that correct for it, each weighed by `TUNING.features`.
 */
export type Feature =
  | 'points'
  | 'income'
  | 'kinds'
  | 'minIncome'
  | 'sites2'
  | 'harbours'
  | 'hand'
  | 'devHeld'
  | 'knights'
  | 'trail'
  | 'awards';

/** Corners a player could settle within two new roads. */
function openSites(t: Table, id: string, common: Shared): number {
  let n = 0;
  for (const [v, d] of common.dist.get(id) ?? []) if (d <= 2 && openCorner(t, v)) n++;
  return n;
}

export function features(t: Table, id: string, know: Knowledge, common: Shared): Record<Feature, number> {
  const seat = t.players.find((p) => p.id === id)!;
  const made = income(t, id, null);
  let kinds = 0,
    least = Infinity,
    total = 0;
  for (const r of RESOURCES) {
    total += made[r];
    if (made[r] > 0) kinds++;
    least = Math.min(least, made[r]);
  }
  const sites2 = openSites(t, id, common);
  const rate = rates(t, id);
  return {
    points: know.points,
    income: total,
    kinds,
    minIncome: least,
    sites2,
    harbours: RESOURCES.filter((r) => rate[r] < 4).length,
    hand: handSize(seat.hand),
    devHeld: seat.cards.length,
    knights: seat.knights,
    trail: common.trail.get(id) ?? 0,
    awards: (t.longestRoad === id ? 1 : 0) + (t.largestArmy === id ? 1 : 0),
  };
}

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
  options: {
    endOfTurn?: boolean;
    lean?: Record<string, Strategy | undefined>;
    /** The chance of a seven within so many rolls, when the dice are counted. */
    sevens?: (rolls: number) => number;
  } = {},
): Standing[] {
  const seats = t.players.filter((p) => !p.resigned);
  const n = Math.max(1, seats.length);
  const goal = target(t);
  const order = t.players.map((p) => p.id);
  const common = shared(t);
  const coef = TUNING.features;
  const races = seats.map((p) => {
    const k = know(p.id);
    const r = race(t, p.id, k, options.lean?.[p.id], common);
    let bonus = 0;
    if (coef) {
      // Open corners in reach alone is cheap; anything else takes the full set.
      const keys = Object.keys(coef) as Feature[];
      if (keys.length === 1 && keys[0] === 'sites2') bonus = coef.sites2! * openSites(t, p.id, common);
      else {
        const f = features(t, p.id, k, common);
        for (const name of keys) bonus += coef[name]! * f[name];
      }
    }
    // Seats after the one on turn get their next build sooner.
    const seat = order.indexOf(p.id);
    const wait = (seat - t.active + t.players.length) % t.players.length;
    let rolls = r.rolls + wait * TUNING.waitPerSeat;
    if (options.endOfTurn) rolls += sevenRisk(t, p.id, wait === 0 ? n : wait, options.sevens);
    return { id: p.id, rolls, race: r, won: k.points >= goal, bonus };
  });
  const winner = races.find((r) => r.won);
  if (winner) return races.map((r) => ({ id: r.id, rolls: r.rolls, race: r.race, chance: r.id === winner.id ? 1 : 0 }));
  // Rounds of the table, and how much luck is left: a long race is less certain.
  const rounds = races.map((r) => r.rolls / n);
  const least = Math.min(...rounds);
  const temperature = TUNING.temperatureBase + TUNING.temperaturePerRound * least;
  // The race in rounds, plus the measured correction, as the softmax's scores.
  const scores = rounds.map((r, i) => -(r - least) / temperature + races[i]!.bonus);
  const top = Math.max(...scores);
  const weights = scores.map((x) => Math.exp(x - top));
  const sum = weights.reduce((a, b) => a + b, 0);
  return races.map((r, i) => ({ id: r.id, rolls: r.rolls, race: r.race, chance: weights[i]! / sum }));
}
