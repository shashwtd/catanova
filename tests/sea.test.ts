/**
 * Open Sea's board, pieces, pirate and awards: sections 2, 3, 5, 7 and 10–14 of docs/RULEBOOK-OPEN-SEA.md. Moving
 * ships is tested in sea-ships.test.ts and gold fields in gold.test.ts. "You" are blue; red and green are others.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLand, seededRandom } from '../packages/rules/src/board.js';
import type { Board } from '../packages/rules/src/board.js';
import { longestTrail, tradeRate } from '../packages/rules/src/game.js';
import { COSTS, SUPPLY } from '../packages/rules/src/index.js';
import {
  ISLAND_BONUS,
  LONGEST_ROUTE,
  MAIN_ISLAND,
  SEA_COSTS,
  SEA_LOG,
  SEA_SUPPLY,
  SHIP_MOVE_BLOCKS,
  canPlaceRoadOpenSea,
  canPlaceShip,
  edgeKind,
  hexEdges,
  isCoastalIntersection,
  isLandIntersection,
  islandBonusForSettlement,
  islandBonusPoints,
  knightTargets,
  longestRoute,
  longestRouteHolder,
  pirateBlocksEdge,
  pirateHexes,
  pirateMoveIssue,
  pirateVictims,
  placeSettlement,
  placeShip,
  producedResource,
  roadBuildingSites,
  roadSitesOpenSea,
  robberHexes,
  settlementSitesOpenSea,
  shipMoveBlock,
  shipSites,
  takesRoad,
  takesShip,
  vertexIsland,
} from '../packages/rules/src/sea.js';
import type { EdgeKind, SeaBoard, SeaState } from '../packages/rules/src/sea.js';
import {
  corner,
  edgeBetween,
  edgesAlong,
  narrows,
  outerIslesFour,
  outerIslesThree,
  playRandomly,
  sketch,
  state,
  strait,
  walk,
} from './sea-boards.js';

const sorted = (ids: Iterable<number>) => [...ids].sort((x, y) => x - y);
const at = (board: SeaBoard, vertex: number) => board.vertices[vertex]!.edges;
const kinds = (board: SeaBoard) => {
  const count: Partial<Record<EdgeKind, number>> = {};
  for (const e of board.edges) count[edgeKind(board, e.id)] = (count[edgeKind(board, e.id)] ?? 0) + 1;
  return count;
};
/** The strait board's islet, and your settlement H on the bay, with the sea route between them. */
function straitIslet() {
  const sk = strait(),
    { board } = sk;
  const islet = board.hexes.find((h) => h.island === 'a')!.id;
  const H = corner(board, sk.hex('1'), 'nw');
  return { sk, board, islet, H, route: walk(board, H, 'ne', 'se', 's', 'se') };
}

test('§2.1 gold fields and deserts are land, the sea produces nothing, and the ring of sea is on the board', () => {
  for (const terrain of ['wood', 'brick', 'sheep', 'wheat', 'ore', 'desert', 'gold'])
    assert.ok(isLand({ terrain }), terrain);
  assert.ok(!isLand({ terrain: 'sea' }));
  assert.equal(producedResource({ terrain: 'wheat' }), 'wheat');
  for (const terrain of ['desert', 'gold', 'sea']) assert.equal(producedResource({ terrain }), null);
  // No frame: the outermost hexes are all sea hexes of the board, 30 of them round Outer Isles for three.
  const { board } = outerIslesThree();
  const ring = board.hexes.filter((h) => hexEdges(board, h.id).some((e) => edgeKind(board, e) === 'rim'));
  assert.equal(ring.length, 30);
  assert.ok(ring.every((h) => h.terrain === 'sea'));
  assert.equal(board.hexes.filter((h) => h.terrain === 'sea').length, 48);
});

test('§2.2 and §2.3 land, coastal and sea intersections, each land intersection on exactly one island', () => {
  for (const { board } of [outerIslesThree(), outerIslesFour()])
    for (const v of board.vertices) {
      const land = v.hexes.filter((h) => isLand(board.hexes[h]!));
      assert.equal(isLandIntersection(board, v.id), land.length > 0);
      assert.equal(isCoastalIntersection(board, v.id), land.length > 0 && land.length < v.hexes.length);
      // Islands never touch, so a land intersection's land hexes share their island.
      assert.equal(new Set(land.map((h) => board.hexes[h]!.island)).size, land.length ? 1 : 0);
      assert.equal(vertexIsland(board, v.id), land.length ? board.hexes[land[0]!]!.island : undefined);
    }
  const { board } = outerIslesThree();
  assert.equal(board.vertices.filter((v) => vertexIsland(board, v.id) === MAIN_ISLAND).length, 51);
});

test('§2.3 the distance rule counts every kind of edge, a sea edge across a narrow strait included', () => {
  const sk = narrows(),
    { board } = sk;
  // The one sea edge that joins a corner of each island.
  const strait = board.edges.filter(
    (e) =>
      edgeKind(board, e.id) === 'sea' &&
      isLandIntersection(board, e.a) &&
      isLandIntersection(board, e.b) &&
      vertexIsland(board, e.a) !== vertexIsland(board, e.b),
  );
  assert.equal(strait.length, 1);
  const [x, y] =
    vertexIsland(board, strait[0]!.a) === MAIN_ISLAND
      ? [strait[0]!.a, strait[0]!.b]
      : [strait[0]!.b, strait[0]!.a];
  // Your ship touches y from along the small island's coast; red's settlement stands across the strait at x.
  const coast = at(board, y).find((e) => edgeKind(board, e) === 'coastal')!;
  const yours = state(sk, { ships: { blue: [coast] } });
  assert.ok(settlementSitesOpenSea(yours, 'blue').includes(y));
  const across = { ...yours, buildings: { [x]: { player: 'red', kind: 'settlement' as const } } };
  assert.ok(!settlementSitesOpenSea(across, 'blue').includes(y));
});

test('§2.4 roads go on land and coastal edges, ships on coastal and sea edges, and nothing on the rim', () => {
  assert.deepEqual(
    (['land', 'coastal', 'sea', 'rim'] as const).map((k) => [takesRoad(k), takesShip(k)]),
    [
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ],
  );
  // The counts docs/MAP_GENERATION.md gives for the two Outer Isles templates.
  const three = outerIslesThree().board,
    four = outerIslesFour().board;
  assert.deepEqual([three.vertices.length, three.edges.length], [178, 249]);
  assert.deepEqual(kinds(three), { rim: 66, sea: 74, coastal: 74, land: 35 });
  assert.deepEqual([four.vertices.length, four.edges.length], [190, 266]);
  assert.equal(kinds(four).rim, 70);
  assert.equal((kinds(four).coastal ?? 0) + (kinds(four).sea ?? 0), 150);
  for (const [board, edges, facing] of [
    [three, 36, 21],
    [four, 40, 23],
  ] as const) {
    const coast = board.edges.filter(
      (e) =>
        edgeKind(board, e.id) === 'coastal' && e.hexes.some((h) => board.hexes[h]!.island === MAIN_ISLAND),
    );
    assert.equal(coast.length, edges);
    assert.equal(new Set(coast.flatMap((e) => e.hexes.filter((h) => !isLand(board.hexes[h]!)))).size, facing);
    // The rim is the outline of the sea ring: no land hex has a rim edge.
    for (const e of board.edges.filter((e) => edgeKind(board, e.id) === 'rim'))
      assert.ok(e.hexes.length === 1 && !isLand(board.hexes[e.hexes[0]!]!));
  }
  // Whatever is on the board, no site offered breaks the table.
  const table = playRandomly(
    outerIslesThree(),
    ['red', 'blue', 'green'],
    seededRandom(5),
    { turns: 30 },
    () => {},
  );
  for (const p of ['red', 'blue', 'green']) {
    for (const e of roadSitesOpenSea(table, p)) assert.ok(takesRoad(edgeKind(table.board, e)));
    for (const e of shipSites(table, p, 'build')) assert.ok(takesShip(edgeKind(table.board, e)));
  }
  for (const [e, p] of Object.entries(table.roads))
    assert.ok(takesRoad(edgeKind(table.board, +e)), `road of ${p}`);
  for (const [e, p] of Object.entries(table.ships ?? {}))
    assert.ok(takesShip(edgeKind(table.board, +e)), `ship of ${p}`);
});

test('§2.4 a land hex left on the outline of a board gets nothing on its outer edges either', () => {
  const sk = sketch('T .'),
    { board } = sk;
  const land = board.hexes.findIndex((h) => isLand(h));
  const outer = board.hexes[land]!.vertices.find((v) => board.vertices[v]!.hexes.length === 1)!;
  assert.ok(at(board, outer).every((e) => edgeKind(board, e) === 'rim'));
  const g = state(sk, { settlements: { blue: [outer] } });
  assert.deepEqual(roadSitesOpenSea(g, 'blue', outer), []);
  assert.deepEqual(shipSites(g, 'blue', { setup: outer }), []);
});

test('§2.5 a harbour edge is an ordinary coastal edge: a ship may stand on it, and gives no harbour', () => {
  const { sk, board, H } = straitIslet();
  const harbour = edgeBetween(board, H, walk(board, H, 's')[1]!);
  assert.equal(edgeKind(board, harbour), 'coastal');
  const far = corner(board, sk.hex('4'), 'se');
  const g = state(sk, { settlements: { blue: [far] }, ships: { blue: [] } });
  const withHarbour = {
    ...g,
    board: { ...board, seed: 0, preset: 'balanced-v2', ports: [{ edge: harbour, resource: 'any' }] },
  };
  const beside = {
    ...withHarbour,
    buildings: { ...g.buildings, [H]: { player: 'blue', kind: 'settlement' as const } },
  };
  assert.ok(shipSites(beside, 'blue', 'build').includes(harbour));
  assert.ok(roadSitesOpenSea(beside, 'blue').includes(harbour));
  // Classic's harbour rule is unchanged: your building on its corner gives the rate; your ship on it does not.
  const rate = (s: SeaState) =>
    tradeRate(
      s as unknown as { board: Board; buildings: SeaState['buildings']; roads: SeaState['roads'] },
      'blue',
      'ore',
    );
  assert.equal(rate({ ...withHarbour, ships: { [harbour]: 'blue' } }), 4);
  assert.equal(rate(beside), 3);
});

test('§3 a ship costs 1 Timber and 1 Sheep, each player has 15, and Classic’s own tables have no ship', () => {
  assert.deepEqual(SEA_COSTS.ship, { wood: 1, brick: 0, sheep: 1, wheat: 0, ore: 0 });
  assert.deepEqual(SEA_SUPPLY, { resourcesPerType: 19, roads: 15, ships: 15, settlements: 5, cities: 4 });
  for (const kind of Object.keys(COSTS) as (keyof typeof COSTS)[])
    assert.deepEqual(SEA_COSTS[kind], COSTS[kind]);
  assert.ok(!('ship' in COSTS) && !('ships' in SUPPLY));
  // With all 15 ships on the board you cannot build another; the same for roads.
  const sk = outerIslesThree(),
    { board } = sk;
  const home = board.vertices.find(
    (v) => isCoastalIntersection(board, v.id) && vertexIsland(board, v.id) === MAIN_ISLAND,
  )!.id;
  const elsewhere = board.edges
    .filter(
      (e) =>
        takesShip(edgeKind(board, e.id)) &&
        ![e.a, e.b].some((v) => board.vertices[home]!.neighbors.includes(v) || v === home),
    )
    .map((e) => e.id);
  const fleet = (n: number) =>
    state(sk, { settlements: { blue: [home] }, ships: { blue: elsewhere.slice(0, n) } });
  assert.ok(shipSites(fleet(14), 'blue', 'build').length > 0);
  assert.deepEqual(shipSites(fleet(15), 'blue', 'build'), []);
  assert.throws(() =>
    placeShip(
      fleet(15),
      'blue',
      at(board, home).find((e) => takesShip(edgeKind(board, e)))!,
      'build',
    ),
  );
  const roads = board.edges.filter((e) => takesRoad(edgeKind(board, e.id))).map((e) => e.id);
  assert.deepEqual(
    roadSitesOpenSea(
      { ...fleet(0), roads: Object.fromEntries(roads.slice(0, 15).map((e) => [e, 'blue'])) },
      'blue',
    ),
    [],
  );
});

test('§5.3 starting settlements go only on the main island, by the distance rule', () => {
  const sk = outerIslesThree(),
    { board } = sk;
  let g = state(sk);
  const sites = settlementSitesOpenSea(g, 'blue', true);
  assert.equal(sites.length, 51);
  assert.ok(sites.every((v) => vertexIsland(board, v) === MAIN_ISLAND));
  g = { ...g, ...placeSettlement(g, 'blue', sites[10]!, true) };
  const next = settlementSitesOpenSea(g, 'red', true);
  assert.ok(
    !next.includes(sites[10]!) && board.vertices[sites[10]!]!.neighbors.every((n) => !next.includes(n)),
  );
  assert.throws(() =>
    placeSettlement(g, 'red', board.vertices.find((v) => vertexIsland(board, v.id) === 'a')!.id, true),
  );
});

test('§5.4 after a starting settlement: a road touching it, or on the coast a ship there, never on the pirate’s edges', () => {
  const sk = outerIslesThree(),
    { board } = sk;
  const main = board.vertices.filter((v) => vertexIsland(board, v.id) === MAIN_ISLAND).map((v) => v.id);
  const coastal = main.find(
    (v) => isCoastalIntersection(board, v) && at(board, v).some((e) => edgeKind(board, e) === 'sea'),
  )!;
  const inland = main.find((v) => !isCoastalIntersection(board, v))!;
  const g = state(sk, { settlements: { blue: [coastal, inland] } });
  assert.deepEqual(
    roadSitesOpenSea(g, 'blue', coastal),
    at(board, coastal).filter((e) => takesRoad(edgeKind(board, e))),
  );
  assert.deepEqual(
    shipSites(g, 'blue', { setup: coastal }),
    sorted(at(board, coastal).filter((e) => takesShip(edgeKind(board, e)))),
  );
  assert.deepEqual(shipSites(g, 'blue', { setup: inland }), [], 'only a coastal settlement may take a ship');
  assert.equal(roadSitesOpenSea(g, 'blue', inland).length, 3);
  // Either settlement, both or neither: a ship at the coastal one leaves the other's road free.
  const after = {
    ...g,
    ...placeShip(g, 'blue', shipSites(g, 'blue', { setup: coastal })[0]!, { setup: coastal }),
  };
  assert.equal(roadSitesOpenSea(after, 'blue', inland).length, 3);
  // With the pirate beside the settlement, the edges of its hex are refused.
  const seaHex = board.vertices[coastal]!.hexes.find((h) => !isLand(board.hexes[h]!))!;
  const guarded = { ...g, pirate: seaHex };
  const ships = shipSites(guarded, 'blue', { setup: coastal });
  assert.ok(ships.every((e) => !board.edges[e]!.hexes.includes(seaHex)));
  assert.ok(ships.length < shipSites(g, 'blue', { setup: coastal }).length);
});

test('§5.4 wherever the pirate stands, no setup ship is ever offered on its edges', () => {
  for (const sk of [outerIslesThree(), outerIslesFour()]) {
    const { board } = sk;
    const main = board.vertices.filter((v) => vertexIsland(board, v.id) === MAIN_ISLAND).map((v) => v.id);
    for (const pirate of pirateHexes(board))
      for (const v of main) {
        const g: SeaState = { ...state(sk, { settlements: { blue: [v] } }), pirate };
        for (const e of shipSites(g, 'blue', { setup: v })) assert.ok(!pirateBlocksEdge(g, e));
      }
    // The template's own start touches no land, so it never takes a starting ship away.
    const start = sk.pirate!;
    assert.ok(board.hexes[start]!.vertices.every((v) => !isLandIntersection(board, v)));
  }
});

test('§5.6 setup earns no island bonus and builds nothing that counts as built this turn', () => {
  const { sk, board, islet } = straitIslet();
  const g = state(sk);
  assert.equal(islandBonusForSettlement(g, 'blue', corner(board, islet, 'n'), true), null);
  assert.equal(islandBonusForSettlement(g, 'blue', corner(board, islet, 'n'), false), 'a');
  const coast = corner(board, sk.hex('1'), 'nw');
  const placed = { ...g, ...placeSettlement(g, 'blue', coast, true) };
  assert.deepEqual(placed.islandBonuses, {});
  assert.deepEqual(
    placeShip(placed, 'blue', shipSites(placed, 'blue', { setup: coast })[0]!, { setup: coast })
      .shipsBuiltThisTurn,
    [],
  );
});

test('§7.1 a new ship touches your building or your ship, never through another player’s building or by a road', () => {
  const { sk, board, H } = straitIslet();
  let g = state(sk, { settlements: { blue: [H] } });
  assert.deepEqual(
    shipSites(g, 'blue', 'build'),
    sorted(at(board, H)),
    'every edge at your coastal settlement',
  );
  // A ship along the coast to a, then another from a: a ship connects to your ship.
  const [, a, b] = walk(board, H, 's', 'se');
  const Ha = edgeBetween(board, H, a!),
    ab = edgeBetween(board, a!, b!);
  g = { ...g, ...placeShip(g, 'blue', Ha, 'build') };
  assert.ok(shipSites(g, 'blue', 'build').includes(ab));
  assert.ok(!canPlaceShip(g, 'blue', Ha, 'build'), 'not on an edge already taken');
  // Where another player's settlement stands, your ship there connects to no new one.
  const line = state(sk, { settlements: { blue: [H] }, ships: { blue: [Ha, ab] } });
  const cut = state(sk, { settlements: { blue: [H], red: [b!] }, ships: { blue: [Ha, ab] } });
  const beyond = at(board, b!).filter((e) => e !== ab);
  assert.ok(beyond.every((e) => shipSites(line, 'blue', 'build').includes(e)));
  assert.ok(beyond.every((e) => !shipSites(cut, 'blue', 'build').includes(e)));
  // A road never serves a ship, and a ship never serves a road.
  const road = state(sk, { settlements: { blue: [H] }, roads: { blue: [Ha] } });
  assert.ok(!shipSites(road, 'blue', 'build').includes(ab) && roadSitesOpenSea(road, 'blue').includes(ab));
  assert.ok(!canPlaceRoadOpenSea(g, 'blue', ab), 'your ship H–a starts no road at a');
  // Nothing on the pirate's edges, and nothing on another player's road.
  const guarded: SeaState = { ...g, pirate: sk.hex('1') };
  assert.ok(!shipSites(guarded, 'blue', 'build').includes(ab));
  assert.ok(shipSites(guarded, 'blue', 'build').every((e) => !pirateBlocksEdge(guarded, e)));
  assert.ok(!canPlaceShip({ ...g, roads: { [ab]: 'red' } }, 'blue', ab, 'build'));
});

test('§7.5 a point of land: a road or a ship on each coastal edge, never both, and ships only on the sea edge', () => {
  const { sk, board, islet } = straitIslet();
  const P = corner(board, islet, 'nw');
  const [Q, R] = [corner(board, islet, 'n'), corner(board, islet, 'sw')];
  const S = board.vertices[P]!.neighbors.find((v) => v !== Q && v !== R)!;
  const [PQ, PR, PS] = [edgeBetween(board, P, Q), edgeBetween(board, P, R), edgeBetween(board, P, S)];
  assert.deepEqual(
    [edgeKind(board, PQ), edgeKind(board, PR), edgeKind(board, PS)],
    ['coastal', 'coastal', 'sea'],
  );
  let g = state(sk, { settlements: { blue: [P] }, roads: { blue: [PQ] } });
  assert.ok(roadSitesOpenSea(g, 'blue').includes(PR) && shipSites(g, 'blue', 'build').includes(PR));
  assert.ok(shipSites(g, 'blue', 'build').includes(PS) && !roadSitesOpenSea(g, 'blue').includes(PS));
  assert.ok(!shipSites(g, 'blue', 'build').includes(PQ), 'your road is already there');
  g = { ...g, ...placeShip(g, 'blue', PR, 'build') };
  assert.ok(!roadSitesOpenSea(g, 'blue').includes(PR), 'the ship holds that coastal edge now');
});

/** Section 7.5's second example on the strait board's islet: your roads A–B–C–J, your ships H–K–L–M–J. */
function meetingAtJ() {
  const { sk, board, islet, H, route } = straitIslet();
  const [A, B, C, J, N] = (['se', 's', 'sw', 'nw', 'n'] as const).map((c) =>
    corner(board, islet, c),
  ) as number[];
  const roads = edgesAlong(board, [A!, B!, C!, J!]),
    ships = edgesAlong(board, route);
  assert.equal(route.at(-1), J);
  return { sk, board, A: A!, J: J!, N: N!, H, roads, ships, JN: edgeBetween(board, J!, N!) };
}

test('§7.3 and §7.5 a road meets a line of ships where nobody can build: they never join there', () => {
  const { sk, A, J, N, H, roads, ships, JN } = meetingAtJ();
  const g = state(sk, {
    settlements: { blue: [A, H], red: [N] },
    roads: { blue: roads },
    ships: { blue: ships },
  });
  assert.ok(!settlementSitesOpenSea(g, 'blue').includes(J), 'the distance rule keeps J empty');
  assert.deepEqual(longestRoute(g, 'blue').length, 4, 'the ships, not 7');
  // A new road at J continues your road, a new ship your ship; neither starts from the other kind.
  assert.ok(roadSitesOpenSea(g, 'blue').includes(JN));
  assert.ok(shipSites(g, 'blue', 'build').includes(JN));
  const noRoad = { ...g, roads: Object.fromEntries(roads.slice(0, 2).map((e) => [e, 'blue'])) };
  assert.ok(
    !roadSitesOpenSea(noRoad, 'blue').includes(JN) && shipSites(noRoad, 'blue', 'build').includes(JN),
  );
  const noShip = { ...g, ships: Object.fromEntries(ships.slice(0, 3).map((e) => [e, 'blue'])) };
  assert.ok(
    roadSitesOpenSea(noShip, 'blue').includes(JN) && !shipSites(noShip, 'blue', 'build').includes(JN),
  );
  // Had J been free and another player built there, the route would be the same.
  const theirs = state(sk, {
    settlements: { blue: [A, H], red: [J] },
    roads: { blue: roads },
    ships: { blue: ships },
  });
  assert.equal(longestRoute(theirs, 'blue').length, 4);
  // Had you built there, your roads and ships would join: 7.
  const free = state(sk, { settlements: { blue: [A, H] }, roads: { blue: roads }, ships: { blue: ships } });
  assert.ok(settlementSitesOpenSea(free, 'blue').includes(J));
  const joined = { ...free, ...placeSettlement(free, 'blue', J) };
  assert.equal(longestRoute(joined, 'blue').length, 7);
  assert.equal(longestRoute(joined, 'blue').edges.length, 7);
});

test('§7.4 you settle by ship: on a land intersection your ship touches, earning the island bonus', () => {
  const { sk, board, H, route } = straitIslet();
  const J = route.at(-1)!;
  const g = state(sk, { settlements: { blue: [H] }, ships: { blue: edgesAlong(board, route) } });
  const sites = settlementSitesOpenSea(g, 'blue');
  assert.deepEqual(sites, [J], 'the islet, not the sea intersections on the way');
  const settled = { ...g, ...placeSettlement(g, 'blue', J) };
  assert.deepEqual(settled.islandBonuses, { blue: ['a'] });
  // From there, roads grow across the island.
  assert.ok(roadSitesOpenSea(settled, 'blue').some((e) => at(board, J).includes(e)));
});

test('§10.1 the robber stands on any land hex, gold and desert included; the pirate on any sea hex, the ring included', () => {
  const sk = outerIslesThree(),
    { board } = sk;
  const desert = board.hexes.find((h) => h.terrain === 'desert')!.id;
  const land = board.hexes.filter((h) => isLand(h)).map((h) => h.id),
    sea = board.hexes.filter((h) => !isLand(h)).map((h) => h.id);
  assert.deepEqual(
    robberHexes(board, desert),
    land.filter((h) => h !== desert),
  );
  assert.ok(robberHexes(board, desert).some((h) => board.hexes[h]!.terrain === 'gold'));
  assert.ok(robberHexes(board, desert).some((h) => board.hexes[h]!.island === 'c'));
  assert.deepEqual(
    pirateHexes(board, sk.pirate),
    sea.filter((h) => h !== sk.pirate),
  );
  // After a seven or a Knight, either may move: never both, and never neither, is the reducer's to keep.
  assert.deepEqual(knightTargets({ board, robber: desert, pirate: sk.pirate! }), {
    robber: robberHexes(board, desert),
    pirate: pirateHexes(board, sk.pirate),
  });
});

test('§10.5 the pirate robs one other player with a ship on its hex, and nobody for a building on its coast', () => {
  const { sk, board, H } = straitIslet();
  const bay = sk.hex('1'),
    strait4 = sk.hex('4');
  const [n, ne, se, s, sw] = (['n', 'ne', 'se', 's', 'sw'] as const).map((c) =>
    corner(board, bay, c),
  ) as number[];
  const g = {
    ...state(sk, {
      settlements: { blue: [H], green: [sw!] },
      ships: { blue: [edgeBetween(board, H, n!)], red: edgesAlong(board, [n!, ne!, se!, s!]) },
    }),
    pirate: sk.hex('2'),
    players: [{ id: 'blue' }, { id: 'red' }, { id: 'green' }],
  };
  assert.deepEqual(pirateVictims(g, 'blue', bay), ['red'], 'one victim however many ships, never yourself');
  assert.deepEqual(pirateVictims(g, 'red', bay), ['blue'], 'green’s settlement on the coast is no target');
  // Red's ship between the bay and the strait is within reach of either.
  assert.deepEqual(pirateVictims(g, 'blue', strait4), ['red']);
  assert.deepEqual(
    pirateVictims(
      { ...g, players: [{ id: 'blue' }, { id: 'red', resigned: true }, { id: 'green' }] },
      'blue',
      bay,
    ),
    [],
  );
  assert.equal(pirateMoveIssue(g, 'blue', bay, 'red'), null);
  assert.match(pirateMoveIssue(g, 'blue', bay)!, /Choose one player/, 'the theft is compulsory');
  assert.match(pirateMoveIssue(g, 'blue', bay, 'green')!, /Choose one player/);
  assert.equal(pirateMoveIssue(g, 'blue', sk.hex('3')), null, 'nobody there, nothing stolen');
  assert.match(pirateMoveIssue(g, 'blue', sk.hex('3'), 'red')!, /Choose one player/);
  assert.match(pirateMoveIssue(g, 'blue', sk.hex('2'))!, /different sea hex/);
  assert.match(pirateMoveIssue(g, 'blue', board.hexes.find((h) => isLand(h))!.id)!, /different sea hex/);
});

test('§10.6 the pirate stops ships being built on, moved onto or off its edges, but not roads, and ships there count', () => {
  const { sk, board, H, route } = straitIslet();
  const bay = sk.hex('1');
  const [, a, b] = route;
  const ships = edgesAlong(board, [H, a!, b!]);
  const g: SeaState = { ...state(sk, { settlements: { blue: [H] }, ships: { blue: ships } }), pirate: bay };
  assert.ok(
    ships.every((e) => pirateBlocksEdge(g, e)),
    'both ships stand on the bay’s edges',
  );
  for (const placement of ['build', 'roadBuilding', { setup: H }] as const)
    assert.ok(shipSites(g, 'blue', placement).every((e) => !pirateBlocksEdge(g, e)));
  assert.equal(shipMoveBlock(g, 'blue', ships[1]!), 'pirate');
  // They stay connected: a ship may still be built on from them, off the bay's edges.
  const [, onward] = walk(board, a!, 'n');
  assert.ok(shipSites(g, 'blue', 'build').includes(edgeBetween(board, a!, onward!)));
  assert.equal(longestRoute(g, 'blue').length, 2);
  // Roads and settlements pay the pirate no heed.
  const [, south] = walk(board, H, 's');
  assert.ok(
    pirateBlocksEdge(g, edgeBetween(board, H, south!)) &&
      roadSitesOpenSea(g, 'blue').includes(edgeBetween(board, H, south!)),
  );
});

test('§11.2 and §11.3 a route joins roads to ships only at your own building, breaks at another’s, and ignores the pirate', () => {
  const { sk, board, H } = straitIslet();
  // Roads west along the coast from H, ships south along it, through the empty coastal intersections a and b.
  const roads = edgesAlong(board, walk(board, H, 'nw', 'sw', 'nw'));
  const [, a, b, c] = walk(board, H, 's', 'se', 's');
  const ships = edgesAlong(board, [H, a!, b!, c!]);
  const g = state(sk, { settlements: { blue: [H] }, roads: { blue: roads }, ships: { blue: ships } });
  const route = longestRoute(g, 'blue');
  assert.equal(route.length, 6, 'joined at your settlement');
  assert.deepEqual(sorted(route.edges), sorted([...roads, ...ships]));
  assert.equal(longestRoute({ ...g, buildings: {} }, 'blue').length, 3, 'not at an empty intersection');
  const theirs = (v: number) => ({ ...g.buildings, [v]: { player: 'red', kind: 'settlement' as const } });
  assert.equal(longestRoute({ ...g, buildings: { [H]: { player: 'red', kind: 'city' } } }, 'blue').length, 3);
  // Another player's settlement at b ends the route there: the roads, H–a and a–b.
  assert.equal(longestRoute({ ...g, buildings: theirs(b!) }, 'blue').length, 5);
  for (const pirate of [sk.hex('1'), sk.hex('2')])
    assert.equal(longestRoute({ ...g, pirate }, 'blue').length, 6);
});

test('§11.1 Longest Route is Classic’s award: at least 5, the holder keeps a tie, only a longer route takes it', () => {
  const { sk, board, H } = straitIslet();
  const line = (n: number) =>
    edgesAlong(board, walk(board, H, ...(['ne', 'se', 'ne', 'se', 's', 'sw'] as const).slice(0, n)));
  const west = corner(board, board.hexes.find((h) => h.terrain === 'sheep')!.id, 'sw');
  const theirs = (n: number) =>
    edgesAlong(board, walk(board, west, ...(['n', 'ne', 'n', 'ne', 'se', 'ne'] as const).slice(0, n)));
  const table = (mine: number, red: number) => ({
    ...state(sk, {
      settlements: { blue: [H], red: [west] },
      ships: { blue: line(mine) },
      roads: { red: theirs(red) },
    }),
    players: [{ id: 'blue' }, { id: 'red' }],
  });
  assert.equal(longestRouteHolder(table(4, 4), null), null, 'nobody has 5');
  assert.equal(longestRouteHolder(table(5, 4), null), 'blue');
  assert.equal(longestRouteHolder(table(5, 5), 'blue'), 'blue', 'the holder keeps a tie');
  assert.equal(longestRouteHolder(table(5, 5), null), null, 'a tie gives it to nobody new');
  assert.equal(longestRouteHolder(table(5, 6), 'blue'), 'red');
  assert.equal(longestRouteHolder(table(4, 4), 'blue'), null, 'a holder below 5 loses it');
  const resigned = { ...table(6, 5), players: [{ id: 'blue', resigned: true }, { id: 'red' }] };
  assert.equal(longestRouteHolder(resigned, 'blue'), 'red');
  assert.deepEqual(LONGEST_ROUTE, { name: 'Longest Route', minimum: 5, points: 2 });
});

test('§11 in random games a route is continuous, never passes another player’s building, and matches Classic by kind', () => {
  let checked = 0;
  for (const seed of [21, 22, 23]) {
    const players = ['red', 'blue', 'green'];
    playRandomly(
      seed % 2 ? outerIslesThree() : strait(),
      players,
      seededRandom(seed),
      { turns: 70 },
      (_, g) => {
        for (const p of players) {
          const { length, edges } = longestRoute(g, p);
          checked++;
          assert.equal(length, edges.length);
          assert.equal(new Set(edges).size, edges.length);
          const kind = (e: number) => (g.roads[e] === p ? 'road' : g.ships?.[e] === p ? 'ship' : null);
          assert.ok(edges.every((e) => kind(e)));
          // Walk it: each piece shares an intersection with the next, and each intersection passed is open to it.
          if (edges.length > 1) {
            const first = g.board.edges[edges[0]!]!,
              second = g.board.edges[edges[1]!]!;
            let v = [second.a, second.b].includes(first.a) ? first.b : first.a;
            for (const [i, e] of edges.entries()) {
              const edge = g.board.edges[e]!;
              assert.ok(edge.a === v || edge.b === v, 'continuous');
              if (i > 0) {
                const building = g.buildings[v];
                assert.ok(!building || building.player === p, 'never through another player’s building');
                if (kind(e) !== kind(edges[i - 1]!))
                  assert.equal(building?.player, p, 'roads meet ships only at yours');
              }
              v = edge.a === v ? edge.b : edge.a;
            }
          }
          // One kind at a time, it is Classic's Longest Road.
          const roadsOnly = { board: g.board as unknown as Board, buildings: g.buildings, roads: g.roads };
          assert.equal(longestRoute({ ...g, ships: {} }, p).length, longestTrail(roadsOnly, p));
          assert.equal(
            longestRoute({ ...g, roads: {} }, p).length,
            longestTrail({ ...roadsOnly, roads: g.ships ?? {} }, p),
          );
          assert.ok(
            length >=
              Math.max(longestTrail(roadsOnly, p), longestTrail({ ...roadsOnly, roads: g.ships ?? {} }, p)),
          );
        }
      },
    );
  }
  assert.ok(checked > 1000, `${checked} routes checked`);
});

test('§12 your first settlement on each small island earns 2 points, whoever settled it first, with no limit', () => {
  const sk = outerIslesThree(),
    { board } = sk;
  const on = (island: string) =>
    board.vertices.filter((v) => vertexIsland(board, v.id) === island).map((v) => v.id);
  const red = on('a')[3]!;
  const yours = on('a').find((v) => v !== red && !board.vertices[red]!.neighbors.includes(v))!;
  let g: SeaState = state(sk, { settlements: { red: [red] } });
  // Red settled there first; your first settlement there earns your bonus all the same.
  assert.equal(islandBonusForSettlement(g, 'blue', yours, false), 'a');
  g = { ...g, islandBonuses: { red: ['a'], blue: ['a'] } };
  assert.equal(islandBonusForSettlement(g, 'blue', on('a').at(-1)!, false), null, 'each island once');
  assert.equal(
    islandBonusForSettlement(g, 'blue', on(MAIN_ISLAND)[0]!, false),
    null,
    'never the main island',
  );
  assert.equal(islandBonusForSettlement(g, 'blue', on('b')[0]!, true), null, 'never in setup');
  assert.equal(islandBonusForSettlement(g, 'blue', on('b')[0]!, false), 'b');
  g = { ...g, islandBonuses: { red: ['a'], blue: ['a', 'b', 'c'] } };
  assert.equal(islandBonusPoints(g, 'blue'), 3 * ISLAND_BONUS, 'every bonus earned is paid');
  assert.equal(islandBonusPoints(g, 'red'), 2);
  assert.equal(islandBonusPoints(g, 'green'), 0);
  // The bonus stays when the settlement becomes a city: nothing about a city touches it.
  const city = { ...g, buildings: { ...g.buildings, [red]: { player: 'red', kind: 'city' as const } } };
  assert.equal(islandBonusPoints(city, 'red'), 2);
});

test('§12.3 the book’s example: settling a small island Red already holds takes you from 11 points to 14', () => {
  const { sk, board, H, route, islet } = straitIslet();
  const J = route.at(-1)!;
  const g = state(sk, {
    settlements: { blue: [H], red: [corner(board, islet, 'se')] },
    ships: { blue: edgesAlong(board, route) },
  });
  const settled = { ...g, ...placeSettlement(g, 'blue', J) };
  assert.equal(11 + 1 + islandBonusPoints(settled, 'blue'), 14);
});

test('§13.2 Road Building places roads or ships in any mix, each by its own rule, and a free ship cannot move', () => {
  const { sk, board, H, route } = straitIslet();
  let g = state(sk, { settlements: { blue: [H] } });
  const both = roadBuildingSites(g, 'blue');
  assert.deepEqual(both.roads, roadSitesOpenSea(g, 'blue'));
  assert.deepEqual(both.ships, shipSites(g, 'blue', 'build'));
  // A second ship may attach to the first; a road never to a ship.
  const first = edgeBetween(board, H, route[1]!);
  g = { ...g, ...placeShip(g, 'blue', first, 'roadBuilding') };
  const second = roadBuildingSites(g, 'blue');
  assert.ok(second.ships.includes(edgeBetween(board, route[1]!, route[2]!)));
  assert.ok(at(board, route[1]!).every((e) => !second.roads.includes(e)));
  assert.deepEqual(g.shipsBuiltThisTurn, [first]);
  assert.equal(shipMoveBlock(g, 'blue', first), 'built-this-turn');
  // No legal first placement, no card: every road and ship already on the board.
  const edges = board.edges.map((e) => e.id);
  const spent = {
    ...g,
    roads: Object.fromEntries(
      edges
        .filter((e) => takesRoad(edgeKind(board, e)))
        .slice(0, 15)
        .map((e) => [e, 'blue']),
    ),
    ships: Object.fromEntries(
      edges
        .filter((e) => edgeKind(board, e) === 'sea')
        .slice(0, 15)
        .map((e) => [e, 'blue']),
    ),
  };
  assert.deepEqual(roadBuildingSites(spent, 'blue'), { roads: [], ships: [] });
  // With one ship and no road left, the card places that ship, and then there is no second piece to place.
  const lastShip = { ...spent, ships: Object.fromEntries(Object.entries(spent.ships).slice(1)) };
  const only = roadBuildingSites(lastShip, 'blue');
  assert.ok(only.ships.length > 0 && only.roads.length === 0);
  const placed = { ...lastShip, ...placeShip(lastShip, 'blue', only.ships[0]!, 'roadBuilding') };
  assert.deepEqual(roadBuildingSites(placed, 'blue'), { roads: [], ships: [] });
});

test('§14 the log records each ship move from and to, and the pirate’s theft names no card', () => {
  assert.equal(SEA_LOG.shipMove('Blue', 4, 9), 'Blue moved a ship from edge 5 to edge 10.');
  assert.equal(SEA_LOG.ship('Blue', 0), 'Blue built a ship on edge 1.');
  assert.equal(SEA_LOG.freeShip('Blue', 1), 'Blue built a free ship on edge 2.');
  assert.equal(SEA_LOG.startingShip('Blue', 2), 'Blue placed a starting ship on edge 3.');
  assert.equal(SEA_LOG.pirate('Blue'), 'Blue moved the pirate.');
  assert.equal(
    SEA_LOG.pirate('Blue', { name: 'Red', hadCards: true }),
    'Blue moved the pirate and stole a card from Red.',
  );
  assert.equal(
    SEA_LOG.pirate('Blue', { name: 'Red', hadCards: false }),
    'Blue moved the pirate. Red had no resource cards.',
  );
  assert.equal(SEA_LOG.islandBonus('Blue'), 'Blue settled a new island (+2 points).');
  assert.equal(SEA_LOG.longestRoute('Blue'), 'Blue claimed Longest Route (+2 points).');
  // Which ships cannot move follows from public information, so the interface may say why.
  for (const reason of Object.values(SHIP_MOVE_BLOCKS)) assert.ok(reason.length > 10);
});
