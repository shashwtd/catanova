import { DEVELOPMENT_DECK, RESOURCES, RESOURCE_NAMES } from './index.js';
import type { Resource } from './index.js';
import { generateBoard, shuffle } from './board.js';
import {
  TURN_STRUCTURES,
  boardPresetOf,
  findRuleset,
  fullBank,
  handLimit,
  playsBoard,
  rulesetOf,
  seatRange,
  targetRangeText,
  validTarget,
} from './rulesets.js';
import type { TurnStructure } from './rulesets.js';
import type { Board } from './board.js';
import { rollDice } from './dice.js';
import type { DiceMode, BalancedDiceState } from './dice.js';

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
 * What the game waits for. Big Table adds two: 'partner', the Partner's phase of a paired turn, and
 * 'buildWindow', one player's window to build between turns. In both, `active` is the player acting, as it is
 * in every other phase; `pair` and `windows` say whose turn it is.
 */
export type Phase =
  | 'setupSettlement'
  | 'setupRoad'
  | 'roll'
  | 'actions'
  | 'discard'
  | 'robber'
  | 'freeRoads'
  | 'partner'
  | 'buildWindow'
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
  /** Whether a development card was played in the part under way: a turn, a Lead's part or a Partner's phase. */
  playedCard: boolean;
  /** Where a Knight's robber or Road Building's roads return to. */
  returnPhase: 'roll' | 'actions' | 'partner';
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
  /** The turn structure the host chose, frozen at the start. Only a mode that offers a choice has one. */
  turns?: TurnStructure;
  /**
   * Paired turns: the seats of the paired turn's Lead and Partner, from the moment the markers reach them until
   * the Partner's phase ends. Both are on turn for the whole paired turn, whoever is acting. Absent once fewer
   * than five players remain, when turns go one player at a time (docs/RULEBOOK-BIG-TABLE.md, 6.8).
   */
  pair?: { lead: number; partner: number };
  /**
   * Between-turns build: the build windows running after the turn of seat `after`. `robber` is a robber move a
   * resigned player left owing, which the next player makes before rolling, once the windows are over.
   */
  windows?: { after: number; robber?: true };
};
export type GameAction =
  | { kind: 'start' | 'returnToLobby' }
  | { kind: 'settlement' | 'city'; vertex: number }
  | { kind: 'road'; edge: number }
  | { kind: 'roll' | 'endTurn' | 'buyCard' | 'cancelTrade' }
  /** The Partner ends their phase. `expired`: the clock ended it, leaving free roads still owed unplaced. */
  | { kind: 'endPhase'; expired?: true }
  /** The player in a build window closes it. */
  | { kind: 'endWindow' }
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
 * new action that names a `vertex`, `edge` or `hex` is checked without being listed here.
 */
function onBoard(board: Board, a: GameAction) {
  return (
    (!('vertex' in a) || a.vertex < board.vertices.length) &&
    (!('edge' in a) || a.edge < board.edges.length) &&
    (!('hex' in a) || a.hex < board.hexes.length)
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
    case 'endWindow':
      return { kind: a.kind };
    case 'endPhase':
      requireRule(a.expired === undefined || a.expired === true, 'Invalid action');
      return a.expired ? { kind: a.kind, expired: true } : { kind: a.kind };
    case 'settlement':
    case 'city':
      return { kind: a.kind, vertex: index(a.vertex, BOARD_ID_LIMIT) };
    case 'road':
      return { kind: a.kind, edge: index(a.edge, BOARD_ID_LIMIT) };
    case 'robber':
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
  // `turns`: the turn structure the host chose, where the mode offers one; its first when absent.
  options: {
    diceMode?: DiceMode;
    victoryPoints?: number;
    board?: Board;
    ruleset?: string;
    turns?: TurnStructure;
  } = {},
): Game {
  const rules = findRuleset(options.ruleset);
  requireRule(rules, 'This game mode is not available');
  requireRule(
    options.victoryPoints === undefined || validTarget(rules, options.victoryPoints),
    targetRangeText(rules),
  );
  requireRule(
    options.turns === undefined || !!rules.turns?.includes(options.turns),
    `${rules.name} has no turn structure called ${options.turns}`,
  );
  requireRule(
    seats.length >= rules.seats.min && seats.length <= rules.seats.max,
    `Start with ${seatRange(rules)} players`,
  );
  requireRule(new Set(seats.map((p) => p.id)).size === seats.length, 'Seats must be unique');
  requireRule(!options.board || options.board.seed === seed >>> 0, 'The island does not match its seed');
  requireRule(!options.board || playsBoard(rules, options.board), 'The island was dealt for another mode');
  const board = options.board ? structuredClone(options.board) : generateBoard(seed, boardPresetOf(rules));
  const g: Game = {
    schema: 1,
    ruleset: rules.id,
    board,
    players: seats.map((p) => ({ ...p, hand: emptyHand(), cards: [], knights: 0 })),
    bank: fullBank(rules),
    buildings: {},
    roads: {},
    // A board with two deserts says which one the robber starts on; Classic's has only the one.
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
    ...(rules.turns ? { turns: options.turns ?? rules.turns[0]! } : {}),
  };
  log(g, 'The island is ready. Place two settlements and roads in snake order.');
  if (g.turns) log(g, `This game plays ${TURN_STRUCTURES[g.turns].name}.`);
  return g;
}
export const activePlayer = (g: Pick<Game, 'players' | 'active'>) => g.players[g.active]!;
/** How many players are still in the game. */
const stillPlaying = (g: { players: readonly { resigned?: boolean }[] }) =>
  g.players.filter((p) => !p.resigned).length;
/** Whether the player acting is the Partner, in their phase of a paired turn (or a card played in it). */
export const partnerActing = (g: Pick<Game, 'pair' | 'active'>) => !!g.pair && g.active === g.pair.partner;
/**
 * Whether a Partner's phase follows the Lead's part under way: only while five or more players remain
 * (docs/RULEBOOK-BIG-TABLE.md, 6.8). Asked of a game or of a player's view of it.
 */
export const partnerFollows = (
  g: Pick<Game, 'pair' | 'active'> & { players: readonly { resigned?: boolean }[] },
) => !!g.pair && !partnerActing(g) && !g.players[g.pair.partner]!.resigned && stillPlaying(g) >= 5;
/**
 * The Partner of a paired turn led from `lead`: the third player to the Lead's left, counting only players
 * still in the game (docs/RULEBOOK-BIG-TABLE.md, 6.1). Only asked while five or more remain.
 */
function partnerSeat(g: Pick<Game, 'players'>, lead: number): number {
  let seat = lead;
  for (let counted = 0; counted < 3;)
    if (!g.players[(seat = (seat + 1) % g.players.length)]!.resigned) counted++;
  return seat;
}
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
 * The buildings (a point per settlement, two per city), the two awards and victory point cards. A mode that
 * scores something new adds its term here, read from its own part of the game (Open Sea's island bonuses),
 * and every reader of score() counts it: the game view, the win check, player records and the admin views.
 */
export type ScoreTermId = 'settlements' | 'cities' | 'longestRoad' | 'largestArmy' | 'cards';
type Scored = Pick<Game, 'buildings' | 'longestRoad' | 'largestArmy'>;
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
    { id: 'cards', points: cards, count: cards },
  ];
  return terms.filter((term) => term.points > 0);
}
/** A player's points: the sum of their score terms. */
export function score(g: Scored, p: Pick<Player, 'id' | 'cards'>, hidden = true): number {
  return scoreTerms(g, p, hidden).reduce((n, term) => n + term.points, 0);
}
function updateAwards(g: Game) {
  for (const [key, minimum, values] of [
    ['longestRoad', 5, g.players.map((p) => (p.resigned ? 0 : longestTrail(g, p.id)))],
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
        `${g.players.find((p) => p.id === g[key])!.name} claimed ${key === 'longestRoad' ? 'Longest Road' : 'Largest Army'} (+2 points).`,
      );
  }
}
/**
 * Who may win now: the player on turn. In a paired turn that is both marker holders, the Lead first, whoever
 * is acting; in a build window it is nobody (docs/RULEBOOK-BIG-TABLE.md, 6.7 and 7.5).
 */
function onTurn(g: Game): Player[] {
  if (g.pair) return [g.players[g.pair.lead]!, g.players[g.pair.partner]!];
  return g.phase === 'buildWindow' ? [] : [activePlayer(g)];
}
/**
 * Whether anyone on turn has reached the target, checked after every action and as each turn begins. When
 * both marker holders have, the Lead wins. `eligible` leaves out a winner the caller may not declare yet.
 */
function checkWin(g: Game, eligible: (id: string) => boolean = () => true) {
  if (!g.turn) return;
  const target = g.victoryPoints ?? rulesetOf(g).victoryPoints.default;
  const winner = onTurn(g).find((p) => !p.resigned && score(g, p) >= target);
  if (!winner || !eligible(winner.id)) return;
  g.winner = winner.id;
  g.phase = 'finished';
  g.trade = null;
  const partner = g.pair?.partner === g.players.indexOf(winner);
  log(g, `${winner.name} wins${partner ? ' as Partner' : ''} with ${score(g, winner)} points!`);
}
/**
 * Whether someone on turn already has the target as their turn, or a Partner's phase, is about to end. Only a
 * resignation can leave one there undeclared: one that began their turn, or handed them an award, while they
 * were away, when the room may not declare them the winner (resignPlayers). They win at their next move, their
 * own or the clock's: after the dice, for a turn that begins so, or here, rather than lose the turn to the next.
 */
function wonAlready(g: Game): boolean {
  checkWin(g);
  return g.phase === 'finished';
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
  if (
    g.freeRoads <= 0 ||
    pieces(g, activePlayer(g).id).roads >= rulesetOf(g).supply.pieces.roads ||
    !roadSites(g, activePlayer(g).id).length
  ) {
    g.freeRoads = 0;
    g.phase = g.returnPhase;
  }
}
function produce(g: Game, number: number) {
  const owed = g.players.map(() => emptyHand());
  const received = g.players.map(() => emptyHand());
  for (const h of g.board.hexes)
    if (h.number === number && h.id !== g.robber && h.terrain !== 'desert') {
      for (const v of h.vertices) {
        const b = g.buildings[v];
        if (b) {
          const i = g.players.findIndex((p) => p.id === b.player);
          if (!g.players[i]?.resigned) owed[i]![h.terrain as Resource] += b.kind === 'city' ? 2 : 1;
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
  if (!received.some((hand) => total(hand))) log(g, 'No resources produced.');
}

/** How a turn is announced: in a paired turn, with its Partner. */
const turnLine = (g: Game) =>
  g.pair
    ? `${g.players[g.pair.lead]!.name}'s turn, with ${g.players[g.pair.partner]!.name} as Partner.`
    : `${activePlayer(g).name}'s turn.`;

function advanceTurn(g: Game, pendingRobber = false) {
  // A paired turn passes on from its Lead, whoever acted last, and the turn after build windows from the player
  // whose turn they followed.
  if (g.pair) g.active = g.pair.lead;
  if (g.windows) {
    g.active = g.windows.after;
    pendingRobber ||= !!g.windows.robber;
    delete g.windows;
  }
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
  pairUp(g);
  log(g, `${turnLine(g)}${pendingRobber ? ' Move the robber, then roll.' : ''}`);
}

/**
 * Hand out the markers as a paired turn begins: the Lead is the player on turn and the Partner is recounted
 * from them. With fewer than five players left, turns go one player at a time for the rest of the game.
 */
function pairUp(g: Game) {
  if (g.turns !== 'paired') return;
  if (stillPlaying(g) >= 5) {
    g.pair = { lead: g.active, partner: partnerSeat(g, g.active) };
    return;
  }
  if (g.pair || g.turn === 1)
    log(g, 'Fewer than five players remain, so turns go one player at a time from now on, with no Partner.');
  delete g.pair;
}

/** The Lead's part is over: the Partner takes their phase, first moving a robber the Lead left owing. */
function beginPartnerPhase(g: Game, pendingRobber = false) {
  g.active = g.pair!.partner;
  g.phase = pendingRobber ? 'robber' : 'partner';
  g.returnPhase = 'partner';
  g.playedCard = false;
  g.freeRoads = 0;
  g.trade = null;
  log(
    g,
    `${activePlayer(g).name} begins the Partner's phase.${pendingRobber ? ' Move the robber first.' : ''}`,
  );
}

/** A turn under Between-turns build is over: every other player, from the next, gets a window to build. */
function openWindows(g: Game, pendingRobber = false) {
  g.windows = { after: g.active, ...(pendingRobber ? { robber: true as const } : {}) };
  g.freeRoads = 0;
  g.trade = null;
  nextWindow(g);
}

/** The next build window, clockwise, until it comes back round to the player whose turn it followed. */
function nextWindow(g: Game) {
  const after = g.windows!.after;
  for (let seat = (g.active + 1) % g.players.length; seat !== after; seat = (seat + 1) % g.players.length)
    if (!g.players[seat]!.resigned) {
      g.active = seat;
      g.phase = 'buildWindow';
      log(g, `${activePlayer(g).name}'s build window.`);
      return;
    }
  advanceTurn(g);
}

/**
 * Whatever part of the turn is under way ends: a turn, a Lead's part, a Partner's phase or a build window. A
 * robber move still owed passes to whoever acts next and may move it (docs/RULEBOOK-BIG-TABLE.md, 9.6).
 */
function endPart(g: Game, pendingRobber = false) {
  if (g.phase === 'buildWindow') nextWindow(g);
  else if (partnerFollows(g)) beginPartnerPhase(g, pendingRobber);
  else if (g.turns === 'betweenTurnsBuild') openWindows(g, pendingRobber);
  else advanceTurn(g, pendingRobber);
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
  // The first paired turn begins after setup, with the starting player as Lead.
  pairUp(g);
  if (g.pair) log(g, turnLine(g));
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
      // They wait as a turn begins, whatever part the table was in: at the roll, with no card played yet.
      g.phase = 'roll';
      g.returnPhase = 'roll';
      g.playedCard = false;
      g.trade = null;
      g.discards = {};
      g.freeRoads = 0;
      g.setupVertex = null;
      // One player cannot pair up or have a window: they only wait here to come back and win.
      delete g.pair;
      delete g.windows;
      return g;
    }
    g.winner = remaining[0]!.id;
    g.finishReason = 'resignation';
    g.phase = 'finished';
    g.trade = null;
    g.discards = {};
    g.freeRoads = 0;
    log(g, `${remaining[0]!.name} wins by resignation.`);
    return g;
  }
  if (activePlayer(g).resigned) {
    if (g.phase === 'setupSettlement' || g.phase === 'setupRoad') {
      g.setupIndex++;
      advanceSetup(g);
    } else if (g.phase !== 'discard' || !Object.keys(g.discards).length) {
      // A resignation that hands an award on counts as an action, so the check comes before the part it was made
      // in ends: the other marker holder of a paired turn is on turn until then (docs/RULEBOOK-BIG-TABLE.md, 6.7
      // rule 2, and 6.8). With one player on turn, the one resigning, it finds nobody.
      checkWin(g, eligible);
      if (g.phase === 'finished') return g;
      // Their part of the turn ends there: a Lead's part is still followed by the Partner's phase, and a build
      // window by the next one (docs/RULEBOOK-BIG-TABLE.md, 9.6).
      endPart(g, g.phase === 'robber' || g.phase === 'discard');
    }
    // Other players finish required discards before the next player moves the robber.
  } else if (g.phase === 'discard' && !Object.keys(g.discards).length) g.phase = 'robber';
  // Whoever is on turn now may win by the award, or already have the target as their turn begins.
  checkWin(g, eligible);
  return g;
}

/** Pure transition: caller supplies private randomness, and commits the result before broadcasting. */
export function applyAction(state: Game, playerId: string, raw: GameAction, random: () => number): Game {
  const a = parseGameAction(raw);
  requireRule(onBoard(state.board, a), 'Invalid board location');
  const rules = rulesetOf(state),
    { bank, pieces: supply } = rules.supply;
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
        endPart(g, true);
        checkWin(g);
      } else g.phase = 'robber';
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
  if (a.kind === 'robber') {
    requireRule(g.phase === 'robber' && a.hex !== g.robber, 'Move the robber to a different tile');
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
  if (a.kind === 'road' && g.phase === 'freeRoads') {
    requireRule(
      owned.roads < supply.roads && roadSites(g, p.id).includes(a.edge),
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
  if (a.kind === 'endPhase') {
    // Only the clock ends the phase with free roads still owed, and leaves them unplaced (rulebook 9.3).
    requireRule(
      partnerActing(g) && (g.phase === 'partner' || (!!a.expired && g.phase === 'freeRoads')),
      g.phase === 'freeRoads' ? 'Place your free roads first' : 'Finish the current action first',
    );
    if (wonAlready(g)) return g;
    advanceTurn(g);
    updateAwards(g);
    checkWin(g);
    return g;
  }
  if (a.kind === 'playCard') {
    requireRule(g.phase !== 'buildWindow', 'No development card is played in a build window');
    requireRule(
      g.phase === 'roll' || g.phase === 'actions' || g.phase === 'partner',
      'Finish the current action first',
    );
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
    if (card.kind === 'roadBuilding') {
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
    }
    // The dice change no one's points, so this finds only a target reached before them and not yet declared
    // (wonAlready): the roll is the first move of a turn, the player's own or the clock's.
    checkWin(g);
    return g;
  }
  requireRule(
    g.phase === 'actions' || g.phase === 'partner' || g.phase === 'buildWindow',
    'Finish the current action first',
  );
  // The Partner trades only with the bank, and a build window allows no trade at all.
  if (a.kind === 'offerTrade' || a.kind === 'openTrade' || a.kind === 'cancelTrade')
    requireRule(
      g.phase === 'actions',
      g.phase === 'partner'
        ? 'No trades with players in the Partner’s phase'
        : 'No trading in a build window',
    );
  requireRule(a.kind !== 'bankTrade' || g.phase !== 'buildWindow', 'No trading in a build window');
  // Keep one live offer; cancelling it deliberately permits another with no per-turn cap.
  if (a.kind === 'offerTrade' || a.kind === 'openTrade')
    requireRule(!g.trade, 'Cancel your current offer before creating another');
  else g.trade = null;
  switch (a.kind) {
    case 'road':
      requireRule(
        owned.roads < supply.roads && roadSites(g, p.id).includes(a.edge),
        'Choose a legal road site',
      );
      transfer(p.hand, g.bank, rules.costs.road);
      g.roads[a.edge] = p.id;
      log(g, `${p.name} built a road on edge ${a.edge + 1}.`);
      break;
    case 'settlement':
      requireRule(
        owned.settlements < supply.settlements && settlementSites(g, p.id).includes(a.vertex),
        'Choose a legal settlement site',
      );
      transfer(p.hand, g.bank, rules.costs.settlement);
      g.buildings[a.vertex] = { player: p.id, kind: 'settlement' };
      log(g, `${p.name} built a settlement at corner ${a.vertex + 1}.`);
      break;
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
      requireRule(
        g.phase === 'actions',
        g.phase === 'partner' ? 'End your Partner’s phase instead' : 'Close your build window instead',
      );
      if (wonAlready(g)) return g;
      // Under Big Table's turn structures, the Partner's phase or the build windows come next.
      endPart(g);
      break;
    case 'endWindow':
      requireRule(g.phase === 'buildWindow', 'That action is unavailable');
      nextWindow(g);
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
  roadLength: number;
  pieces: ReturnType<typeof pieces>;
  hand?: Hand;
  cards?: Card[];
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
  };
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
  const { costs, supply } = rulesetOf(g);
  // Building and buying happen in a turn's actions, and in Big Table's Partner's phase and build windows.
  const build = active && (g.phase === 'actions' || g.phase === 'partner' || g.phase === 'buildWindow'),
    setup = active && g.phase === 'setupSettlement';
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
      roadLength: longestTrail(g, p.id),
      pieces: pieces(g, p.id),
      ...(p.id === viewer ? { hand: { ...p.hand }, cards: structuredClone(p.cards) } : {}),
    })),
    legal: {
      roads:
        owned.roads >= supply.pieces.roads
          ? []
          : active && g.phase === 'setupRoad'
            ? roadSites(g, viewer, g.setupVertex)
            : (active && g.phase === 'freeRoads') || (build && canPay(me.hand, costs.road))
              ? roadSites(g, viewer)
              : [],
      settlements:
        owned.settlements < supply.pieces.settlements &&
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
        active && ['roll', 'actions', 'partner'].includes(g.phase) && !g.playedCard
          ? me.cards.filter((c) => c.kind !== 'victoryPoint' && c.boughtTurn < g.turn).map((c) => c.id)
          : [],
      canBuyCard: build && deck.length > 0 && canPay(me.hand, costs.developmentCard),
      rates: Object.fromEntries(RESOURCES.map((r) => [r, tradeRate(g, viewer, r)])) as Hand,
    },
  };
}
