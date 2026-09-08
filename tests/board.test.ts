import test from 'node:test';
import assert from 'node:assert/strict';
import { fairnessIssues, generateBoard, topology } from '../packages/rules/src/board.js';
import { NUMBER_SPIRAL, RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';

test('island topology has shared corners and edges, without duplicate geometry', () => {
  const board = topology();
  assert.equal(board.hexes.length, 19); assert.equal(board.vertices.length, 54); assert.equal(board.edges.length, 72);
  assert.equal(board.edges.filter(e => e.hexes.length === 1).length, 30);
  for (const v of board.vertices) {
    assert.ok(v.hexes.length <= 3);
    for (const n of v.neighbors) assert.ok(board.vertices[n]!.neighbors.includes(v.id));
  }
});
test('500 seeded islands preserve the supply and satisfy every balance constraint', () => {
  const fingerprints = new Set<string>();
  for (let seed = 0; seed < 500; seed++) {
    const b = generateBoard(seed);
    assert.deepEqual(fairnessIssues(b), [], `seed ${seed}`);
    for (const r of RESOURCES) assert.equal(b.hexes.filter(h => h.terrain === r).length, r === 'brick' || r === 'ore' ? 3 : 4);
    assert.equal(b.hexes.filter(h => h.terrain === 'desert' && h.number === 0).length, 1);
    assert.deepEqual(b.hexes.map(h => h.number).filter(Boolean).sort(), [...NUMBER_SPIRAL].sort());
    const portVertices = b.ports.flatMap(p => [b.edges[p.edge]!.a, b.edges[p.edge]!.b]);
    assert.equal(new Set(portVertices).size, 18);
    assert.equal(b.ports.filter(p => p.resource === 'any').length, 4);
    fingerprints.add(JSON.stringify(b.hexes.map(h => [h.terrain, h.number])));
  }
  assert.equal(fingerprints.size, 500);
  assert.deepEqual(generateBoard(281), generateBoard(281));
  assert.deepEqual(Object.values(RESOURCE_NAMES), ['Timber', 'Clay', 'Sheep', 'Hay', 'Rock']);
});
