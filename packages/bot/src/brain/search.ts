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
import { isLand } from '../../../rules/src/board.js';
import { robberVictims, roadSites, settlementSites, simulateAction } from '../../../rules/src/game.js';
import type { CardKind, Game, GameAction, Hand } from '../../../rules/src/game.js';
import { cardChance, composition } from './belief.js';
import type { Belief } from './belief.js';
import { winChances } from './race.js';
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
  return winChances(g, th.know(g), { endOfTurn, lean: th.lean });
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
  return (mine?.chance ?? 0) - (mine?.rolls ?? 0) * 1e-5 - Math.max(0, held - 4) * 2e-4;
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
    if (spent(th)) break;
  }
  return { action: best.first ?? { kind: 'endTurn' }, value: best.value, line: best.line, baseline };
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
  if (takesArmy || (blocked && gain > 0) || gain > 0.03) return { kind: 'playCard', cardId: knight.id };
  return null;
}

export { tryMove, settle };
export type { Resource };
