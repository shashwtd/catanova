/** Open Sea's board as the scene draws it: a frame of sea hexes round islands (docs/BIGGER-MAPS-AND-MODES.md). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, hexagon, hexDistance, isCoastalEdge, isLand } from '../packages/rules/src/board.js';
import {
  coastDistance,
  coastPoints,
  frameDistance,
  hasSea,
  HEX_SIZE,
  hexPoints,
  hexSdf,
  islandsBox,
  portPlacement,
  PORT_BADGE_BOUNDS,
  rimPoints,
  SEA_BAND,
  SEA_EDGE_WAVES,
  SEA_SMOOTHING,
  SEA_WORLD_MARGIN,
  seaBadge,
  seaOutline,
  seaWidth,
  WATER_FEATHER,
  WORLD,
  worldBox,
} from '../apps/client/src/scene.js';
import type { ShorePoint } from '../apps/client/src/scene.js';
import {
  fragmentSource,
  MAX_SEA_HEXES,
  MAX_TERRAIN_HEXES,
  seaFragmentSource,
  terrainUniforms,
} from '../apps/client/src/Terrain.js';
import { bareBoard, BIG_TABLE_SHAPE, dealtOuterIsles4, flood, outerIsles4 } from './board-shapes.js';

/** Whether segment a–b crosses segment c–d. */
const intersects = (a: ShorePoint, b: ShorePoint, c: ShorePoint, d: ShorePoint) => {
  const side = (p: ShorePoint, q: ShorePoint, r: ShorePoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

test('a board with sea frames its hexes more closely, as its ring is already water; Classic keeps its box', () => {
  const board = outerIsles4(),
    world = worldBox(board);
  assert.ok(hasSea(board) && !hasSea(generateBoard(481)) && !hasSea(bareBoard(BIG_TABLE_SHAPE)));
  assert.deepEqual(worldBox(generateBoard(481)), WORLD);
  assert.deepEqual(world, { x: -576, y: -520, width: 1152, height: 1040 });
  for (const v of board.vertices) {
    assert.ok(
      v.x * HEX_SIZE - world.x >= SEA_WORLD_MARGIN &&
        world.x + world.width - v.x * HEX_SIZE >= SEA_WORLD_MARGIN,
    );
    assert.ok(
      v.y * HEX_SIZE - world.y >= SEA_WORLD_MARGIN &&
        world.y + world.height - v.y * HEX_SIZE >= SEA_WORLD_MARGIN,
    );
  }
  // The islands' box holds every land hex with a hex of water round it, and none of the ring's far side.
  assert.equal(islandsBox(generateBoard(481)), undefined);
  const islands = islandsBox(board)!;
  assert.deepEqual(
    [islands.x, islands.y, islands.width, islands.height].map((n) => Math.round(n)),
    [-452, -416, 904, 832],
  );
});

test('the rim is one loop round an Open Sea board, and round Classic it is the coast', () => {
  const [rim, ...more] = rimPoints(outerIsles4());
  assert.equal(more.length, 0);
  assert.equal(rim!.length, 70, 'the four-player frame has 70 rim edges');
  assert.deepEqual(rimPoints(generateBoard(42)), coastPoints(generateBoard(42)));
});

test('the scene’s hex distance is the shader’s, and exact', () => {
  const corners = hexPoints(0, 0)
    .split(' ')
    .map((p) => p.split(',').map(Number))
    .map(([x, y]) => ({ x: x!, y: y! }));
  for (let i = 0; i < 400; i++) {
    const x = ((i * 37) % 300) - 150,
      y = ((i * 91) % 280) - 140;
    assert.ok(Math.abs(hexSdf(x, y) - coastDistance(corners, x, y)) < 1e-4, `${x},${y}`);
  }
  assert.ok(Math.abs(hexSdf(0, 0) + (HEX_SIZE * Math.sqrt(3)) / 2) < 1e-4);
  assert.match(seaFragmentSource, /float hex\(vec2 p,float r\)\{p=abs\(p\.yx\);r\*=0\.8660254;/);
});

test('the frame is a smooth union of every hex, land or sea, no further out than the hexes themselves', () => {
  const board = outerIsles4(),
    centres = board.hexes.map((h) => ({ x: h.x * HEX_SIZE, y: h.y * HEX_SIZE }));
  for (let i = 0; i < 300; i++) {
    const x = ((i * 53) % 1136) - 568,
      y = ((i * 97) % 1024) - 512;
    const exact = Math.min(...centres.map((c) => hexSdf(x - c.x, y - c.y))),
      smooth = frameDistance(centres, x, y);
    assert.ok(smooth <= exact + 1e-9 && smooth >= exact - SEA_SMOOTHING * Math.log(centres.length) - 1e-9);
  }
  for (const h of board.hexes)
    assert.ok(frameDistance(centres, h.x * HEX_SIZE, h.y * HEX_SIZE) < -HEX_SIZE * 0.8);
});

test('the sea fills the whole frame and fades into the table on a rounded, wobbling line inside the scene', () => {
  const board = outerIsles4(),
    world = worldBox(board),
    centres = board.hexes.map((h) => ({ x: h.x * HEX_SIZE, y: h.y * HEX_SIZE })),
    alpha = (x: number, y: number) => frameDistance(centres, x, y) - seaWidth(x, y);
  // Opaque over every corner of every hex, the whole outer ring included: the fade starts outside the rim.
  for (const v of board.vertices) assert.ok(alpha(v.x * HEX_SIZE, v.y * HEX_SIZE) < -WATER_FEATHER);
  // And fully transparent before the edge of the scene, on every side.
  for (let step = 0; step <= 200; step++) {
    const x = world.x + (world.width * step) / 200,
      y = world.y + (world.height * step) / 200;
    for (const [px, py] of [
      [x, world.y],
      [x, world.y + world.height],
      [world.x, y],
      [world.x + world.width, y],
    ])
      assert.ok(alpha(px!, py!) > 0, `${px},${py}`);
  }
  for (const inset of [0, WATER_FEATHER / 2, WATER_FEATHER]) {
    const [outline, ...more] = seaOutline(board, inset);
    assert.equal(more.length, 0);
    const turns: number[] = [];
    for (const [i, p] of outline!.entries()) {
      const next = outline![(i + 1) % outline!.length]!,
        after = outline![(i + 2) % outline!.length]!;
      assert.ok(Math.abs(frameDistance(centres, p.x, p.y) - (seaWidth(p.x, p.y) - inset)) < 0.01);
      assert.ok(Math.hypot(next.x - p.x, next.y - p.y) <= 12.5, 'fine segments, not hex sides');
      const turn = Math.atan2(after.y - next.y, after.x - next.x) - Math.atan2(next.y - p.y, next.x - p.x);
      turns.push(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))));
    }
    // The rim turns 60° at every corner. The line the SVG ground feathers, halfway through the fade, bends a few
    // degrees at a time, and no line folds back on itself.
    const limit = inset === WATER_FEATHER / 2 ? 20 : 45;
    assert.ok(
      Math.max(...turns) < (limit * Math.PI) / 180,
      `turns up to ${(Math.max(...turns) * 180) / Math.PI}°`,
    );
    for (let i = 0; i < outline!.length; i++)
      for (let j = i + 2; j < outline!.length - (i === 0 ? 1 : 0); j++)
        assert.ok(
          !intersects(outline![i]!, outline![i + 1]!, outline![j]!, outline![(j + 1) % outline!.length]!),
          'the outline never crosses itself',
        );
  }
  // Its waves follow the world, not an angle about the centre, and stay low.
  const amplitude = SEA_EDGE_WAVES.reduce((sum, wave) => sum + wave.amplitude, 0);
  const widths = Array.from({ length: 400 }, (_, i) => seaWidth(i * 7 - 1400, -500));
  assert.ok(widths.every((w) => Math.abs(w - SEA_BAND) <= amplitude + 1e-9));
  assert.ok(Math.max(...widths) - Math.min(...widths) > amplitude, 'a gentle wobble, not a ruled line');
  // The shader's waves are the same ones, on the position, where Classic's take the angle about the centre.
  assert.doesNotMatch(seaFragmentSource, /atan\(/);
  for (const wave of SEA_EDGE_WAVES)
    assert.ok(
      seaFragmentSource.includes(
        `*${((2 * Math.PI) / wave.wavelength).toFixed(8)}+${wave.phase.toFixed(2)})`,
      ),
    );
});

test('the shader takes land in uLand, the sea two to a vector, and draws gold from its own texture', () => {
  const board = dealtOuterIsles4(),
    uniforms = terrainUniforms(board),
    land = board.hexes.filter(isLand),
    sea = board.hexes.filter((h) => !isLand(h));
  assert.equal(uniforms.count, 30);
  assert.deepEqual(
    [...uniforms.land],
    [
      ...new Float32Array(
        land.flatMap((h) => [h.x * HEX_SIZE, h.y * HEX_SIZE, (h.terrain as string) === 'gold' ? 6 : 5]),
      ),
    ],
  );
  assert.equal(uniforms.seaCount, 47);
  assert.equal(uniforms.sea.length, 96);
  for (const [i, h] of sea.entries()) {
    assert.equal(uniforms.sea[i * 2], Math.fround(h.x * HEX_SIZE));
    assert.equal(uniforms.sea[i * 2 + 1], Math.fround(h.y * HEX_SIZE));
  }
  assert.deepEqual([...uniforms.sea.slice(94)], [0, 0], 'the odd sea hex out pads its vector');
  assert.deepEqual(uniforms.world, worldBox(board));
  // Room for both arrays and the rest in the 224 vectors WebGL 2 guarantees.
  assert.ok(MAX_TERRAIN_HEXES + MAX_SEA_HEXES / 2 + 4 <= 224);
  assert.match(
    seaFragmentSource,
    new RegExp(`uniform vec3 uLand\\[${MAX_TERRAIN_HEXES}\\];\\s*uniform int uCount;`),
  );
  assert.match(
    seaFragmentSource,
    new RegExp(`uniform vec4 uSea\\[${MAX_SEA_HEXES / 2}\\];\\s*uniform int uSeaCount;`),
  );
  assert.match(seaFragmentSource, /uniform sampler2D uGold;/);
  assert.match(seaFragmentSource, /tile>5\.5\?texture\(uGold,uv\)/);
  assert.doesNotMatch(fragmentSource, /uGold|uSea/, 'the Classic shader is left as it was');
  // A gold field needs the sea shader: on a board without sea the SVG ground draws it.
  const golden = bareBoard(hexagon(2));
  Object.assign(golden.hexes[0]!, { terrain: 'gold' });
  assert.throws(() => terrainUniforms(golden), /gold fields on boards with sea/);
  assert.throws(
    () => terrainUniforms(flood(bareBoard(hexagon(7)), (h) => hexDistance(h, { q: 0, r: 0 }) <= 1)),
    /128 sea hexes, not 162/,
  );
});

test('harbour badges on a sea board sit nearer the shore, clear of the sea hex’s middle, inside the scene', () => {
  const board = outerIsles4(),
    world = worldBox(board);
  for (const edge of board.edges.filter((e) => isCoastalEdge(board, e))) {
    const pose = portPlacement(board, edge.id),
      badge = seaBadge(pose),
      out = (x: number, y: number) => (x - pose.x) * pose.nx + (y - pose.y) * pose.ny;
    // Past the piers' ends, and nearer the shore than Classic's badge, which sits on the sea hex's middle.
    for (const bridge of pose.bridges)
      assert.ok(out(badge.markerX, badge.markerY) > out(bridge.to.x, bridge.to.y));
    assert.ok(out(badge.markerX, badge.markerY) < out(pose.markerX, pose.markerY) - 25);
    assert.ok(out(badge.markerX, badge.markerY) < (HEX_SIZE * Math.sqrt(3)) / 2 - 20);
    for (const [x, y] of [
      [PORT_BADGE_BOUNDS.x, PORT_BADGE_BOUNDS.y],
      [PORT_BADGE_BOUNDS.x + PORT_BADGE_BOUNDS.width, PORT_BADGE_BOUNDS.y + PORT_BADGE_BOUNDS.height],
    ]) {
      assert.ok(badge.markerX + x! > world.x + 4 && badge.markerX + x! < world.x + world.width - 4);
      assert.ok(badge.markerY + y! > world.y + 4 && badge.markerY + y! < world.y + world.height - 4);
    }
  }
});
