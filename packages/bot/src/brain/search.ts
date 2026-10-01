/**
 * Thinking a turn through.
 *
 * The bot tries whole sequences of moves on imagined copies of the game, played
 * by the real rules (`simulateAction`), and scores where each sequence leaves it
 * when the turn ends: its chance of winning, from the race to ten points. The
 * sequence with the best ending wins, and the bot plays its first move. After that
 * move it thinks again from the new position, so a plan that stops making sense
 * halfway through a turn is dropped.
 *
 * Chance is averaged rather than guessed: a development card is every card it
 * could be, weighted by the cards nobody has seen; a steal is every card the
 * victim could be holding, weighted by the counting.
 */

import { COSTS, RESOURCES } from '../../../rules/src/index.js';
import type { Resource } from '../../../rules/src/index.js';
import { isLand, pips, seededRandom } from '../../../rules/src/board.js';
import { owedMoves } from '../../../rules/src/owed.js';
import { timeoutAction } from '../../../rules/src/timeout.js';
import { robberVictims, roadSites, settlementSites, simulateAction } from '../../../rules/src/game.js';
import type { CardKind, Game, GameAction, Hand } from '../../../rules/src/game.js';
import { cardChance, composition } from './belief.js';
import type { Belief } from './belief.js';
import { race, winChances } from './race.js';
import { TUNING } from './tuning.js';
import type { Knowledge, Standing, Strategy } from './race.js';
import { canAfford, cityCount, emptyHand, handSize, rates, roadCount, settlementCount } from './table.js';
import type { Table } from './table.js';

export type Thinker = {
  me: string;
  /** Points, knights and cards for each player, given a position. */
  know: (t: Table) => (id: string) => Knowledge;
  belief: Belief;
  unseen: Record<CardKind, number>;
  lean?: Record<string, Strategy | undefined>;
  /** Whom the bot robbed last, to spread the robber around while nobody is ahead. */
  lastVictim?: string;
  /** The chance of a seven within so many rolls, from the counted dice; ordinary odds when absent. */
  sevens?: (rolls: number) => number;
  random: () => number;
  /** performance.now() at which to stop widening the search: a safety net only. */
  deadline: number;
  /** Positions to score before settling. The real limit, so the same position always gets the same answer. */
  positions: number;
  beam: number;
  depth: number;
  /** Positions scored, for the record. */
  scored: number;
};

const now = () => performance.now();
/** Whether the search has used its allowance. */
export const spent = (th: Thinker) => th.scored >= th.positions || now() > th.deadline;

export function standings(g: Table, th: Thinker, endOfTurn = true): Standing[] {
  th.scored++;
  return winChances(g, th.know(g), { endOfTurn, lean: th.lean, sevens: th.sevens });
}

/**
 * The bot's chance of winning from this position, with its own race length as a
 * tie-breaker: when the chance is all but certain either way (far ahead, far
 * behind), a quicker road to ten points must still count for something.
 */
export function value(g: Table, th: Thinker, endOfTurn = true): number {
  const mine = standings(g, th, endOfTurn).find((s) => s.id === th.me);
  // Cards held are cards exposed to the robber and to a seven, and a road built
  // now holds a path that could be cut later: between two lines the race rates
  // alike, prefer the one that has put its cards to work.
  const held = handSize(g.players.find((p) => p.id === th.me)?.hand ?? emptyHand());
  return (
    (mine?.chance ?? 0) -
    (mine?.rolls ?? 0) * TUNING.rollTieBreak -
    Math.max(0, held - TUNING.exposureFrom) * TUNING.exposure
  );
}

const tryMove = (g: Game, player: string, action: GameAction): Game | null => {
  try {
    return simulateAction(g, player, action, () => 0.5);
  } catch {
    return null;
  }
};

/** Every move worth considering in the bot's own action phase. */
export function turnMoves(g: Game, me: string): GameAction[] {
  const p = g.players.find((x) => x.id === me);
  if (!p) return [];
  const hand = p.hand,
    out: GameAction[] = [];
  if (canAfford(hand, COSTS.city as Hand) && cityCount(g, me) < 4)
    for (const [v, b] of Object.entries(g.buildings))
      if (b.player === me && b.kind === 'settlement') out.push({ kind: 'city', vertex: Number(v) });
  if (canAfford(hand, COSTS.settlement as Hand) && settlementCount(g, me) < 5)
    for (const v of settlementSites(g, me)) out.push({ kind: 'settlement', vertex: v });
  if (canAfford(hand, COSTS.road as Hand) && roadCount(g, me) < 15)
    for (const e of roadSites(g, me)) out.push({ kind: 'road', edge: e });
  if (canAfford(hand, COSTS.developmentCard as Hand) && g.deck.length > 0) out.push({ kind: 'buyCard' });
  const rate = rates(g, me);
  for (const give of RESOURCES)
    if (hand[give] >= rate[give])
      for (const receive of RESOURCES)
        if (receive !== give && g.bank[receive] > 0) out.push({ kind: 'bankTrade', give, receive });
  out.push(...cardMoves(g, me));
  return out;
}

/** Development cards that could be played now, with every choice each offers. */
export function cardMoves(g: Game, me: string): GameAction[] {
  const p = g.players.find((x) => x.id === me);
  if (!p || g.playedCard) return [];
  const out: GameAction[] = [];
  const seen = new Set<CardKind>();
  for (const card of p.cards) {
    if (card.kind === 'victoryPoint' || card.boughtTurn >= g.turn || seen.has(card.kind)) continue;
    seen.add(card.kind);
    if (card.kind === 'knight') out.push({ kind: 'playCard', cardId: card.id });
    if (card.kind === 'roadBuilding' && roadCount(g, me) < 15 && roadSites(g, me).length)
      out.push({ kind: 'playCard', cardId: card.id });
    if (card.kind === 'monopoly')
      for (const r of RESOURCES) out.push({ kind: 'playCard', cardId: card.id, resource: r });
    if (card.kind === 'yearOfPlenty') {
      const bankTotal = handSize(g.bank);
      if (!bankTotal) continue;
      for (let i = 0; i < RESOURCES.length; i++)
        for (let j = i; j < RESOURCES.length; j++) {
          const resources = emptyHand();
          resources[RESOURCES[i]!]++;
          resources[RESOURCES[j]!]++;
          if (RESOURCES.every((r) => g.bank[r] >= resources[r]) || bankTotal < 2)
            out.push({ kind: 'playCard', cardId: card.id, resources });
        }
    }
  }
  return out;
}

const stateKey = (g: Game, me: string) => {
  const p = g.players.find((x) => x.id === me)!;
  const mine = Object.entries(g.buildings)
    .filter(([, b]) => b.player === me)
    .map(([v, b]) => v + b.kind[0])
    .join(',');
  const roads = Object.entries(g.roads)
    .filter(([, o]) => o === me)
    .map(([e]) => e)
    .join(',');
  return `${g.phase}|${RESOURCES.map((r) => p.hand[r]).join('')}|${mine}|${roads}|${g.robber}|${p.cards.length}|${g.playedCard}|${g.freeRoads}`;
};

/**
 * Finish anything a move left owing inside the bot's own turn: a robber to place
 * after a knight, roads to place after Road Building. Each is chosen the same
 * way the bot chooses everything, by what it leaves the bot with.
 */
function settle(g: Game, th: Thinker): Game {
  let current = g;
  for (let guard = 0; guard < 4; guard++) {
    if (current.phase === 'robber' && current.players[current.active]?.id === th.me) {
      const best = bestRobber(current, th);
      const next = best && tryMove(current, th.me, best.action);
      if (!next) return current;
      current = next;
    } else if (current.phase === 'freeRoads' && current.players[current.active]?.id === th.me) {
      const options = roadSites(current, th.me);
      if (!options.length) return current;
      let best: Game | null = null,
        bestValue = -1;
      for (const edge of options) {
        const next = tryMove(current, th.me, { kind: 'road', edge });
        if (!next) continue;
        const v = value(next, th, false);
        if (v > bestValue) {
          bestValue = v;
          best = next;
        }
      }
      if (!best) return current;
      current = best;
    } else return current;
  }
  return current;
}

/** A development card is every card it could be: the value averaged over the cards nobody has seen. */
function boughtValue(g: Game, th: Thinker): number {
  const me = g.players.find((p) => p.id === th.me)!;
  const card = me.cards[me.cards.length - 1];
  if (!card) return value(g, th);
  let sum = 0,
    weight = 0;
  for (const kind of Object.keys(th.unseen) as CardKind[]) {
    const chance = cardChance(th.unseen, kind);
    if (!chance) continue;
    const original = card.kind;
    card.kind = kind;
    sum += chance * value(g, th);
    card.kind = original;
    weight += chance;
  }
  return weight ? sum / weight : value(g, th);
}

type Node = { g: Game; first: GameAction | null; value: number; line: GameAction[] };

export type Plan = { action: GameAction; value: number; line: GameAction[]; baseline: number };

/**
 * The best way to spend the rest of this turn, found by a beam search over whole
 * sequences of moves. `baseline` is the value of ending the turn now.
 */
export function planTurn(root: Game, th: Thinker): Plan {
  const baseline = value(root, th);
  let best: Node = { g: root, first: null, value: baseline, line: [] };
  let frontier: Node[] = [best];
  const seen = new Set<string>([stateKey(root, th.me)]);
  const all: Node[] = [];
  for (let depth = 0; depth < th.depth && frontier.length; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const action of turnMoves(node.g, th.me)) {
        if (spent(th) && next.length) break;
        let g = tryMove(node.g, th.me, action);
        if (!g) continue;
        g = settle(g, th);
        const key = stateKey(g, th.me);
        if (seen.has(key)) continue;
        seen.add(key);
        const v = action.kind === 'buyCard' ? boughtValue(g, th) : value(g, th);
        const child: Node = { g, first: node.first ?? action, value: v, line: [...node.line, action] };
        next.push(child);
        if (v > best.value + 1e-9) best = child;
      }
    }
    next.sort((a, b) => b.value - a.value);
    frontier = next.slice(0, th.beam);
    all.push(...next);
    if (spent(th)) break;
  }
  if (TUNING.lookahead > 0) {
    const looked = lookPast(root, all, th);
    if (looked) return { ...looked, baseline };
  }
  return { action: best.first ?? { kind: 'endTurn' }, value: best.value, line: best.line, baseline };
}

/**
 * Judge the best few candidate turns by what happens next: the dice and every
 * opponent's turn played forward to the bot's next turn, several times over, the
 * same dice for every candidate so the comparison is fair. This is what the
 * end-of-turn score cannot see on its own: a corner taken before the bot gets
 * there, a seven that lands on a big hand, a robber on its best tile.
 */
function lookPast(root: Game, nodes: Node[], th: Thinker): Plan | null {
  // The best line for each distinct first move, including ending the turn now.
  const byFirst = new Map<string, Node>();
  const consider = (node: Node) => {
    const key = JSON.stringify(node.first ?? { kind: 'endTurn' });
    const held = byFirst.get(key);
    if (!held || node.value > held.value) byFirst.set(key, node);
  };
  consider({ g: root, first: null, value: value(root, th), line: [] });
  for (const node of nodes) consider(node);
  const top = [...byFirst.values()].sort((a, b) => b.value - a.value).slice(0, TUNING.lookaheadTop);
  if (top.length < 2) return null;
  let best: { node: Node; score: number } | null = null;
  for (const node of top) {
    let sum = 0;
    for (let sample = 0; sample < TUNING.lookahead; sample++) sum += rollForward(node.g, th, 7919 * (sample + 1));
    const ahead = sum / TUNING.lookahead;
    const score = TUNING.lookaheadWeight * ahead + (1 - TUNING.lookaheadWeight) * node.value;
    if (!best || score > best.score) best = { node, score };
  }
  return best
    ? { action: best.node.first ?? { kind: 'endTurn' }, value: best.score, line: best.node.line, baseline: 0 }
    : null;
}

/** One future: the bot ends its turn, everyone else plays a simple sensible turn, and the bot is scored at its next. */
function rollForward(start: Game, th: Thinker, seed: number): number {
  const random = seededRandom(seed);
  let g = start;
  const ended = tryMove(g, th.me, { kind: 'endTurn' });
  if (!ended) return value(start, th);
  g = ended;
  for (let step = 0; step < 80; step++) {
    if (g.winner || g.phase === 'finished') break;
    const owed = owedMoves(g)[0];
    if (!owed) break;
    if (owed.player === th.me && g.phase === 'roll') break;
    const action = TUNING.lookaheadPlanned ? plannedMove(g, owed.player, th, random) : quickMove(g, owed.player, random);
    let next: Game | null = null;
    if (action)
      try {
        next = simulateAction(g, owed.player, action, random);
      } catch {
        next = null;
      }
    if (!next) {
      const fallback = timeoutAction(g, owed.player, random);
      if (!fallback) break;
      try {
        next = simulateAction(g, owed.player, fallback, random);
      } catch {
        break;
      }
    }
    g = next;
  }
  return value(g, th, false);
}

/**
 * A fast, sensible move for a player in a looked-ahead future: roll, build the
 * best city or settlement the hand allows, put the robber where it hurts the
 * richest rival most, and otherwise end the turn. Not the bot's own search, which
 * would be far too slow to run inside every future.
 */
function quickMove(g: Game, player: string, random: () => number): GameAction | null {
  const p = g.players.find((x) => x.id === player);
  if (!p) return null;
  if (g.phase === 'roll') return { kind: 'roll' };
  if (g.phase === 'robber') {
    let best: { hex: number; victim?: string; score: number } | null = null;
    for (const hex of g.board.hexes) {
      if (hex.id === g.robber || !isLand(hex)) continue;
      let score = 0;
      for (const v of hex.vertices) {
        const b = g.buildings[v];
        if (!b) continue;
        score += (b.player === player ? -3 : 1) * (b.kind === 'city' ? 2 : 1) * pips(hex.number);
      }
      const victims = robberVictims(g, player, hex.id);
      if (!best || score > best.score)
        best = { hex: hex.id, ...(victims.length ? { victim: victims[Math.floor(random() * victims.length)] } : {}), score };
    }
    return best ? { kind: 'robber', hex: best.hex, ...(best.victim ? { victim: best.victim } : {}) } : null;
  }
  if (g.phase !== 'actions') return null;
  const hand = p.hand;
  const worth = (v: number) => {
    let n = 0;
    for (const h of g.board.vertices[v]?.hexes ?? []) {
      const hex = g.board.hexes[h];
      if (hex && h !== g.robber) n += pips(hex.number);
    }
    return n;
  };
  if (canAfford(hand, COSTS.city as Hand) && cityCount(g, player) < 4) {
    const mine = Object.entries(g.buildings)
      .filter(([, b]) => b.player === player && b.kind === 'settlement')
      .map(([v]) => Number(v))
      .sort((a, b) => worth(b) - worth(a));
    if (mine.length) return { kind: 'city', vertex: mine[0]! };
  }
  if (canAfford(hand, COSTS.settlement as Hand) && settlementCount(g, player) < 5) {
    const sites = settlementSites(g, player).sort((a, b) => worth(b) - worth(a));
    if (sites.length) return { kind: 'settlement', vertex: sites[0]! };
  }
  return { kind: 'endTurn' };
}

/**
 * A better guess at a player's turn in a looked-ahead future: they work toward
 * the first purchase of their own race, as the bot judges it. A road toward the
 * corner they want, the city, the settlement, a development card for the army,
 * with one bank trade when that is all that stands in the way. Everything else
 * (the dice, the robber) is as `quickMove`.
 */
function plannedMove(g: Game, player: string, th: Thinker, random: () => number): GameAction | null {
  if (g.phase !== 'actions') return quickMove(g, player, random);
  const p = g.players.find((x) => x.id === player);
  if (!p) return null;
  const step = race(g, player, th.know(g)(player)).steps[0];
  if (!step) return quickMove(g, player, random);
  const hand = p.hand;
  // What the step needs now, and the move that spends it.
  let cost: Hand | null = null;
  let move: GameAction | null = null;
  if (step.kind === 'city' && step.vertex !== undefined && g.buildings[step.vertex]?.player === player) {
    cost = COSTS.city as Hand;
    move = { kind: 'city', vertex: step.vertex };
  } else if (step.kind === 'settlement' && step.site !== undefined) {
    if ((step.roads ?? 0) > 0) {
      const edge = roadToward(g, player, step.site);
      if (edge !== null) {
        cost = COSTS.road as Hand;
        move = { kind: 'road', edge };
      }
    } else if (settlementSites(g, player).includes(step.site)) {
      cost = COSTS.settlement as Hand;
      move = { kind: 'settlement', vertex: step.site };
    }
  } else if ((step.kind === 'army' || step.kind === 'card') && g.deck.length > 0) {
    const knight = p.cards.find((c) => c.kind === 'knight' && c.boughtTurn < g.turn);
    if (knight && !g.playedCard && step.kind === 'army') return { kind: 'playCard', cardId: knight.id };
    cost = COSTS.developmentCard as Hand;
    move = { kind: 'buyCard' };
  } else if (step.kind === 'road') {
    const edges = roadSites(g, player);
    if (edges.length) {
      cost = COSTS.road as Hand;
      move = { kind: 'road', edge: edges[Math.floor(random() * edges.length)]! };
    }
  }
  if (!cost || !move) return quickMove(g, player, random);
  if (canAfford(hand, cost)) return move;
  // One card short, with a pile that buys it at the bank: trade, then build next move.
  const missing = RESOURCES.filter((r) => hand[r] < cost![r]);
  const short = missing.reduce((n, r) => n + cost![r] - hand[r], 0);
  if (short === 1) {
    const rate = rates(g, player);
    const give = RESOURCES.filter((r) => hand[r] - cost![r] >= rate[r]).sort((a, b) => hand[b] - hand[a])[0];
    if (give && g.bank[missing[0]!] > 0) return { kind: 'bankTrade', give, receive: missing[0]! };
  }
  return quickMove(g, player, random);
}

/** A road the player could build now that leads toward `target`, or null. */
function roadToward(g: Game, player: string, target: number): number | null {
  // Distances back from the target over corners nobody else has built on.
  const far = new Map<number, number>([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const v = queue.shift()!;
    const d = far.get(v)!;
    if (d >= 4) continue;
    for (const e of g.board.vertices[v]!.edges) {
      const owner = g.roads[e];
      if (owner && owner !== player) continue;
      const edge = g.board.edges[e]!;
      const next = edge.a === v ? edge.b : edge.a;
      const b = g.buildings[next];
      if (far.has(next) || (b && b.player !== player)) continue;
      far.set(next, d + 1);
      queue.push(next);
    }
  }
  // The road that reaches nearest the target; between equals, the one not running alongside.
  let best: number | null = null,
    bestD = Infinity;
  for (const e of roadSites(g, player)) {
    const edge = g.board.edges[e]!;
    const a = far.get(edge.a) ?? 99,
      b = far.get(edge.b) ?? 99;
    const d = Math.min(a, b) * 100 + Math.max(a, b);
    if (Math.min(a, b) < 99 && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * Where to put the robber and whom to rob.
 *
 * Each choice is scored by what it leaves the bot with, averaged over the card the
 * steal could take. While nobody is clearly ahead, robbing the same person twice
 * in a row costs a little: people remember, and pay it back.
 */
export function bestRobber(g: Game, th: Thinker): { action: GameAction; value: number; runnerUp?: number } | null {
  const table = standings(g, th, false);
  const lead = [...table].sort((a, b) => b.chance - a.chance);
  const clearLeader = lead[0] && lead[1] && lead[0].chance > lead[1].chance * 1.5 ? lead[0].id : null;
  const scored: { action: GameAction; value: number }[] = [];
  for (const hex of g.board.hexes) {
    if (hex.id === g.robber || !isLand(hex)) continue;
    const victims = robberVictims(g, th.me, hex.id);
    for (const victim of victims.length ? victims : [undefined]) {
      const action: GameAction = { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
      const moved = tryMove(g, th.me, action);
      if (!moved) continue;
      let v = victim ? stealValue(g, moved, victim, th) : value(moved, th, false);
      if (victim && victim === th.lastVictim && !clearLeader) v *= 0.97;
      scored.push({ action, value: v });
    }
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.value - a.value);
  return { ...scored[0]!, runnerUp: scored[1]?.value };
}

/** A steal averaged over every card the victim might be holding, as the counting sees them. */
function stealValue(before: Game, after: Game, victim: string, th: Thinker): number {
  const mine = after.players.find((p) => p.id === th.me)!;
  const theirs = after.players.find((p) => p.id === victim)!;
  const was = before.players.find((p) => p.id === th.me)!;
  // What the imagined steal took, so it can be swapped for each possibility.
  const took = RESOURCES.find((r) => mine.hand[r] > was.hand[r]);
  if (!took) return value(after, th, false);
  const odds = composition(th.belief, victim);
  const total = RESOURCES.reduce((n, r) => n + odds[r], 0);
  if (total <= 0) return value(after, th, false);
  let sum = 0;
  for (const r of RESOURCES) {
    if (odds[r] <= 0) continue;
    mine.hand[took]--;
    mine.hand[r]++;
    theirs.hand[took]++;
    theirs.hand[r]--;
    const ok = theirs.hand[r] >= 0;
    if (ok) sum += (odds[r] / total) * value(after, th, false);
    else sum += (odds[r] / total) * value(before, th, false);
    mine.hand[r]--;
    mine.hand[took]++;
    theirs.hand[r]++;
    theirs.hand[took]--;
  }
  return sum;
}

/**
 * What to throw away on a seven: every way of discarding the right number,
 * scored by the bot's own race, since a discard changes nobody else's.
 */
export function bestDiscard(g: Game, th: Thinker, count: number): Hand {
  const me = g.players.find((p) => p.id === th.me)!;
  const hand = me.hand;
  let best = emptyHand(),
    bestValue = -Infinity,
    tried = 0;
  const current = emptyHand();
  const walk = (i: number, left: number) => {
    if (tried > 700) return;
    if (i === RESOURCES.length) {
      if (left) return;
      tried++;
      const saved = { ...me.hand };
      for (const r of RESOURCES) me.hand[r] = saved[r] - current[r];
      const v = value(g, th, false);
      for (const r of RESOURCES) me.hand[r] = saved[r];
      if (v > bestValue) {
        bestValue = v;
        best = { ...current };
      }
      return;
    }
    const r = RESOURCES[i]!;
    for (let n = Math.min(hand[r], left); n >= 0; n--) {
      current[r] = n;
      walk(i + 1, left - n);
    }
    current[r] = 0;
  };
  walk(0, count);
  if (bestValue === -Infinity) {
    // Too many ways to count: throw from the biggest piles.
    const left = { ...hand };
    for (let n = 0; n < count; n++) {
      const r = RESOURCES.filter((x) => left[x] > 0).sort((a, b) => left[b] - left[a])[0]!;
      left[r]--;
      best[r]++;
    }
  }
  return best;
}

/**
 * Before the dice: play a knight now, or roll? A knight is worth playing first
 * when the robber sits on the bot's own production, or when it takes largest
 * army; otherwise it keeps, because a knight in hand is still a defence.
 */
export function knightFirst(g: Game, th: Thinker): GameAction | null {
  const knight = g.players
    .find((p) => p.id === th.me)
    ?.cards.find((c) => c.kind === 'knight' && c.boughtTurn < g.turn);
  if (!knight || g.playedCard) return null;
  const blocked = g.board.hexes[g.robber]?.vertices.some((v) => g.buildings[v]?.player === th.me);
  const played = tryMove(g, th.me, { kind: 'playCard', cardId: knight.id });
  if (!played) return null;
  const after = settle(played, th);
  const takesArmy = after.largestArmy === th.me && g.largestArmy !== th.me;
  const gain = value(after, th, false) - value(g, th, false);
  if (takesArmy || (blocked && gain > 0) || gain > 0.03 * TUNING.gainScale) return { kind: 'playCard', cardId: knight.id };
  return null;
}

export { tryMove, settle };
export type { Resource };
