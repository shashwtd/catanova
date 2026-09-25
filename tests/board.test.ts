import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fairnessIssues,
  generateBoard,
  hexagon,
  hexDistance,
  isCoastalEdge,
  shoreHex,
  topology,
} from '../packages/rules/src/board.js';
import { createGame } from '../packages/rules/src/game.js';
import type { Board, BoardShape } from '../packages/rules/src/board.js';
import { NUMBER_SPIRAL, RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';
import { BIG_TABLE_SHAPE, flood } from './board-shapes.js';

test('island topology has shared corners and edges, without duplicate geometry', () => {
  const board = topology();
  assert.equal(board.hexes.length, 19);
  assert.equal(board.vertices.length, 54);
  assert.equal(board.edges.length, 72);
  assert.equal(board.edges.filter((e) => e.hexes.length === 1).length, 30);
  for (const v of board.vertices) {
    assert.ok(v.hexes.length <= 3);
    for (const n of v.neighbors) assert.ok(board.vertices[n]!.neighbors.includes(v.id));
  }
});

/** Every cross-reference in a board's graph agrees with every other, for a shape with no lakes in it. */
function assertConsistent(shape: BoardShape) {
  const { hexes, vertices, edges } = topology(shape);
  assert.deepEqual(
    hexes.map(({ id, q, r }) => ({ id, q, r })),
    shape.map(({ q, r }, id) => ({ id, q, r })),
    'hexes are numbered in the order the shape lists them',
  );
  const touching = (a: number, b: number) =>
    edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (const h of hexes) {
    assert.equal(new Set(h.vertices).size, 6);
    for (const [k, v] of h.vertices.entries()) {
      assert.ok(vertices[v]!.hexes.includes(h.id));
      assert.ok(touching(v, h.vertices[(k + 1) % 6]!)!.hexes.includes(h.id));
    }
    assert.deepEqual(
      h.neighbors,
      hexes.filter((o) => hexDistance(h, o) === 1).map((o) => o.id),
    );
    for (const n of h.neighbors)
      assert.equal(
        h.vertices.filter((v) => hexes[n]!.vertices.includes(v)).length,
        2,
        'neighbours share an edge',
      );
  }
  for (const v of vertices) {
    assert.ok(v.hexes.length >= 1 && v.hexes.length <= 3);
    assert.ok(v.neighbors.length >= 2 && v.neighbors.length <= 3);
    assert.equal(v.edges.length, v.neighbors.length);
    for (const n of v.neighbors) {
      assert.ok(vertices[n]!.neighbors.includes(v.id));
      assert.ok(v.edges.includes(touching(v.id, n)!.id));
      assert.ok(Math.abs(Math.hypot(vertices[n]!.x - v.x, vertices[n]!.y - v.y) - 1) < 1e-9);
    }
  }
  for (const e of edges) {
    assert.ok(e.a !== e.b && e.hexes.length >= 1 && e.hexes.length <= 2);
    for (const h of e.hexes) assert.ok(hexes[h]!.vertices.includes(e.a) && hexes[h]!.vertices.includes(e.b));
  }
  // Euler's formula for one piece of plane with no holes: corners - edges + hexes = 1.
  assert.equal(vertices.length - edges.length + hexes.length, 1);
  // The scene is centred on the origin, so the middle of the board must be there.
  const xs = vertices.map((v) => v.x),
    ys = vertices.map((v) => v.y);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys) + Math.max(...ys)) < 1e-9);
  return { hexes, vertices, edges, coast: edges.filter((e) => e.hexes.length === 1) };
}

test('a board is built from any list of hexes, the Classic island from its own', () => {
  const classic = assertConsistent(hexagon(2));
  assert.deepEqual(topology(hexagon(2)), topology());
  assert.equal(classic.coast.length, 30);
  // A 30-hex island has an even middle row, so no hex sits at its centre; it is moved to the origin all the same.
  const big = assertConsistent(BIG_TABLE_SHAPE);
  assert.deepEqual(
    [big.hexes.length, big.vertices.length, big.edges.length, big.coast.length],
    [30, 80, 109, 38],
  );
  // Every edge that is not on the coast joins two neighbouring hexes.
  assert.equal(big.hexes.reduce((sum, h) => sum + h.neighbors.length, 0) / 2, 109 - 38);
  assert.throws(
    () =>
      topology([
        { q: 0, r: 0 },
        { q: 0, r: 0 },
      ]),
    /twice/,
  );
  assert.throws(() => topology([{ q: 0.5, r: 0 }]), /not a hex/);
});

test('the coast is where land meets sea, whether the sea is hexes or the world beyond the rim', () => {
  const classic = topology();
  assert.deepEqual(
    classic.edges.filter((e) => isCoastalEdge(classic, e)),
    classic.edges.filter((e) => e.hexes.length === 1),
  );
  // The Classic island in a ring of sea hexes: every edge now touches two hexes, and the coast is where it was.
  const ringed = flood(topology(hexagon(3)), (h) => hexDistance(h, { q: 0, r: 0 }) <= 2);
  const coast = ringed.edges.filter((e) => isCoastalEdge(ringed, e));
  assert.equal(coast.length, 30);
  assert.ok(coast.every((e) => e.hexes.length === 2));
  const midpoint = (board: typeof classic, id: number) => {
    const e = board.edges[id]!,
      [a, b] = [board.vertices[e.a]!, board.vertices[e.b]!];
    const round = (n: number) => Math.round(n * 1e6) / 1e6 || 0;
    return `${round((a.x + b.x) / 2)},${round((a.y + b.y) / 2)}`;
  };
  assert.deepEqual(
    coast.map((e) => midpoint(ringed, e.id)).sort(),
    classic.edges
      .filter((e) => isCoastalEdge(classic, e))
      .map((e) => midpoint(classic, e.id))
      .sort(),
  );
  // The sea ring's own rim is open water, and the shore is always the land side, whichever hex an edge lists first.
  assert.equal(
    ringed.edges.filter((e) => e.hexes.length === 1).filter((e) => isCoastalEdge(ringed, e)).length,
    0,
  );
  assert.ok(coast.some((e) => ringed.hexes[e.hexes[0]!]!.terrain === ('sea' as string)));
  for (const e of coast) assert.ok(hexDistance(shoreHex(ringed, e), { q: 0, r: 0 }) === 2);
  assert.throws(
    () =>
      shoreHex(
        ringed,
        ringed.edges.find((e) => !isCoastalEdge(ringed, e))!,
      ),
    /coastal/,
  );
});
/** Edge k of a hex joins its corners k and k + 1 and faces this axial direction: NE, E, SE, SW, W, NW. */
const FACING = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;
/** The sea space across a coastal edge, in axial coordinates. */
function seaSpace(board: Board, edgeId: number) {
  const e = board.edges[edgeId]!,
    h = board.hexes[e.hexes[0]!]!;
  const k = h.vertices.findIndex((v, i) => {
    const w = h.vertices[(i + 1) % 6]!;
    return (v === e.a && w === e.b) || (v === e.b && w === e.a);
  });
  return { q: h.q + FACING[k]![0], r: h.r + FACING[k]![1] };
}
const seaSteps = (a: { q: number; r: number }, b: { q: number; r: number }) =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
/** The six sea spaces off the island's tips each sit at two of the three axial extremes. */
const offTip = ({ q, r }: { q: number; r: number }) =>
  [q, r, -q - r].filter((c) => Math.abs(c) === 3).length === 2;
const timed = <T>(deal: () => T): [T, number] => {
  const started = performance.now();
  const result = deal();
  return [result, performance.now() - started];
};
test('500 seeded islands preserve the supply and satisfy every balance constraint', () => {
  const fingerprints = new Set<string>();
  const elapsed: number[] = [];
  for (let seed = 0; seed < 500; seed++) {
    const [b, ms] = timed(() => generateBoard(seed));
    elapsed.push(ms);
    assert.deepEqual(fairnessIssues(b), [], `seed ${seed}`);
    // Checked here too, so loosening fairnessIssues cannot let these through unnoticed.
    for (const h of b.hexes)
      for (const n of h.neighbors) {
        const [x, y] = [h.number, b.hexes[n]!.number];
        assert.ok(!x || x !== y, `seed ${seed}: two ${x}s share a border`);
        assert.ok(!(x === 2 && y === 12), `seed ${seed}: the 2 borders the 12`);
      }
    for (const r of RESOURCES)
      assert.equal(b.hexes.filter((h) => h.terrain === r).length, r === 'brick' || r === 'ore' ? 3 : 4);
    assert.equal(b.hexes.filter((h) => h.terrain === 'desert' && h.number === 0).length, 1);
    assert.deepEqual(
      b.hexes
        .map((h) => h.number)
        .filter(Boolean)
        .sort(),
      [...NUMBER_SPIRAL].sort(),
    );
    const portVertices = b.ports.flatMap((p) => [b.edges[p.edge]!.a, b.edges[p.edge]!.b]);
    assert.equal(new Set(portVertices).size, 18);
    assert.equal(b.ports.filter((p) => p.resource === 'any').length, 4);
    assert.deepEqual(
      b.ports.map((p) => p.resource).sort(),
      ['any', 'any', 'any', 'any', ...RESOURCES].sort(),
    );
    // Harbours alternate with open sea all round the island, as on the fixed frame: nine different sea spaces
    // out of the eighteen, none beside another, three of them off the island's tips.
    const seas = b.ports.map((p) => seaSpace(b, p.edge));
    assert.equal(new Set(seas.map(({ q, r }) => `${q},${r}`)).size, 9, `seed ${seed}`);
    for (const [i, sea] of seas.entries())
      for (const other of seas.slice(i + 1))
        assert.ok(seaSteps(sea, other) > 1, `seed ${seed}: harbours on neighbouring sea spaces`);
    assert.equal(seas.filter(offTip).length, 3, `seed ${seed}`);
    fingerprints.add(JSON.stringify(b.hexes.map((h) => [h.terrain, h.number])));
  }
  assert.equal(fingerprints.size, 500);
  assert.deepEqual(generateBoard(281), generateBoard(281));
  assert.deepEqual(Object.values(RESOURCE_NAMES), ['Timber', 'Clay', 'Sheep', 'Hay', 'Rock']);
  // Every island must deal quickly, not just the average one. A seed over budget is re-timed and keeps its best
  // of three runs, so a scheduling hiccup on a busy machine cannot fail the bound by itself.
  for (const [seed, ms] of elapsed.entries())
    if (ms > 100) {
      const best = Math.min(...[0, 1, 2].map(() => timed(() => generateBoard(seed))[1]));
      assert.ok(best < 100, `seed ${seed} took ${best.toFixed(1)} ms to deal`);
    }
});
test('equal numbers, two red numbers, or the 2 and the 12 may not share a border', () => {
  const board = topology();
  const a = board.hexes[9]!,
    b = board.hexes[a.neighbors[0]!]!;
  const borderIssues = (x: number, y: number) => {
    a.number = x;
    b.number = y;
    return [...new Set(fairnessIssues(board).filter((issue) => issue.startsWith('Adjacent')))];
  };
  assert.deepEqual(borderIssues(5, 5), ['Adjacent equal numbers']);
  assert.deepEqual(borderIssues(6, 8), ['Adjacent red numbers']);
  assert.deepEqual(borderIssues(8, 8), ['Adjacent red numbers', 'Adjacent equal numbers']);
  assert.deepEqual(borderIssues(2, 12), ['Adjacent 2 and 12']);
  assert.deepEqual(borderIssues(12, 2), ['Adjacent 2 and 12']);
  assert.deepEqual(borderIssues(5, 9), []);
  assert.deepEqual(borderIssues(2, 11), []);
});
test('new islands are balanced-v2, and boards saved as balanced-v1 remain valid', () => {
  for (let seed = 0; seed < 20; seed++) assert.equal(generateBoard(seed).preset, 'balanced-v2');
  // A seed deals a different island under v2, but saved games keep the board they were dealt, so the old id
  // must stay a valid Board. tsc checks this file: dropping 'balanced-v1' from the type fails here.
  const saved = JSON.parse(JSON.stringify(generateBoard(281))) as Board;
  saved.preset = 'balanced-v1';
});

test('a game starts on the island its lobby was dealt, even one from an older generator', () => {
  const seats = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  // A lobby opened before a generator change keeps the island it showed.
  const dealt = generateBoard(1234);
  const older = { ...structuredClone(dealt), preset: 'balanced-v1' as const };
  older.hexes[0]!.number = older.hexes[0]!.number === 5 ? 9 : 5;
  const game = createGame(seats, 1234, () => 0.5, { board: older });
  assert.deepEqual(game.board, older);
  assert.throws(() => createGame(seats, 99, () => 0.5, { board: older }), /does not match its seed/);
});
