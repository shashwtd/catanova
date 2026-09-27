/**
 * Building blocks for Big Table's tests: a game through its setup draft, scripted dice, hands and points set up
 * for a scenario, and roads laid along the island for award races. docs/RULEBOOK-BIG-TABLE.md is what they test.
 */
import { activePlayer, applyAction, createGame, emptyHand, score } from '../packages/rules/src/game.js';
import type { CardKind, Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { BIG_TABLE } from '../packages/rules/src/rulesets.js';
import type { TurnStructure } from '../packages/rules/src/rulesets.js';

export const NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay'];
export const seats = (n: number) => NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name }));
/** The random draw a Classic roll turns into this face of a die. */
export const face = (n: number) => (n - 0.5) / 6;
/** A random source that gives `values` first, then a seeded stream. */
export function scripted(values: number[], seed = 7): () => number {
  const rest = seededRandom(seed);
  return () => (values.length ? values.shift()! : rest());
}

/**
 * A Big Table game on its own island through the setup draft, each placement the clock's (the richest corner,
 * then a road beside it), at the start of the first turn.
 */
export function afterSetup(
  n = 5,
  options: { turns?: TurnStructure; victoryPoints?: number; seed?: number } = {},
): Game {
  const random = seededRandom(options.seed ?? 4242);
  let g = createGame(seats(n), options.seed ?? 4242, random, {
    ruleset: BIG_TABLE.id,
    ...(options.turns ? { turns: options.turns } : {}),
    ...(options.victoryPoints ? { victoryPoints: options.victoryPoints } : {}),
  });
  while (g.turn === 0) {
    const [owed] = owedMoves(g);
    g = applyAction(g, owed!.player, timeoutAction(g, owed!.player, random)!, random);
  }
  return g;
}

/** A move by whoever it names, with a seeded random source unless given one. */
export const act = (g: Game, player: string, action: GameAction, random = seededRandom(11)) =>
  applyAction(g, player, action, random);
/** The player acting rolls these dice. */
export const roll = (g: Game, a: number, b: number) =>
  act(g, activePlayer(g).id, { kind: 'roll' }, scripted([face(a), face(b)]));
/** The seat index of a player. */
export const seatOf = (g: Game, id: string) => g.players.findIndex((p) => p.id === id);
/** The id of the player in a seat. */
export const idAt = (g: Game, seat: number) => g.players[seat]!.id;

/**
 * Whoever holds the turn finishes it as quickly as the rules allow: a Lead or player on turn rolls an 8 if they
 * have not rolled and ends their part; a Partner ends their phase; a player in a build window closes it.
 */
export function pass(g: Game): Game {
  const actor = activePlayer(g).id;
  if (g.phase === 'roll') g = roll(g, 3, 5);
  if (g.phase === 'actions') return act(g, actor, { kind: 'endTurn' });
  if (g.phase === 'partner') return act(g, actor, { kind: 'endPhase' });
  if (g.phase === 'buildWindow') return act(g, actor, { kind: 'endWindow' });
  throw new Error(`nothing to pass during ${g.phase}`);
}
/** Pass until the game reaches the given turn. */
export function untilTurn(g: Game, turn: number): Game {
  for (let guard = 0; guard < 200 && g.turn < turn; guard++) g = pass(g);
  return g;
}

/** Move resource cards from the bank into a hand, keeping every card accounted for. */
export function give(g: Game, player: string, cards: Partial<Hand>) {
  const hand = g.players.find((p) => p.id === player)!.hand;
  for (const r of RESOURCES) {
    const n = cards[r] ?? 0;
    if (g.bank[r] < n) throw new Error(`the bank has only ${g.bank[r]} ${r}`);
    g.bank[r] -= n;
    hand[r] += n;
  }
}
/** Empty a hand into the bank. */
export function emptyInto(g: Game, player: string) {
  const hand = g.players.find((p) => p.id === player)!.hand;
  for (const r of RESOURCES) {
    g.bank[r] += hand[r];
    hand[r] = 0;
  }
}
/** A development card from the deck into a hand, as if it had been bought on `turn`. */
export function deal(g: Game, player: string, kind: CardKind, turn = 0) {
  const at = g.deck.lastIndexOf(kind);
  if (at < 0) throw new Error(`no ${kind} left in the deck`);
  g.deck.splice(at, 1);
  const card = { id: `card-${g.nextCard++}`, kind, boughtTurn: turn };
  g.players.find((p) => p.id === player)!.cards.push(card);
  return card;
}
/**
 * Hidden points for a scenario: victory point cards, made for the test rather than drawn, so that a player's
 * score is exactly `points`. Only wins are asked of games rigged this way, never conservation.
 */
export function pointsTo(g: Game, player: string, points: number) {
  const p = g.players.find((q) => q.id === player)!;
  const missing = points - score(g, p);
  if (missing < 0) throw new Error(`${player} already has ${score(g, p)} points`);
  for (let i = 0; i < missing; i++)
    p.cards.push({ id: `vp-${player}-${p.cards.length}`, kind: 'victoryPoint', boughtTurn: 0 });
}

/** The island with nothing built on it, for scenarios that lay out their own pieces. */
export function clearBoard(g: Game) {
  g.buildings = {};
  g.roads = {};
  g.longestRoad = null;
  g.largestArmy = null;
}
/**
 * A line of `length` roads along corners no building stands on or beside, avoiding `taken` corners and their
 * neighbours, so that a settlement could later go anywhere along it. Returns its corners, first to last.
 */
export function line(g: Game, length: number, taken: Set<number>): number[] {
  const free = (v: number) =>
    !taken.has(v) && !g.buildings[v] && g.board.vertices[v]!.neighbors.every((n) => !taken.has(n));
  const walk = (path: number[]): number[] | null => {
    if (path.length === length + 1) return path;
    const at = path.at(-1)!;
    for (const next of g.board.vertices[at]!.neighbors)
      if (!path.includes(next) && free(next)) {
        const found = walk([...path, next]);
        if (found) return found;
      }
    return null;
  };
  for (const v of g.board.vertices)
    if (free(v.id) && g.board.vertices[v.id]!.neighbors.length === 3) {
      const path = walk([v.id]);
      if (path) {
        for (const corner of path) taken.add(corner);
        return path;
      }
    }
  throw new Error(`no free line of ${length} roads`);
}
/** The edge between two neighbouring corners. */
export const edgeBetween = (g: Game, a: number, b: number) =>
  g.board.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))!.id;
/** Lay a player's roads along a line of corners. */
export function layRoads(g: Game, player: string, corners: number[]) {
  for (let i = 1; i < corners.length; i++) g.roads[edgeBetween(g, corners[i - 1]!, corners[i]!)] = player;
}
/**
 * A corner where `player` may build a settlement: free of buildings and their neighbours, reached by a road of
 * theirs laid here for the scenario. Returns the corner.
 */
export function openSite(g: Game, player: string): number {
  const clear = (v: number) =>
    !g.buildings[v] && g.board.vertices[v]!.neighbors.every((n) => !g.buildings[n]);
  for (const v of g.board.vertices) {
    if (!clear(v.id)) continue;
    const edge = v.edges.find((e) => g.roads[e] === undefined);
    if (edge === undefined) continue;
    g.roads[edge] = player;
    return v.id;
  }
  throw new Error('no corner is free for a settlement');
}
/** Enough cards for one settlement. */
export const SETTLEMENT: Partial<Hand> = { wood: 1, brick: 1, sheep: 1, wheat: 1 };
export const ROAD: Partial<Hand> = { wood: 1, brick: 1 };
export const CARD: Partial<Hand> = { sheep: 1, wheat: 1, ore: 1 };
export { emptyHand };
