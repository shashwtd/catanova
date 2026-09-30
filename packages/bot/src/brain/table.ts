/**
 * The parts of a position the brain reads, and the board arithmetic it needs.
 *
 * Everything here works on a `Table`: the fields a game and a player's view of it
 * have in common. The brain never needs more than that, so the same code scores
 * the real position from a view and the imagined ones it builds while searching.
 */

import { COSTS, RESOURCES } from '../../../rules/src/index.js';
import type { Resource } from '../../../rules/src/index.js';
import { pips } from '../../../rules/src/board.js';
import type { Board } from '../../../rules/src/board.js';
import { tradeRate } from '../../../rules/src/game.js';
import type { Building, Card, Hand } from '../../../rules/src/game.js';

export type Seat = {
  id: string;
  hand: Hand;
  cards: Card[];
  knights: number;
  resigned?: boolean;
};

export type Table = {
  board: Board;
  buildings: Record<number, Building>;
  roads: Record<number, string>;
  robber: number;
  longestRoad: string | null;
  largestArmy: string | null;
  victoryPoints?: number;
  players: Seat[];
  bank: Hand;
  active: number;
  turn: number;
};

export const emptyHand = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const handSize = (hand: Hand) => RESOURCES.reduce((n, r) => n + hand[r], 0);
export const canAfford = (hand: Hand, cost: Hand) => RESOURCES.every((r) => hand[r] >= cost[r]);
export const plus = (a: Hand, b: Hand): Hand => ({
  wood: a.wood + b.wood,
  brick: a.brick + b.brick,
  sheep: a.sheep + b.sheep,
  wheat: a.wheat + b.wheat,
  ore: a.ore + b.ore,
});
export const minus = (a: Hand, b: Hand): Hand => ({
  wood: a.wood - b.wood,
  brick: a.brick - b.brick,
  sheep: a.sheep - b.sheep,
  wheat: a.wheat - b.wheat,
  ore: a.ore - b.ore,
});
export const target = (t: Pick<Table, 'victoryPoints'>) => t.victoryPoints ?? 10;
export { COSTS };

/** What one corner produces per roll, resource by resource, with the robber's tile giving nothing. */
export function cornerIncome(board: Board, vertex: number, robber: number | null): Hand {
  const out = emptyHand();
  for (const id of board.vertices[vertex]?.hexes ?? []) {
    const hex = board.hexes[id];
    if (!hex || id === robber || !(RESOURCES as readonly string[]).includes(hex.terrain)) continue;
    out[hex.terrain as Resource] += pips(hex.number) / 36;
  }
  return out;
}

/** Everything a player's buildings produce per roll: a city counts twice. */
export function income(t: Table, id: string, robber: number | null = t.robber): Hand {
  let out = emptyHand();
  for (const [vertex, building] of Object.entries(t.buildings)) {
    if (building.player !== id) continue;
    const corner = cornerIncome(t.board, Number(vertex), robber);
    out = plus(out, building.kind === 'city' ? plus(corner, corner) : corner);
  }
  return out;
}

export const incomeTotal = (h: Hand) => handSize(h);

/** The rate each resource trades at with the bank, given the harbours a player owns. */
export function rates(t: Table, id: string): Hand {
  const out = emptyHand();
  for (const r of RESOURCES) out[r] = tradeRate(t as never, id, r);
  return out;
}

export const settlementCount = (t: Table, id: string) =>
  Object.values(t.buildings).filter((b) => b.player === id && b.kind === 'settlement').length;
export const cityCount = (t: Table, id: string) =>
  Object.values(t.buildings).filter((b) => b.player === id && b.kind === 'city').length;
export const roadCount = (t: Table, id: string) => Object.values(t.roads).filter((p) => p === id).length;

/** Whether a corner could take a settlement at all: empty, with no neighbour built on. */
export function openCorner(t: Table, vertex: number): boolean {
  const v = t.board.vertices[vertex];
  return !!v && !t.buildings[vertex] && v.neighbors.every((n) => !t.buildings[n]);
}

/**
 * How many new roads a player needs to reach each corner, by breadth-first search
 * from their network. Own roads are free to walk, empty edges cost one road, and a
 * corner somebody else has built on cannot be walked through. Only corners up to
 * `limit` roads away are returned.
 */
export function roadDistances(t: Table, id: string, limit = 3): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  const blocked = (v: number) => {
    const b = t.buildings[v];
    return !!b && b.player !== id;
  };
  for (const v of t.board.vertices) {
    const mine = t.buildings[v.id]?.player === id || v.edges.some((e) => t.roads[e] === id);
    if (mine && !blocked(v.id)) {
      dist.set(v.id, 0);
      queue.push(v.id);
    }
  }
  // A 0-1 search: walking an own road costs nothing, so those go to the front.
  while (queue.length) {
    const v = queue.shift()!;
    const d = dist.get(v)!;
    if (blocked(v)) continue;
    for (const e of t.board.vertices[v]!.edges) {
      const owner = t.roads[e];
      if (owner && owner !== id) continue;
      const edge = t.board.edges[e]!;
      const next = edge.a === v ? edge.b : edge.a;
      const cost = owner === id ? 0 : 1;
      const nd = d + cost;
      if (nd > limit || (dist.has(next) && dist.get(next)! <= nd)) continue;
      dist.set(next, nd);
      if (cost === 0) queue.unshift(next);
      else queue.push(next);
    }
  }
  return dist;
}

/** Scarcity: how much of each resource the whole board produces, so a rare one is worth more. */
export function boardSupply(board: Board): Hand {
  const out = emptyHand();
  for (const hex of board.hexes)
    if ((RESOURCES as readonly string[]).includes(hex.terrain)) out[hex.terrain as Resource] += pips(hex.number);
  return out;
}
