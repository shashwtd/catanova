/**
 * Moving ships in Open Sea: section 8 of docs/RULEBOOK-OPEN-SEA.md, every example of 8.8 and each consequence 8.7
 * lists, on the strait board of tests/sea-boards.ts. "You" are blue; red and green are the other players.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../packages/rules/src/board.js';
import {
  closedShips,
  edgeKind,
  freedByCycle,
  hexEdges,
  isCoastalIntersection,
  isLandIntersection,
  legalShipDestinations,
  longestRoute,
  longestRouteHolder,
  movableShips,
  moveShip,
  openEnds,
  pirateBlocksEdge,
  pirateHexes,
  placeSettlement,
  placeShip,
  recordClosedEndsOnSettle,
  roadSitesOpenSea,
  shipMoveBlock,
  shipSites,
  takesShip,
} from '../packages/rules/src/sea.js';
import type { SeaState } from '../packages/rules/src/sea.js';
import {
  corner,
  edgeBetween,
  edgesAlong,
  outerIslesFour,
  outerIslesThree,
  playRandomly,
  state,
  strait,
  walk,
} from './sea-boards.js';
import type { Pieces, Sketch, Step } from './sea-boards.js';

const sorted = (edges: Iterable<number>) => [...edges].sort((x, y) => x - y);
const moved = (g: SeaState, player: string, from: number, to: number): SeaState => ({
  ...g,
  ...moveShip(g, player, from, to),
});
/** Another player's settlement, placed by the rules: it needs their road or ship touching it. */
const settle = (g: SeaState, player: string, vertex: number): SeaState => ({
  ...g,
  ...placeSettlement(g, player, vertex),
});
/** The strait board, and the line of section 8.8's examples: H on the bay's coast, a and b along it, c at sea. */
function bayLine() {
  const sk = strait(),
    { board } = sk;
  const H = corner(board, sk.hex('1'), 'nw');
  const [, a, b, c] = walk(board, H, 's', 'se', 'ne') as [number, number, number, number];
  return { sk, board, H, a, b, c, along: (...route: number[]) => edgesAlong(board, route) };
}
/** Red's road from a settlement of theirs, walking back from `to` by `steps`, so that red may settle at `to`. */
function redRoadTo(sk: Sketch, to: number, ...steps: Step[]): Pieces {
  const route = walk(sk.board, to, ...steps);
  return { settlements: { red: [route.at(-1)!] }, roads: { red: edgesAlong(sk.board, route) } };
}
const merge = (...all: Pieces[]): Pieces => {
  const out: Pieces = {};
  for (const pieces of all)
    for (const key of ['roads', 'ships', 'settlements', 'cities'] as const)
      for (const [player, ids] of Object.entries(pieces[key] ?? {}))
        out[key] = { ...out[key], [player]: [...(out[key]?.[player] ?? []), ...ids] };
  return out;
};

test('§8.8 a line and a branch: only the ships with an open end move', () => {
  const { sk, board, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  let g = state(sk, { settlements: { blue: [H] }, ships: { blue: [Ha!, ab!, bc!] } });
  assert.equal(edgeKind(board, bc!), 'sea', 'c is an empty sea intersection');
  assert.deepEqual(movableShips(g, 'blue'), [bc]);
  assert.deepEqual(openEnds(g, 'blue', bc!), [c]);
  // a–b meets your ships at both ends; H–a meets your settlement and a–b.
  assert.equal(shipMoveBlock(g, 'blue', ab!), 'no-open-end');
  assert.equal(shipMoveBlock(g, 'blue', Ha!), 'no-open-end');
  const [, d] = walk(board, b, 's');
  const bd = edgeBetween(board, b, d!);
  g = { ...g, ships: { ...g.ships, [bd]: 'blue' } };
  assert.deepEqual(movableShips(g, 'blue'), sorted([bc!, bd]));
  assert.equal(shipMoveBlock(g, 'blue', ab!), 'no-open-end');
  assert.equal(shipMoveBlock(g, 'blue', Ha!), 'no-open-end');
});

test('§8.8 your road at the end of a line does not close it', () => {
  const { sk, board, H } = bayLine();
  const [, a, b, C] = walk(board, H, 's', 'se', 's') as [number, number, number, number];
  const [, x, T] = walk(board, C, 'sw', 's');
  const ships = edgesAlong(board, [H, a, b, C]);
  const g = state(sk, {
    settlements: { blue: [H, T!] },
    ships: { blue: ships },
    roads: { blue: edgesAlong(board, [C, x!, T!]) },
  });
  assert.ok(!g.buildings[C], 'nobody has built at C');
  assert.deepEqual(movableShips(g, 'blue'), [ships[2]]);
  assert.deepEqual(openEnds(g, 'blue', ships[2]!), [C]);
});

test('§8.8 an open line, then an opponent: the ships beside the new settlement stay closed there', () => {
  const { sk, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  let g = state(
    sk,
    merge({ settlements: { blue: [H] }, ships: { blue: [Ha!, ab!, bc!] } }, redRoadTo(sk, b, 's', 'sw', 's')),
  );
  assert.deepEqual(movableShips(g, 'blue'), [bc]);
  g = settle(g, 'red', b);
  // The line never joined two of your buildings, so nothing is locked by history; the ends at b are recorded.
  assert.deepEqual(g.lockedShips, []);
  assert.deepEqual(g.closedShipEnds, { [ab!]: [b], [bc!]: [b] });
  assert.equal(shipMoveBlock(g, 'blue', ab!), 'no-open-end', 'a–b does not become open');
  assert.deepEqual(openEnds(g, 'blue', bc!), [c], 'b–c still moves, through its open end at c');
  assert.deepEqual(movableShips(g, 'blue'), [bc]);
  assert.equal(shipMoveBlock(g, 'blue', Ha!), 'no-open-end');
  // The record lasts while a–b stays on its edge, even once b–c has sailed away to your settlement.
  const [, out] = walk(sk.board, H, 'ne');
  g = moved(g, 'blue', bc!, edgeBetween(sk.board, H, out!));
  assert.deepEqual(g.closedShipEnds, { [ab!]: [b] });
  assert.deepEqual(openEnds(g, 'blue', ab!), []);
});

test('§8.8 a closed line, then an opponent: it stays closed, and the route is broken there', () => {
  const { sk, board, H } = bayLine();
  const [, a, b, c, T] = walk(board, H, 's', 'se', 's', 'sw') as number[];
  const line = edgesAlong(board, [H, a!, b!, c!, T!]);
  // Red sails in from the islet to the coastal intersection b.
  const islet = corner(board, sk.hex('4'), 'ne');
  const [, sea] = walk(board, islet, 'nw');
  let g = state(sk, {
    settlements: { blue: [H, T!], red: [islet] },
    ships: { blue: line, red: edgesAlong(board, [islet, sea!, b!]) },
  });
  assert.deepEqual(sorted(closedShips(g, 'blue')), sorted(line));
  assert.deepEqual(movableShips(g, 'blue'), []);
  assert.equal(longestRoute(g, 'blue').length, 4);
  g = settle(g, 'red', b!);
  assert.deepEqual(g.lockedShips, sorted(line), 'the whole line is locked by history');
  assert.deepEqual(movableShips(g, 'blue'), []);
  for (const ship of line) assert.equal(shipMoveBlock(g, 'blue', ship), 'closed');
  assert.equal(longestRoute(g, 'blue').length, 2, 'for Longest Route the line is broken at b');
});

test('§8.8 meeting at a building that was already there: each ship has an open end there', () => {
  const { sk, board, H } = bayLine();
  const [, g1, X, k, T] = walk(board, H, 's', 'se', 's', 'sw') as number[];
  const fromH = edgesAlong(board, [H, g1!, X!]),
    fromT = edgesAlong(board, [T!, k!, X!]);
  const g = state(sk, {
    settlements: { blue: [H, T!], red: [X!] },
    ships: { blue: [...fromH, ...fromT] },
  });
  assert.deepEqual(sorted(closedShips(g, 'blue')), [], 'the lines never joined, so they never closed');
  assert.deepEqual(movableShips(g, 'blue'), sorted([fromH[1]!, fromT[1]!]));
  assert.deepEqual(openEnds(g, 'blue', fromH[1]!), [X]);
  assert.deepEqual(openEnds(g, 'blue', fromT[1]!), [X]);
  // The previous example, where the building came after the ships met, locks the same pieces.
  const later = recordClosedEndsOnSettle(
    { ...g, buildings: { [H]: g.buildings[H]!, [T!]: g.buildings[T!]! } },
    'red',
    X!,
  );
  assert.deepEqual(later.lockedShips, sorted([...fromH, ...fromT]));
});

test('§8.8 a loop: only the two ships touching your settlement move', () => {
  const { sk, board, H } = bayLine();
  const loop = hexEdges(board, sk.hex('1'));
  const g = state(sk, { settlements: { blue: [H] }, ships: { blue: loop } });
  const atH = loop.filter((e) => [board.edges[e]!.a, board.edges[e]!.b].includes(H));
  assert.equal(atH.length, 2);
  assert.deepEqual(movableShips(g, 'blue'), sorted(atH));
  for (const e of atH) assert.equal(freedByCycle(g, 'blue', e), 'loop');
  for (const e of loop.filter((e) => !atH.includes(e))) {
    assert.equal(freedByCycle(g, 'blue', e), null);
    assert.equal(shipMoveBlock(g, 'blue', e), 'no-open-end');
  }
});

/** Ten ships round the neighbouring sea hexes 2 and 3, and two linking your settlement T to the ring at v. */
function ringOfTen() {
  const sk = strait(),
    { board } = sk;
  const west = hexEdges(board, sk.hex('2')),
    east = hexEdges(board, sk.hex('3'));
  const shared = west.find((e) => east.includes(e))!;
  const v = corner(board, sk.hex('3'), 'n');
  const [, u, T] = walk(board, v, 'n', 'ne') as [number, number, number];
  const links = edgesAlong(board, [T, u, v]);
  const ring = [...west, ...east].filter((e) => e !== shared);
  return { sk, board, west, east, shared, ring, links, T, v };
}

test('§8.8 a ring under the pirate: the ring ships off its edges move, the ships linking it do not', () => {
  const { sk, board, ring, links, east, T, v } = ringOfTen();
  const g: SeaState = {
    ...state(sk, { settlements: { blue: [T] }, ships: { blue: [...ring, ...links] } }),
    pirate: sk.hex('3'),
  };
  assert.equal(ring.length, 10);
  assert.ok(
    ring.every((e) => edgeKind(board, e) === 'sea'),
    'away from the edge of the board',
  );
  assert.ok(board.hexes[sk.hex('2')]!.vertices.every((c) => !g.buildings[c]));
  const underPirate = ring.filter((e) => east.includes(e));
  assert.equal(underPirate.length, 5);
  for (const e of underPirate) {
    assert.equal(shipMoveBlock(g, 'blue', e), 'pirate');
    assert.equal(freedByCycle(g, 'blue', e), 'ring', 'the pirate does not break the ring');
  }
  assert.deepEqual(movableShips(g, 'blue'), sorted(ring.filter((e) => !east.includes(e))));
  // Each end of T–u and u–v meets your settlement or another of your ships, and neither lies on the ring.
  for (const e of links) {
    assert.equal(shipMoveBlock(g, 'blue', e), 'no-open-end');
    assert.equal(freedByCycle(g, 'blue', e), null);
  }
  assert.ok(board.vertices[v]!.edges.includes(links[1]!));
});

test('§8.3 two rings side by side, or three lines between two sea intersections: all their ships are free', () => {
  const { sk, ring, shared, links, T } = ringOfTen();
  const g = state(sk, { settlements: { blue: [T] }, ships: { blue: [...ring, shared, ...links] } });
  for (const e of [...ring, shared]) assert.equal(freedByCycle(g, 'blue', e), 'ring');
  assert.deepEqual(movableShips(g, 'blue'), sorted([...ring, shared]));
});

test('§8.3 a ring hanging off a loop: the ring and the loop’s two end ships are free, nothing else', () => {
  const { sk, board, H } = bayLine();
  const loop = hexEdges(board, sk.hex('1')),
    ring = hexEdges(board, sk.hex('4'));
  const g = state(sk, { settlements: { blue: [H] }, ships: { blue: [...new Set([...loop, ...ring])] } });
  const atH = loop.filter((e) => [board.edges[e]!.a, board.edges[e]!.b].includes(H));
  for (const e of ring) assert.equal(freedByCycle(g, 'blue', e), 'ring');
  for (const e of atH) assert.equal(freedByCycle(g, 'blue', e), 'loop');
  assert.deepEqual(movableShips(g, 'blue'), sorted(new Set([...ring, ...atH])));
  for (const e of loop.filter((e) => !ring.includes(e) && !atH.includes(e)))
    assert.equal(shipMoveBlock(g, 'blue', e), 'no-open-end');
});

test('§8.3 a loop or a ring through another player’s building is broken there', () => {
  const { sk, board, H, b } = bayLine();
  const loop = hexEdges(board, sk.hex('1'));
  // Red settled at b first; your ships met there afterwards, so their ends at b are open.
  const g = state(sk, { settlements: { blue: [H], red: [b] }, ships: { blue: loop } });
  for (const e of loop) assert.equal(freedByCycle(g, 'blue', e), null);
  const atB = loop.filter((e) => [board.edges[e]!.a, board.edges[e]!.b].includes(b));
  assert.deepEqual(movableShips(g, 'blue'), sorted(atB));
  for (const e of atB) assert.deepEqual(openEnds(g, 'blue', e), [b]);
});

test('§8.3 a settlement that joins a loop or a ring to a second building closes it', () => {
  const { sk, board, H, b } = bayLine();
  const loop = hexEdges(board, sk.hex('1'));
  let g = state(sk, { settlements: { blue: [H] }, ships: { blue: loop } });
  assert.equal(movableShips(g, 'blue').length, 2);
  g = settle(g, 'blue', b);
  assert.deepEqual(sorted(closedShips(g, 'blue')), sorted(loop));
  assert.deepEqual(movableShips(g, 'blue'), []);
  assert.deepEqual(g.lockedShips, [], 'your own settlement locks nothing by history');

  // A ring linked to T, which you then settle on.
  const [, x, T] = walk(board, b, 's', 'sw');
  const links = edgesAlong(board, [T!, x!, b]);
  g = state(sk, { settlements: { blue: [T!] }, ships: { blue: [...loop, ...links] } });
  assert.deepEqual(movableShips(g, 'blue'), sorted(loop));
  g = settle(g, 'blue', H);
  assert.deepEqual(sorted(closedShips(g, 'blue')), sorted([...loop, ...links]));
  assert.deepEqual(movableShips(g, 'blue'), []);
});

test('§8.4 one move a turn, and never a ship built this turn, but a starting ship moves on the first turn', () => {
  const { sk, board, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  let g = state(sk, { settlements: { blue: [H] } });
  g = { ...g, ...placeShip(g, 'blue', Ha!, { setup: H }) };
  assert.deepEqual(g.shipsBuiltThisTurn, [], 'setup is not a turn');
  assert.deepEqual(movableShips(g, 'blue'), [Ha]);
  g = { ...g, ...placeShip(g, 'blue', ab!, 'build') };
  assert.deepEqual(g.shipsBuiltThisTurn, [ab]);
  assert.equal(shipMoveBlock(g, 'blue', ab!), 'built-this-turn');
  assert.deepEqual(movableShips(g, 'blue'), []);
  g = { ...g, ...placeShip(g, 'blue', bc!, 'roadBuilding') };
  assert.equal(shipMoveBlock(g, 'blue', bc!), 'built-this-turn', 'a free ship counts as built this turn');
  // The next turn, the tip moves; then the turn's move is used.
  g = { ...g, shipsBuiltThisTurn: [] };
  assert.deepEqual(movableShips(g, 'blue'), [bc]);
  const [, e] = walk(board, b, 's');
  g = moved(g, 'blue', bc!, edgeBetween(board, b, e!));
  assert.equal(g.shipMovedThisTurn, true);
  assert.deepEqual(movableShips(g, 'blue'), []);
  assert.equal(shipMoveBlock(g, 'blue', edgeBetween(board, b, e!)), 'move-used');
});

test('§8.5 a ship moves to any edge where it could be built now, judged with it lifted', () => {
  const { sk, board, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  const islet = corner(board, sk.hex('4'), 'se');
  let g = state(sk, {
    settlements: { blue: [H, islet] },
    ships: { blue: [Ha!, ab!, bc!] },
    roads: { blue: [edgeBetween(board, H, walk(board, H, 'nw')[1]!)] },
  });
  const road = Number(Object.keys(g.roads)[0]);
  const to = legalShipDestinations(g, 'blue', bc!);
  assert.ok(!to.includes(bc!), 'a different edge');
  for (const e of to) {
    assert.ok(takesShip(edgeKind(board, e)), 'never a land or rim edge');
    assert.ok(!g.roads[e] && !g.ships?.[e]);
  }
  // Its own old place is not a connection: nothing else of yours is at c.
  for (const e of board.vertices[c]!.edges) assert.ok(!to.includes(e));
  // It may go beside a–b at b, beside your settlement at H, or anywhere beside your other settlement.
  const [, d] = walk(board, b, 's');
  assert.ok(to.includes(edgeBetween(board, b, d!)));
  assert.ok(
    board.vertices[islet]!.edges.filter((e) => takesShip(edgeKind(board, e))).every((e) => to.includes(e)),
  );
  assert.ok(!to.includes(road), 'not onto your road');
  // Never onto an edge of the pirate's hex.
  g = { ...g, pirate: sk.hex('4') };
  const guarded = legalShipDestinations(g, 'blue', bc!);
  assert.ok(guarded.length && guarded.every((e) => !pirateBlocksEdge(g, e)));
  assert.ok(!guarded.includes(edgeBetween(board, b, d!)));
});

test('§8.5 a move may not detach another of your ships, but a ship already cut off never blocks one', () => {
  const { sk, board, H } = bayLine();
  // H–a–b–c–d with b coastal and c, d at sea. Red settles at b, which cuts b–c and c–d off from a–b.
  const [, a, b, c, d] = walk(board, H, 's', 'se', 'ne', 'n') as [number, number, number, number, number];
  const line = edgesAlong(board, [H, a, b, c, d]);
  const [, ab, bc, cd] = line as [number, number, number, number];
  let g = state(
    sk,
    merge({ settlements: { blue: [H] }, ships: { blue: line } }, redRoadTo(sk, b, 's', 'sw', 's')),
  );
  g = settle(g, 'red', b);
  assert.deepEqual(movableShips(g, 'blue'), [cd], 'c–d has an open end at d');
  // b–c no longer meets a–b at b, so c–d may go only where it still meets b–c: beside it at c.
  const [, e] = walk(board, c, 'se');
  assert.deepEqual(legalShipDestinations(g, 'blue', cd), [edgeBetween(board, c, e!)]);
  g = moved(g, 'blue', cd, edgeBetween(board, c, e!));
  assert.deepEqual(g.closedShipEnds, { [ab]: [b], [bc]: [b] });

  // Section 8.7's example: c is coastal and d in open sea, and red settles at c.
  const [, a2, b2, c2, d2] = walk(board, H, 's', 'se', 's', 'se') as [number, number, number, number, number];
  const cut = edgesAlong(board, [H, a2, b2, c2, d2]);
  const tip = edgesAlong(board, walk(board, H, 'ne', 'se'));
  g = state(
    sk,
    merge({ settlements: { blue: [H] }, ships: { blue: [...cut, ...tip] } }, redRoadTo(sk, c2, 'sw', 's')),
  );
  g = settle(g, 'red', c2);
  assert.deepEqual(g.closedShipEnds, { [cut[2]!]: [c2], [cut[3]!]: [c2] });
  assert.deepEqual(openEnds(g, 'blue', cut[3]!), [d2], 'c–d moves too, through its open end at d');
  assert.equal(shipMoveBlock(g, 'blue', cut[2]!), 'no-open-end', 'b–c does not');
  assert.deepEqual(movableShips(g, 'blue'), sorted([cut[3]!, tip[1]!]));
  // c–d touches nothing of yours, but it was cut off before any move, so it never limits where the tip of the
  // other line may go: anywhere a ship could be built with the tip lifted.
  const lifted = { ...g.ships };
  delete lifted[tip[1]!];
  assert.deepEqual(
    legalShipDestinations(g, 'blue', tip[1]!),
    shipSites({ ...g, ships: lifted }, 'blue', 'build').filter((e) => e !== tip[1]),
  );
});

test('§8.2 other players’ pieces never close an open end; a lone ship’s end at a new settlement stays open', () => {
  const { sk, board, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  // Red's ship ends at c, beside your tip; red's road ends at your other tip's coastal end.
  const [, d] = walk(board, b, 's');
  const bd = edgeBetween(board, b, d!);
  const [, x, home] = walk(board, d!, 'sw', 's');
  const [, far] = walk(board, c, 'n');
  let g = state(sk, {
    settlements: { blue: [H], red: [home!] },
    ships: { blue: [Ha!, ab!, bc!, bd], red: [edgeBetween(board, c, far!)] },
    roads: { red: edgesAlong(board, [home!, x!, d!]) },
  });
  assert.deepEqual(openEnds(g, 'blue', bc!), [c]);
  assert.deepEqual(openEnds(g, 'blue', bd), [d]);
  assert.deepEqual(movableShips(g, 'blue'), sorted([bc!, bd]));
  // Red settles at d, where only one of your ships ends: its end there stays open.
  g = settle(g, 'red', d!);
  assert.deepEqual(g.closedShipEnds, {});
  assert.deepEqual(openEnds(g, 'blue', bd), [d]);
  assert.deepEqual(movableShips(g, 'blue'), sorted([bc!, bd]));
});

test('§8.6 a move that leaves your route as long keeps Longest Route; a shorter one follows Classic', () => {
  const { sk, board, H } = bayLine();
  const route = walk(board, H, 'ne', 'se', 'ne', 'se', 's');
  const ships = edgesAlong(board, route);
  const far = corner(board, sk.hex('4'), 'se');
  // Red's five roads round the west of the main island tie your five ships.
  const west = walk(board, corner(board, sk.hex('1'), 'sw'), 'sw', 'nw', 'sw', 'nw', 'sw', 's');
  const g = {
    ...state(sk, {
      settlements: { blue: [H, far], red: [west[0]!] },
      ships: { blue: ships },
      roads: { red: edgesAlong(board, west.slice(0, 6)) },
    }),
    players: [{ id: 'blue' }, { id: 'red' }],
  };
  assert.equal(longestRoute(g, 'blue').length, 5);
  assert.equal(longestRoute(g, 'red').length, 5);
  assert.equal(longestRouteHolder(g, 'blue'), 'blue', 'the holder keeps a tie');
  const tip = ships.at(-1)!;
  const end = route.at(-2)!;
  // The tip swings round its inner end: still five.
  const swing = legalShipDestinations(g, 'blue', tip).find(
    (e) => e !== tip && [board.edges[e]!.a, board.edges[e]!.b].includes(end),
  )!;
  const kept = { ...g, ...moveShip(g, 'blue', tip, swing) };
  assert.equal(longestRoute(kept, 'blue').length, 5);
  assert.equal(longestRouteHolder(kept, 'blue'), 'blue');
  // Sailing it to your far settlement leaves four, and red's five take the award.
  const away = legalShipDestinations(g, 'blue', tip).find((e) =>
    [board.edges[e]!.a, board.edges[e]!.b].includes(far),
  )!;
  const shorter = { ...g, ...moveShip(g, 'blue', tip, away) };
  assert.equal(longestRoute(shorter, 'blue').length, 4);
  assert.equal(longestRouteHolder(shorter, 'blue'), 'red');
});

test('§8.7 when the end ship of a line is on the pirate’s edge, nothing in the line moves until it leaves', () => {
  const { sk, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  const g: SeaState = {
    ...state(sk, { settlements: { blue: [H] }, ships: { blue: [Ha!, ab!, bc!] } }),
    pirate: sk.hex('4'),
  };
  assert.ok(pirateBlocksEdge(g, bc!) && !pirateBlocksEdge(g, ab!));
  assert.equal(shipMoveBlock(g, 'blue', bc!), 'pirate');
  assert.equal(shipMoveBlock(g, 'blue', ab!), 'no-open-end', 'the ship behind it has no open end');
  assert.deepEqual(movableShips(g, 'blue'), []);
  assert.deepEqual(movableShips({ ...g, pirate: sk.hex('2') }, 'blue'), [bc]);
});

test('§8.7 a loop or ring another player settles on stops moving, unless something else frees its ships', () => {
  const { sk, board, H, b } = bayLine();
  const loop = hexEdges(board, sk.hex('1'));
  let g = state(
    sk,
    merge({ settlements: { blue: [H] }, ships: { blue: loop } }, redRoadTo(sk, b, 's', 'sw', 's')),
  );
  assert.equal(movableShips(g, 'blue').length, 2);
  g = settle(g, 'red', b);
  const atB = loop.filter((e) => [board.edges[e]!.a, board.edges[e]!.b].includes(b));
  assert.deepEqual(g.closedShipEnds, Object.fromEntries(atB.map((e) => [e, [b]])));
  assert.deepEqual(movableShips(g, 'blue'), []);
  // An open end elsewhere frees only its own ship.
  const [ne] = [corner(board, sk.hex('1'), 'ne')];
  const [, out] = walk(board, ne, 'ne');
  const spur = edgeBetween(board, ne, out!);
  g = { ...g, ships: { ...g.ships, [spur]: 'blue' } };
  assert.deepEqual(movableShips(g, 'blue'), [spur]);

  // A ring, linked to your settlement T, which red then settles on at H.
  const [, x, T] = walk(board, b, 's', 'sw');
  const links = edgesAlong(board, [T!, x!, b]);
  const [, north, west, home] = walk(board, H, 'nw', 'sw', 'nw');
  g = state(sk, {
    settlements: { blue: [T!], red: [home!] },
    ships: { blue: [...loop, ...links] },
    roads: { red: edgesAlong(board, [H, north!, west!, home!]) },
  });
  assert.deepEqual(movableShips(g, 'blue'), sorted(loop));
  g = settle(g, 'red', H);
  assert.deepEqual(movableShips(g, 'blue'), []);
});

test('§8 moving a ship returns only what changes, and refuses a move the rules do not allow', () => {
  const { sk, board, H, a, b, c, along } = bayLine();
  const [Ha, ab, bc] = along(H, a, b, c);
  const g: SeaState = {
    ...state(sk, { settlements: { blue: [H] }, ships: { blue: [Ha!, ab!, bc!], red: [] } }),
    closedShipEnds: { [bc!]: [b] },
  };
  const [, d] = walk(board, b, 's');
  const to = edgeBetween(board, b, d!);
  assert.deepEqual(moveShip(g, 'blue', bc!, to), {
    ships: { [Ha!]: 'blue', [ab!]: 'blue', [to]: 'blue' },
    closedShipEnds: {},
    shipMovedThisTurn: true,
  });
  assert.throws(() => moveShip(g, 'red', bc!, to), /not your ship/);
  assert.throws(() => moveShip(g, 'blue', ab!, to), /no open end/);
  assert.throws(() => moveShip(g, 'blue', bc!, bc!), /cannot move to that edge/);
  assert.throws(() => moveShip({ ...g, shipMovedThisTurn: true }, 'blue', bc!, to), /already moved/);
});

/**
 * Sections 8.5 and 8.7 read straight off the book, by brute force: every set of the player's ships is tried as a
 * line joining two of their buildings, a loop or a ring. Exponential, so only for fleets of a dozen ships.
 */
function lines(g: SeaState, player: string) {
  const ships = g.ships ?? {};
  const mine = Object.keys(ships)
    .map(Number)
    .filter((e) => ships[e] === player);
  // The intersections the fleet touches, numbered from 0, and each ship's two.
  const corners: number[] = [];
  const at = (v: number) => (corners.includes(v) ? corners.indexOf(v) : corners.push(v) - 1);
  const ends = mine.map((e) => [at(g.board.edges[e]!.a), at(g.board.edges[e]!.b)] as const);
  const own = corners.map((v) => g.buildings[v]?.player === player),
    built = corners.map((v) => !!g.buildings[v]);
  const closed = new Set<number>(),
    loops = new Set<number>(),
    rings = new Set<number>();
  const degree = new Int8Array(corners.length),
    root = new Int8Array(corners.length);
  const find = (v: number): number => (root[v] === v ? v : (root[v] = find(root[v]!)));
  for (let mask = 1; mask < 1 << mine.length; mask++) {
    degree.fill(0);
    for (let v = 0; v < corners.length; v++) root[v] = v;
    let parts = 0,
      tooMany = false;
    for (let i = 0; i < ends.length && !tooMany; i++)
      if (mask & (1 << i)) {
        const [a, b] = ends[i]!;
        parts += (degree[a] ? 0 : 1) + (degree[b] ? 0 : 1);
        tooMany = ++degree[a]! > 2 || ++degree[b]! > 2;
        if (find(a) !== find(b)) {
          root[find(a)] = find(b);
          parts--;
        }
      }
    // One connected piece in which no intersection has three ships: a simple path or a simple cycle.
    if (tooMany || parts !== 1) continue;
    const touched = [...degree.keys()].filter((v) => degree[v]),
      tips = touched.filter((v) => degree[v] === 1),
      inner = touched.filter((v) => degree[v] === 2);
    const set = mine.filter((_, i) => mask & (1 << i));
    const innerBuilt = inner.filter((v) => built[v]);
    if (tips.length === 2 && !innerBuilt.length && tips.every((v) => own[v]))
      for (const e of set) closed.add(e);
    if (!tips.length && !innerBuilt.length) for (const e of set) rings.add(e);
    if (!tips.length && innerBuilt.length === 1 && own[innerBuilt[0]!])
      for (const [i, e] of mine.entries())
        if (mask & (1 << i) && ends[i]!.includes(innerBuilt[0]!)) loops.add(e);
  }
  return { mine, closed, loops, rings };
}
/** The movable ships and where each may go, by the brute-force reading, with L and E kept by the test itself. */
function bookMoves(
  g: SeaState,
  player: string,
  locked: Set<number>,
  recorded: Map<number, Set<number>>,
  { mine, closed, loops, rings } = lines(g, player),
) {
  const ships = g.ships ?? {};
  const ends = (e: number) => [g.board.edges[e]!.a, g.board.edges[e]!.b];
  const foreign = (v: number) => !!g.buildings[v] && g.buildings[v]!.player !== player;
  const others = (fleet: Record<number, string>, v: number, except: number) =>
    g.board.vertices[v]!.edges.filter((e) => e !== except && fleet[e] === player);
  const attached = (fleet: Record<number, string>, e: number) =>
    ends(e).some((v) => g.buildings[v]?.player === player || (!foreign(v) && others(fleet, v, e).length > 0));
  const onPirate = (e: number) => g.pirate !== undefined && g.board.edges[e]!.hexes.includes(g.pirate);
  const moves = new Map<number, number[]>();
  if (g.shipMovedThisTurn) return moves;
  for (const x of mine) {
    if (g.shipsBuiltThisTurn?.includes(x) || onPirate(x) || locked.has(x) || closed.has(x)) continue;
    const open = ends(x).some(
      (v) =>
        g.buildings[v]?.player !== player &&
        (foreign(v) || !others(ships, v, x).length) &&
        !recorded.get(x)?.has(v),
    );
    if (!open && !loops.has(x) && !rings.has(x)) continue;
    const lifted = { ...ships };
    delete lifted[x];
    const before = mine.filter((y) => y !== x && attached(ships, y));
    const to = g.board.edges
      .filter((d) => {
        if (d.id === x || !takesShip(edgeKind(g.board, d.id)) || lifted[d.id] || g.roads[d.id]) return false;
        if (onPirate(d.id) || !attached(lifted, d.id)) return false;
        const after = { ...lifted, [d.id]: player };
        return before.every((y) => attached(after, y));
      })
      .map((d) => d.id);
    if (to.length) moves.set(x, to);
  }
  return moves;
}

/**
 * Random fleets for blue, with red and green settling straight onto blue's lines wherever the distance rule lets
 * them, which ordinary play seldom does. `check` sees every state, with L and E as the test keeps them.
 */
function stressFleets(
  seed: number,
  check: (g: SeaState, locked: Set<number>, recorded: Map<number, Set<number>>) => void,
) {
  const random = seededRandom(seed),
    pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const sk = seed % 3 ? strait() : outerIslesThree();
  let g: SeaState = { ...state(sk), lockedShips: [], closedShipEnds: {} };
  const locked = new Set<number>(),
    recorded = new Map<number, Set<number>>();
  const free = (v: number) =>
    !g.buildings[v] &&
    g.board.vertices[v]!.neighbors.every((n) => !g.buildings[n]) &&
    isLandIntersection(g.board, v);
  const coast = g.board.vertices.filter((v) => isCoastalIntersection(g.board, v.id)).map((v) => v.id);
  for (let i = 0; i < 3; i++) {
    const v = pick(coast.filter(free));
    if (v !== undefined)
      g = { ...g, buildings: { ...g.buildings, [v]: { player: 'blue', kind: 'settlement' } } };
  }
  const settleOn = (player: string, v: number) => {
    // The test's own L and E, by the book's step 0, before the module's.
    if (player !== 'blue') {
      const after: SeaState = { ...g, buildings: { ...g.buildings, [v]: { player, kind: 'settlement' } } };
      const was = lines(g, 'blue').closed,
        still = lines(after, 'blue').closed;
      for (const e of was) if (!still.has(e)) locked.add(e);
      const meeting = g.board.vertices[v]!.edges.filter((e) => g.ships?.[e] === 'blue');
      if (meeting.length > 1)
        for (const e of meeting) recorded.set(e, new Set([...(recorded.get(e) ?? []), v]));
    }
    g = {
      ...g,
      ...recordClosedEndsOnSettle(g, player, v),
      buildings: { ...g.buildings, [v]: { player, kind: 'settlement' } },
    };
  };
  for (let step = 0; step < 60; step++) {
    const roll = random(),
      fleet = Object.values(g.ships ?? {}).filter((p) => p === 'blue').length;
    if (roll < 0.45 && fleet < 12) {
      const sites = shipSites(g, 'blue', 'build');
      const joins = sites.filter((e) =>
        [g.board.edges[e]!.a, g.board.edges[e]!.b].every(
          (v) => g.buildings[v] || g.board.vertices[v]!.edges.some((o) => g.ships?.[o] === 'blue'),
        ),
      );
      const edge = pick(joins.length && random() < 0.6 ? joins : sites);
      if (edge !== undefined) g = { ...g, ...placeShip(g, 'blue', edge, 'build') };
    } else if (roll < 0.52) {
      // Your roads never close a ship's end, so the fleet gets some.
      const edge = pick(roadSitesOpenSea(g, 'blue'));
      if (edge !== undefined) g = { ...g, roads: { ...g.roads, [edge]: 'blue' } };
    } else if (roll < 0.67) {
      const onLines = g.board.vertices
        .filter((v) => free(v.id) && v.edges.filter((e) => g.ships?.[e] === 'blue').length > 1)
        .map((v) => v.id);
      const v = pick(onLines.length ? onLines : g.board.vertices.map((v) => v.id).filter(free));
      if (v !== undefined) settleOn(random() < 0.8 ? pick(['red', 'green'])! : 'blue', v);
    } else if (roll < 0.95) {
      g = { ...g, shipsBuiltThisTurn: [], shipMovedThisTurn: false };
      const from = pick(movableShips(g, 'blue'));
      if (from !== undefined) {
        g = { ...g, ...moveShip(g, 'blue', from, pick(legalShipDestinations(g, 'blue', from))!) };
        recorded.delete(from);
      }
    } else g = { ...g, pirate: pick(pirateHexes(g.board, g.pirate)) };
    check(g, locked, recorded);
    g = { ...g, shipsBuiltThisTurn: [], shipMovedThisTurn: false };
  }
}

test('§8.5 and §8.7 in random fleets: moves, destinations, L and E match the rules read by brute force', () => {
  let states = 0,
    moves = 0,
    lockedSeen = 0,
    recordedSeen = 0;
  for (let seed = 1; seed <= 30; seed++)
    stressFleets(seed, (g, locked, recorded) => {
      states++;
      assert.deepEqual(g.lockedShips, sorted(locked), `seed ${seed}: L`);
      assert.deepEqual(
        g.closedShipEnds,
        Object.fromEntries([...recorded].map(([e, at]) => [e, sorted(at)])),
        `seed ${seed}: E`,
      );
      // As the step left it, and as the next turn begins, when nothing has been built or moved yet.
      const shape = lines(g, 'blue');
      for (const now of [g, { ...g, shipsBuiltThisTurn: [], shipMovedThisTurn: false }]) {
        const book = bookMoves(now, 'blue', locked, recorded, shape);
        assert.deepEqual(movableShips(now, 'blue'), sorted(book.keys()), `seed ${seed}: movable ships`);
        for (const [x, to] of book) {
          moves += to.length;
          assert.deepEqual(legalShipDestinations(now, 'blue', x), to, `seed ${seed}: where ${x} may go`);
        }
      }
      lockedSeen = Math.max(lockedSeen, locked.size);
      recordedSeen = Math.max(recordedSeen, recorded.size);
    });
  // The generator reaches the cases the records exist for.
  assert.ok(
    states >= 1500 && moves > 50000 && lockedSeen >= 3 && recordedSeen >= 3,
    `${states} ${moves} ${lockedSeen} ${recordedSeen}`,
  );
});

/** Section 8.5's attached, as the book words it: an end at your building, or at your ship where nobody else built. */
function attachedIn(g: SeaState, player: string, edge: number) {
  const { a, b } = g.board.edges[edge]!;
  return [a, b].some(
    (v) =>
      g.buildings[v]?.player === player ||
      (!g.buildings[v] && g.board.vertices[v]!.edges.some((e) => e !== edge && g.ships?.[e] === player)),
  );
}

test('§8.5 in random games with full fleets: no legal move ever detaches a ship that was attached', () => {
  const players = ['red', 'blue', 'green'];
  let tried = 0;
  for (const seed of [11, 12, 13]) {
    const sk = seed % 2 ? outerIslesThree() : strait();
    playRandomly(sk, players, seededRandom(seed), { turns: 90 }, (_, now, player) => {
      // Every move the player could make as their next turn begins, not only the one the game made.
      const g = { ...now, shipsBuiltThisTurn: [], shipMovedThisTurn: false };
      for (const from of movableShips(g, player))
        for (const to of legalShipDestinations(g, player, from)) {
          tried++;
          const after = moved(g, player, from, to);
          assert.ok(attachedIn(after, player, to), 'the moved ship is attached');
          for (const e of Object.keys(g.ships ?? {}).map(Number))
            if (e !== from && g.ships![e] === player && attachedIn(g, player, e))
              assert.ok(attachedIn(after, player, e), `seed ${seed}: moving ${from} to ${to} detaches ${e}`);
        }
      // The records name only ships on the board, and an end only where another player has built.
      for (const e of g.lockedShips ?? []) assert.ok(g.ships?.[e]);
      for (const [e, ends] of Object.entries(g.closedShipEnds ?? {}))
        for (const v of ends) {
          const edge = g.board.edges[Number(e)]!;
          assert.ok(g.ships?.[Number(e)] && (edge.a === v || edge.b === v));
          assert.ok(g.buildings[v] && g.buildings[v]!.player !== g.ships![Number(e)]);
        }
    });
  }
  assert.ok(tried > 10000, `${tried} moves tried`);
});

test('§8 the ship checks run in well under a frame on a full four-player Outer Isles board', () => {
  const players = ['red', 'blue', 'green', 'white'];
  const table = playRandomly(outerIslesFour(), players, seededRandom(3), { turns: 160 }, () => {});
  const g = { ...table, shipsBuiltThisTurn: [], shipMovedThisTurn: false };
  assert.equal(g.board.vertices.length, 190);
  for (const p of players) assert.equal(Object.values(g.ships ?? {}).filter((x) => x === p).length, 15);
  // Everything an action and the view of it may ask, for every player.
  const everything = () => {
    for (const p of players) {
      for (const from of movableShips(g, p)) legalShipDestinations(g, p, from);
      longestRoute(g, p);
      shipSites(g, p, 'build');
      roadSitesOpenSea(g, p);
    }
    longestRouteHolder(g, null);
  };
  everything();
  const started = performance.now();
  for (let i = 0; i < 20; i++) everything();
  const each = (performance.now() - started) / 20;
  assert.ok(each < 25, `${each.toFixed(1)} ms for every check of every player`);
});
