import { COSTS, DEVELOPMENT_DECK, RESOURCES, RESOURCE_NAMES, SUPPLY, RULESET } from './index.js';
import type { Resource } from './index.js';
import { generateBoard, shuffle } from './board.js';
import type { Board } from './board.js';

export type Hand = Record<Resource, number>;
export type CardKind = keyof typeof DEVELOPMENT_DECK;
export type Card = { id: string; kind: CardKind; boughtTurn: number };
export type Player = { id: string; name: string; hand: Hand; cards: Card[]; knights: number };
export type Building = { player: string; kind: 'settlement' | 'city' };
export type Phase = 'setupSettlement' | 'setupRoad' | 'roll' | 'actions' | 'discard' | 'robber' | 'freeRoads' | 'finished';
export type Trade = { id: number; player: string; give: Hand; want: Hand };
export type Game = {
  schema: 1; ruleset: string; board: Board; players: Player[]; bank: Hand;
  buildings: Record<number, Building>; roads: Record<number, string>; robber: number;
  phase: Phase; active: number; setupIndex: number; setupVertex: number | null;
  turn: number; dice: [number, number] | null; deck: CardKind[]; nextCard: number;
  playedCard: boolean; returnPhase: 'roll' | 'actions'; freeRoads: number;
  discards: Record<string, number>; trade: Trade | null; nextTrade: number;
  longestRoad: string | null; largestArmy: string | null; winner: string | null;
  log: { id: number; text: string }[]; nextLog: number;
};
export type GameAction =
  | { kind: 'start' }
  | { kind: 'settlement' | 'city'; vertex: number }
  | { kind: 'road'; edge: number }
  | { kind: 'roll' | 'endTurn' | 'buyCard' | 'cancelTrade' }
  | { kind: 'discard'; resources: Hand }
  | { kind: 'robber'; hex: number; victim?: string }
  | { kind: 'bankTrade'; give: Resource; receive: Resource }
  | { kind: 'offerTrade'; give: Hand; want: Hand }
  | { kind: 'acceptTrade'; tradeId: number }
  | { kind: 'playCard'; cardId: string; resources?: Hand; resource?: Resource };
export class RuleError extends Error { readonly code = 'ILLEGAL_ACTION'; }
function requireRule(condition: unknown, message: string): asserts condition { if (!condition) throw new RuleError(message); }
export const emptyHand = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const total = (hand: Hand) => RESOURCES.reduce((n, r) => n + hand[r], 0);
export const canPay = (hand: Hand, cost: Hand) => RESOURCES.every(r => hand[r] >= cost[r]);
const transfer = (from: Hand, to: Hand, amount: Hand) => { requireRule(canPay(from, amount), 'Not enough resources'); for (const r of RESOURCES) { from[r] -= amount[r]; to[r] += amount[r]; } };
const resourceText = (hand: Hand) => RESOURCES.filter(r => hand[r]).map(r => `${hand[r]} ${RESOURCE_NAMES[r]}`).join(', ');
function log(g: Game, text: string) { g.log.push({ id: g.nextLog++, text }); if (g.log.length > 80) g.log.shift(); }

/** Untrusted input becomes a small, canonical action before it reaches a transaction. */
export function parseGameAction(input: unknown): GameAction {
  requireRule(input && typeof input === 'object' && !Array.isArray(input), 'Invalid action');
  const a = input as Record<string, unknown>;
  const index = (v: unknown, max: number) => { requireRule(Number.isInteger(v) && (v as number) >= 0 && (v as number) < max, 'Invalid board location'); return v as number; };
  const id = (v: unknown) => { requireRule(typeof v === 'string' && v.length > 0 && v.length <= 80, 'Invalid identifier'); return v; };
  const resource = (v: unknown) => { requireRule(RESOURCES.includes(v as Resource), 'Choose a resource'); return v as Resource; };
  const hand = (v: unknown): Hand => {
    requireRule(v && typeof v === 'object' && !Array.isArray(v), 'Invalid resource selection');
    const h = v as Record<string, unknown>; const result = emptyHand();
    requireRule(Object.keys(h).every(k => RESOURCES.includes(k as Resource)), 'Unknown resource');
    for (const r of RESOURCES) { requireRule(Number.isInteger(h[r]) && (h[r] as number) >= 0 && (h[r] as number) <= 19, 'Choose whole resource counts from 0 to 19'); result[r] = h[r] as number; }
    return result;
  };
  switch (a.kind) {
    case 'start': case 'roll': case 'endTurn': case 'buyCard': case 'cancelTrade': return { kind: a.kind };
    case 'settlement': case 'city': return { kind: a.kind, vertex: index(a.vertex, 54) };
    case 'road': return { kind: a.kind, edge: index(a.edge, 72) };
    case 'robber': return { kind: a.kind, hex: index(a.hex, 19), ...(a.victim === undefined ? {} : { victim: id(a.victim) }) };
    case 'discard': return { kind: a.kind, resources: hand(a.resources) };
    case 'bankTrade': return { kind: a.kind, give: resource(a.give), receive: resource(a.receive) };
    case 'offerTrade': return { kind: a.kind, give: hand(a.give), want: hand(a.want) };
    case 'acceptTrade': return { kind: a.kind, tradeId: index(a.tradeId, Number.MAX_SAFE_INTEGER) };
    case 'playCard': return { kind: a.kind, cardId: id(a.cardId), ...(a.resources === undefined ? {} : { resources: hand(a.resources) }), ...(a.resource === undefined ? {} : { resource: resource(a.resource) }) };
    default: throw new RuleError('Unknown action');
  }
}

export function createGame(seats: { id: string; name: string }[], seed: number, random: () => number): Game {
  requireRule(seats.length === 3 || seats.length === 4, 'Start with three or four players');
  requireRule(new Set(seats.map(p => p.id)).size === seats.length, 'Seats must be unique');
  const board = generateBoard(seed);
  const g: Game = {
    schema: 1, ruleset: RULESET, board, players: seats.map(p => ({ ...p, hand: emptyHand(), cards: [], knights: 0 })),
    bank: { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 }, buildings: {}, roads: {}, robber: board.hexes.find(h => h.terrain === 'desert')!.id,
    phase: 'setupSettlement', active: 0, setupIndex: 0, setupVertex: null, turn: 0, dice: null,
    deck: shuffle(Object.entries(DEVELOPMENT_DECK).flatMap(([k, n]) => Array<CardKind>(n).fill(k as CardKind)), random), nextCard: 0,
    playedCard: false, returnPhase: 'actions', freeRoads: 0, discards: {}, trade: null, nextTrade: 0,
    longestRoad: null, largestArmy: null, winner: null, log: [], nextLog: 0,
  };
  log(g, 'The island is ready. Place two settlements and roads in snake order.');
  return g;
}
export const activePlayer = (g: Pick<Game, 'players' | 'active'>) => g.players[g.active]!;
type BoardState = Pick<Game, 'board' | 'buildings' | 'roads'>;
export function settlementSites(g: BoardState, player: string, setup = false): number[] {
  return g.board.vertices.filter(v => !g.buildings[v.id] && v.neighbors.every(n => !g.buildings[n]) && (setup || v.edges.some(e => g.roads[e] === player))).map(v => v.id);
}
export function roadSites(g: BoardState, player: string, setupVertex: number | null = null): number[] {
  return g.board.edges.filter(e => !g.roads[e.id] && (setupVertex !== null ? e.a === setupVertex || e.b === setupVertex : [e.a, e.b].some(v => {
    const building = g.buildings[v];
    if (building) return building.player === player;
    return g.board.vertices[v]!.edges.some(other => g.roads[other] === player);
  }))).map(e => e.id);
}
export const pieces = (g: BoardState, player: string) => ({
  roads: Object.values(g.roads).filter(id => id === player).length,
  settlements: Object.values(g.buildings).filter(b => b.player === player && b.kind === 'settlement').length,
  cities: Object.values(g.buildings).filter(b => b.player === player && b.kind === 'city').length,
});
export function tradeRate(g: BoardState, player: string, resource: Resource): number {
  const ports = g.board.ports.filter(p => { const e = g.board.edges[p.edge]!; return g.buildings[e.a]?.player === player || g.buildings[e.b]?.player === player; });
  return ports.some(p => p.resource === resource) ? 2 : ports.some(p => p.resource === 'any') ? 3 : 4;
}
export function longestTrail(g: BoardState, player: string): number {
  let longest = 0;
  const walk = (vertex: number, used: Set<number>) => {
    longest = Math.max(longest, used.size);
    if (used.size && g.buildings[vertex] && g.buildings[vertex]!.player !== player) return;
    for (const id of g.board.vertices[vertex]!.edges) if (g.roads[id] === player && !used.has(id)) {
      const edge = g.board.edges[id]!; used.add(id); walk(edge.a === vertex ? edge.b : edge.a, used); used.delete(id);
    }
  };
  for (const v of g.board.vertices) if (v.edges.some(e => g.roads[e] === player)) walk(v.id, new Set());
  return longest;
}
export function score(g: Pick<Game, 'buildings' | 'longestRoad' | 'largestArmy'>, p: Pick<Player, 'id' | 'cards'>, hidden = true): number {
  return Object.values(g.buildings).filter(b => b.player === p.id).reduce((n, b) => n + (b.kind === 'city' ? 2 : 1), 0)
    + (g.longestRoad === p.id ? 2 : 0) + (g.largestArmy === p.id ? 2 : 0) + (hidden ? p.cards.filter(c => c.kind === 'victoryPoint').length : 0);
}
function updateAwards(g: Game) {
  for (const [key, minimum, values] of [
    ['longestRoad', 5, g.players.map(p => longestTrail(g, p.id))],
    ['largestArmy', 3, g.players.map(p => p.knights)],
  ] as const) {
    const max = Math.max(...values); const leaders = g.players.filter((_, i) => values[i] === max);
    const old = g[key];
    g[key] = max < minimum ? null : leaders.some(p => p.id === old) ? old : leaders.length === 1 ? leaders[0]!.id : null;
    if (g[key] && g[key] !== old) log(g, `${g.players.find(p => p.id === g[key])!.name} claimed ${key === 'longestRoad' ? 'Longest Road' : 'Largest Army'} (+2 points).`);
  }
}
function checkWin(g: Game) {
  if (g.turn && score(g, activePlayer(g)) >= 10) { g.winner = activePlayer(g).id; g.phase = 'finished'; g.trade = null; log(g, `${activePlayer(g).name} wins with ${score(g, activePlayer(g))} points!`); }
}
export function robberVictims(g: BoardState, player: string, hex: number): string[] {
  return [...new Set(g.board.hexes[hex]!.vertices.map(v => g.buildings[v]?.player).filter((p): p is string => !!p && p !== player))];
}
function finishFreeRoads(g: Game) {
  if (g.freeRoads <= 0 || pieces(g, activePlayer(g).id).roads >= SUPPLY.roads || !roadSites(g, activePlayer(g).id).length) { g.freeRoads = 0; g.phase = g.returnPhase; }
}
function produce(g: Game, number: number) {
  const owed = g.players.map(() => emptyHand());
  for (const h of g.board.hexes) if (h.number === number && h.id !== g.robber && h.terrain !== 'desert') {
    for (const v of h.vertices) { const b = g.buildings[v]; if (b) owed[g.players.findIndex(p => p.id === b.player)]![h.terrain] += b.kind === 'city' ? 2 : 1; }
  }
  for (const r of RESOURCES) {
    const recipients = owed.map((h, i) => ({ n: h[r], i })).filter(x => x.n > 0);
    const needed = recipients.reduce((n, p) => n + p.n, 0);
    if (needed > g.bank[r] && recipients.length > 1) { log(g, `The bank is short of ${RESOURCE_NAMES[r]}; nobody receives that resource.`); continue; }
    for (const { n, i } of recipients) { const amount = Math.min(n, g.bank[r]); g.players[i]!.hand[r] += amount; g.bank[r] -= amount; }
  }
}

/** Pure transition: caller supplies private randomness, and commits the result before broadcasting. */
export function applyAction(state: Game, playerId: string, raw: GameAction, random: () => number): Game {
  const a = parseGameAction(raw), g = structuredClone(state);
  const p = g.players.find(p => p.id === playerId); requireRule(p, 'Not a player in this game');
  requireRule(g.phase !== 'finished', 'The game has ended');
  const isActive = activePlayer(g).id === p.id;
  if (a.kind === 'discard') {
    requireRule(g.phase === 'discard' && !!g.discards[p.id], 'You do not need to discard');
    requireRule(total(a.resources) === g.discards[p.id], `Discard exactly ${g.discards[p.id]} cards`);
    transfer(p.hand, g.bank, a.resources); delete g.discards[p.id];
    log(g, `${p.name} discarded ${total(a.resources)} cards.`);
    if (!Object.keys(g.discards).length) g.phase = 'robber';
    return g;
  }
  if (a.kind === 'acceptTrade') {
    requireRule(g.phase === 'actions' && !isActive && g.trade?.id === a.tradeId, 'That trade is no longer available');
    const maker = activePlayer(g), offer = g.trade;
    requireRule(canPay(maker.hand, offer.give) && canPay(p.hand, offer.want), 'A player no longer has the offered cards');
    transfer(maker.hand, p.hand, offer.give); transfer(p.hand, maker.hand, offer.want);
    log(g, `${maker.name} traded ${resourceText(offer.give)} to ${p.name} for ${resourceText(offer.want)}.`); g.trade = null; return g;
  }
  requireRule(isActive, 'Wait for your turn');
  const owned = pieces(g, p.id);
  if (g.phase === 'setupSettlement') {
    requireRule(a.kind === 'settlement' && settlementSites(g, p.id, true).includes(a.vertex), 'Choose an empty corner at least two edges from another settlement');
    g.buildings[a.vertex] = { player: p.id, kind: 'settlement' }; g.setupVertex = a.vertex; g.phase = 'setupRoad';
    if (g.setupIndex >= g.players.length) for (const id of g.board.vertices[a.vertex]!.hexes) {
      const resource = g.board.hexes[id]!.terrain;
      if (resource !== 'desert') { p.hand[resource]++; g.bank[resource]--; }
    }
    log(g, `${p.name} placed a starting settlement.`); return g;
  }
  if (g.phase === 'setupRoad') {
    requireRule(a.kind === 'road' && roadSites(g, p.id, g.setupVertex).includes(a.edge), 'Place a road touching your new settlement');
    g.roads[a.edge] = p.id; g.setupIndex++; g.setupVertex = null;
    if (g.setupIndex === g.players.length * 2) { g.phase = 'roll'; g.active = 0; g.turn = 1; log(g, 'Setup complete. Roll the dice to begin.'); }
    else { g.active = g.setupIndex < g.players.length ? g.setupIndex : g.players.length * 2 - 1 - g.setupIndex; g.phase = 'setupSettlement'; }
    return g;
  }
  if (a.kind === 'robber') {
    requireRule(g.phase === 'robber' && a.hex !== g.robber, 'Move the robber to a different tile');
    const victims = robberVictims(g, p.id, a.hex);
    requireRule(victims.length ? !!a.victim && victims.includes(a.victim) : !a.victim, 'Choose one opponent touching this tile');
    g.robber = a.hex;
    if (a.victim) {
      const victim = g.players.find(other => other.id === a.victim)!;
      const cards = RESOURCES.flatMap(r => Array<Resource>(victim.hand[r]).fill(r));
      if (cards.length) { const stolen = cards[Math.floor(random() * cards.length)]!; victim.hand[stolen]--; p.hand[stolen]++; log(g, `${p.name} moved the robber and stole a card from ${victim.name}.`); }
      else log(g, `${p.name} moved the robber. ${victim.name} had no resource cards.`);
    } else log(g, `${p.name} moved the robber.`);
    g.phase = g.returnPhase; checkWin(g); return g;
  }
  if (a.kind === 'road' && g.phase === 'freeRoads') {
    requireRule(owned.roads < 15 && roadSites(g, p.id).includes(a.edge), 'Choose a legal road site');
    g.roads[a.edge] = p.id; g.freeRoads--; finishFreeRoads(g); updateAwards(g); checkWin(g); log(g, `${p.name} built a free road.`); return g;
  }
  if (a.kind === 'playCard') {
    requireRule(g.phase === 'roll' || g.phase === 'actions', 'Finish the current action first');
    requireRule(!g.playedCard, 'Only one development card can be played per turn');
    const card = p.cards.find(c => c.id === a.cardId);
    requireRule(card && card.boughtTurn < g.turn && card.kind !== 'victoryPoint', 'That card cannot be played this turn');
    g.returnPhase = g.phase; g.trade = null;
    if (card.kind === 'knight') { p.knights++; g.phase = 'robber'; }
    if (card.kind === 'roadBuilding') {
      requireRule(owned.roads < 15 && roadSites(g, p.id).length, 'No legal road is available');
      g.freeRoads = Math.min(2, 15 - owned.roads); g.phase = 'freeRoads';
    }
    if (card.kind === 'yearOfPlenty') {
      requireRule(a.resources && total(a.resources) === Math.min(2, total(g.bank)) && total(g.bank) > 0, 'Choose two available bank resources (or the remainder if only one exists)');
      transfer(g.bank, p.hand, a.resources);
    }
    if (card.kind === 'monopoly') {
      requireRule(a.resource, 'Choose a resource'); let taken = 0;
      for (const other of g.players) if (other.id !== p.id) { taken += other.hand[a.resource]; p.hand[a.resource] += other.hand[a.resource]; other.hand[a.resource] = 0; }
      log(g, `${p.name} collected ${taken} ${RESOURCE_NAMES[a.resource]} with Monopoly.`);
    }
    p.cards = p.cards.filter(c => c.id !== card.id); g.playedCard = true;
    log(g, `${p.name} played ${CARD_NAMES[card.kind]}.`); updateAwards(g); checkWin(g); return g;
  }
  if (a.kind === 'roll') {
    requireRule(g.phase === 'roll', 'You have already rolled or must finish the current action');
    g.dice = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
    const sum = g.dice[0] + g.dice[1]; log(g, `${p.name} rolled ${sum}.`);
    if (sum === 7) {
      g.discards = Object.fromEntries(g.players.filter(other => total(other.hand) > 7).map(other => [other.id, Math.floor(total(other.hand) / 2)]));
      g.returnPhase = 'actions'; g.phase = Object.keys(g.discards).length ? 'discard' : 'robber';
    } else { produce(g, sum); g.phase = 'actions'; }
    return g;
  }
  requireRule(g.phase === 'actions', 'Finish the current action first');
  // A new action withdraws an old offer; it cannot later be accepted against changed intent.
  if (a.kind !== 'offerTrade') g.trade = null;
  switch (a.kind) {
    case 'road':
      requireRule(owned.roads < 15 && roadSites(g, p.id).includes(a.edge), 'Choose a legal road site'); transfer(p.hand, g.bank, COSTS.road); g.roads[a.edge] = p.id; log(g, `${p.name} built a road.`); break;
    case 'settlement':
      requireRule(owned.settlements < 5 && settlementSites(g, p.id).includes(a.vertex), 'Choose a legal settlement site'); transfer(p.hand, g.bank, COSTS.settlement); g.buildings[a.vertex] = { player: p.id, kind: 'settlement' }; log(g, `${p.name} built a settlement.`); break;
    case 'city':
      requireRule(owned.cities < 4 && g.buildings[a.vertex]?.player === p.id && g.buildings[a.vertex]?.kind === 'settlement', 'Upgrade one of your settlements'); transfer(p.hand, g.bank, COSTS.city); g.buildings[a.vertex]!.kind = 'city'; log(g, `${p.name} built a city.`); break;
    case 'buyCard':
      requireRule(g.deck.length > 0, 'The development deck is empty'); transfer(p.hand, g.bank, COSTS.developmentCard); p.cards.push({ id: `card-${g.nextCard++}`, kind: g.deck.pop()!, boughtTurn: g.turn }); log(g, `${p.name} bought a development card.`); break;
    case 'bankTrade': {
      requireRule(a.give !== a.receive, 'Choose two different resources');
      const rate = tradeRate(g, p.id, a.give), give = emptyHand(), receive = emptyHand(); give[a.give] = rate; receive[a.receive] = 1;
      requireRule(g.bank[a.receive] > 0, 'The bank is out of that resource'); transfer(p.hand, g.bank, give); transfer(g.bank, p.hand, receive);
      log(g, `${p.name} traded ${rate} ${RESOURCE_NAMES[a.give]} for 1 ${RESOURCE_NAMES[a.receive]} at ${rate}:1.`); break;
    }
    case 'offerTrade':
      requireRule(total(a.give) > 0 && total(a.want) > 0 && RESOURCES.every(r => !a.give[r] || !a.want[r]), 'Both sides must offer cards, with no resource on both sides');
      requireRule(canPay(p.hand, a.give), 'You do not have the offered cards');
      g.trade = { id: g.nextTrade++, player: p.id, give: a.give, want: a.want }; break;
    case 'cancelTrade': break;
    case 'endTurn':
      g.active = (g.active + 1) % g.players.length; g.turn++; g.phase = 'roll'; g.dice = null; g.playedCard = false; log(g, `${activePlayer(g).name}'s turn.`); break;
    default: throw new RuleError('That action is unavailable');
  }
  updateAwards(g); checkWin(g); return g;
}

export const CARD_NAMES: Record<CardKind, string> = { knight: 'Knight', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly', victoryPoint: 'Victory Point' };
export type PlayerView = { id: string; name: string; resourceCount: number; cardCount: number; knights: number; points: number; roadLength: number; pieces: ReturnType<typeof pieces>; hand?: Hand; cards?: Card[] };
export type GameView = Omit<Game, 'deck' | 'players' | 'nextCard' | 'nextLog' | 'nextTrade'> & {
  deckCount: number; players: PlayerView[];
  legal: { roads: number[]; settlements: number[]; cities: number[]; playableCards: string[]; canBuyCard: boolean; rates: Hand };
};
export function gameView(g: Game, viewer: string): GameView {
  const { deck, players, nextCard: _card, nextLog: _log, nextTrade: _trade, ...publicState } = g;
  const me = players.find(p => p.id === viewer)!; const active = activePlayer(g).id === viewer; const owned = pieces(g, viewer);
  const build = active && g.phase === 'actions', setup = active && g.phase === 'setupSettlement';
  return {
    ...structuredClone(publicState), deckCount: deck.length,
    players: players.map(p => ({ id: p.id, name: p.name, resourceCount: total(p.hand), cardCount: p.cards.length, knights: p.knights, points: score(g, p, p.id === viewer || !!g.winner), roadLength: longestTrail(g, p.id), pieces: pieces(g, p.id), ...(p.id === viewer ? { hand: { ...p.hand }, cards: structuredClone(p.cards) } : {}) })),
    legal: {
      roads: owned.roads >= 15 ? [] : active && g.phase === 'setupRoad' ? roadSites(g, viewer, g.setupVertex) : active && g.phase === 'freeRoads' || build && canPay(me.hand, COSTS.road) ? roadSites(g, viewer) : [],
      settlements: owned.settlements < 5 && (setup || build && canPay(me.hand, COSTS.settlement)) ? settlementSites(g, viewer, setup) : [],
      cities: build && owned.cities < 4 && canPay(me.hand, COSTS.city) ? Object.entries(g.buildings).filter(([, b]) => b.player === viewer && b.kind === 'settlement').map(([id]) => Number(id)) : [],
      playableCards: active && ['roll', 'actions'].includes(g.phase) && !g.playedCard ? me.cards.filter(c => c.kind !== 'victoryPoint' && c.boughtTurn < g.turn).map(c => c.id) : [],
      canBuyCard: build && deck.length > 0 && canPay(me.hand, COSTS.developmentCard),
      rates: Object.fromEntries(RESOURCES.map(r => [r, tradeRate(g, viewer, r)])) as Hand,
    },
  };
}
