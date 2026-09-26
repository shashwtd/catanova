/**
 * Open Sea games for the reducer's tests (docs/RULEBOOK-OPEN-SEA.md): a sketched board from sea-boards.ts dealt as
 * an Outer Isles preset would deal it, the players seated, and pieces, hands and the phase laid out as a test needs.
 * Everything else goes through createGame and applyAction, as a real game does.
 */
import { isLand, seededRandom } from '../packages/rules/src/board.js';
import type { Board } from '../packages/rules/src/board.js';
import { applyAction, createGame, emptyHand } from '../packages/rules/src/game.js';
import type { CardKind, Game, GameAction, Hand, Phase } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { hexEdges, vertexIsland } from '../packages/rules/src/sea.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import type { Sketch } from './sea-boards.js';

/** The seats, in turn order: "you" are Blue, on turn unless a test says otherwise. */
export const SEATS = [
  { id: 'blue', name: 'Blue' },
  { id: 'red', name: 'Red' },
  { id: 'green', name: 'Green' },
  { id: 'orange', name: 'Orange' },
];
export const hand = (cards: Partial<Hand> = {}): Hand => ({ ...emptyHand(), ...cards });
/** The dice a roll will show, as the random source the reducer draws them from. */
export const dice = (a: number, b: number, ...after: number[]) => {
  const values = [(a - 0.5) / 6, (b - 0.5) / 6, ...after];
  return () => values.shift() ?? 0.5;
};

/**
 * A sketch as an Outer Isles board: the tokens by hex, the robber on the desert (or the first land hex), and the
 * pirate where the sketch put it, else on the first sea hex.
 */
export function sketchBoard(sk: Sketch, players: number, numbers: Record<number, number> = {}): Board {
  const board = structuredClone(sk.board) as unknown as Board;
  for (const h of board.hexes) h.number = numbers[h.id] ?? 0;
  const land = board.hexes.filter(isLand);
  return {
    ...board,
    seed: 7,
    preset: 'outer-isles-v1',
    players,
    ports: [],
    robberStart: (land.find((h) => h.terrain === 'desert') ?? land[0]!).id,
    pirateStart: sk.pirate ?? board.hexes.find((h) => !isLand(h))!.id,
  };
}

export type Layout = {
  players?: number;
  numbers?: Record<number, number>;
  /** Setup over: the turn, the phase and who is on turn. The default is Blue's action phase on turn 1. */
  phase?: Phase;
  active?: number;
  settlements?: Record<string, number[]>;
  cities?: Record<string, number[]>;
  roads?: Record<string, number[]>;
  ships?: Record<string, number[]>;
  /** Cards each player holds, taken from the bank so that every card stays accounted for. */
  hands?: Record<string, Partial<Hand>>;
  pirate?: number;
  robber?: number;
};

/** An Open Sea game on a sketch, laid out mid-game, as if setup had been played. */
export function seaGame(sk: Sketch, layout: Layout = {}): Game {
  const players = layout.players ?? 3;
  const board = sketchBoard(sk, players, layout.numbers);
  const g = createGame(SEATS.slice(0, players), board.seed, () => 0.5, { ruleset: OPEN_SEA.id, board });
  Object.assign(g, {
    turn: 1,
    setupIndex: players * 2,
    setupVertex: null,
    phase: layout.phase ?? 'actions',
    active: layout.active ?? 0,
    dice: layout.phase === 'roll' ? null : [3, 4],
    returnPhase: 'actions',
  });
  if (layout.pirate !== undefined) g.pirate = layout.pirate;
  if (layout.robber !== undefined) g.robber = layout.robber;
  for (const kind of ['settlement', 'city'] as const)
    for (const [player, vertices] of Object.entries(
      (kind === 'city' ? layout.cities : layout.settlements) ?? {},
    ))
      for (const v of vertices) g.buildings[v] = { player, kind };
  for (const [player, edges] of Object.entries(layout.roads ?? {}))
    for (const e of edges) g.roads[e] = player;
  for (const [player, edges] of Object.entries(layout.ships ?? {}))
    for (const e of edges) g.ships![e] = player;
  for (const [player, cards] of Object.entries(layout.hands ?? {})) giveCards(g, player, cards);
  return g;
}

/** Move cards from the bank to a hand. */
export function giveCards(g: Game, player: string, cards: Partial<Hand>) {
  const p = g.players.find((other) => other.id === player)!;
  for (const r of RESOURCES) {
    const n = cards[r] ?? 0;
    if (g.bank[r] < n) throw new Error(`The bank has only ${g.bank[r]} ${r}`);
    g.bank[r] -= n;
    p.hand[r] += n;
  }
}

/** Every card in the bank or a hand, and every development card in the deck or bought: Open Sea's own counts. */
export function accountedFor(g: Game): string[] {
  const problems: string[] = [];
  for (const r of RESOURCES) {
    const held = g.bank[r] + g.players.reduce((n, p) => n + p.hand[r], 0);
    if (held !== OPEN_SEA.supply.bank) problems.push(`${r}: ${held} cards, not ${OPEN_SEA.supply.bank}`);
  }
  if (g.deck.length + g.nextCard !== 25) problems.push('development cards went missing');
  for (const p of g.players) {
    const count = (pieces: Record<number, string>) =>
      Object.values(pieces).filter((id) => id === p.id).length;
    const built = Object.values(g.buildings).filter((b) => b.player === p.id);
    const { roads, ships, settlements, cities } = OPEN_SEA.supply.pieces;
    if (count(g.roads) > roads) problems.push(`${p.id} has too many roads`);
    if (count(g.ships ?? {}) > ships!) problems.push(`${p.id} has too many ships`);
    if (built.filter((b) => b.kind === 'settlement').length > settlements)
      problems.push(`${p.id} has too many settlements`);
    if (built.filter((b) => b.kind === 'city').length > cities) problems.push(`${p.id} has too many cities`);
  }
  for (const e of Object.keys(g.ships ?? {}))
    if (g.roads[Number(e)]) problems.push(`edge ${e} has two pieces`);
  return problems;
}

/** Apply a sequence of moves, each by the player named, with the dice or draws given. */
export function play(g: Game, moves: [player: string, action: GameAction, random?: () => number][]): Game {
  for (const [player, action, random] of moves) g = applyAction(g, player, action, random ?? (() => 0.5));
  return g;
}

/** The log lines a move wrote. */
export const newLines = (before: Game, after: Game) =>
  after.log.filter((line) => line.id >= before.nextLog).map((line) => line.text);

/**
 * A game on a real Outer Isles board, its setup placed by the clock's own moves: turn 1, the first seat about to
 * roll, and every rule's invariant holding, so a test can change one thing and see what follows.
 */
export function afterSetup(players: number, seed: number, options: { victoryPoints?: number } = {}): Game {
  const random = seededRandom(seed);
  let g = createGame(SEATS.slice(0, players), seed, random, { ruleset: OPEN_SEA.id, ...options });
  while (g.turn === 0) {
    const [owed] = owedMoves(g);
    g = applyAction(g, owed!.player, timeoutAction(g, owed!.player, random)!, random);
  }
  return g;
}

/**
 * Deal development cards off the deck into a hand, as if bought on turn 0, or straight into play: each played
 * Knight counts for the player's army. The deck and the purchase counter stay in step, as the verifier checks.
 */
export function dealCards(g: Game, player: string, kind: CardKind, count: number, played = false) {
  const p = g.players.find((other) => other.id === player)!;
  for (let i = 0; i < count; i++) {
    const at = g.deck.indexOf(kind);
    if (at < 0) throw new Error(`No ${kind} left in the deck`);
    g.deck.splice(at, 1);
    const id = `card-${g.nextCard++}`;
    if (played && kind === 'knight') p.knights++;
    else p.cards.push({ id, kind, boughtTurn: 0 });
  }
}

/** Corners of a hex where a settlement may stand under the distance rule, apart from one another too. */
export function freeCorners(g: Game, hex: number): number[] {
  const corners: number[] = [];
  for (const v of g.board.hexes[hex]!.vertices) {
    const near = g.board.vertices[v]!.neighbors;
    if (g.buildings[v] || near.some((n) => g.buildings[n] || corners.includes(n))) continue;
    corners.push(v);
  }
  return corners;
}

/**
 * Rig the next roll to pay gold to `pickers`, in the order given: a settlement for each on a corner of one gold
 * field, with the island bonus it would have earned, and no other hex with that number. Returns the field and a
 * random source that rolls its number.
 */
export function rigGold(g: Game, pickers: string[]) {
  const gold = g.board.hexes.find(
    (h) => h.terrain === 'gold' && freeCorners(g, h.id).length >= pickers.length,
  )!;
  for (const h of g.board.hexes) if (h.id !== gold.id && h.number === gold.number) h.number = 0;
  const corners = freeCorners(g, gold.id);
  for (const [i, player] of pickers.entries()) {
    g.buildings[corners[i]!] = { player, kind: 'settlement' };
    const bonuses = g.islandBonuses![player] ?? [];
    if (!bonuses.includes(gold.island!)) g.islandBonuses![player] = [...bonuses, gold.island!];
  }
  const first = Math.max(1, gold.number - 6);
  return { gold, random: dice(first, gold.number - first) };
}

/** Intersections of an island, by its name, in id order. */
export const islandCorners = (g: Game, island: string) =>
  g.board.vertices.filter((v) => vertexIsland(g.board, v.id) === island).map((v) => v.id);
/** The edges of a hex, and whether one is on it. */
export { hexEdges };
