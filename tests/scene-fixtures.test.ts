import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateBoard } from '../packages/rules/src/board.js';
import { coastline, portPlacement } from '../apps/client/src/scene.js';
import { SCENE_FIXTURE, sceneFixture } from './board-fixtures.js';

/** Written by board-fixtures.ts. Rewrite it only as that file describes, never just to make these tests pass. */
const pinned = JSON.parse(readFileSync(SCENE_FIXTURE, 'utf8')) as ReturnType<typeof sceneFixture>;
const current = sceneFixture();

test('the Classic world box is the one the camera, the SVG and the shader have always used', () => {
  assert.deepEqual(current.world, pinned.world);
});

test('the Classic coastline, water outlines and harbour poses are unchanged to the last digit', () => {
  assert.equal(current.coastline, pinned.coastline);
  assert.deepEqual(current.water, pinned.water);
  assert.deepEqual(current.ports, pinned.ports);
  // They follow from the island's shape, so every Classic seed shares them.
  for (const seed of [0, 42, 2026, 98765]) {
    const board = generateBoard(seed);
    assert.deepEqual(coastline(board), [pinned.coastline], `seed ${seed}`);
    for (const port of board.ports)
      assert.deepEqual(
        { edge: port.edge, ...portPlacement(board, port.edge) },
        pinned.ports.find((pose) => pose.edge === port.edge),
        `seed ${seed}, harbour on edge ${port.edge}`,
      );
  }
});

test('the camera fits, zooms and clamps the Classic island as it did at every pinned viewport', () => {
  assert.deepEqual(current.camera, pinned.camera);
});

test('the board, the lounge table and the viewport render the same SVG markup', () => {
  const changed = Object.keys(pinned.markup).filter((name) => current.markup[name] !== pinned.markup[name]);
  assert.deepEqual(
    changed,
    [],
    'diff `npx tsx tests/board-fixtures.ts markup <name>` against the same command on main to see what moved',
  );
  assert.deepEqual(Object.keys(current.markup), Object.keys(pinned.markup));
});

test('the WebGL terrain shader is the pinned source', () => {
  // Node has no WebGL, so only screenshots can show what it paints. Phase 0 changed it to take more than 19 hexes,
  // and pinned the new source once Classic screenshots in both board themes were identical before and after. Any
  // further change needs the same comparison before its source is pinned.
  assert.equal(current.shader, pinned.shader);
});
