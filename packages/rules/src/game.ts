import { DEVELOPMENT_DECK, RESOURCES, RESOURCE_NAMES } from './index.js';
import type { Resource } from './index.js';
import { dealBoard, isLand, shuffle } from './board.js';
import {
  findRuleset,
  fullBank,
  handLimit,
  playsBoard,
  rulesetOf,
  seatRange,
  targetRangeText,
  validTarget,
} from './rulesets.js';
import type { Board } from './board.js';
import { rollDice } from './dice.js';
import type { DiceMode, BalancedDiceState } from './dice.js';
import {
  SEA_LOG,
  SHIP_MOVE_BLOCKS,
  canPlaceRoadOpenSea,
  canPlaceShip,
  islandBonusForSettlement,
  islandBonusPoints,
  knightTargets,
  legalShipDestinations,
  longestRoute,
  movableShips,
  moveShip,
  pirateMoveIssue,
  placeSettlement,
  placeShip,
  producedResource,
  roadBuildingSites,
  roadSitesOpenSea,
  settlementSitesOpenSea,
  shipMoveBlock,
  shipSites,
} from './sea.js';
import type { ShipMoveBlock } from './sea.js';
import {
  applyGoldPick,
  goldOwedForRoll,
  goldPickIssue,
  goldPickText,
  goldPickTypes,
  remainingGoldOwed,
  startingResources,
} from './gold.js';
import type { GoldOwed } from './gold.js';

export type Hand = Record<Resource, number>;
export type CardKind = keyof typeof DEVELOPMENT_DECK;
export type Card = { id: string; kind: CardKind; boughtTurn: number };
export type Player = {
  id: string;
  name: string;
  hand: Hand;
  cards: Card[];
  knights: number;
  resigned?: boolean;
};
export type Building = { player: string; kind: 'settlement' | 'city' };
/**
 * What the game is waiting for. `goldPick` is Open Sea's: the players owed gold choose their resources, one at
 * a time, before the action phase (docs/RULEBOOK-OPEN-SEA.md, section 9.2). In Open Sea, `setupRoad` takes a
 * road or a ship, `robber` moves the robber or the pirate, and `freeRoads` places roads or ships.
 */
export type Phase =
  | 'setupSettlement'
  | 'setupRoad'
  | 'roll'
  | 'actions'
  | 'discard'
  | 'robber'
  | 'freeRoads'
  | 'goldPick'
  | 'finished';
export type TradeProposal = { player: string; give: Hand };
export type Trade = {
  id: number;
  player: string;
  give: Hand;
  want: Hand;
  open?: boolean;
  proposals?: TradeProposal[];
  declinedBy?: string[];
};
export type Game = {
  schema: 1;
  ruleset: string;
  board: Board;
  players: Player[];
  bank: Hand;
  buildings: Record<number, Building>;
  roads: Record<number, string>;
  robber: number;
  phase: Phase;
  active: number;
  setupIndex: number;
  setupVertex: number | null;
  turn: number;
  dice: [number, number] | null;
  deck: CardKind[];
  nextCard: number;
  playedCard: boolean;
  returnPhase: 'roll' | 'actions';
  freeRoads: number;
  discards: Record<string, number>;
  trade: Trade | null;
  nextTrade: number;
  longestRoad: string | null;
  largestArmy: string | null;
  winner: string | null;
  finishReason?: 'resignation' | 'abandoned';
  diceMode?: DiceMode | 'flat';
  balancedDice?: BalancedDiceState;
  victoryPoints?: number;
  tradeOffersThisTurn?: number;
  log: { id: number; text: string }[];
  nextLog: number;
} & SeaFields;
/**
 * What an Open Sea game keeps besides Classic's fields (docs/RULEBOOK-OPEN-SEA.md), all public. A game in any
 * other mode has none of them, so a Classic game saves exactly as it always has.
 */
export type SeaFields = {
  /** Edge id to the player whose ship is on it (section 7). */
  ships?: Record<number, string>;
  /** The sea hex the pirate stands on (section 10). */
  pirate?: number;
  /** The edges of the ships built this turn, bought or free, which may not move until the next (8.4). */
  shipsBuiltThisTurn?: number[];
  /** Whether the player on turn has made this turn's ship move (8.4). */
  shipMovedThisTurn?: boolean;
  /** Ships of a closed line that another player's settlement has since broken: closed for good (8.7, L). */
  lockedShips?: number[];
  /** By a ship's edge, its ends recorded as closed when another player settled there (8.7, E). */
  closedShipEnds?: Record<number, number[]>;
  /** By player, the small islands on which they have earned the island bonus (12.2). */
  islandBonuses?: Record<string, string[]>;
  /** The gold picks still owed, in the order they are made: the first is being made now (9.2). */
  goldOwed?: GoldOwed[];
};
export type GameAction =
  | { kind: 'start' | 'returnToLobby' }
  | { kind: 'settlement' | 'city'; vertex: number }
  | { kind: 'road'; edge: number }
  // Open Sea's own moves: a ship (bought, free or at setup), a ship move, the pirate and a player's gold picks.
  | { kind: 'ship'; edge: number }
  | { kind: 'moveShip'; from: number; to: number }
  | { kind: 'pirate'; hex: number; victim?: string }
  | { kind: 'goldPick'; resources: Hand }
  | { kind: 'roll' | 'endTurn' | 'buyCard' | 'cancelTrade' }
  | { kind: 'discard'; resources: Hand }
  | { kind: 'robber'; hex: number; victim?: string }
  | { kind: 'bankTrade'; give: Resource; receive: Resource }
  | { kind: 'offerTrade'; give: Hand; want: Hand }
  | { kind: 'openTrade'; give: Hand }
  | { kind: 'proposeTrade'; tradeId: number; give: Hand }
  | { kind: 'withdrawProposal'; tradeId: number }
  | { kind: 'acceptProposal'; tradeId: number; player: string; expectedGive?: Hand }
  | { kind: 'acceptTrade' | 'declineTrade'; tradeId: number }
  | { kind: 'playCard'; cardId: string; resources?: Hand; resource?: Resource };
export class RuleError extends Error {
  readonly code = 'ILLEGAL_ACTION';
}
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuleError(message);
}
export const emptyHand = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const total = (hand: Hand) => RESOURCES.reduce((n, r) => n + hand[r], 0);
export const canPay = (hand: Hand, cost: Hand) => RESOURCES.every((r) => hand[r] >= cost[r]);
const transfer = (from: Hand, to: Hand, amount: Hand) => {
  requireRule(canPay(from, amount), 'Not enough resources');
  for (const r of RESOURCES) {
    from[r] -= amount[r];
    to[r] += amount[r];
  }
};
const resourceText = (hand: Hand) =>
  RESOURCES.filter((r) => hand[r])
    .map((r) => `${hand[r]} ${RESOURCE_NAMES[r]}`)
    .join(', ');
function log(g: Game, text: string) {
  g.log.push({ id: g.nextLog++, text });
  if (g.log.length > 80) g.log.shift();
}

/**
 * The ceiling on a corner, edge or hex id, whatever the board. Classic has 72 edges, Big Table 109 and a large
 * Open Sea frame a few hundred. Whether an id is on this game's board is for applyAction to say: only it has the
 * board.
 */
export const BOARD_ID_LIMIT = 4096;
/**
 * Whether every corner, edge and hex an action names is on this board. It reads the fields, not the kinds, so a
 * new action that names a `vertex`, `edge` or `hex` is checked without being listed here. A ship move names two
 * edges by other names, so it is checked by its kind.
 */
function onBoard(board: Board, a: GameAction) {
  return (
    (!('vertex' in a) || a.vertex < board.vertices.length) &&
    (!('edge' in a) || a.edge < board.edges.length) &&
    (!('hex' in a) || a.hex < board.hexes.length) &&
    (a.kind !== 'moveShip' || (a.from < board.edges.length && a.to < board.edges.length))
  );
}

/**
 * Whether every resource count an action names fits in a bank of this size. Like onBoard, it reads the fields
 * rather than the kinds, so a new action with a hand of cards is checked without being listed here.
 */
function handsWithin(bank: number, a: GameAction) {
  return (['resources', 'give', 'want', 'expectedGive'] as const).every((field) => {
    const hand = (a as Partial<Record<typeof field, unknown>>)[field];
    return !hand || typeof hand !== 'object' || RESOURCES.every((r) => (hand as Hand)[r] <= bank);
  });
}

/** Untrusted input becomes a small, canonical action before it reaches a transaction. */
export function parseGameAction(input: unknown): GameAction {
  requireRule(input && typeof input === 'object' && !Array.isArray(input), 'Invalid action');
  const a = input as Record<string, unknown>;
  const index = (v: unknown, max: number) => {
    requireRule(Number.isInteger(v) && (v as number) >= 0 && (v as number) < max, 'Invalid board location');
    return v as number;
  };
  const id = (v: unknown) => {
    requireRule(typeof v === 'string' && v.length > 0 && v.length <= 80, 'Invalid identifier');
    return v;
  };
  const resource = (v: unknown) => {
    requireRule(RESOURCES.includes(v as Resource), 'Choose a resource');
    return v as Resource;
  };
  const hand = (v: unknown): Hand => {
    requireRule(v && typeof v === 'object' && !Array.isArray(v), 'Invalid resource selection');
    const h = v as Record<string, unknown>;
    const result = emptyHand();
    requireRule(
      Object.keys(h).every((k) => RESOURCES.includes(k as Resource)),
      'Unknown resource',
    );
    // No count can exceed the bank. Which bank is the game's to say (handsWithin); here, the largest.
    const limit = handLimit();
    for (const r of RESOURCES) {
      requireRule(
        Number.isInteger(h[r]) && (h[r] as number) >= 0 && (h[r] as number) <= limit,
        `Choose whole resource counts from 0 to ${limit}`,
      );
      result[r] = h[r] as number;
    }
    return result;
  };
  switch (a.kind) {
    case 'returnToLobby':
    case 'start':
    case 'roll':
    case 'endTurn':
    case 'buyCard':
    case 'cancelTrade':
      return { kind: a.kind };
    case 'settlement':
    case 'city':
      return { kind: a.kind, vertex: index(a.vertex, BOARD_ID_LIMIT) };
    case 'road':
    case 'ship':
      return { kind: a.kind, edge: index(a.edge, BOARD_ID_LIMIT) };
    case 'moveShip':
      return { kind: a.kind, from: index(a.from, BOARD_ID_LIMIT), to: index(a.to, BOARD_ID_LIMIT) };
    case 'goldPick':
      return { kind: a.kind, resources: hand(a.resources) };
    case 'robber':
    case 'pirate':
      return {
        kind: a.kind,
        hex: index(a.hex, BOARD_ID_LIMIT),
        ...(a.victim === undefined ? {} : { victim: id(a.victim) }),
      };
    case 'discard':
      return { kind: a.kind, resources: hand(a.resources) };
    case 'bankTrade':
      return { kind: a.kind, give: resource(a.give), receive: resource(a.receive) };
    case 'offerTrade':
      return { kind: a.kind, give: hand(a.give), want: hand(a.want) };
    case 'openTrade':
      return { kind: a.kind, give: hand(a.give) };
    case 'proposeTrade':
      return { kind: a.kind, tradeId: index(a.tradeId, Number.MAX_SAFE_INTEGER), give: hand(a.give) };
    case 'acceptTrade':
    case 'declineTrade':
    case 'withdrawProposal':
      return { kind: a.kind, tradeId: index(a.tradeId, Number.MAX_SAFE_INTEGER) };
    case 'acceptProposal':
      return {
        kind: a.kind,
        tradeId: index(a.tradeId, Number.MAX_SAFE_INTEGER),
        player: id(a.player),
        ...(a.expectedGive === undefined ? {} : { expectedGive: hand(a.expectedGive) }),
      };
    case 'playCard':
      return {
        kind: a.kind,
        cardId: id(a.cardId),
        ...(a.resources === undefined ? {} : { resources: hand(a.resources) }),
        ...(a.resource === undefined ? {} : { resource: resource(a.resource) }),
      };
    default:
      throw new RuleError('Unknown action');
  }
}

export function createGame(
  seats: { id: string; name: string }[],
  seed: number,
  random: () => number,
  // `board`: the island a lobby was already showing, played exactly as dealt. A seed
  // only reproduces a board under the generator that dealt it, and generators change.
  // `ruleset`: the mode the room chose, frozen into the game here. Classic when absent.
  options: { diceMode?: DiceMode; victoryPoints?: number; board?: Board; ruleset?: string } = {},
): Game {
  const rules = findRuleset(options.ruleset);
  requireRule(rules, 'This game mode is not available');
  requireRule(
    options.victoryPoints === undefined || validTarget(rules, options.victoryPoints),
    targetRangeText(rules),
  );
  requireRule(
    seats.length >= rules.seats.min && seats.length <= rules.seats.max,
    `Start with ${seatRange(rules)} players`,
  );
  requireRule(new Set(seats.map((p) => p.id)).size === seats.length, 'Seats must be unique');
  requireRule(!options.board || options.board.seed === seed >>> 0, 'The island does not match its seed');
  requireRule(!options.board || playsBoard(rules, options.board), 'The island was dealt for another mode');
  // Outer Isles has a template for three players and one for four: the island must be the one for this table.
  requireRule(
    !options.board?.players || options.board.players === seats.length,
    'The island was dealt for another number of players',
  );
  const board = options.board ? structuredClone(options.board) : dealBoard(seed, rules.board, seats.length);
  const g: Game = {
    schema: 1,
    ruleset: rules.id,
    board,
    players: seats.map((p) => ({ ...p, hand: emptyHand(), cards: [], knights: 0 })),
    bank: fullBank(rules),
    buildings: {},
    roads: {},
    robber: board.robberStart ?? board.hexes.find((h) => h.terrain === 'desert')!.id,
    phase: 'setupSettlement',
    active: 0,
    setupIndex: 0,
    setupVertex: null,
    turn: 0,
    dice: null,
    deck: shuffle(
      Object.entries(rules.supply.deck).flatMap(([k, n]) => Array<CardKind>(n).fill(k as CardKind)),
      random,
    ),
    nextCard: 0,
    playedCard: false,
    returnPhase: 'actions',
    freeRoads: 0,
    discards: {},
    trade: null,
    nextTrade: 0,
    longestRoad: null,
    largestArmy: null,
    winner: null,
    log: [],
    nextLog: 0,
    diceMode: options.diceMode ?? 'classic',
    victoryPoints: options.victoryPoints ?? rules.victoryPoints.default,
    ...(rules.sea ? seaStart(board) : {}),
  };
  log(
    g,
    rules.sea
      ? 'The islands are ready. Place two settlements on the main island, each with a road or a ship, in snake order.'
      : 'The island is ready. Place two settlements and roads in snake order.',
  );
  return g;
}
export const activePlayer = (g: Pick<Game, 'players' | 'active'>) => g.players[g.active]!;
/** Catanova's anti-spam house rule; responses and bank/port trades do not consume this allowance. */
type BoardState = Pick<Game, 'board' | 'buildings' | 'roads'>;
export function settlementSites(g: BoardState, player: string, setup = false): number[] {
  return g.board.vertices
    .filter(
      (v) =>
        !g.buildings[v.id] &&
        v.neighbors.every((n) => !g.buildings[n]) &&
        (setup || v.edges.some((e) => g.roads[e] === player)),
    )
    .map((v) => v.id);
}
export function roadSites(g: BoardState, player: string, setupVertex: number | null = null): number[] {
  return g.board.edges
    .filter(
      (e) =>
        !g.roads[e.id] &&
        (setupVertex !== null
          ? e.a === setupVertex || e.b === setupVertex
          : [e.a, e.b].some((v) => {
              const building = g.buildings[v];
              if (building) return building.player === player;
              return g.board.vertices[v]!.edges.some((other) => g.roads[other] === player);
            })),
    )
    .map((e) => e.id);
}
export const pieces = (g: BoardState, player: string) => ({
  roads: Object.values(g.roads).filter((id) => id === player).length,
  settlements: Object.values(g.buildings).filter((b) => b.player === player && b.kind === 'settlement')
    .length,
  cities: Object.values(g.buildings).filter((b) => b.player === player && b.kind === 'city').length,
});
export function tradeRate(g: BoardState, player: string, resource: Resource): number {
  const ports = g.board.ports.filter((p) => {
    const e = g.board.edges[p.edge]!;
    return g.buildings[e.a]?.player === player || g.buildings[e.b]?.player === player;
  });
  return ports.some((p) => p.resource === resource) ? 2 : ports.some((p) => p.resource === 'any') ? 3 : 4;
}
export function longestTrail(g: BoardState, player: string): number {
  let longest = 0;
  const walk = (vertex: number, used: Set<number>) => {
    longest = Math.max(longest, used.size);
    if (used.size && g.buildings[vertex] && g.buildings[vertex]!.player !== player) return;
    for (const id of g.board.vertices[vertex]!.edges)
      if (g.roads[id] === player && !used.has(id)) {
        const edge = g.board.edges[id]!;
        used.add(id);
        walk(edge.a === vertex ? edge.b : edge.a, used);
        used.delete(id);
      }
  };
  for (const v of g.board.vertices) if (v.edges.some((e) => g.roads[e] === player)) walk(v.id, new Set());
  return longest;
}
/** One part of a player's points, named so that a results screen can say where each point came from. */
export type ScoreTerm = { id: ScoreTermId; points: number; count: number };
/**
 * The buildings (a point per settlement, two per city), the two awards, Open Sea's island bonuses and victory
 * point cards. A mode that scores something new adds its term here, read from its own part of the game, and every
 * reader of score() counts it: the game view, the win check, player records and the admin views.
 */
export type ScoreTermId = 'settlements' | 'cities' | 'longestRoad' | 'largestArmy' | 'islandBonus' | 'cards';
type Scored = Pick<Game, 'buildings' | 'longestRoad' | 'largestArmy' | 'islandBonuses'>;
/**
 * Where a player's points come from, in the order results list them, leaving out the terms worth nothing.
 * `hidden` counts victory point cards, which only their holder sees until someone wins.
 */
export function scoreTerms(g: Scored, p: Pick<Player, 'id' | 'cards'>, hidden = true): ScoreTerm[] {
  const buildings = Object.values(g.buildings).filter((b) => b.player === p.id);
  const cities = buildings.filter((b) => b.kind === 'city').length,
    settlements = buildings.length - cities,
    cards = hidden ? p.cards.filter((c) => c.kind === 'victoryPoint').length : 0;
  const award = (holder: string | null) => (holder === p.id ? 1 : 0);
  const terms: ScoreTerm[] = [
    { id: 'settlements', points: settlements, count: settlements },
    { id: 'cities', points: cities * 2, count: cities },
    { id: 'longestRoad', points: award(g.longestRoad) * 2, count: award(g.longestRoad) },
    { id: 'largestArmy', points: award(g.largestArmy) * 2, count: award(g.largestArmy) },
    // Open Sea: 2 points for each small island the player was first of theirs to settle (section 12.2).
    {
      id: 'islandBonus',
      points: islandBonusPoints(g, p.id),
      count: g.islandBonuses?.[p.id]?.length ?? 0,
    },
    { id: 'cards', points: cards, count: cards },
  ];
  return terms.filter((term) => term.points > 0);
}
/** A player's points: the sum of their score terms. */
export function score(g: Scored, p: Pick<Player, 'id' | 'cards'>, hidden = true): number {
  return scoreTerms(g, p, hidden).reduce((n, term) => n + term.points, 0);
}
/** A player's longest line for the route award: roads alone, or in Open Sea roads and ships (section 11). */
const routeLength = (g: Game, player: string) =>
  rulesetOf(g).sea ? longestRoute(g, player).length : longestTrail(g, player);
function updateAwards(g: Game) {
  const sea = !!rulesetOf(g).sea;
  for (const [key, minimum, values] of [
    ['longestRoad', 5, g.players.map((p) => (p.resigned ? 0 : routeLength(g, p.id)))],
    ['largestArmy', 3, g.players.map((p) => (p.resigned ? 0 : p.knights))],
  ] as const) {
    const max = Math.max(...values);
    const leaders = g.players.filter((_, i) => values[i] === max);
    const old = g[key];
    g[key] =
      max < minimum
        ? null
        : leaders.some((p) => p.id === old)
          ? old
          : leaders.length === 1
            ? leaders[0]!.id
            : null;
    if (g[key] && g[key] !== old)
      log(
        g,
        key === 'longestRoad' && sea
          ? SEA_LOG.longestRoute(g.players.find((p) => p.id === g[key])!.name)
          : `${g.players.find((p) => p.id === g[key])!.name} claimed ${key === 'longestRoad' ? 'Longest Road' : 'Largest Army'} (+2 points).`,
      );
  }
}
function checkWin(g: Game) {
  if (
    g.turn &&
    !activePlayer(g).resigned &&
    score(g, activePlayer(g)) >= (g.victoryPoints ?? rulesetOf(g).victoryPoints.default)
  ) {
    g.winner = activePlayer(g).id;
    g.phase = 'finished';
    g.trade = null;
    // Open Sea: a win can come while gold is being picked, when a resignation hands over an award; a finished
    // game owes nobody a pick.
    if (g.goldOwed) g.goldOwed = [];
    log(g, `${activePlayer(g).name} wins with ${score(g, activePlayer(g))} points!`);
  }
}
export function robberVictims(
  g: BoardState & { players?: { id: string; resigned?: boolean }[] },
  player: string,
  hex: number,
): string[] {
  return [
    ...new Set(
      g.board.hexes[hex]!.vertices.map((v) => g.buildings[v]?.player).filter(
        (p): p is string => !!p && p !== player && !g.players?.find((other) => other.id === p)?.resigned,
      ),
    ),
  ];
}
function finishFreeRoads(g: Game) {
  const id = activePlayer(g).id;
  if (
    g.freeRoads <= 0 ||
    (rulesetOf(g).sea
      ? !freePieceSites(g, id)
      : pieces(g, id).roads >= rulesetOf(g).supply.pieces.roads || !roadSites(g, id).length)
  ) {
    g.freeRoads = 0;
    g.phase = g.returnPhase;
  }
}
function produce(g: Game, number: number) {
  const owed = g.players.map(() => emptyHand());
  const received = g.players.map(() => emptyHand());
  for (const h of g.board.hexes) {
    // A desert, a gold field and the sea pay no resource here: Open Sea's gold is picked afterwards (9.2).
    const resource = producedResource(h);
    if (h.number === number && h.id !== g.robber && resource) {
      for (const v of h.vertices) {
        const b = g.buildings[v];
        if (b) {
          const i = g.players.findIndex((p) => p.id === b.player);
          if (!g.players[i]?.resigned) owed[i]![resource] += b.kind === 'city' ? 2 : 1;
        }
      }
    }
  }
  for (const r of RESOURCES) {
    const recipients = owed.map((h, i) => ({ n: h[r], i })).filter((x) => x.n > 0);
    const needed = recipients.reduce((n, p) => n + p.n, 0);
    if (needed > g.bank[r] && recipients.length > 1) {
      log(g, `The bank is short of ${RESOURCE_NAMES[r]}; nobody receives that resource.`);
      continue;
    }
    for (const { n, i } of recipients) {
      const amount = Math.min(n, g.bank[r]);
      g.players[i]!.hand[r] += amount;
      g.bank[r] -= amount;
      received[i]![r] += amount;
    }
  }
  for (const [i, hand] of received.entries())
    if (total(hand)) log(g, `${g.players[i]!.name} received ${resourceText(hand)}.`);
  // Open Sea: gold picks may still follow ordinary production (section 9.2), and then something is produced.
  if (!received.some((hand) => total(hand)) && !(rulesetOf(g).sea && goldOwedForRoll(g, number).length))
    log(g, 'No resources produced.');
}

function advanceTurn(g: Game, pendingRobber = false) {
  do {
    g.active = (g.active + 1) % g.players.length;
  } while (activePlayer(g).resigned);
  g.turn++;
  g.phase = pendingRobber ? 'robber' : 'roll';
  g.returnPhase = 'roll';
  g.dice = null;
  g.playedCard = false;
  g.freeRoads = 0;
  g.trade = null;
  const sea = !!rulesetOf(g).sea;
  // Open Sea: a new turn may move a ship again, and any ship built last turn may move in it (section 8.4).
  if (sea) {
    g.shipsBuiltThisTurn = [];
    g.shipMovedThisTurn = false;
  }
  const robber = sea ? ' Move the robber or the pirate, then roll.' : ' Move the robber, then roll.';
  log(g, `${activePlayer(g).name}'s turn.${pendingRobber ? robber : ''}`);
}

function advanceSetup(g: Game) {
  g.setupVertex = null;
  while (g.setupIndex < g.players.length * 2) {
    g.active = g.setupIndex < g.players.length ? g.setupIndex : g.players.length * 2 - 1 - g.setupIndex;
    if (!activePlayer(g).resigned) {
      g.phase = 'setupSettlement';
      return;
    }
    g.setupIndex++;
  }
  g.active = g.players.findIndex((p) => !p.resigned);
  g.turn = 1;
  g.phase = 'roll';
  log(g, 'Setup complete. Roll the dice to begin.');
}

/**
 * A seat changing hands, written into the game's own log.
 *
 * Nothing else about the game changes: the player keeps their roads, their
 * hand and their points, and a stand-in is not a resignation. The log is the
 * record of the match, so the handover belongs in it — a game somebody won
 * while a bot played four of their turns should say so afterwards.
 */
export function noteStandIn(state: Game, playerId: string, taking: boolean): Game {
  if (state.phase === 'finished') return state;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.resigned) return state;
  const g = structuredClone(state);
  log(
    g,
    taking
      ? `${player.name} lost connection. A bot is playing their seat until they return.`
      : `${player.name} reconnected and took their seat back.`,
  );
  return g;
}

/** Departures are a room rule, not a client game action. Apply all due seats together. */
export function resignPlayers(
  state: Game,
  playerIds: string[],
  options: { reason?: 'disconnect' | 'leave'; winnerEligibleIds?: string[]; botIds?: string[] } = {},
): Game {
  if (state.phase === 'finished') return state;
  const departing = state.players.filter((p) => !p.resigned && playerIds.includes(p.id));
  const survivors = state.players.filter((p) => !p.resigned && !playerIds.includes(p.id));
  const eligible = (id: string) =>
    options.winnerEligibleIds === undefined || options.winnerEligibleIds.includes(id);
  // Bots keep a table going for the people at it; they are not a table of their
  // own. Once nobody but bots is left the game is over, rather than paused for good.
  const bot = (id: string) => !!options.botIds?.includes(id);
  const onlyBotsLeft = survivors.length > 0 && survivors.every((p) => bot(p.id));
  if (!departing.length && !onlyBotsLeft && !(survivors.length === 1 && eligible(survivors[0]!.id)))
    return state;
  const g = structuredClone(state);
  for (const p of g.players)
    if (departing.some((other) => other.id === p.id)) {
      p.resigned = true;
      transfer(p.hand, g.bank, { ...p.hand });
      p.cards = [];
      delete g.discards[p.id];
      log(
        g,
        options.reason === 'leave'
          ? `${p.name} left the game and resigned.`
          : `${p.name} resigned after not reconnecting.`,
      );
    }
  // Open Sea: a resigned player's gold picks lapse, and the others' go on from the bank as it now stands,
  // their returned cards included (section 9.2).
  if (g.goldOwed?.length) {
    g.goldOwed = remainingGoldOwed(g.goldOwed, g.bank, g.players);
    if (g.phase === 'goldPick' && !g.goldOwed.length) endGoldPicks(g);
  }
  if (g.trade) {
    if (g.players.find((p) => p.id === g.trade!.player)?.resigned) g.trade = null;
    else {
      g.trade.proposals = g.trade.proposals?.filter((proposal) => !playerIds.includes(proposal.player));
      if (
        g.players.every((p) => p.resigned || p.id === g.trade!.player || g.trade!.declinedBy?.includes(p.id))
      )
        g.trade = null;
    }
  }
  updateAwards(g);
  const remaining = g.players.filter((p) => !p.resigned);
  if (!remaining.length || remaining.every((p) => bot(p.id))) {
    g.winner = null;
    g.finishReason = 'abandoned';
    g.phase = 'finished';
    g.trade = null;
    g.discards = {};
    g.freeRoads = 0;
    g.setupVertex = null;
    if (g.goldOwed) g.goldOwed = [];
    log(
      g,
      remaining.length
        ? 'The game ended with no winner: only bots were left at the table.'
        : 'The game ended with no winner: every player left.',
    );
    return g;
  }
  if (remaining.length === 1) {
    if (!eligible(remaining[0]!.id)) {
      g.active = g.players.findIndex((p) => p.id === remaining[0]!.id);
      g.phase = 'roll';
      g.trade = null;
      g.discards = {};
      g.freeRoads = 0;
      g.setupVertex = null;
      // Open Sea: the survivor starts afresh, and no ship built or moved in the last turn is theirs.
      if (g.goldOwed) g.goldOwed = [];
      if (g.shipsBuiltThisTurn) g.shipsBuiltThisTurn = [];
      if (g.shipMovedThisTurn) g.shipMovedThisTurn = false;
      return g;
    }
    g.winner = remaining[0]!.id;
    g.finishReason = 'resignation';
    g.phase = 'finished';
    g.trade = null;
    g.discards = {};
    g.freeRoads = 0;
    if (g.goldOwed) g.goldOwed = [];
    log(g, `${remaining[0]!.name} wins by resignation.`);
    return g;
  }
  if (activePlayer(g).resigned) {
    if (g.phase === 'setupSettlement' || g.phase === 'setupRoad') {
      g.setupIndex++;
      advanceSetup(g);
    } else if (g.phase === 'goldPick') {
      // The others still owed gold pick first; the turn passes after the last pick (section 9.2).
    } else if (g.phase !== 'discard' || !Object.keys(g.discards).length)
      advanceTurn(g, g.phase === 'robber' || g.phase === 'discard');
    // Other players finish required discards before the next player moves the robber.
  } else if (g.phase === 'discard' && !Object.keys(g.discards).length) g.phase = 'robber';
  if (eligible(activePlayer(g).id)) checkWin(g);
  return g;
}

/** Pure transition: caller supplies private randomness, and commits the result before broadcasting. */
export function applyAction(state: Game, playerId: string, raw: GameAction, random: () => number): Game {
  const a = parseGameAction(raw);
  requireRule(onBoard(state.board, a), 'Invalid board location');
  const rules = rulesetOf(state),
    { bank, pieces: supply } = rules.supply,
    sea = !!rules.sea;
  requireRule(handsWithin(bank, a), `Choose whole resource counts from 0 to ${bank}`);
  const g = structuredClone(state);
  const p = g.players.find((p) => p.id === playerId);
  requireRule(p, 'Not a player in this game');
  requireRule(!p.resigned, 'You resigned from this game; you can still watch');
  requireRule(g.phase !== 'finished', 'The game has ended');
  const isActive = activePlayer(g).id === p.id;
  if (a.kind === 'discard') {
    requireRule(g.phase === 'discard' && !!g.discards[p.id], 'You do not need to discard');
    requireRule(total(a.resources) === g.discards[p.id], `Discard exactly ${g.discards[p.id]} cards`);
    transfer(p.hand, g.bank, a.resources);
    delete g.discards[p.id];
    // Discards go back to the bank in front of everyone (and the bank's counts
    // show them anyway), so the record names them.
    log(g, `${p.name} discarded ${resourceText(a.resources)}.`);
    if (!Object.keys(g.discards).length) {
      if (activePlayer(g).resigned) {
        advanceTurn(g, true);
        checkWin(g);
      } else g.phase = 'robber';
    }
    return g;
  }
  if (a.kind === 'goldPick') {
    // Whoever is owed gold picks in their turn to pick, on turn or not (section 9.2).
    pickGold(g, p.id, a.resources);
    if (g.phase !== 'goldPick' && g.turn && activePlayer(g).resigned) {
      advanceTurn(g);
      checkWin(g);
    }
    return g;
  }
  if (a.kind === 'declineTrade') {
    requireRule(
      g.phase === 'actions' &&
        !isActive &&
        g.trade?.id === a.tradeId &&
        g.trade.player === activePlayer(g).id,
      'That trade is no longer available',
    );
    const offer = g.trade;
    requireRule(!offer.declinedBy?.includes(p.id), 'You already declined this trade');
    requireRule(
      !offer.proposals?.some((proposal) => proposal.player === p.id),
      'Your acceptance is committed until this offer ends',
    );
    offer.declinedBy = [...(offer.declinedBy ?? []), p.id];
    if (offer.proposals) offer.proposals = offer.proposals.filter((proposal) => proposal.player !== p.id);
    log(g, `${p.name} declined the trade offer.`);
    if (
      g.players.every(
        (other) => other.resigned || other.id === offer.player || offer.declinedBy!.includes(other.id),
      )
    ) {
      g.trade = null;
      log(g, 'Trade closed: everyone declined.');
    }
    return g;
  }
  if (a.kind === 'proposeTrade' || a.kind === 'withdrawProposal') {
    requireRule(
      g.phase === 'actions' &&
        !isActive &&
        g.trade?.id === a.tradeId &&
        (a.kind === 'withdrawProposal' || g.trade.open) &&
        g.trade.player === activePlayer(g).id,
      'That trade is no longer available',
    );
    const offer = g.trade;
    requireRule(!offer.declinedBy?.includes(p.id), 'You already declined this trade');
    requireRule(a.kind !== 'withdrawProposal', 'Your acceptance is committed until this offer ends');
    requireRule(
      !offer.proposals?.some((proposal) => proposal.player === p.id),
      'Your acceptance is committed until this offer ends',
    );
    if (a.kind === 'proposeTrade') {
      requireRule(
        total(a.give) > 0 && RESOURCES.every((r) => !a.give[r] || !offer.give[r]),
        'Offer cards with no resource on both sides',
      );
      requireRule(canPay(p.hand, a.give), 'You do not have the proposed cards');
      offer.proposals = [
        ...(offer.proposals ?? []).filter((proposal) => proposal.player !== p.id),
        { player: p.id, give: a.give },
      ];
      log(
        g,
        `${p.name} proposed ${resourceText(a.give)} for ${activePlayer(g).name}'s ${resourceText(offer.give)}.`,
      );
    }
    return g;
  }
  if (a.kind === 'acceptProposal') {
    requireRule(
      g.phase === 'actions' && isActive && g.trade?.id === a.tradeId && g.trade.player === p.id,
      'That proposal is no longer available',
    );
    const offer = g.trade,
      proposal = offer.proposals?.find((proposal) => proposal.player === a.player);
    const responder = g.players.find(
      (other) => other.id === a.player && other.id !== p.id && !other.resigned,
    );
    requireRule(
      proposal && responder && !offer.declinedBy?.includes(a.player),
      'That proposal is no longer available',
    );
    requireRule(
      !a.expectedGive || RESOURCES.every((r) => a.expectedGive![r] === proposal.give[r]),
      'That proposal changed; review the new cards',
    );
    requireRule(
      canPay(p.hand, offer.give) && canPay(responder.hand, proposal.give),
      'A player no longer has the offered cards',
    );
    transfer(p.hand, responder.hand, offer.give);
    transfer(responder.hand, p.hand, proposal.give);
    log(
      g,
      `${p.name} traded ${resourceText(offer.give)} to ${responder.name} for ${resourceText(proposal.give)}.`,
    );
    g.trade = null;
    return g;
  }
  if (a.kind === 'acceptTrade') {
    requireRule(
      g.phase === 'actions' &&
        !isActive &&
        g.trade?.id === a.tradeId &&
        !g.trade.open &&
        g.trade.player === activePlayer(g).id,
      'That trade is no longer available',
    );
    const maker = activePlayer(g),
      offer = g.trade;
    requireRule(!offer.declinedBy?.includes(p.id), 'You already declined this trade');
    requireRule(
      canPay(maker.hand, offer.give) && canPay(p.hand, offer.want),
      'A player no longer has the offered cards',
    );
    requireRule(
      !offer.proposals?.some((proposal) => proposal.player === p.id),
      'You already accepted this offer',
    );
    // A fixed two-player offer already names the only possible recipient. Their
    // confirmation completes that exact exchange; open counteroffers still need approval.
    if (g.players.filter((other) => !other.resigned).length === 2) {
      transfer(maker.hand, p.hand, offer.give);
      transfer(p.hand, maker.hand, offer.want);
      log(
        g,
        `${maker.name} traded ${resourceText(offer.give)} to ${p.name} for ${resourceText(offer.want)}.`,
      );
      g.trade = null;
      return g;
    }
    offer.proposals = [...(offer.proposals ?? []), { player: p.id, give: { ...offer.want } }];
    log(g, `${p.name} is willing to trade with ${maker.name}.`);
    return g;
  }
  requireRule(isActive, 'Wait for your turn');
  const owned = pieces(g, p.id);
  if (g.phase === 'setupSettlement' && sea) {
    requireRule(a.kind === 'settlement', 'Place a starting settlement on the main island');
    placeStartingSettlement(g, p.id, a.vertex);
    return g;
  }
  if (g.phase === 'setupSettlement') {
    requireRule(
      a.kind === 'settlement' && settlementSites(g, p.id, true).includes(a.vertex),
      'Choose an empty corner at least two edges from another settlement',
    );
    g.buildings[a.vertex] = { player: p.id, kind: 'settlement' };
    g.setupVertex = a.vertex;
    g.phase = 'setupRoad';
    const startingResources = emptyHand();
    if (g.setupIndex >= g.players.length)
      for (const id of g.board.vertices[a.vertex]!.hexes) {
        const resource = g.board.hexes[id]!.terrain as Resource | 'desert';
        if (resource !== 'desert') {
          p.hand[resource]++;
          g.bank[resource]--;
          startingResources[resource]++;
        }
      }
    log(g, `${p.name} placed a starting settlement at corner ${a.vertex + 1}.`);
    if (total(startingResources))
      log(g, `${p.name} received ${resourceText(startingResources)} from the starting settlement.`);
    return g;
  }
  if (g.phase === 'setupRoad' && sea) {
    placeStartingPiece(g, p.id, a);
    g.setupIndex++;
    advanceSetup(g);
    return g;
  }
  if (g.phase === 'setupRoad') {
    requireRule(
      a.kind === 'road' && roadSites(g, p.id, g.setupVertex).includes(a.edge),
      'Place a road touching your new settlement',
    );
    log(g, `${p.name} placed a starting road on edge ${a.edge + 1}.`);
    g.roads[a.edge] = p.id;
    g.setupIndex++;
    advanceSetup(g);
    return g;
  }
  if (a.kind === 'pirate') {
    requireRule(sea, 'That action is unavailable');
    requireRule(g.phase === 'robber', 'Move the pirate only after a seven or a Knight');
    movePirate(g, p.id, a.hex, a.victim, random);
    g.phase = g.returnPhase;
    checkWin(g);
    return g;
  }
  if (a.kind === 'robber') {
    requireRule(g.phase === 'robber' && a.hex !== g.robber, 'Move the robber to a different tile');
    // Open Sea: the robber stays on land, any island's (section 10.1).
    requireRule(!sea || isLand(g.board.hexes[a.hex]!), 'Move the robber to a land tile');
    const victims = robberVictims(g, p.id, a.hex);
    requireRule(
      victims.length ? !!a.victim && victims.includes(a.victim) : !a.victim,
      'Choose one opponent touching this tile',
    );
    g.robber = a.hex;
    if (a.victim) {
      const victim = g.players.find((other) => other.id === a.victim)!;
      const cards = RESOURCES.flatMap((r) => Array<Resource>(victim.hand[r]).fill(r));
      if (cards.length) {
        const stolen = cards[Math.floor(random() * cards.length)]!;
        victim.hand[stolen]--;
        p.hand[stolen]++;
        log(g, `${p.name} moved the robber and stole a card from ${victim.name}.`);
      } else log(g, `${p.name} moved the robber. ${victim.name} had no resource cards.`);
    } else log(g, `${p.name} moved the robber.`);
    g.phase = g.returnPhase;
    checkWin(g);
    return g;
  }
  if (a.kind === 'ship' && g.phase === 'freeRoads') {
    // Open Sea's Road Building places ships too (section 13.2), and a free ship counts as built this turn.
    requireRule(sea && canPlaceShip(g, p.id, a.edge, 'roadBuilding'), 'Choose a legal edge for the ship');
    Object.assign(g, placeShip(g, p.id, a.edge, 'roadBuilding'));
    g.freeRoads--;
    finishFreeRoads(g);
    updateAwards(g);
    checkWin(g);
    log(g, SEA_LOG.freeShip(p.name, a.edge));
    return g;
  }
  if (a.kind === 'road' && g.phase === 'freeRoads') {
    requireRule(
      sea
        ? canPlaceRoadOpenSea(g, p.id, a.edge)
        : owned.roads < supply.roads && roadSites(g, p.id).includes(a.edge),
      'Choose a legal road site',
    );
    g.roads[a.edge] = p.id;
    g.freeRoads--;
    finishFreeRoads(g);
    updateAwards(g);
    checkWin(g);
    log(g, `${p.name} built a free road on edge ${a.edge + 1}.`);
    return g;
  }
  if (a.kind === 'playCard') {
    requireRule(g.phase === 'roll' || g.phase === 'actions', 'Finish the current action first');
    requireRule(!g.playedCard, 'Only one development card can be played per turn');
    const card = p.cards.find((c) => c.id === a.cardId);
    requireRule(
      card && card.boughtTurn < g.turn && card.kind !== 'victoryPoint',
      'That card cannot be played this turn',
    );
    g.returnPhase = g.phase;
    g.trade = null;
    if (card.kind === 'knight') {
      p.knights++;
      g.phase = 'robber';
    }
    if (card.kind === 'roadBuilding' && sea) {
      // Two roads, two ships or one of each (section 13.2): as many as the supply and the sites allow.
      requireRule(freePieceSites(g, p.id), 'No legal road or ship is available');
      g.freeRoads = Math.min(2, supply.roads - owned.roads + supply.ships! - shipCount(g, p.id));
      g.phase = 'freeRoads';
    } else if (card.kind === 'roadBuilding') {
      requireRule(owned.roads < supply.roads && roadSites(g, p.id).length, 'No legal road is available');
      g.freeRoads = Math.min(2, supply.roads - owned.roads);
      g.phase = 'freeRoads';
    }
    if (card.kind === 'yearOfPlenty') {
      requireRule(
        a.resources && total(a.resources) === Math.min(2, total(g.bank)) && total(g.bank) > 0,
        'Choose two available bank resources (or the remainder if only one exists)',
      );
      transfer(g.bank, p.hand, a.resources);
      log(g, `${p.name} took ${resourceText(a.resources)} from the bank with Year of Plenty.`);
    }
    if (card.kind === 'monopoly') {
      requireRule(a.resource, 'Choose a resource');
      let taken = 0;
      for (const other of g.players)
        if (other.id !== p.id) {
          taken += other.hand[a.resource];
          p.hand[a.resource] += other.hand[a.resource];
          other.hand[a.resource] = 0;
        }
      log(g, `${p.name} collected ${taken} ${RESOURCE_NAMES[a.resource]} with Monopoly.`);
    }
    p.cards = p.cards.filter((c) => c.id !== card.id);
    g.playedCard = true;
    log(g, `${p.name} played ${CARD_NAMES[card.kind]}.`);
    updateAwards(g);
    checkWin(g);
    return g;
  }
  if (a.kind === 'roll') {
    requireRule(g.phase === 'roll', 'You have already rolled or must finish the current action');
    if (g.diceMode === 'balanced') g.balancedDice ??= { remaining: [] };
    g.dice = rollDice(g.diceMode ?? 'classic', random, g.balancedDice);
    const sum = g.dice[0] + g.dice[1];
    log(g, `${p.name} rolled ${g.dice[0]} + ${g.dice[1]} = ${sum}.`);
    if (sum === 7) {
      g.discards = Object.fromEntries(
        g.players
          .filter((other) => !other.resigned && total(other.hand) > 7)
          .map((other) => [other.id, Math.floor(total(other.hand) / 2)]),
      );
      g.returnPhase = 'actions';
      g.phase = Object.keys(g.discards).length ? 'discard' : 'robber';
    } else {
      produce(g, sum);
      g.phase = 'actions';
      // Open Sea: then the gold picks, one player at a time, before the action phase (section 9.2).
      if (sea) oweGold(g, sum);
    }
    return g;
  }
  requireRule(g.phase === 'actions', 'Finish the current action first');
  // Keep one live offer; cancelling it deliberately permits another with no per-turn cap.
  if (a.kind === 'offerTrade' || a.kind === 'openTrade')
    requireRule(!g.trade, 'Cancel your current offer before creating another');
  else g.trade = null;
  switch (a.kind) {
    case 'road':
      requireRule(
        sea
          ? canPlaceRoadOpenSea(g, p.id, a.edge)
          : owned.roads < supply.roads && roadSites(g, p.id).includes(a.edge),
        'Choose a legal road site',
      );
      transfer(p.hand, g.bank, rules.costs.road);
      g.roads[a.edge] = p.id;
      log(g, `${p.name} built a road on edge ${a.edge + 1}.`);
      break;
    case 'settlement':
      if (sea) {
        buildSeaSettlement(g, p.id, a.vertex);
        break;
      }
      requireRule(
        owned.settlements < supply.settlements && settlementSites(g, p.id).includes(a.vertex),
        'Choose a legal settlement site',
      );
      transfer(p.hand, g.bank, rules.costs.settlement);
      g.buildings[a.vertex] = { player: p.id, kind: 'settlement' };
      log(g, `${p.name} built a settlement at corner ${a.vertex + 1}.`);
      break;
    case 'ship':
      requireRule(sea, 'That action is unavailable');
      requireRule(canPlaceShip(g, p.id, a.edge, 'build'), 'Choose a legal edge for the ship');
      transfer(p.hand, g.bank, rules.costs.ship!);
      Object.assign(g, placeShip(g, p.id, a.edge, 'build'));
      log(g, SEA_LOG.ship(p.name, a.edge));
      break;
    case 'moveShip': {
      requireRule(sea, 'That action is unavailable');
      // Once a turn, in the action phase only, never between Road Building's placements (section 8).
      const block = shipMoveBlock(g, p.id, a.from);
      requireRule(!block, block ? SHIP_MOVE_BLOCKS[block] : '');
      requireRule(legalShipDestinations(g, p.id, a.from).includes(a.to), 'The ship cannot move to that edge');
      Object.assign(g, moveShip(g, p.id, a.from, a.to));
      log(g, SEA_LOG.shipMove(p.name, a.from, a.to));
      break;
    }
    case 'city':
      requireRule(
        owned.cities < supply.cities &&
          g.buildings[a.vertex]?.player === p.id &&
          g.buildings[a.vertex]?.kind === 'settlement',
        'Upgrade one of your settlements',
      );
      transfer(p.hand, g.bank, rules.costs.city);
      g.buildings[a.vertex]!.kind = 'city';
      log(g, `${p.name} built a city at corner ${a.vertex + 1}.`);
      break;
    case 'buyCard':
      requireRule(g.deck.length > 0, 'The development deck is empty');
      transfer(p.hand, g.bank, rules.costs.developmentCard);
      p.cards.push({ id: `card-${g.nextCard++}`, kind: g.deck.pop()!, boughtTurn: g.turn });
      log(g, `${p.name} bought a development card.`);
      break;
    case 'bankTrade': {
      requireRule(a.give !== a.receive, 'Choose two different resources');
      const rate = tradeRate(g, p.id, a.give),
        give = emptyHand(),
        receive = emptyHand();
      give[a.give] = rate;
      receive[a.receive] = 1;
      requireRule(g.bank[a.receive] > 0, 'The bank is out of that resource');
      transfer(p.hand, g.bank, give);
      transfer(g.bank, p.hand, receive);
      log(
        g,
        `${p.name} traded ${rate} ${RESOURCE_NAMES[a.give]} for 1 ${RESOURCE_NAMES[a.receive]} at ${rate}:1.`,
      );
      break;
    }
    case 'offerTrade':
      requireRule(
        total(a.give) > 0 && total(a.want) > 0 && RESOURCES.every((r) => !a.give[r] || !a.want[r]),
        'Both sides must offer cards, with no resource on both sides',
      );
      requireRule(canPay(p.hand, a.give), 'You do not have the offered cards');
      g.trade = { id: g.nextTrade++, player: p.id, give: a.give, want: a.want };
      log(g, `${p.name} offered ${resourceText(a.give)} for ${resourceText(a.want)}.`);
      break;
    case 'openTrade':
      requireRule(total(a.give) > 0, 'Offer at least one resource card');
      requireRule(canPay(p.hand, a.give), 'You do not have the offered cards');
      g.trade = {
        id: g.nextTrade++,
        player: p.id,
        give: a.give,
        want: emptyHand(),
        open: true,
        proposals: [],
      };
      log(g, `${p.name} offered ${resourceText(a.give)} and invited trade proposals.`);
      break;
    case 'cancelTrade':
      log(g, `${p.name} withdrew the trade offer.`);
      break;
    case 'endTurn':
      advanceTurn(g);
      break;
    default:
      throw new RuleError('That action is unavailable');
  }
  updateAwards(g);
  checkWin(g);
  return g;
}

export const CARD_NAMES: Record<CardKind, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  victoryPoint: 'Victory Point',
};
export type PlayerView = {
  id: string;
  name: string;
  resigned?: boolean;
  resourceCount: number;
  cardCount: number;
  knights: number;
  points: number;
  /** Where `points` come from, with the same cards hidden. */
  terms: ScoreTerm[];
  /** The longest line for the route award: roads, or in Open Sea roads and ships (Longest Route). */
  roadLength: number;
  /** Pieces on the board. `ships` only in Open Sea. */
  pieces: ReturnType<typeof pieces> & { ships?: number };
  hand?: Hand;
  cards?: Card[];
};
/** What Open Sea adds to a player's legal moves (docs/RULEBOOK-OPEN-SEA.md). Absent in every other mode. */
export type SeaLegal = {
  /** Edges where the viewer may put a ship now: beside their new settlement in setup, free, or bought. */
  ships: number[];
  /** In the viewer's action phase: each ship of theirs that may move, with the edges it may move to (8). */
  shipMoves: Record<number, number[]>;
  /** In the viewer's action phase: why each of their other ships cannot move (14). */
  shipMoveBlocks: Record<number, ShipMoveBlock>;
  /** While the viewer owes the move after a seven or a Knight: where the robber and the pirate may go (10). */
  robberHexes?: number[];
  pirateHexes?: number[];
  /** When it is the viewer's turn to pick from a gold field: how many cards, of which types (9.2). */
  goldPick?: { count: number; types: Resource[] };
};
export type GameView = Omit<
  Game,
  'deck' | 'players' | 'nextCard' | 'nextLog' | 'nextTrade' | 'balancedDice'
> & {
  deckCount: number;
  players: PlayerView[];
  legal: {
    roads: number[];
    settlements: number[];
    cities: number[];
    playableCards: string[];
    canBuyCard: boolean;
    rates: Hand;
  } & Partial<SeaLegal>;
};
export function gameView(g: Game, viewer: string): GameView {
  const {
    balancedDice: _balancedDice,
    deck,
    players,
    nextCard: _card,
    nextLog: _log,
    nextTrade: _trade,
    ...publicState
  } = g;
  const me = players.find((p) => p.id === viewer);
  const active = !!me && !me.resigned && activePlayer(g).id === viewer;
  const owned = pieces(g, viewer);
  const { costs, supply, sea } = rulesetOf(g);
  const build = active && g.phase === 'actions',
    setup = active && g.phase === 'setupSettlement';
  const {
    roads: seaRoads,
    settlements: seaSettlements,
    ...seaMoves
  } = sea ? seaLegal(g, viewer, active ? me : undefined) : { roads: undefined, settlements: undefined };
  return {
    ...structuredClone(publicState),
    deckCount: deck.length,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.resigned ? { resigned: true } : {}),
      resourceCount: total(p.hand),
      cardCount: p.cards.length,
      knights: p.knights,
      points: score(g, p, p.id === viewer || !!g.winner),
      terms: scoreTerms(g, p, p.id === viewer || !!g.winner),
      roadLength: routeLength(g, p.id),
      pieces: sea ? { ...pieces(g, p.id), ships: shipCount(g, p.id) } : pieces(g, p.id),
      ...(p.id === viewer ? { hand: { ...p.hand }, cards: structuredClone(p.cards) } : {}),
    })),
    legal: {
      roads: seaRoads
        ? seaRoads
        : owned.roads >= supply.pieces.roads
          ? []
          : active && g.phase === 'setupRoad'
            ? roadSites(g, viewer, g.setupVertex)
            : (active && g.phase === 'freeRoads') || (build && canPay(me.hand, costs.road))
              ? roadSites(g, viewer)
              : [],
      settlements: seaSettlements
        ? seaSettlements
        : owned.settlements < supply.pieces.settlements &&
            (setup || (build && canPay(me.hand, costs.settlement)))
          ? settlementSites(g, viewer, setup)
          : [],
      cities:
        build && owned.cities < supply.pieces.cities && canPay(me.hand, costs.city)
          ? Object.entries(g.buildings)
              .filter(([, b]) => b.player === viewer && b.kind === 'settlement')
              .map(([id]) => Number(id))
          : [],
      playableCards:
        active && ['roll', 'actions'].includes(g.phase) && !g.playedCard
          ? me.cards.filter((c) => c.kind !== 'victoryPoint' && c.boughtTurn < g.turn).map((c) => c.id)
          : [],
      canBuyCard: build && deck.length > 0 && canPay(me.hand, costs.developmentCard),
      rates: Object.fromEntries(RESOURCES.map((r) => [r, tradeRate(g, viewer, r)])) as Hand,
      ...seaMoves,
    },
  };
}

// Open Sea (ruleset open-sea-v1, docs/RULEBOOK-OPEN-SEA.md). The rules are sea.ts's and gold.ts's; these apply
// them to a game and write its log. applyAction and gameView reach them only for a game whose ruleset has the
// sea, so a Classic game never does.

/** The fields a new Open Sea game starts with: the pirate on its template's sea hex, and no ships yet. */
function seaStart(board: Board): Required<SeaFields> {
  const pirate = board.pirateStart;
  requireRule(pirate !== undefined && !isLand(board.hexes[pirate]!), 'The island has no sea for the pirate');
  return {
    ships: {},
    pirate,
    shipsBuiltThisTurn: [],
    shipMovedThisTurn: false,
    lockedShips: [],
    closedShipEnds: {},
    islandBonuses: {},
    goldOwed: [],
  };
}
const shipCount = (g: Pick<Game, 'ships'>, player: string) =>
  Object.values(g.ships ?? {}).filter((owner) => owner === player).length;
/** Whether Road Building has anywhere to put a piece: a road or a ship, each by its own rule (13.2). */
function freePieceSites(g: Game, player: string) {
  const sites = roadBuildingSites(g, player);
  return sites.roads.length > 0 || sites.ships.length > 0;
}

/**
 * A starting settlement, on the main island (5.3). The second collects a resource from each producing hex beside
 * it and a pick for each gold field, made straight away, before its road or ship (5.5 and 9.3).
 */
function placeStartingSettlement(g: Game, player: string, vertex: number) {
  requireRule(
    settlementSitesOpenSea(g, player, true).includes(vertex),
    'Choose an empty corner of the main island at least two edges from another settlement',
  );
  const p = g.players.find((other) => other.id === player)!;
  Object.assign(g, placeSettlement(g, player, vertex, true));
  g.setupVertex = vertex;
  g.phase = 'setupRoad';
  log(g, `${p.name} placed a starting settlement at corner ${vertex + 1}.`);
  if (g.setupIndex < g.players.length) return;
  const { resources, goldPicks } = startingResources(g.board, vertex);
  transfer(g.bank, p.hand, resources);
  if (total(resources)) log(g, `${p.name} received ${resourceText(resources)} from the starting settlement.`);
  g.goldOwed = remainingGoldOwed(goldPicks ? [{ player, picks: goldPicks }] : [], g.bank, g.players);
  if (g.goldOwed.length) g.phase = 'goldPick';
}
/** The road or ship after a starting settlement, touching it; a ship only on a coastal or sea edge (5.4). */
function placeStartingPiece(g: Game, player: string, a: GameAction) {
  const p = g.players.find((other) => other.id === player)!,
    at = g.setupVertex!;
  if (a.kind === 'ship') {
    requireRule(canPlaceShip(g, player, a.edge, { setup: at }), 'Place a ship touching your new settlement');
    Object.assign(g, placeShip(g, player, a.edge, { setup: at }));
    log(g, SEA_LOG.startingShip(p.name, a.edge));
    return;
  }
  requireRule(
    a.kind === 'road' && canPlaceRoadOpenSea(g, player, a.edge, at),
    'Place a road or a ship touching your new settlement',
  );
  log(g, `${p.name} placed a starting road on edge ${a.edge + 1}.`);
  g.roads[a.edge] = player;
}
/** A settlement built in play: by a road or a ship of the player's, earning any island bonus (7.4 and 12.2). */
function buildSeaSettlement(g: Game, player: string, vertex: number) {
  requireRule(settlementSitesOpenSea(g, player).includes(vertex), 'Choose a legal settlement site');
  const p = g.players.find((other) => other.id === player)!;
  const island = islandBonusForSettlement(g, player, vertex, false);
  transfer(p.hand, g.bank, rulesetOf(g).costs.settlement);
  Object.assign(g, placeSettlement(g, player, vertex));
  log(g, `${p.name} built a settlement at corner ${vertex + 1}.`);
  if (island) log(g, SEA_LOG.islandBonus(p.name));
}

/**
 * After ordinary production, the gold picks a roll pays, in turn order from the player on turn (9.2). The action
 * phase waits for them. From an empty bank they lapse at once, and the log says so.
 */
function oweGold(g: Game, roll: number) {
  g.goldOwed = goldOwedForRoll(g, roll);
  if (g.goldOwed.length) g.phase = 'goldPick';
  // goldOwedForRoll owes nothing from an empty bank; asked again with a card in it, it says whether gold was due.
  else if (!total(g.bank) && goldOwedForRoll({ ...g, bank: { ...g.bank, wood: 1 } }, roll).length)
    log(g, 'The bank has no cards left, so nobody picks from a gold field.');
}
/** A player's gold picks, all in one action: exactly as many cards as they are owed, or all the bank holds (9.2). */
function pickGold(g: Game, player: string, picks: Hand) {
  requireRule(g.phase === 'goldPick', 'Nobody is picking from a gold field now');
  const issue = goldPickIssue(g, player, picks);
  requireRule(!issue, issue ?? '');
  const name = g.players.find((other) => other.id === player)!.name,
    waiting = g.goldOwed!.length - 1;
  Object.assign(g, applyGoldPick(g, player, picks));
  if (total(picks)) log(g, goldPickText(name, picks));
  // Only an empty bank ends the queue early: every player still in it is owed a pick.
  if (waiting && !g.goldOwed!.length) log(g, 'The bank has run out of cards, so the other gold picks lapse.');
  if (!g.goldOwed!.length) endGoldPicks(g);
}
/** Once every pick is made: back to setup's road or ship, or on to the action phase (5.5 and 9.2). */
function endGoldPicks(g: Game) {
  g.phase = g.turn === 0 ? 'setupRoad' : 'actions';
}

/** The pirate to another sea hex, robbing a player with a ship on its edges if anyone has one (10.5). */
function movePirate(g: Game, player: string, hex: number, victim: string | undefined, random: () => number) {
  const issue = pirateMoveIssue(g, player, hex, victim);
  requireRule(!issue, issue ?? '');
  const p = g.players.find((other) => other.id === player)!;
  g.pirate = hex;
  const robbed = victim === undefined ? undefined : g.players.find((other) => other.id === victim)!;
  if (!robbed) return log(g, SEA_LOG.pirate(p.name));
  const cards = RESOURCES.flatMap((r) => Array<Resource>(robbed.hand[r]).fill(r));
  if (cards.length) {
    const stolen = cards[Math.floor(random() * cards.length)]!;
    robbed.hand[stolen]--;
    p.hand[stolen]++;
  }
  log(g, SEA_LOG.pirate(p.name, { name: robbed.name, hadCards: cards.length > 0 }));
}

/**
 * What Open Sea adds to a player's view: where they may put a road, a settlement or a ship now, which of their
 * ships may move and where, or why not, the robber's and the pirate's hexes while that move is theirs, and their
 * gold picks. `active` is the viewer when the turn is theirs, else undefined.
 */
function seaLegal(
  g: Game,
  viewer: string,
  active: Player | undefined,
): SeaLegal & { roads: number[]; settlements: number[] } {
  const { costs } = rulesetOf(g);
  const affords = (cost: Hand) => !!active && g.phase === 'actions' && canPay(active.hand, cost);
  const setup = active && g.phase === 'setupRoad' ? g.setupVertex : null,
    free = !!active && g.phase === 'freeRoads';
  const shipMoves: Record<number, number[]> = {},
    shipMoveBlocks: Record<number, ShipMoveBlock> = {};
  if (active && g.phase === 'actions') {
    const movable = new Set(movableShips(g, viewer));
    for (const [edge, owner] of Object.entries(g.ships ?? {}))
      if (owner === viewer) {
        const e = Number(edge);
        if (movable.has(e)) shipMoves[e] = legalShipDestinations(g, viewer, e);
        else shipMoveBlocks[e] = shipMoveBlock(g, viewer, e)!;
      }
  }
  const picking = g.phase === 'goldPick' ? g.goldOwed?.[0] : undefined;
  const targets = active && g.phase === 'robber' ? knightTargets(g) : undefined;
  return {
    roads:
      setup !== null
        ? roadSitesOpenSea(g, viewer, setup)
        : free || affords(costs.road)
          ? roadSitesOpenSea(g, viewer)
          : [],
    settlements:
      active && g.phase === 'setupSettlement'
        ? settlementSitesOpenSea(g, viewer, true)
        : affords(costs.settlement)
          ? settlementSitesOpenSea(g, viewer)
          : [],
    ships:
      setup !== null
        ? shipSites(g, viewer, { setup })
        : free
          ? shipSites(g, viewer, 'roadBuilding')
          : affords(costs.ship!)
            ? shipSites(g, viewer, 'build')
            : [],
    shipMoves,
    shipMoveBlocks,
    ...(targets ? { robberHexes: targets.robber, pirateHexes: targets.pirate } : {}),
    ...(picking?.player === viewer
      ? { goldPick: { count: Math.min(picking.picks, total(g.bank)), types: goldPickTypes(g.bank) } }
      : {}),
  };
}
