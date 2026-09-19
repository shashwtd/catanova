/**
 * Everything the bot works out for itself, with no model involved.
 *
 * The division of labour matters for both cost and correctness. Counting pips,
 * checking what a hand can afford, walking the road network, and working out
 * who is winning are all arithmetic: a decision model is bad at them and they
 * are cheap here. Jev is asked only the judgement that is left over, and always
 * from options this file produced, so a bot cannot pick a move the rules never
 * offered.
 *
 * These functions also decide how much the bot sends to the model. Late in a
 * game there can be forty legal road edges; sending all of them wastes tokens
 * and, worse, buries the handful that matter. Everything here that ends in
 * `rank` returns a short, already-sensible shortlist.
 */

import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../rules/src/index.js';
import type { Resource } from '../../rules/src/index.js';
import { pips } from '../../rules/src/board.js';
import type { Board } from '../../rules/src/board.js';
import { robberVictims, total } from '../../rules/src/game.js';
import type { GameView, Hand, PlayerView } from '../../rules/src/game.js';

export type Buildable = 'road' | 'settlement' | 'city' | 'developmentCard';

/** What a corner is worth, in the terms a Catan player actually uses. */
export type CornerFacts = {
  produces: string[];
  pips: number;
  resources: number;
  kinds: Resource[];
  port?: string;
};

export function cornerFacts(board: Board, vertex: number): CornerFacts {
  const corner = board.vertices[vertex];
  if (!corner) return { produces: [], pips: 0, resources: 0, kinds: [] };
  const hexes = corner.hexes
    .map((id) => board.hexes[id])
    .filter((hex): hex is NonNullable<typeof hex> => !!hex && hex.terrain !== 'desert');
  const port = board.ports.find((p) => corner.edges.includes(p.edge));
  const kinds = [...new Set(hexes.map((h) => h.terrain as Resource))];
  return {
    produces: hexes.map((h) => `${RESOURCE_NAMES[h.terrain as Resource].toLowerCase()} on ${h.number}`),
    pips: hexes.reduce((n, h) => n + pips(h.number), 0),
    resources: kinds.length,
    kinds,
    ...(port
      ? { port: port.resource === 'any' ? '3:1 any' : `2:1 ${RESOURCE_NAMES[port.resource].toLowerCase()}` }
      : {}),
  };
}

/** Pips plus a bonus for variety: three resources on one corner is worth more
 *  than the same production from two, because it unlocks more of the cost table. */
const cornerScore = (facts: CornerFacts) => facts.pips + facts.resources * 2 + (facts.port ? 1 : 0);

export function rankCorners(board: Board, vertices: readonly number[], limit: number): number[] {
  return [...vertices]
    .sort((a, b) => cornerScore(cornerFacts(board, b)) - cornerScore(cornerFacts(board, a)))
    .slice(0, limit);
}

/** Edge steps from a corner to a target corner, ignoring who owns what. Used to
 *  keep road choices pointed somewhere instead of wandering. */
export function stepsToCorner(board: Board, from: number, target: number): number {
  if (from === target) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let depth = 1; depth <= 6; depth++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const neighbour of board.vertices[id]?.neighbors ?? []) {
        if (seen.has(neighbour)) continue;
        if (neighbour === target) return depth;
        seen.add(neighbour);
        next.push(neighbour);
      }
    if (!next.length) break;
    frontier = next;
  }
  return 99;
}

/** Roads that move toward the target corner first, then roads that open good
 *  corners. A shortlist, because forty options is mostly noise. */
export function rankRoads(
  board: Board,
  edges: readonly number[],
  target: number | null,
  limit: number,
): number[] {
  const value = (edge: number) => {
    const e = board.edges[edge];
    if (!e) return -99;
    const ends = [e.a, e.b];
    const reach = target === null ? 0 : -Math.min(...ends.map((v) => stepsToCorner(board, v, target)));
    const opens = Math.max(...ends.map((v) => cornerScore(cornerFacts(board, v)) / 10));
    return reach * 2 + opens;
  };
  return [...edges].sort((a, b) => value(b) - value(a)).slice(0, limit);
}

export const handOf = (view: GameView): Hand =>
  view.players.find((p) => p.hand)?.hand ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

export function affordable(hand: Hand): Buildable[] {
  const out: Buildable[] = [];
  for (const [kind, cost] of Object.entries(COSTS) as [Buildable, Hand][])
    if (RESOURCES.every((r) => hand[r] >= cost[r])) out.push(kind);
  return out;
}

/** What the current focus still needs, and what is spare. Both are derived, so
 *  the model is never asked to do subtraction. */
export function needsAndSurplus(
  hand: Hand,
  target: Buildable | null,
): { needs: Resource[]; surplus: Resource[] } {
  const cost: Hand = target ? COSTS[target] : { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const needs = RESOURCES.filter((r) => hand[r] < cost[r]);
  const surplus = RESOURCES.filter((r) => hand[r] > cost[r] + 1);
  return { needs, surplus };
}

export const leaderOf = (view: GameView, meId: string): PlayerView | null => {
  const others = view.players.filter((p) => p.id !== meId && !p.resigned);
  return others.sort((a, b) => b.points - a.points)[0] ?? null;
};

/**
 * Hexes worth putting the robber on, best first: block the most production and
 * never block yourself.
 *
 * `leaderWeight` is what separates the two difficulties. At 1 the robber goes
 * wherever the most production is, whoever owns it — a bot minding its own
 * game. Above 1 the same tile is worth more for belonging to whoever is ahead,
 * so the robber follows the leader around the board.
 */
export function rankRobberHexes(
  board: Board,
  view: GameView,
  meId: string,
  limit: number,
  leaderWeight = 2,
): number[] {
  const leader = leaderOf(view, meId);
  const value = (hexId: number) => {
    const hex = board.hexes[hexId];
    if (!hex || hex.terrain === 'desert' || hexId === view.robber) return -99;
    let score = 0;
    for (const vertex of hex.vertices) {
      const building = view.buildings[vertex];
      if (!building) continue;
      const weight = building.kind === 'city' ? 2 : 1;
      if (building.player === meId) score -= pips(hex.number) * weight * 3;
      else if (leader && building.player === leader.id) score += pips(hex.number) * weight * leaderWeight;
      else score += pips(hex.number) * weight;
    }
    return score;
  };
  return board.hexes
    .map((h) => h.id)
    .filter((id) => value(id) > -99)
    .sort((a, b) => value(b) - value(a))
    .slice(0, limit);
}

/** Who may be robbed from a hex. Delegates to the rules engine so the bot's
 *  shortlist can never disagree with what the rules will accept: the engine
 *  counts every opponent on the tile, whether or not they hold cards. */
export function robberTargets(view: GameView, hexId: number, meId: string): string[] {
  return robberVictims(view, meId, hexId);
}

/** Which cards to throw away on a seven: keep what the plan needs, drop the
 *  most plentiful of the rest. Pure counting, so no decision is spent on it. */
export function discardChoice(hand: Hand, keep: readonly Resource[], count: number): Hand {
  const out: Hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const pool = RESOURCES.flatMap((r) => Array<Resource>(hand[r]).fill(r));
  pool.sort((a, b) => (keep.includes(a) ? 1 : 0) - (keep.includes(b) ? 1 : 0) || hand[b] - hand[a]);
  for (const r of pool.slice(0, count)) out[r] += 1;
  return out;
}

/**
 * A bank or harbour trade worth making: give the biggest surplus, take the
 * first thing the plan is short of. Rates come from the rules engine, which
 * already accounts for which harbours a player owns.
 *
 * Without this a bot stalls on a hand full of one resource, which is the most
 * common way a beginner loses a game of Catan.
 */
export function bankTrade(
  hand: Hand,
  rates: Hand,
  needs: readonly Resource[],
  bank: Hand,
): { give: Resource; receive: Resource } | null {
  // The bank can run dry late in a game, and asking for a resource it does not
  // hold is rejected by the rules, so supply is checked here rather than
  // discovered as an error.
  const wanted = needs.filter((r) => bank[r] > 0);
  const give = RESOURCES.filter((r) => !wanted.includes(r) && hand[r] >= (rates[r] || 4)).sort(
    (a, b) => hand[b] - hand[a],
  )[0];
  const receive = wanted[0];
  return give && receive ? { give, receive } : null;
}

/** A safe move for every phase, used when the decision service is slow or down.
 *  A bot must never stall a real game, so every call site has one of these. */
export const fallbackCorner = (board: Board, options: readonly number[]): number =>
  rankCorners(board, options, 1)[0] ?? options[0]!;

export const handTotal = total;
