import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlayer, applyAction, canPay, createGame, emptyHand, gameView, longestTrail, parseGameAction, pieces, roadSites, score, settlementSites, total, tradeRate } from '../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import type { Resource } from '../packages/rules/src/index.js';

const seats = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}` }));
const random = seededRandom(42);
const move = (g: Game, a: GameAction, id = activePlayer(g).id) => applyAction(g, id, a, random);
function setup(count = 4): Game {
  let g = createGame(seats.slice(0, count), 82, random);
  while (g.turn === 0) {
    const legal = gameView(g, activePlayer(g).id).legal;
    g = move(g, g.phase === 'setupSettlement' ? { kind: 'settlement', vertex: legal.settlements[0]! } : { kind: 'road', edge: legal.roads[0]! });
  }
  return g;
}
function fund(g: Game, id: string, hand: Partial<Hand>) {
  const p = g.players.find(p => p.id === id)!;
  for (const r of RESOURCES) { const n = hand[r] ?? 0; assert.ok(g.bank[r] >= n); g.bank[r] -= n; p.hand[r] += n; }
}
function clearHands(g: Game) { for (const p of g.players) for (const r of RESOURCES) { g.bank[r] += p.hand[r]; p.hand[r] = 0; } }
function conserved(g: Game) {
  for (const r of RESOURCES) { assert.equal(g.bank[r] + g.players.reduce((n, p) => n + p.hand[r], 0), 19, r); assert.ok(g.bank[r] >= 0); }
  for (const p of g.players) { for (const r of RESOURCES) assert.ok(Number.isInteger(p.hand[r]) && p.hand[r] >= 0); const n = pieces(g, p.id); assert.ok(n.roads <= 15 && n.settlements <= 5 && n.cities <= 4); }
}
test('three- and four-player snake setup grants resources only from the second settlement', () => {
  for (const count of [3, 4]) {
    let g = createGame(seats.slice(0, count), 7, random); const order: string[] = [];
    for (let i = 0; i < count * 2; i++) {
      const p = activePlayer(g); order.push(p.id);
      const vertex = settlementSites(g, p.id, true)[0]!;
      g = move(g, { kind: 'settlement', vertex });
      assert.equal(total(g.players.find(x => x.id === p.id)!.hand), i < count ? 0 : g.board.vertices[vertex]!.hexes.filter(h => g.board.hexes[h]!.terrain !== 'desert').length);
      g = move(g, { kind: 'road', edge: roadSites(g, p.id, vertex)[0]! });
    }
    assert.deepEqual(order, [...seats.slice(0, count), ...seats.slice(0, count).reverse()].map(p => p.id));
    assert.equal(g.phase, 'roll'); assert.equal(g.turn, 1); assert.equal(g.active, 0); conserved(g);
  }
  assert.throws(() => createGame(seats.slice(0, 2), 1, random), /three or four/);
});
test('invalid moves cannot mutate input; turn, distance, road connection and costs are enforced', () => {
  const g = setup(); const before = structuredClone(g);
  assert.throws(() => move(g, { kind: 'roll' }, 'p1'), /Wait/);
  assert.throws(() => move(g, { kind: 'city', vertex: 0 }), /current action/);
  assert.deepEqual(g, before);
  g.phase = 'actions'; clearHands(g);
  assert.throws(() => move(g, { kind: 'road', edge: roadSites(g, 'p0')[0]! }), /resources/);
  const occupied = Number(Object.keys(g.buildings)[0]);
  assert.ok(!settlementSites(g, 'p0', true).includes(g.board.vertices[occupied]!.neighbors[0]!));
  const disconnected = g.board.edges.find(e => !g.roads[e.id] && !roadSites(g, 'p0').includes(e.id))!;
  assert.throws(() => move(g, { kind: 'road', edge: disconnected.id }), /legal road/);
  fund(g, 'p0', { wood: 1, brick: 1 });
  const next = move(g, { kind: 'road', edge: roadSites(g, 'p0')[0]! }); assert.equal(pieces(next, 'p0').roads, 3); conserved(next);
});
test('production pays cities twice, respects the robber and handles bank shortages per resource', () => {
  let g = setup(); clearHands(g); g.buildings = {};
  const h = g.board.hexes.find(h => h.terrain !== 'desert' && h.number === 6)!; const r = h.terrain as Resource;
  g.robber = g.board.hexes.find(x => x.terrain === 'desert')!.id;
  g.buildings[h.vertices[0]!] = { player: 'p0', kind: 'city' };
  const diceSix = () => 0.34; // 3 + 3
  let next = applyAction(g, 'p0', { kind: 'roll' }, diceSix);
  assert.equal(next.players[0]!.hand[r], 2); conserved(next);
  const blocked = structuredClone(g); blocked.robber = h.id;
  next = applyAction(blocked, 'p0', { kind: 'roll' }, diceSix); assert.equal(total(next.players[0]!.hand), 0);
  fund(g, 'p2', { [r]: 18 }); // one remaining; sole recipient gets it
  next = applyAction(g, 'p0', { kind: 'roll' }, diceSix); assert.equal(next.players[0]!.hand[r], 1); conserved(next);
  g.buildings[h.vertices[2]!] = { player: 'p1', kind: 'settlement' };
  next = applyAction(g, 'p0', { kind: 'roll' }, diceSix); assert.equal(next.players[0]!.hand[r], 0); assert.equal(next.players[1]!.hand[r], 0); conserved(next);
});
test('seven waits for every discard, ignores development cards, then steals only from an adjacent opponent', () => {
  let g = setup(); clearHands(g); fund(g, 'p0', { wood: 9 }); fund(g, 'p1', { brick: 8 }); fund(g, 'p2', { sheep: 7 });
  g.players[2]!.cards = [{ id: 'v', kind: 'victoryPoint', boughtTurn: 0 }];
  let roll = 0; g = applyAction(g, 'p0', { kind: 'roll' }, () => roll++ === 0 ? 0.34 : 0.51);
  assert.equal(g.phase, 'discard'); assert.deepEqual(g.discards, { p0: 4, p1: 4 });
  assert.throws(() => move(g, { kind: 'robber', hex: 1 }), /different tile/);
  assert.throws(() => move(g, { kind: 'discard', resources: { ...emptyHand(), wood: 3 } }), /exactly/);
  g = move(g, { kind: 'discard', resources: { ...emptyHand(), brick: 4 } }, 'p1'); assert.equal(g.phase, 'discard');
  g = move(g, { kind: 'discard', resources: { ...emptyHand(), wood: 4 } }); assert.equal(g.phase, 'robber');
  const vertex = Number(Object.entries(g.buildings).find(([, b]) => b.player === 'p1')![0]);
  const hex = g.board.vertices[vertex]!.hexes.find(h => h !== g.robber)!;
  assert.throws(() => move(g, { kind: 'robber', hex, victim: 'p0' }), /opponent/);
  g = move(g, { kind: 'robber', hex, victim: 'p1' }); assert.equal(g.players[0]!.hand.brick, 1); assert.equal(g.phase, 'actions'); conserved(g);
});
test('cities free a settlement piece, produce two points, and bank/port exchanges honor the best rate', () => {
  let g = setup(); g.phase = 'actions'; clearHands(g); fund(g, 'p0', { wheat: 2, ore: 3, wood: 6 });
  const vertex = Number(Object.entries(g.buildings).find(([, b]) => b.player === 'p0')![0]);
  g = move(g, { kind: 'city', vertex }); assert.equal(pieces(g, 'p0').cities, 1); assert.equal(pieces(g, 'p0').settlements, 1); assert.equal(score(g, g.players[0]!), 3);
  for (const resource of ['wood', 'any'] as const) {
    const port = g.board.ports.find(p => p.resource === resource)!; const edge = g.board.edges[port.edge]!;
    g.buildings[edge.a] = { player: 'p0', kind: 'settlement' };
  }
  assert.equal(tradeRate(g, 'p0', 'wood'), 2); assert.ok(tradeRate(g, 'p0', 'sheep') <= 3);
  g = move(g, { kind: 'bankTrade', give: 'wood', receive: 'brick' }); assert.equal(g.players[0]!.hand.wood, 4); assert.equal(g.players[0]!.hand.brick, 1); conserved(g);
});
test('player trades are atomic, active-player-only offers; stale offers and gifts fail', () => {
  let g = setup(); g.phase = 'actions'; clearHands(g); fund(g, 'p0', { wood: 2 }); fund(g, 'p1', { sheep: 1 });
  const give = { ...emptyHand(), wood: 2 }, want = { ...emptyHand(), sheep: 1 };
  assert.throws(() => move(g, { kind: 'offerTrade', give, want }, 'p1'), /Wait/);
  assert.throws(() => move(g, { kind: 'offerTrade', give, want: emptyHand() }), /Both sides/);
  g = move(g, { kind: 'offerTrade', give, want }); const id = g.trade!.id;
  assert.throws(() => move(g, { kind: 'acceptTrade', tradeId: id }, 'p2'), /no longer has/);
  g = move(g, { kind: 'acceptTrade', tradeId: id }, 'p1'); assert.equal(g.players[0]!.hand.sheep, 1); assert.equal(g.players[1]!.hand.wood, 2); conserved(g);
  assert.throws(() => move(g, { kind: 'acceptTrade', tradeId: id }, 'p1'), /no longer available/);
});
test('hidden hands, deck order and victory cards are omitted from opponent projections', () => {
  const g = setup(); g.players[1]!.cards = [{ id: 'secret-card-id', kind: 'victoryPoint', boughtTurn: 0 }];
  const view = gameView(g, 'p0');
  assert.deepEqual(view.players[0]!.hand, g.players[0]!.hand); assert.equal(view.players[1]!.hand, undefined); assert.equal(view.players[1]!.cards, undefined);
  assert.equal(view.players[1]!.points, 2); assert.equal(gameView(g, 'p1').players[1]!.points, 3);
  assert.equal('deck' in view, false); assert.equal(JSON.stringify(view).includes('secret-card-id'), false);
});
test('development cards cannot be played when bought; old cards can be played before rolling once per turn', () => {
  let g = setup(); g.phase = 'actions'; clearHands(g); fund(g, 'p0', { sheep: 1, wheat: 1, ore: 1 }); g.deck = ['knight'];
  g = move(g, { kind: 'buyCard' }); const id = g.players[0]!.cards[0]!.id;
  assert.throws(() => move(g, { kind: 'playCard', cardId: id }), /cannot be played/);
  g.players[0]!.cards[0]!.boughtTurn = 0; g.phase = 'roll';
  g = move(g, { kind: 'playCard', cardId: id }); assert.equal(g.phase, 'robber'); assert.deepEqual(g.discards, {});
  const hex = g.board.hexes.find(h => h.id !== g.robber && h.vertices.every(v => !g.buildings[v] || g.buildings[v]!.player === 'p0'))!.id;
  g = move(g, { kind: 'robber', hex }); assert.equal(g.phase, 'roll'); assert.equal(g.players[0]!.knights, 1);
  g.players[0]!.cards.push({ id: 'another', kind: 'monopoly', boughtTurn: 0 });
  assert.throws(() => move(g, { kind: 'playCard', cardId: 'another', resource: 'wood' }), /one development/);
});
test('plenty, monopoly and two sequential free roads obey costs, inventory and timing', () => {
  let g = setup(); clearHands(g); g.phase = 'actions';
  g.players[0]!.cards = [{ id: 'plenty', kind: 'yearOfPlenty', boughtTurn: 0 }];
  g = move(g, { kind: 'playCard', cardId: 'plenty', resources: { ...emptyHand(), ore: 2 } }); assert.equal(g.players[0]!.hand.ore, 2); conserved(g);
  g.playedCard = false; g.players[0]!.cards = [{ id: 'monopoly', kind: 'monopoly', boughtTurn: 0 }]; fund(g, 'p1', { wood: 3 }); fund(g, 'p2', { wood: 2 });
  g = move(g, { kind: 'playCard', cardId: 'monopoly', resource: 'wood' }); assert.equal(g.players[0]!.hand.wood, 5); assert.equal(g.players[1]!.hand.wood, 0); conserved(g);
  g.playedCard = false; g.players[0]!.cards = [{ id: 'roads', kind: 'roadBuilding', boughtTurn: 0 }]; const before = { ...g.players[0]!.hand };
  g = move(g, { kind: 'playCard', cardId: 'roads' }); assert.equal(g.phase, 'freeRoads');
  assert.throws(() => move(g, { kind: 'endTurn' }), /current action/);
  for (let i = 0; i < 2; i++) g = move(g, { kind: 'road', edge: roadSites(g, 'p0')[0]! });
  assert.equal(g.phase, 'actions'); assert.equal(pieces(g, 'p0').roads, 4); assert.deepEqual(g.players[0]!.hand, before); conserved(g);
});
test('longest road counts a loop without reusing edges and is interrupted by opposing buildings', () => {
  const g = setup(); g.roads = {}; g.buildings = {};
  const hex = g.board.hexes[9]!; const loop = g.board.edges.filter(e => e.hexes.includes(hex.id));
  for (const edge of loop) g.roads[edge.id] = 'p0';
  assert.equal(longestTrail(g, 'p0'), 6);
  g.buildings[hex.vertices[0]!] = { player: 'p1', kind: 'settlement' };
  g.buildings[hex.vertices[3]!] = { player: 'p1', kind: 'settlement' };
  assert.equal(longestTrail(g, 'p0'), 3);
  const blocked = hex.vertices[0]!;
  const extension = g.board.vertices[blocked]!.edges.find(e => !g.roads[e]);
  if (extension !== undefined) assert.ok(!roadSites(g, 'p0').includes(extension));
});
test('newly bought victory point wins immediately; ten points on another turn waits until your turn', () => {
  let g = setup(); g.phase = 'actions'; clearHands(g); fund(g, 'p0', { sheep: 1, wheat: 1, ore: 1 });
  for (const b of Object.values(g.buildings)) if (b.player === 'p0') b.kind = 'city';
  g.players[0]!.cards = Array.from({ length: 5 }, (_, i) => ({ id: `vp-${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  g.deck = ['victoryPoint'];
  g = move(g, { kind: 'buyCard' }); assert.equal(g.winner, 'p0'); assert.equal(g.phase, 'finished');
  assert.throws(() => move(g, { kind: 'endTurn' }), /ended/);
  g = setup(); g.phase = 'actions'; g.players[1]!.cards = Array.from({ length: 8 }, (_, i) => ({ id: `vp-${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  assert.equal(g.winner, null); g = move(g, { kind: 'endTurn' }); assert.equal(g.winner, 'p1');
});
test('untrusted action data cannot inject negative costs, fractional sites or unknown resource keys', () => {
  for (const input of [null, [], { kind: 'road', edge: 1.5 }, { kind: 'road', edge: 72 }, { kind: 'discard', resources: { ...emptyHand(), wood: -1 } }, { kind: 'bankTrade', give: '__proto__', receive: 'ore' }, { kind: 'offerTrade', give: { ...emptyHand(), gold: 1 }, want: emptyHand() }]) assert.throws(() => parseGameAction(input));
});
test('automated legal play preserves inventories through 1,500 turns of rolls, discards, steals and building', () => {
  let g = setup(); const rng = seededRandom(135);
  for (let step = 0; step < 8000 && !g.winner && g.turn <= 1500; step++) {
    const p = activePlayer(g), view = gameView(g, p.id); let action: GameAction;
    if (g.phase === 'roll') action = { kind: 'roll' };
    else if (g.phase === 'discard') {
      const id = Object.keys(g.discards)[0]!, hand = g.players.find(p => p.id === id)!.hand, selection = emptyHand(); let remaining = g.discards[id]!;
      for (const r of RESOURCES) { selection[r] = Math.min(remaining, hand[r]); remaining -= selection[r]; }
      g = applyAction(g, id, { kind: 'discard', resources: selection }, rng); conserved(g); continue;
    } else if (g.phase === 'robber') {
      const hex = g.board.hexes.find(h => h.id !== g.robber)!;
      const victim = hex.vertices.map(v => g.buildings[v]?.player).find(id => id && id !== p.id);
      action = { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
    } else if (view.legal.cities.length) action = { kind: 'city', vertex: view.legal.cities[0]! };
    else if (view.legal.settlements.length) action = { kind: 'settlement', vertex: view.legal.settlements[0]! };
    else if (view.legal.roads.length && rng() > .3) action = { kind: 'road', edge: view.legal.roads[Math.floor(rng() * view.legal.roads.length)]! };
    else if (view.legal.canBuyCard) action = { kind: 'buyCard' };
    else action = { kind: 'endTurn' };
    g = applyAction(g, p.id, action, rng); conserved(g);
  }
  assert.ok(g.turn > 100 || g.winner);
});
