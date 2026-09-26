/**
 * Open Sea through the reducer (docs/RULEBOOK-OPEN-SEA.md): every rule as applyAction plays it, each test named
 * by its section. The rules themselves are tested module by module in sea.test.ts, sea-ships.test.ts and
 * gold.test.ts; these check that the game applies them, in order, with its log, its view and its clock. "You"
 * are Blue, on turn unless a test says otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dealBoard, isLand, seededRandom } from '../packages/rules/src/board.js';
import {
  RuleError,
  applyAction,
  createGame,
  gameView,
  parseGameAction,
  resignPlayers,
  score,
  scoreTerms,
  total,
} from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';
import { COSTS, DEVELOPMENT_DECK, RESOURCES } from '../packages/rules/src/index.js';
import {
  CLASSIC,
  OPEN_SEA,
  findRuleset,
  routeAwardName,
  rulesetProblems,
  rulesets,
  seatRange,
} from '../packages/rules/src/rulesets.js';
import {
  MAIN_ISLAND,
  edgeKind,
  hexEdges,
  isCoastalIntersection,
  longestRoute,
  pirateVictims,
  takesRoad,
  takesShip,
  vertexIsland,
} from '../packages/rules/src/sea.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction, timeoutDescription } from '../packages/rules/src/timeout.js';
import { requiredAction } from '../apps/client/src/game-attention.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import { outerIslesThree, sketch } from './sea-boards.js';
import {
  SEATS,
  accountedFor,
  afterSetup,
  dealCards,
  dice,
  giveCards,
  hand,
  newLines,
  rigGold,
  seaGame,
} from './open-sea-game.js';
import { gameInvariantProblems } from '../scripts/verify-restored-games.js';

const rule = (message: RegExp | string) => (error: unknown) =>
  error instanceof RuleError &&
  (typeof message === 'string' ? error.message === message : message.test(error.message));
const sea = outerIslesThree();
const board = sea.board;
const other = (edge: number, vertex: number) =>
  board.edges[edge]!.a === vertex ? board.edges[edge]!.b : board.edges[edge]!.a;
const edgeBetween = (a: number, b: number) =>
  board.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))!.id;
/** The fewest ship edges from an intersection to one `to` accepts: a line a player could sail. */
function shipLine(from: number, to: (vertex: number) => boolean): number[] {
  const back = new Map<number, [number, number]>([[from, [from, -1]]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]!;
    if (v !== from && to(v)) {
      const line: number[] = [];
      for (let at = v; at !== from; at = back.get(at)![0]) line.unshift(back.get(at)![1]);
      return line;
    }
    for (const e of board.vertices[v]!.edges)
      if (takesShip(edgeKind(board, e)) && !back.has(other(e, v))) {
        back.set(other(e, v), [v, e]);
        queue.push(other(e, v));
      }
  }
  throw new Error(`No line of ships leaves ${from}`);
}
const hexOf = (terrain: string, island: string) =>
  board.hexes.find((h) => h.terrain === terrain && h.island === island)!.id;
// Places on the sketch: the main island's north coast faces the north isle (a) across one row of sea.
const NORTH_COAST = 57; // the top of the main island's Sheep, facing the north isle
const MOUNTAINS = hexOf('ore', MAIN_ISLAND);
const GOLD_NORTH = hexOf('gold', 'a');

test('§1.1, §3 and §15.1 Open Sea is a ruleset: three or four players, 14 points, ships, no bots', () => {
  assert.equal(findRuleset('open-sea-v1'), OPEN_SEA);
  assert.deepEqual(
    rulesets().map((r) => r.id),
    [CLASSIC.id, OPEN_SEA.id],
  );
  assert.equal(OPEN_SEA.name, 'Open Sea');
  assert.equal(OPEN_SEA.board, 'outer-isles-v1');
  assert.deepEqual(OPEN_SEA.seats, { min: 3, max: 4 });
  assert.deepEqual(OPEN_SEA.victoryPoints, { default: 14, min: 10, max: 18 });
  assert.equal(OPEN_SEA.supply.bank, 19);
  assert.equal(OPEN_SEA.supply.deck, DEVELOPMENT_DECK);
  assert.deepEqual(OPEN_SEA.supply.pieces, { roads: 15, settlements: 5, cities: 4, ships: 15 });
  assert.deepEqual(OPEN_SEA.costs.ship, { wood: 1, brick: 0, sheep: 1, wheat: 0, ore: 0 });
  for (const purchase of ['road', 'settlement', 'city', 'developmentCard'] as const)
    assert.deepEqual(OPEN_SEA.costs[purchase], COSTS[purchase]);
  assert.equal(CLASSIC.costs.ship, undefined, 'a ship is never offered in Classic');
  assert.equal(OPEN_SEA.bots, false);
  assert.equal(OPEN_SEA.standIns, false);
  assert.deepEqual(OPEN_SEA.sea, { scenario: 'outer-isles' });
  assert.deepEqual(rulesetProblems(OPEN_SEA), []);
  assert.equal(seatRange(OPEN_SEA), 'three to four');
  assert.equal(routeAwardName(OPEN_SEA), 'Longest Route');
  assert.equal(routeAwardName(CLASSIC), 'Longest Road');
  const seats = (n: number) => SEATS.slice(0, n);
  for (const n of [2, 5])
    assert.throws(
      () =>
        createGame([...seats(4), { id: 'extra', name: 'Extra' }].slice(0, n), 1, Math.random, {
          ruleset: OPEN_SEA.id,
        }),
      rule('Start with three to four players'),
    );
  // A game's board is its player count's template (section 4.1).
  const three = createGame(seats(3), 11, () => 0.5, { ruleset: OPEN_SEA.id });
  const four = createGame(seats(4), 11, () => 0.5, { ruleset: OPEN_SEA.id });
  assert.equal(three.board.preset, 'outer-isles-v1');
  assert.deepEqual([three.board.players, three.board.hexes.length], [3, 72]);
  assert.deepEqual([four.board.players, four.board.hexes.length], [4, 77]);
  assert.equal(three.victoryPoints, 14);
  assert.equal(total(three.bank), 95);
  assert.equal(three.deck.length, 25);
  assert.throws(
    () =>
      createGame(seats(4), 11, () => 0.5, {
        ruleset: OPEN_SEA.id,
        board: dealBoard(11, 'outer-isles-v1', 3),
      }),
    rule('The island was dealt for another number of players'),
  );
});

test('§4.3 the robber starts on the desert and the pirate on its template’s sea hex; nothing else is at sea', () => {
  for (const players of [3, 4]) {
    const g = createGame(SEATS.slice(0, players), 90 + players, () => 0.5, { ruleset: OPEN_SEA.id });
    assert.equal(g.robber, g.board.robberStart);
    assert.equal(g.board.hexes[g.robber]!.terrain, 'desert');
    assert.equal(g.pirate, g.board.pirateStart);
    const pirate = g.board.hexes[g.pirate!]!;
    assert.ok(!isLand(pirate));
    assert.ok(
      pirate.neighbors.every((n) => !isLand(g.board.hexes[n]!)),
      'the pirate starts away from land',
    );
    assert.deepEqual(
      {
        ships: g.ships,
        shipsBuiltThisTurn: g.shipsBuiltThisTurn,
        shipMovedThisTurn: g.shipMovedThisTurn,
        lockedShips: g.lockedShips,
        closedShipEnds: g.closedShipEnds,
        islandBonuses: g.islandBonuses,
        goldOwed: g.goldOwed,
      },
      {
        ships: {},
        shipsBuiltThisTurn: [],
        shipMovedThisTurn: false,
        lockedShips: [],
        closedShipEnds: {},
        islandBonuses: {},
        goldOwed: [],
      },
    );
    assert.match(g.log[0]!.text, /Place two settlements on the main island, each with a road or a ship/);
  }
  // Classic keeps none of the sea's fields, so it saves as it always has.
  const classic = createGame(SEATS.slice(0, 3), 5, () => 0.5);
  for (const field of ['ships', 'pirate', 'goldOwed', 'islandBonuses', 'shipsBuiltThisTurn'])
    assert.ok(!(field in classic), field);
  assert.equal('ships' in gameView(classic, 'blue').legal, false);
});

test('§5.2 and §5.3 starting settlements go only on the main island, in snake order', () => {
  let g = createGame(SEATS.slice(0, 3), 404, () => 0.5, { ruleset: OPEN_SEA.id });
  const sites = gameView(g, 'blue').legal.settlements;
  assert.ok(sites.length > 20);
  for (const v of sites) assert.equal(vertexIsland(g.board, v), MAIN_ISLAND, `corner ${v}`);
  const smallIsland = g.board.vertices.find((v) => {
    const island = vertexIsland(g.board, v.id);
    return island && island !== MAIN_ISLAND;
  })!.id;
  const openSea = g.board.vertices.find((v) => v.hexes.every((h) => !isLand(g.board.hexes[h]!)))!.id;
  for (const vertex of [smallIsland, openSea])
    assert.throws(
      () => applyAction(g, 'blue', { kind: 'settlement', vertex }, () => 0.5),
      rule(/main island/),
    );
  // The draft runs 1, 2, 3, 3, 2, 1; each settlement followed by its road or ship.
  const order: string[] = [];
  const random = seededRandom(3);
  while (g.turn === 0) {
    const [owed] = owedMoves(g);
    order.push(`${owed!.player}:${owed!.kind}`);
    g = applyAction(g, owed!.player, timeoutAction(g, owed!.player, random)!, random);
  }
  assert.deepEqual(
    order.filter((move) => move.endsWith('setupSettlement')).map((move) => move.split(':')[0]),
    ['blue', 'red', 'green', 'green', 'red', 'blue'],
  );
  assert.equal(g.phase, 'roll');
  assert.equal(Object.keys(g.buildings).length, 6);
  assert.deepEqual(accountedFor(g), []);
});

test('§5.4 after a starting settlement comes a road or, at a coastal one, a ship touching it, never by the pirate', () => {
  let g = createGame(SEATS.slice(0, 3), 404, () => 0.5, { ruleset: OPEN_SEA.id });
  const coastal = gameView(g, 'blue').legal.settlements.find((v) => isCoastalIntersection(g.board, v))!;
  const inland = gameView(g, 'blue').legal.settlements.find((v) => !isCoastalIntersection(g.board, v))!;
  const atInland = applyAction(g, 'blue', { kind: 'settlement', vertex: inland }, () => 0.5);
  assert.deepEqual(gameView(atInland, 'blue').legal.ships, [], 'no ship beside an inland settlement');
  g = applyAction(g, 'blue', { kind: 'settlement', vertex: coastal }, () => 0.5);
  const legal = gameView(g, 'blue').legal;
  const touching = (e: number) => [g.board.edges[e]!.a, g.board.edges[e]!.b].includes(coastal);
  assert.ok(
    legal.ships!.length > 0 && legal.ships!.every((e) => touching(e) && takesShip(edgeKind(g.board, e))),
  );
  assert.ok(
    legal.roads.length > 0 && legal.roads.every((e) => touching(e) && takesRoad(edgeKind(g.board, e))),
  );
  const seaEdge = legal.ships!.find((e) => edgeKind(g.board, e) === 'sea');
  const landEdge = legal.roads.find((e) => edgeKind(g.board, e) === 'land');
  if (seaEdge !== undefined)
    assert.throws(
      () => applyAction(g, 'blue', { kind: 'road', edge: seaEdge }, () => 0.5),
      rule(/road or a ship/),
    );
  if (landEdge !== undefined)
    assert.throws(
      () => applyAction(g, 'blue', { kind: 'ship', edge: landEdge }, () => 0.5),
      rule(/ship touching/),
    );
  // The pirate's six edges take no ship, starting ships included (section 10.6).
  const beside = g.board.vertices[coastal]!.hexes.find((h) => !isLand(g.board.hexes[h]!))!;
  const blocked = { ...structuredClone(g), pirate: beside };
  const underPirate = legal.ships!.filter((e) => hexEdges(g.board, beside).includes(e));
  assert.ok(underPirate.length > 0);
  for (const edge of underPirate) {
    assert.ok(!gameView(blocked, 'blue').legal.ships!.includes(edge));
    assert.throws(
      () => applyAction(blocked, 'blue', { kind: 'ship', edge }, () => 0.5),
      rule(/ship touching/),
    );
  }
  const edge = legal.ships![0]!;
  const placed = applyAction(g, 'blue', { kind: 'ship', edge }, () => 0.5);
  assert.equal(placed.ships![edge], 'blue');
  assert.deepEqual(
    placed.shipsBuiltThisTurn,
    [],
    'setup is not a turn: a starting ship may move on the first',
  );
  assert.deepEqual(newLines(g, placed), [`Blue placed a starting ship on edge ${edge + 1}.`]);
  assert.equal(placed.phase, 'setupSettlement');
  assert.equal(placed.active, 1);
});

test('§5.5 the second settlement collects a card for each producing hex beside it, and nothing for desert or sea', () => {
  let g = createGame(SEATS.slice(0, 3), 404, () => 0.5, { ruleset: OPEN_SEA.id });
  const random = seededRandom(9);
  // Play the draft until Blue places the second settlement, on the corner with the most kinds of land.
  while (!(g.phase === 'setupSettlement' && g.setupIndex === 5)) {
    const [owed] = owedMoves(g);
    g = applyAction(g, owed!.player, timeoutAction(g, owed!.player, random)!, random);
  }
  const land = (v: number) => g.board.vertices[v]!.hexes.filter((h) => isLand(g.board.hexes[h]!)).length;
  const vertex = gameView(g, 'blue')
    .legal.settlements.filter((v) => isCoastalIntersection(g.board, v))
    .sort((a, b) => land(b) - land(a))[0]!;
  const expected = hand();
  for (const h of g.board.vertices[vertex]!.hexes) {
    const terrain = g.board.hexes[h]!.terrain;
    if ((RESOURCES as readonly string[]).includes(terrain)) expected[terrain as keyof typeof expected]++;
  }
  const before = g;
  g = applyAction(g, 'blue', { kind: 'settlement', vertex }, () => 0.5);
  const blue = g.players.find((p) => p.id === 'blue')!;
  assert.deepEqual(blue.hand, expected);
  for (const r of RESOURCES) assert.equal(g.bank[r], before.bank[r] - expected[r]);
  assert.ok(Object.values(blue.hand).every(Number.isInteger), 'no gold or sea card');
  assert.equal(g.phase, 'setupRoad');
  assert.deepEqual(accountedFor(g), []);
});

test('§5.5 and §9.3 a second settlement beside a gold field picks its card before its road or ship', () => {
  // A main island with a gold field of its own, which Outer Isles never deals but the ruleset allows.
  const sk = sketch(
    ' ~ ~ ~ ~ ~ ~',
    '~ . . . . . ~',
    ' ~ . T G . ~',
    '~ . S H C . ~',
    ' ~ . . . . ~',
    '~ ~ ~ ~ ~ ~ ~',
  );
  const board = { ...sk.board, hexes: sk.board.hexes };
  const gold = board.hexes.find((h) => h.terrain === 'gold')!;
  let g = seaGame(sk, { phase: 'setupSettlement' });
  Object.assign(g, { turn: 0, setupIndex: 5, active: 0 });
  const vertex = gold.vertices.find((v) => gameView(g, 'blue').legal.settlements.includes(v))!;
  const fields = g.board.vertices[vertex]!.hexes.filter((h) => g.board.hexes[h]!.terrain === 'gold').length;
  g = applyAction(g, 'blue', { kind: 'settlement', vertex }, () => 0.5);
  assert.equal(g.phase, 'goldPick');
  assert.deepEqual(g.goldOwed, [{ player: 'blue', picks: fields }]);
  assert.deepEqual(owedMoves(g), [{ player: 'blue', kind: 'goldPick' }]);
  assert.deepEqual(gameView(g, 'blue').legal.goldPick, { count: fields, types: [...RESOURCES] });
  assert.throws(
    () => applyAction(g, 'blue', { kind: 'road', edge: gameView(g, 'blue').legal.roads[0] ?? 0 }, () => 0.5),
    rule(/current action|road or a ship/),
  );
  const picked = applyAction(g, 'blue', { kind: 'goldPick', resources: hand({ ore: fields }) }, () => 0.5);
  assert.equal(picked.phase, 'setupRoad', 'then the road or ship');
  assert.equal(picked.players[0]!.hand.ore, fields);
  assert.deepEqual(picked.goldOwed, []);
  assert.ok(newLines(g, picked).includes(`Blue took ${fields} Rock from the bank for gold.`));
  assert.deepEqual(accountedFor(picked), []);
});

test('§5.6 setup earns no island bonus and allows no trade, card or ship move', () => {
  const g = createGame(SEATS.slice(0, 3), 404, () => 0.5, { ruleset: OPEN_SEA.id });
  for (const action of [
    { kind: 'bankTrade', give: 'wood', receive: 'ore' },
    { kind: 'moveShip', from: 0, to: 1 },
    { kind: 'buyCard' },
  ] as GameAction[])
    assert.throws(() => applyAction(g, 'blue', action, () => 0.5), RuleError, action.kind);
  let played = g;
  const random = seededRandom(12);
  while (played.turn === 0) {
    const [owed] = owedMoves(played);
    played = applyAction(played, owed!.player, timeoutAction(played, owed!.player, random)!, random);
  }
  assert.deepEqual(played.islandBonuses, {});
});

test('§7.1 a ship costs 1 Timber and 1 Sheep and goes by your settlement or ship, never by a road or the pirate', () => {
  const g = seaGame(sea, { settlements: { blue: [NORTH_COAST] }, hands: { blue: { wood: 2, sheep: 2 } } });
  const legal = gameView(g, 'blue').legal;
  assert.ok(legal.ships!.length > 0);
  for (const e of legal.ships!) {
    assert.ok([board.edges[e]!.a, board.edges[e]!.b].includes(NORTH_COAST));
    assert.ok(takesShip(edgeKind(board, e)));
  }
  const [edge] = shipLine(NORTH_COAST, (v) => vertexIsland(board, v) === 'a');
  const built = applyAction(g, 'blue', { kind: 'ship', edge: edge! }, () => 0.5);
  assert.equal(built.ships![edge!], 'blue');
  assert.deepEqual(built.players[0]!.hand, hand({ wood: 1, sheep: 1 }));
  assert.equal(built.bank.wood, g.bank.wood + 1);
  assert.equal(built.bank.sheep, g.bank.sheep + 1);
  assert.deepEqual(built.shipsBuiltThisTurn, [edge]);
  assert.deepEqual(newLines(g, built), [`Blue built a ship on edge ${edge! + 1}.`]);
  // Without the cards, or where nothing of yours touches, or in someone else's turn: no ship.
  const poor = seaGame(sea, { settlements: { blue: [NORTH_COAST] } });
  assert.deepEqual(gameView(poor, 'blue').legal.ships, []);
  assert.throws(
    () => applyAction(poor, 'blue', { kind: 'ship', edge: edge! }, () => 0.5),
    rule('Not enough resources'),
  );
  const far = board.edges.find(
    (e) => takesShip(edgeKind(board, e.id)) && ![e.a, e.b].includes(NORTH_COAST),
  )!.id;
  assert.throws(
    () => applyAction(g, 'blue', { kind: 'ship', edge: far }, () => 0.5),
    rule(/legal edge for the ship/),
  );
  assert.throws(
    () => applyAction(g, 'red', { kind: 'ship', edge: edge! }, () => 0.5),
    rule('Wait for your turn'),
  );
  // A road never serves as a ship's connection.
  const road = board.vertices[NORTH_COAST]!.edges.find((e) => edgeKind(board, e) === 'coastal')!;
  const end = other(road, NORTH_COAST);
  const byRoad = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    roads: { blue: [road] },
    hands: { blue: { wood: 1, sheep: 1 } },
  });
  for (const e of board.vertices[end]!.edges.filter((e) => e !== road && takesShip(edgeKind(board, e))))
    assert.ok(!gameView(byRoad, 'blue').legal.ships!.includes(e), `edge ${e} would join a road`);
  // Nor on the pirate's edges.
  const pirateHex = board.edges[edge!]!.hexes.find((h) => !isLand(board.hexes[h]!))!;
  const pirate = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    hands: { blue: { wood: 1, sheep: 1 } },
    pirate: pirateHex,
  });
  assert.throws(
    () => applyAction(pirate, 'blue', { kind: 'ship', edge: edge! }, () => 0.5),
    rule(/legal edge/),
  );
  // Nothing in Classic is a ship.
  const classic = createGame(SEATS.slice(0, 3), 5, () => 0.5);
  Object.assign(classic, { turn: 1, phase: 'actions', setupIndex: 6 });
  assert.throws(
    () => applyAction(classic, 'blue', { kind: 'ship', edge: 0 }, () => 0.5),
    rule('That action is unavailable'),
  );
});

test('§7.2 and §7.3 a coastal edge holds one piece, and roads and ships join only at your own building', () => {
  const coastal = board.vertices[NORTH_COAST]!.edges.filter((e) => edgeKind(board, e) === 'coastal');
  const [road, second] = coastal;
  const g = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    roads: { blue: [road!] },
    ships: { blue: [second!] },
    hands: { blue: { wood: 3, brick: 3, sheep: 3 } },
  });
  assert.throws(() => applyAction(g, 'blue', { kind: 'ship', edge: road! }, () => 0.5), rule(/legal edge/));
  assert.throws(
    () => applyAction(g, 'blue', { kind: 'road', edge: second! }, () => 0.5),
    rule('Choose a legal road site'),
  );
  // Past the settlement, the road's far end takes only roads and the ship's far end only ships.
  const roadEnd = other(road!, NORTH_COAST),
    shipEnd = other(second!, NORTH_COAST);
  const legal = gameView(g, 'blue').legal;
  for (const e of board.vertices[shipEnd]!.edges.filter((e) => e !== second))
    assert.ok(!legal.roads.includes(e), `a road may not continue the ship at ${shipEnd}`);
  for (const e of board.vertices[roadEnd]!.edges.filter((e) => e !== road))
    assert.ok(!legal.ships!.includes(e), `a ship may not continue the road at ${roadEnd}`);
});

test('§7.4 and §12.2 a line of ships reaches a small island, and your first settlement there earns 2 points', () => {
  const line = shipLine(NORTH_COAST, (v) => vertexIsland(board, v) === 'a');
  const landing = line.reduce((v, e) => other(e, v), NORTH_COAST);
  // One more ship along the island's coast, past the corner the distance rule keeps empty.
  const coast = board.vertices[landing]!.edges.find(
    (e) =>
      !line.includes(e) && edgeKind(board, e) === 'coastal' && vertexIsland(board, other(e, landing)) === 'a',
  )!;
  const site = other(coast, landing);
  let g = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    ships: { blue: [...line, coast] },
    hands: { blue: { wood: 2, brick: 2, sheep: 2, wheat: 2 } },
  });
  assert.ok(gameView(g, 'blue').legal.settlements.includes(site));
  const before = score(g, g.players[0]!);
  const settled = applyAction(g, 'blue', { kind: 'settlement', vertex: site }, () => 0.5);
  assert.deepEqual(settled.islandBonuses, { blue: ['a'] });
  assert.equal(score(settled, settled.players[0]!), before + 3);
  assert.deepEqual(
    scoreTerms(settled, settled.players[0]!).find((term) => term.id === 'islandBonus'),
    { id: 'islandBonus', points: 2, count: 1 },
  );
  assert.deepEqual(newLines(g, settled), [
    `Blue built a settlement at corner ${site + 1}.`,
    'Blue settled a new island (+2 points).',
  ]);
  // The bonus stays when the settlement becomes a city, and a second settlement there earns nothing more.
  g = structuredClone(settled);
  giveCards(g, 'blue', { wheat: 2, ore: 3 });
  const city = applyAction(g, 'blue', { kind: 'city', vertex: site }, () => 0.5);
  assert.deepEqual(city.islandBonuses, { blue: ['a'] });
  assert.equal(score(city, city.players[0]!), score(settled, settled.players[0]!) + 1);
  // The main island never earns one: a settlement built there by road.
  const [first] = board.vertices[NORTH_COAST]!.edges.filter((e) => edgeKind(board, e) === 'coastal');
  const bend = other(first!, NORTH_COAST);
  const second = board.vertices[bend]!.edges.find(
    (e) =>
      e !== first && takesRoad(edgeKind(board, e)) && vertexIsland(board, other(e, bend)) === MAIN_ISLAND,
  )!;
  const main = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    roads: { blue: [first!, second] },
    hands: { blue: { wood: 1, brick: 1, sheep: 1, wheat: 1 } },
  });
  const built = applyAction(main, 'blue', { kind: 'settlement', vertex: other(second, bend) }, () => 0.5);
  assert.deepEqual(built.islandBonuses, {});
  assert.equal(score(built, built.players[0]!), 2);
});

test('§12.3 the book’s example: settling a small island Red already holds takes Blue from 11 points to 14, a win', () => {
  const line = shipLine(NORTH_COAST, (v) => vertexIsland(board, v) === 'a');
  const landing = line.reduce((v, e) => other(e, v), NORTH_COAST);
  const coast = board.vertices[landing]!.edges.find(
    (e) =>
      !line.includes(e) && edgeKind(board, e) === 'coastal' && vertexIsland(board, other(e, landing)) === 'a',
  )!;
  const site = other(coast, landing);
  // Red is already on the north isle, on a corner the distance rule allows beside Blue's.
  const redCorner = board.hexes[GOLD_NORTH]!.vertices.find(
    (v) =>
      v !== site &&
      !board.vertices[site]!.neighbors.includes(v) &&
      !board.vertices[landing]!.neighbors.includes(v) &&
      v !== landing,
  )!;
  // Blue: four cities and a settlement on the main island (9 points) and two victory point cards: 11.
  const mainCorners = [59, 64, 74, 93];
  const g = seaGame(sea, {
    cities: { blue: mainCorners },
    settlements: { blue: [NORTH_COAST], red: [redCorner] },
    ships: { blue: [...line, coast] },
    hands: { blue: { wood: 1, brick: 1, sheep: 1, wheat: 1 } },
  });
  g.islandBonuses = { red: ['a'] };
  g.players[0]!.cards = [
    { id: 'card-0', kind: 'victoryPoint', boughtTurn: 0 },
    { id: 'card-1', kind: 'victoryPoint', boughtTurn: 0 },
  ];
  g.deck = g.deck.slice(2);
  g.nextCard = 2;
  assert.equal(score(g, g.players[0]!), 11);
  const won = applyAction(g, 'blue', { kind: 'settlement', vertex: site }, () => 0.5);
  assert.equal(score(won, won.players[0]!), 14);
  assert.equal(won.winner, 'blue');
  assert.equal(won.phase, 'finished');
  assert.deepEqual(won.islandBonuses, { red: ['a'], blue: ['a'] });
  assert.equal(won.log.at(-1)!.text, 'Blue wins with 14 points!');
});

// The south coast of the north isle, west to east: the corner the line from the main island lands on, then along.
const LANDING = 43;
const south = (...corners: number[]) => corners.slice(1).map((v, i) => edgeBetween(corners[i]!, v));
const STRAIT = edgeBetween(NORTH_COAST, LANDING);

test('§8.1 and §8.4 one ship move a turn, in the action phase only, never the turn the ship was built', () => {
  // Blue's line: the strait, then along the north isle's coast to 42, whose end there is open.
  const [along] = south(LANDING, 42);
  // Lifted, it may go anywhere a new ship could: here, along the coast the other way from where the line lands.
  const further = edgeBetween(LANDING, 40);
  const layout = { settlements: { blue: [NORTH_COAST] }, ships: { blue: [STRAIT, along!] } };
  const g = seaGame(sea, layout);
  const legal = gameView(g, 'blue').legal;
  assert.deepEqual(Object.keys(legal.shipMoves!).map(Number), [along]);
  assert.deepEqual(legal.shipMoveBlocks, { [STRAIT]: 'no-open-end' });
  assert.ok(legal.shipMoves![along!]!.includes(further));
  assert.ok(!legal.shipMoves![along!]!.includes(edgeBetween(42, 45)), 'not by its own former place');
  const moved = applyAction(g, 'blue', { kind: 'moveShip', from: along!, to: further! }, () => 0.5);
  assert.equal(moved.ships![further!], 'blue');
  assert.equal(moved.ships![along!], undefined);
  assert.equal(moved.shipMovedThisTurn, true);
  assert.deepEqual(newLines(g, moved), [
    `Blue moved a ship from edge ${along! + 1} to edge ${further! + 1}.`,
  ]);
  assert.deepEqual(gameView(moved, 'blue').legal.shipMoves, {});
  assert.throws(
    () => applyAction(moved, 'blue', { kind: 'moveShip', from: further!, to: along! }, () => 0.5),
    rule('You have already moved a ship this turn'),
  );
  // Not before the roll, not in someone else's turn, not between Road Building's placements.
  for (const phase of ['roll', 'freeRoads'] as const)
    assert.throws(
      () =>
        applyAction(
          seaGame(sea, { ...layout, phase }),
          'blue',
          { kind: 'moveShip', from: along!, to: further! },
          () => 0.5,
        ),
      RuleError,
      phase,
    );
  assert.throws(
    () => applyAction(g, 'red', { kind: 'moveShip', from: along!, to: further! }, () => 0.5),
    rule('Wait for your turn'),
  );
  // A ship built this turn stays put; the next turn it may move.
  const built = seaGame(sea, {
    ...layout,
    ships: { blue: [STRAIT] },
    hands: { blue: { wood: 1, sheep: 1 } },
  });
  const fresh = applyAction(built, 'blue', { kind: 'ship', edge: along! }, () => 0.5);
  assert.deepEqual(gameView(fresh, 'blue').legal.shipMoveBlocks![along!], 'built-this-turn');
  assert.throws(
    () => applyAction(fresh, 'blue', { kind: 'moveShip', from: along!, to: further! }, () => 0.5),
    rule('A ship cannot move on the turn it was built'),
  );
  let later = applyAction(fresh, 'blue', { kind: 'endTurn' }, () => 0.5);
  assert.deepEqual([later.shipsBuiltThisTurn, later.shipMovedThisTurn], [[], false]);
  later = { ...later, active: 0, phase: 'actions' };
  assert.ok(Object.keys(gameView(later, 'blue').legal.shipMoves!).includes(String(along)));
  // Off the board, and in Classic, a move is refused before any rule is asked.
  assert.throws(
    () => applyAction(g, 'blue', { kind: 'moveShip', from: along!, to: 9999 }, () => 0.5),
    rule('Invalid board location'),
  );
  const classic = createGame(SEATS.slice(0, 3), 5, () => 0.5);
  Object.assign(classic, { turn: 1, phase: 'actions', setupIndex: 6 });
  assert.throws(
    () => applyAction(classic, 'blue', { kind: 'moveShip', from: 1, to: 2 }, () => 0.5),
    rule('That action is unavailable'),
  );
});

test('§8.5 and §10.6 a ship moves only to an edge where it could be built now, and never on or off the pirate’s', () => {
  const [along] = south(LANDING, 42);
  const further = edgeBetween(LANDING, 40);
  const layout = { settlements: { blue: [NORTH_COAST] }, ships: { blue: [STRAIT, along!] } };
  const g = seaGame(sea, layout);
  // A land edge, an edge touching nothing of Blue's, or the ship's own place: all refused.
  const land = board.edges.find((e) => edgeKind(board, e.id) === 'land')!.id;
  const nowhere = board.edges.find(
    (e) => takesShip(edgeKind(board, e.id)) && !gameView(g, 'blue').legal.shipMoves![along!]!.includes(e.id),
  )!.id;
  for (const to of [land, nowhere, along!])
    assert.throws(
      () => applyAction(g, 'blue', { kind: 'moveShip', from: along!, to }, () => 0.5),
      rule('The ship cannot move to that edge'),
    );
  // The pirate holds the ships on its six edges, and takes no ship onto them.
  const onEdge = board.edges[along!]!.hexes.find((h) => !isLand(board.hexes[h]!))!;
  const held = seaGame(sea, { ...layout, pirate: onEdge });
  assert.throws(
    () => applyAction(held, 'blue', { kind: 'moveShip', from: along!, to: further! }, () => 0.5),
    rule('The pirate holds ships on the edges of its hex'),
  );
  const target = board.edges[further!]!.hexes.find(
    (h) => !isLand(board.hexes[h]!) && !board.edges[along!]!.hexes.includes(h),
  );
  if (target !== undefined) {
    const guarded = seaGame(sea, { ...layout, pirate: target });
    assert.ok(!gameView(guarded, 'blue').legal.shipMoves![along!]?.includes(further!));
  }
});

test('§8.6 and §11 Longest Route counts roads and ships through your own settlement, and a move keeps it', () => {
  // Two roads along the main island's coast; ships across the strait, west along the north isle, then out.
  const road = board.vertices[NORTH_COAST]!.edges.find((e) => edgeKind(board, e) === 'coastal')!;
  const roadEnd = other(road, NORTH_COAST);
  const road2 = board.vertices[roadEnd]!.edges.find((e) => e !== road && takesRoad(edgeKind(board, e)))!;
  const [west] = south(LANDING, 40);
  const out = board.vertices[40]!.edges.find((e) => edgeKind(board, e) === 'sea')!;
  const g = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    roads: { blue: [road, road2] },
    ships: { blue: [STRAIT, west!] },
    hands: { blue: { wood: 1, sheep: 1 } },
  });
  assert.equal(gameView(g, 'blue').players[0]!.roadLength, 4);
  assert.equal(g.longestRoad, null);
  const claimed = applyAction(g, 'blue', { kind: 'ship', edge: out }, () => 0.5);
  assert.equal(longestRoute(claimed, 'blue').length, 5);
  assert.equal(claimed.longestRoad, 'blue');
  assert.equal(gameView(claimed, 'red').players[0]!.roadLength, 5);
  assert.ok(newLines(g, claimed).includes('Blue claimed Longest Route (+2 points).'));
  assert.deepEqual(
    scoreTerms(claimed, claimed.players[0]!).find((term) => term.id === 'longestRoad'),
    { id: 'longestRoad', points: 2, count: 1 },
  );
  // The next turn the end ship moves round the corner of the isle: the route is still 5, so Blue keeps it.
  const next = { ...structuredClone(claimed), shipsBuiltThisTurn: [], shipMovedThisTurn: false };
  const corner = board.vertices[40]!.edges.find((e) => e !== west && e !== out)!;
  assert.ok(gameView(next, 'blue').legal.shipMoves![out]!.includes(corner));
  const kept = applyAction(next, 'blue', { kind: 'moveShip', from: out, to: corner }, () => 0.5);
  assert.equal(longestRoute(kept, 'blue').length, 5);
  assert.equal(kept.longestRoad, 'blue');
  assert.ok(!newLines(next, kept).some((line) => /claimed/.test(line)));
  // Moved to branch off the strait instead, the route is 4 and nobody holds the award.
  const branch = edgeBetween(LANDING, 42);
  const shorter = applyAction(next, 'blue', { kind: 'moveShip', from: out, to: branch }, () => 0.5);
  assert.equal(longestRoute(shorter, 'blue').length, 4);
  assert.equal(shorter.longestRoad, null);
});

// On the sketch the north isle's gold field has these corners: the three below are two apart from one another.
const [GOLD_N, , GOLD_SE, , GOLD_SW] = board.hexes[GOLD_NORTH]!.vertices;
const MOUNTAIN_NE = board.hexes[MOUNTAINS]!.vertices[1]!,
  MOUNTAIN_SW = board.hexes[MOUNTAINS]!.vertices[4]!;

test('§9.2 the book’s example: ordinary production and its shortage first, then gold from the bank as it stands', () => {
  // The bank holds 2 Rock. Blue's city and Red's settlement touch the mountains numbered 10; Green's settlement
  // the gold field numbered 10.
  const g = seaGame(sea, {
    numbers: { [MOUNTAINS]: 10, [GOLD_NORTH]: 10 },
    phase: 'roll',
    cities: { blue: [MOUNTAIN_NE] },
    settlements: { red: [MOUNTAIN_SW], green: [GOLD_N!] },
    hands: { blue: { ore: 9 }, red: { ore: 8 } },
  });
  assert.equal(g.bank.ore, 2);
  const rolled = applyAction(g, 'blue', { kind: 'roll' }, dice(4, 6));
  assert.deepEqual(newLines(g, rolled), [
    'Blue rolled 4 + 6 = 10.',
    'The bank is short of Rock; nobody receives that resource.',
  ]);
  assert.equal(rolled.bank.ore, 2, 'the 3 Rock owed are more than the bank holds, so nobody receives Rock');
  assert.equal(rolled.phase, 'goldPick');
  assert.deepEqual(rolled.goldOwed, [{ player: 'green', picks: 1 }]);
  assert.deepEqual(owedMoves(rolled), [{ player: 'green', kind: 'goldPick' }]);
  assert.deepEqual(gameView(rolled, 'green').legal.goldPick, { count: 1, types: [...RESOURCES] });
  assert.equal(gameView(rolled, 'blue').legal.goldPick, undefined);
  // Blue waits: nothing of the action phase until the picks are made.
  for (const action of [{ kind: 'endTurn' }, { kind: 'buyCard' }] as GameAction[])
    assert.throws(
      () => applyAction(rolled, 'blue', action, () => 0.5),
      rule('Finish the current action first'),
    );
  const picked = applyAction(rolled, 'green', { kind: 'goldPick', resources: hand({ ore: 1 }) }, () => 0.5);
  assert.equal(picked.players[2]!.hand.ore, 1);
  assert.equal(picked.bank.ore, 1);
  assert.deepEqual(newLines(rolled, picked), ['Green took 1 Rock from the bank for gold.']);
  assert.equal(picked.phase, 'actions');
  assert.deepEqual(picked.goldOwed, []);
  assert.deepEqual(accountedFor(picked), []);
});

test('§9.1 and §9.2 gold picks go one player at a time in turn order from the player on turn, all at once each', () => {
  // Red rolls; Blue's city (2 picks), Red's and Green's settlements (1 each) are on the gold field.
  const g = seaGame(sea, {
    numbers: { [GOLD_NORTH]: 5 },
    phase: 'roll',
    active: 1,
    cities: { blue: [GOLD_SE!] },
    settlements: { red: [GOLD_N!], green: [GOLD_SW!] },
  });
  const rolled = applyAction(g, 'red', { kind: 'roll' }, dice(2, 3));
  assert.deepEqual(rolled.goldOwed, [
    { player: 'red', picks: 1 },
    { player: 'green', picks: 1 },
    { player: 'blue', picks: 2 },
  ]);
  assert.ok(!rolled.log.some((line) => line.text === 'No resources produced.'), 'gold is production too');
  assert.throws(
    () => applyAction(rolled, 'green', { kind: 'goldPick', resources: hand({ wood: 1 }) }, () => 0.5),
    rule('It is not your turn to pick from a gold field'),
  );
  // Every pick in one action: exactly the number owed, of types the bank holds; picks cannot be declined.
  for (const resources of [hand(), hand({ wood: 2 })])
    assert.throws(
      () => applyAction(rolled, 'red', { kind: 'goldPick', resources }, () => 0.5),
      rule('Choose 1 resource'),
    );
  let next = applyAction(rolled, 'red', { kind: 'goldPick', resources: hand({ sheep: 1 }) }, () => 0.5);
  assert.deepEqual(owedMoves(next), [{ player: 'green', kind: 'goldPick' }]);
  next = applyAction(next, 'green', { kind: 'goldPick', resources: hand({ wheat: 1 }) }, () => 0.5);
  assert.deepEqual(owedMoves(next), [{ player: 'blue', kind: 'goldPick' }]);
  assert.equal(
    requiredAction(gameView(next, 'blue'), 'blue'),
    'goldPick',
    'the client knows whose move it is',
  );
  assert.equal(requiredAction(gameView(next, 'red'), 'red'), null);
  assert.throws(
    () => applyAction(next, 'blue', { kind: 'goldPick', resources: hand({ ore: 1 }) }, () => 0.5),
    rule('Choose 2 resources'),
  );
  const done = applyAction(
    next,
    'blue',
    { kind: 'goldPick', resources: hand({ ore: 1, brick: 1 }) },
    () => 0.5,
  );
  assert.deepEqual(newLines(next, done), ['Blue took 1 Clay, 1 Rock from the bank for gold.']);
  assert.equal(done.phase, 'actions');
  assert.equal(done.active, 1);
  assert.deepEqual(accountedFor(done), []);
  // The robber on the gold field stops it, as on any land (section 9.4).
  const robbed = applyAction({ ...g, robber: GOLD_NORTH }, 'red', { kind: 'roll' }, dice(2, 3));
  assert.deepEqual([robbed.phase, robbed.goldOwed], ['actions', []]);
});

test('§9.2 picks come from what the bank still holds, and lapse once it is empty', () => {
  const layout = {
    numbers: { [GOLD_NORTH]: 5 },
    phase: 'roll' as const,
    cities: { blue: [GOLD_SE!] },
    settlements: { green: [GOLD_N!] },
  };
  // One card left in the bank: Blue, first to pick, takes it, and Green's pick lapses.
  const g = seaGame(sea, layout);
  giveCards(g, 'red', { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 18 });
  const rolled = applyAction(g, 'blue', { kind: 'roll' }, dice(1, 4));
  assert.deepEqual(rolled.goldOwed, [
    { player: 'blue', picks: 2 },
    { player: 'green', picks: 1 },
  ]);
  assert.deepEqual(gameView(rolled, 'blue').legal.goldPick, { count: 1, types: ['ore'] });
  assert.throws(
    () => applyAction(rolled, 'blue', { kind: 'goldPick', resources: hand({ wood: 1 }) }, () => 0.5),
    rule('The bank does not have those resources'),
  );
  const last = applyAction(rolled, 'blue', { kind: 'goldPick', resources: hand({ ore: 1 }) }, () => 0.5);
  assert.deepEqual(newLines(rolled, last), [
    'Blue took 1 Rock from the bank for gold.',
    'The bank has run out of cards, so the other gold picks lapse.',
  ]);
  assert.deepEqual([last.phase, last.goldOwed], ['actions', []]);
  // An empty bank owes nobody a pick at all.
  const empty = seaGame(sea, layout);
  giveCards(empty, 'red', { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 });
  const none = applyAction(empty, 'blue', { kind: 'roll' }, dice(1, 4));
  assert.deepEqual([none.phase, none.goldOwed], ['actions', []]);
  assert.ok(newLines(empty, none).includes('The bank has no cards left, so nobody picks from a gold field.'));
});

test('§9.2 a player who resigns before picking loses the picks; the others go on, and the turn passes after', () => {
  // Four at the table, so that two may leave and the game go on.
  const g = seaGame(sea, {
    players: 4,
    numbers: { [GOLD_NORTH]: 5 },
    phase: 'roll',
    cities: { blue: [GOLD_SE!] },
    settlements: { red: [GOLD_N!], green: [GOLD_SW!] },
    hands: { green: { wood: 3 } },
  });
  const rolled = applyAction(g, 'blue', { kind: 'roll' }, dice(2, 3));
  assert.deepEqual(
    rolled.goldOwed!.map((o) => o.player),
    ['blue', 'red', 'green'],
  );
  // Green leaves before their turn to pick: their picks lapse, and their cards go back to the bank.
  const left = resignPlayers(rolled, ['green'], { reason: 'leave' });
  assert.deepEqual(
    left.goldOwed!.map((o) => o.player),
    ['blue', 'red'],
  );
  assert.equal(left.bank.wood, rolled.bank.wood + 3);
  // Blue, on turn and picking first, leaves too: Red still picks, from the bank as it stands, then Red's turn.
  const blueGone = resignPlayers(left, ['blue'], { reason: 'leave' });
  assert.deepEqual(blueGone.goldOwed, [{ player: 'red', picks: 1 }]);
  assert.deepEqual([blueGone.phase, blueGone.active], ['goldPick', 0]);
  assert.deepEqual(owedMoves(blueGone), [{ player: 'red', kind: 'goldPick' }]);
  const after = applyAction(blueGone, 'red', { kind: 'goldPick', resources: hand({ wood: 1 }) }, () => 0.5);
  assert.deepEqual([after.phase, after.active], ['roll', 1]);
  assert.ok(newLines(blueGone, after).includes("Red's turn."));
  assert.deepEqual(accountedFor(after), []);
});

test('§9.5 when the 20 seconds run out, the clock picks what the player holds fewest of, Timber first on a tie', () => {
  const g = seaGame(sea, {
    numbers: { [GOLD_NORTH]: 5 },
    phase: 'roll',
    cities: { green: [GOLD_N!] },
    hands: { green: { wood: 2, sheep: 1, ore: 3 } },
  });
  const rolled = applyAction(g, 'blue', { kind: 'roll' }, dice(2, 3));
  assert.deepEqual(rolled.goldOwed, [{ player: 'green', picks: 2 }]);
  const action = timeoutAction(rolled, 'green', () => 0.5);
  assert.deepEqual(action, { kind: 'goldPick', resources: hand({ brick: 1, wheat: 1 }) });
  assert.equal(timeoutDescription(action!, rolled.phase), 'gold picks made automatically');
  assert.equal(
    timeoutAction(rolled, 'blue', () => 0.5),
    undefined,
    'nobody else owes a move now',
  );
  const after = applyAction(rolled, 'green', action!, () => 0.5);
  assert.equal(after.phase, 'actions');
});

// A sea hex on the strait, bordering the main island's north coast and the north isle.
const STRAIT_HEX = board.edges[STRAIT]!.hexes[0]!;

test('§10.2 and §10.5 after a seven Blue moves the robber or the pirate, and the pirate robs a ship’s owner', () => {
  const redShip = hexEdges(board, STRAIT_HEX).find((e) => e !== STRAIT && takesShip(edgeKind(board, e)))!;
  // Green has a settlement on the strait's coast, and no ship there.
  const greenCorner = board.hexes[STRAIT_HEX]!.vertices.find(
    (v) =>
      isCoastalIntersection(board, v) &&
      v !== NORTH_COAST &&
      !board.vertices[NORTH_COAST]!.neighbors.includes(v),
  )!;
  const table = (red: Partial<ReturnType<typeof hand>>) =>
    applyAction(
      seaGame(sea, {
        phase: 'roll',
        settlements: { blue: [NORTH_COAST], green: [greenCorner] },
        ships: { red: [redShip], blue: [STRAIT] },
        hands: { red, green: { ore: 2 } },
      }),
      'blue',
      { kind: 'roll' },
      dice(3, 4),
    );
  const rolled = table({ wheat: 2 });
  assert.equal(rolled.phase, 'robber');
  const legal = gameView(rolled, 'blue').legal;
  assert.deepEqual(
    legal.robberHexes,
    board.hexes.filter((h) => isLand(h) && h.id !== rolled.robber).map((h) => h.id),
  );
  assert.deepEqual(
    legal.pirateHexes,
    board.hexes.filter((h) => !isLand(h) && h.id !== rolled.pirate).map((h) => h.id),
  );
  assert.equal(gameView(rolled, 'red').legal.robberHexes, undefined);
  // The robber stays on land, the pirate at sea, and neither stays where it is.
  assert.throws(
    () => applyAction(rolled, 'blue', { kind: 'robber', hex: STRAIT_HEX }, () => 0.5),
    rule('Move the robber to a land tile'),
  );
  for (const hex of [MOUNTAINS, rolled.pirate!])
    assert.throws(
      () => applyAction(rolled, 'blue', { kind: 'pirate', hex }, () => 0.5),
      rule('Move the pirate to a different sea hex'),
    );
  // Only a ship makes a target: Green's coastal settlement does not, nor Blue's own ship. The theft is compulsory.
  assert.deepEqual(pirateVictims(rolled, 'blue', STRAIT_HEX), ['red']);
  for (const victim of [undefined, 'green', 'blue'])
    assert.throws(
      () =>
        applyAction(
          rolled,
          'blue',
          { kind: 'pirate', hex: STRAIT_HEX, ...(victim ? { victim } : {}) },
          () => 0.5,
        ),
      rule('Choose one player with a ship on this hex'),
    );
  const robbed = applyAction(rolled, 'blue', { kind: 'pirate', hex: STRAIT_HEX, victim: 'red' }, () => 0.5);
  assert.equal(robbed.pirate, STRAIT_HEX);
  assert.equal(robbed.robber, rolled.robber, 'exactly one of them moves');
  assert.deepEqual([robbed.players[0]!.hand.wheat, robbed.players[1]!.hand.wheat], [1, 1]);
  assert.deepEqual(newLines(rolled, robbed), ['Blue moved the pirate and stole a card from Red.']);
  assert.equal(robbed.phase, 'actions');
  assert.throws(
    () => applyAction(robbed, 'blue', { kind: 'robber', hex: MOUNTAINS }, () => 0.5),
    rule('Move the robber to a different tile'),
  );
  // Nobody's ships there, a victim with no cards, and a resigned player are the plain cases.
  const open = board.hexes.find(
    (h) => !isLand(h) && h.id !== rolled.pirate && !pirateVictims(rolled, 'blue', h.id).length,
  )!.id;
  const quiet = applyAction(rolled, 'blue', { kind: 'pirate', hex: open }, () => 0.5);
  assert.deepEqual(newLines(rolled, quiet), ['Blue moved the pirate.']);
  const broke = table({});
  const nothing = applyAction(broke, 'blue', { kind: 'pirate', hex: STRAIT_HEX, victim: 'red' }, () => 0.5);
  assert.deepEqual(newLines(broke, nothing), ['Blue moved the pirate. Red had no resource cards.']);
  const gone = resignPlayers(rolled, ['red'], { reason: 'leave' });
  assert.deepEqual(pirateVictims(gone, 'blue', STRAIT_HEX), []);
  assert.doesNotThrow(() => applyAction(gone, 'blue', { kind: 'pirate', hex: STRAIT_HEX }, () => 0.5));
  // In Classic there is no pirate.
  const classic = createGame(SEATS.slice(0, 3), 5, () => 0.5);
  Object.assign(classic, { turn: 1, phase: 'robber', setupIndex: 6 });
  assert.throws(
    () => applyAction(classic, 'blue', { kind: 'pirate', hex: 1 }, () => 0.5),
    rule('That action is unavailable'),
  );
});

test('§10.3 and §13.1 a Knight gives the same choice, before the roll too, with no discards', () => {
  const g = seaGame(sea, {
    phase: 'roll',
    ships: { red: [STRAIT] },
    hands: { red: { brick: 1 }, blue: { wood: 9 } },
  });
  g.players[0]!.cards = [{ id: 'card-0', kind: 'knight', boughtTurn: 0 }];
  g.deck = g.deck.slice(1);
  g.nextCard = 1;
  const knight = applyAction(g, 'blue', { kind: 'playCard', cardId: 'card-0' }, () => 0.5);
  assert.deepEqual([knight.phase, knight.returnPhase, knight.discards], ['robber', 'roll', {}]);
  assert.equal(knight.players[0]!.knights, 1);
  const moved = applyAction(knight, 'blue', { kind: 'pirate', hex: STRAIT_HEX, victim: 'red' }, () => 0.5);
  assert.equal(moved.phase, 'roll');
  assert.equal(moved.players[0]!.hand.brick, 1);
});

test('§13.2 Road Building places two roads, two ships or one of each; a free ship counts as built this turn', () => {
  const g = seaGame(sea, { settlements: { blue: [NORTH_COAST] } });
  g.players[0]!.cards = [{ id: 'card-0', kind: 'roadBuilding', boughtTurn: 0 }];
  g.deck = g.deck.slice(1);
  g.nextCard = 1;
  const played = applyAction(g, 'blue', { kind: 'playCard', cardId: 'card-0' }, () => 0.5);
  assert.deepEqual([played.phase, played.freeRoads], ['freeRoads', 2]);
  const legal = gameView(played, 'blue').legal;
  assert.ok(legal.roads.length > 0 && legal.ships!.includes(STRAIT));
  const ship = applyAction(played, 'blue', { kind: 'ship', edge: STRAIT }, () => 0.5);
  assert.deepEqual(newLines(played, ship), [`Blue built a free ship on edge ${STRAIT + 1}.`]);
  assert.deepEqual([ship.phase, ship.freeRoads, ship.shipsBuiltThisTurn], ['freeRoads', 1, [STRAIT]]);
  assert.equal(total(ship.players[0]!.hand), 0, 'free');
  // Nothing comes between the two placements: no trade, no paid build, no ship move.
  for (const action of [
    { kind: 'bankTrade', give: 'wood', receive: 'ore' },
    { kind: 'moveShip', from: STRAIT, to: edgeBetween(LANDING, 40) },
    { kind: 'buyCard' },
  ] as GameAction[])
    assert.throws(() => applyAction(ship, 'blue', action, () => 0.5), RuleError, action.kind);
  // A second ship may join the first; a road may not.
  const [along] = south(LANDING, 42);
  assert.ok(gameView(ship, 'blue').legal.ships!.includes(along!));
  assert.throws(
    () => applyAction(ship, 'blue', { kind: 'road', edge: along! }, () => 0.5),
    rule('Choose a legal road site'),
  );
  const road = gameView(ship, 'blue').legal.roads[0]!;
  const done = applyAction(ship, 'blue', { kind: 'road', edge: road }, () => 0.5);
  assert.deepEqual([done.phase, done.freeRoads], ['actions', 0]);
  assert.throws(
    () =>
      applyAction(done, 'blue', { kind: 'moveShip', from: STRAIT, to: edgeBetween(LANDING, 40) }, () => 0.5),
    rule('A ship cannot move on the turn it was built'),
  );
  // With all 15 roads on the board, only ships: Classic would refuse the card, Open Sea places them.
  const noRoads = structuredClone(g);
  for (const e of board.edges.filter((e) => edgeKind(board, e.id) === 'land').slice(0, 15))
    noRoads.roads[e.id] = 'blue';
  assert.deepEqual(gameView({ ...noRoads, phase: 'freeRoads' }, 'blue').legal.roads, []);
  const onlyShips = applyAction(noRoads, 'blue', { kind: 'playCard', cardId: 'card-0' }, () => 0.5);
  assert.deepEqual([onlyShips.phase, onlyShips.freeRoads], ['freeRoads', 2]);
  assert.deepEqual(gameView(onlyShips, 'blue').legal.roads, []);
  assert.ok(gameView(onlyShips, 'blue').legal.ships!.includes(STRAIT));
  // With nowhere at all for a piece, the card cannot be played.
  const stuck = seaGame(sea, {});
  stuck.players[0]!.cards = g.players[0]!.cards;
  assert.throws(
    () => applyAction(stuck, 'blue', { kind: 'playCard', cardId: 'card-0' }, () => 0.5),
    rule('No legal road or ship is available'),
  );
});

test('§14 ships, the pirate, gold owed and island bonuses are public; a stolen card stays private', () => {
  const g = seaGame(sea, {
    settlements: { blue: [NORTH_COAST] },
    ships: { blue: [STRAIT] },
    pirate: STRAIT_HEX,
  });
  g.islandBonuses = { blue: ['a'] };
  g.goldOwed = [];
  const red = gameView(g, 'red');
  assert.deepEqual(red.ships, { [STRAIT]: 'blue' });
  assert.equal(red.pirate, STRAIT_HEX);
  assert.deepEqual(red.islandBonuses, { blue: ['a'] });
  assert.deepEqual(red.goldOwed, []);
  assert.deepEqual(red.players[0]!.pieces, { roads: 0, settlements: 1, cities: 0, ships: 1 });
  assert.deepEqual(
    red.players[0]!.terms.find((term) => term.id === 'islandBonus'),
    {
      id: 'islandBonus',
      points: 2,
      count: 1,
    },
  );
  // Not Red's turn: Red is offered nothing to build, move or pick.
  assert.deepEqual([red.legal.ships, red.legal.shipMoves, red.legal.shipMoveBlocks], [[], {}, {}]);
});

test('§15.3 the clock always moves the robber, never the pirate, and places owed Road Building pieces as roads first', () => {
  const g = seaGame(sea, {
    phase: 'robber',
    settlements: { red: [MOUNTAIN_SW] },
    ships: { red: [STRAIT] },
    hands: { red: { wood: 2 } },
  });
  for (let seed = 1; seed <= 60; seed++) {
    const action = timeoutAction(g, 'blue', seededRandom(seed))!;
    assert.equal(action.kind, 'robber');
    if (action.kind !== 'robber') continue;
    assert.ok(isLand(board.hexes[action.hex]!) && action.hex !== g.robber);
    assert.doesNotThrow(() => applyAction(g, 'blue', action, seededRandom(seed)));
  }
  // Owed free pieces: a road wherever one can go, else a ship, else the piece is dropped.
  const free = seaGame(sea, { phase: 'freeRoads', settlements: { blue: [NORTH_COAST] } });
  free.freeRoads = 2;
  assert.equal(timeoutAction(free, 'blue', () => 0.5)!.kind, 'road');
  assert.equal(
    timeoutDescription({ kind: 'ship', edge: 1 }, 'freeRoads'),
    'remaining free ship placed automatically',
  );
  const boxedIn = structuredClone(free);
  for (const e of board.vertices[NORTH_COAST]!.edges.filter((e) => edgeKind(board, e) === 'coastal'))
    boxedIn.roads[e] = 'red';
  const ship = timeoutAction(boxedIn, 'blue', () => 0.5)!;
  assert.deepEqual(ship, { kind: 'ship', edge: STRAIT });
  const after = applyAction(boxedIn, 'blue', ship, () => 0.5);
  assert.equal(after.ships![STRAIT], 'blue');
  // The setup piece likewise: a road beside the new settlement, else a ship.
  const setup = seaGame(sea, { phase: 'setupRoad', settlements: { blue: [NORTH_COAST] } });
  Object.assign(setup, { turn: 0, setupIndex: 0, setupVertex: NORTH_COAST });
  for (const e of board.vertices[NORTH_COAST]!.edges.filter((e) => edgeKind(board, e) === 'coastal'))
    setup.roads[e] = 'red';
  assert.deepEqual(
    timeoutAction(setup, 'blue', () => 0.5),
    { kind: 'ship', edge: STRAIT },
  );
  assert.equal(
    timeoutDescription({ kind: 'ship', edge: STRAIT }, 'setupRoad'),
    'starting ship placed automatically',
  );
});

test('the new moves are parsed like the others, and a Classic game refuses each of them', () => {
  assert.deepEqual(parseGameAction({ kind: 'ship', edge: 3, extra: 1 }), { kind: 'ship', edge: 3 });
  assert.deepEqual(parseGameAction({ kind: 'moveShip', from: 1, to: 2 }), {
    kind: 'moveShip',
    from: 1,
    to: 2,
  });
  assert.deepEqual(parseGameAction({ kind: 'pirate', hex: 4 }), { kind: 'pirate', hex: 4 });
  assert.deepEqual(parseGameAction({ kind: 'pirate', hex: 4, victim: 'red' }), {
    kind: 'pirate',
    hex: 4,
    victim: 'red',
  });
  assert.deepEqual(parseGameAction({ kind: 'goldPick', resources: hand({ ore: 2 }) }), {
    kind: 'goldPick',
    resources: hand({ ore: 2 }),
  });
  for (const bad of [
    { kind: 'ship', edge: -1 },
    { kind: 'moveShip', from: 1 },
    { kind: 'moveShip', from: 1.5, to: 2 },
    { kind: 'pirate', hex: 'x' },
    { kind: 'goldPick', resources: { ...hand(), gold: 1 } },
    { kind: 'goldPick', resources: { ore: 2 } },
    { kind: 'goldPick' },
  ])
    assert.throws(() => parseGameAction(bad), RuleError, JSON.stringify(bad));
  // The socket's message parser takes them as it takes every other move.
  const message = (action: unknown) =>
    parseClientMessage(
      JSON.stringify({ type: 'action', commandId: 'command-1', expectedRevision: 3, action }),
    );
  assert.deepEqual(message({ kind: 'moveShip', from: 5, to: 9 }), {
    type: 'action',
    commandId: 'command-1',
    expectedRevision: 3,
    action: { kind: 'moveShip', from: 5, to: 9 },
  });
  assert.throws(() => message({ kind: 'moveShip', from: 5 }), RuleError);
  const classic = createGame(SEATS.slice(0, 3), 5, () => 0.5);
  Object.assign(classic, { turn: 1, phase: 'actions', setupIndex: 6 });
  assert.throws(
    () => applyAction(classic, 'red', { kind: 'goldPick', resources: hand({ ore: 1 }) }, () => 0.5),
    rule('Nobody is picking from a gold field now'),
  );
  assert.deepEqual(owedMoves(classic), [{ player: 'blue', kind: 'actions' }]);
});

// Guards the first review found no test for, each by its section, and what a resignation or a win must end.

test('§9.2 and §12.3 a resignation during gold picks that hands the player on turn the win ends the picks too', () => {
  // Blue, on turn, has two cities and four hidden Victory Point cards: 8 of a target of 10. Blue and Orange have
  // played three Knights each, and Orange holds Largest Army on the tie. Red is owed a pick from a gold field.
  const g = afterSetup(4, 11, { victoryPoints: 10 });
  for (const [v, building] of Object.entries(g.buildings))
    if (building.player === 'blue') g.buildings[Number(v)] = { player: 'blue', kind: 'city' };
  dealCards(g, 'blue', 'victoryPoint', 4);
  dealCards(g, 'blue', 'knight', 3, true);
  dealCards(g, 'orange', 'knight', 3, true);
  g.largestArmy = 'orange';
  const { random } = rigGold(g, ['red']);
  assert.deepEqual(gameInvariantProblems(g), []);
  assert.equal(score(g, g.players[0]!), 8);
  const rolled = applyAction(g, 'blue', { kind: 'roll' }, random);
  assert.deepEqual([rolled.phase, rolled.goldOwed], ['goldPick', [{ player: 'red', picks: 1 }]]);
  // Orange leaves while Red picks: Largest Army passes to Blue, who has 10 on their own turn and wins at once.
  const left = resignPlayers(rolled, ['orange'], { reason: 'leave' });
  assert.deepEqual([left.phase, left.winner, left.largestArmy], ['finished', 'blue', 'blue']);
  assert.deepEqual(newLines(rolled, left).slice(-2), [
    'Blue claimed Largest Army (+2 points).',
    'Blue wins with 10 points!',
  ]);
  // Nobody picks in a finished game, and the restore verifier finds nothing wrong with it.
  assert.deepEqual(left.goldOwed, []);
  assert.deepEqual(owedMoves(left), []);
  assert.deepEqual(gameInvariantProblems(left), []);
  assert.throws(
    () => applyAction(left, 'red', { kind: 'goldPick', resources: hand({ ore: 1 }) }, () => 0.5),
    rule('The game has ended'),
  );
});

test('§9.2 a pick is never empty, even in a state that owes one from an empty bank', () => {
  const g = afterSetup(3, 41);
  Object.assign(g, { phase: 'goldPick', goldOwed: [{ player: 'blue', picks: 1 }] });
  for (const r of RESOURCES) {
    g.players[1]!.hand[r] += g.bank[r];
    g.bank[r] = 0;
  }
  assert.throws(
    () => applyAction(g, 'blue', { kind: 'goldPick', resources: hand() }, () => 0.5),
    rule('Choose at least one resource'),
  );
});

test('§13.2 a free ship that makes the longest route claims it at once, and a win with it; the log says so in order', () => {
  // Blue's cities on the north coast and at the west end, and four ships from the first, across the strait and
  // round the north isle's west end.
  const [west] = south(LANDING, 40);
  const out = board.vertices[40]!.edges.find((e) => edgeKind(board, e) === 'sea')!;
  const tip = other(out, 40);
  const onward = board.vertices[tip]!.edges.find((e) => e !== out && takesShip(edgeKind(board, e)))!;
  const layout = { cities: { blue: [NORTH_COAST, 52] }, ships: { blue: [STRAIT, west!, out, onward] } };
  const table = (target: number, cards: number) => {
    const g = seaGame(sea, layout);
    g.victoryPoints = target;
    dealCards(g, 'blue', 'roadBuilding', 1);
    dealCards(g, 'blue', 'victoryPoint', cards);
    return applyAction(g, 'blue', { kind: 'playCard', cardId: g.players[0]!.cards[0]!.id }, () => 0.5);
  };
  const end = other(onward, tip);
  // With 4 points and a long way to go: the first free ship claims Longest Route before the second is placed.
  const played = table(14, 0);
  assert.equal(longestRoute(played, 'blue').length, 4);
  const ship = gameView(played, 'blue').legal.ships!.find((e) =>
    [board.edges[e]!.a, board.edges[e]!.b].includes(end),
  )!;
  const claimed = applyAction(played, 'blue', { kind: 'ship', edge: ship }, () => 0.5);
  assert.deepEqual([claimed.phase, claimed.freeRoads, claimed.longestRoad], ['freeRoads', 1, 'blue']);
  // With 8 of 10, the same ship wins before the second piece; the ship is logged first, as a bought one is.
  const winning = table(10, 4);
  const won = applyAction(winning, 'blue', { kind: 'ship', edge: ship }, () => 0.5);
  assert.deepEqual([won.phase, won.winner], ['finished', 'blue']);
  assert.deepEqual(newLines(winning, won), [
    `Blue built a free ship on edge ${ship + 1}.`,
    'Blue claimed Longest Route (+2 points).',
    'Blue wins with 10 points!',
  ]);
});

test('§15.6 the last player left, offline, starts a turn with no ship built or moved in it', () => {
  const g = afterSetup(3, 1);
  Object.assign(g, { phase: 'actions', dice: [2, 3] });
  giveCards(g, 'blue', { wood: 1, sheep: 1 });
  const edge = gameView(g, 'blue').legal.ships![0]!;
  const built = applyAction(g, 'blue', { kind: 'ship', edge }, () => 0.5);
  assert.deepEqual(built.shipsBuiltThisTurn, [edge]);
  // Blue and Green leave while Red, the only one left, is offline: the game waits for Red's return.
  const alone = resignPlayers(built, ['blue', 'green'], { reason: 'leave', winnerEligibleIds: [] });
  assert.deepEqual(
    [alone.phase, alone.players[alone.active]!.id, alone.shipsBuiltThisTurn, alone.shipMovedThisTurn],
    ['roll', 'red', [], false],
  );
  assert.equal(alone.ships![edge], 'blue', 'the ship stays on the board');
  assert.deepEqual(gameInvariantProblems(alone), []);
});
