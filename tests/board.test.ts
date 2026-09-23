import test from 'node:test';
import assert from 'node:assert/strict';
import { fairnessIssues, generateBoard, topology } from '../packages/rules/src/board.js';
import type { Board } from '../packages/rules/src/board.js';
import { NUMBER_SPIRAL, RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';

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
