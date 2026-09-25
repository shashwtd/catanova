import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateBoard, hexagon, hexDistance, isCoastalEdge, isLand } from '../packages/rules/src/board.js';
import type { Axial } from '../packages/rules/src/board.js';
import {
  coastline,
  HEX_SIZE,
  coastDistance,
  coastPoints,
  waterOutline,
  waterWidth,
  portPlacement,
  shoreDistance,
  WORLD,
  MATERIAL_GUTTER,
  MATERIAL_QUADRANTS,
  SHIP_BOUNDS,
  PORT_BADGE_BOUNDS,
  SHIP_COAST_DISTANCE,
  WATER_FEATHER,
  WORLD_MARGIN,
  worldBox,
} from '../apps/client/src/scene.js';
import { constrainCamera, fitBoard } from '../apps/client/src/camera.js';
import { Board } from '../apps/client/src/Board.js';
import { BoardViewport } from '../apps/client/src/BoardViewport.js';
import { fragmentSource, MAX_TERRAIN_HEXES, terrainUniforms } from '../apps/client/src/Terrain.js';
import { BIG_TABLE_SHAPE, bareBoard, flood } from './board-shapes.js';

test('the calm continuous water band follows the coast and leaves room for its shadow within the scene', () => {
  const board = generateBoard(42),
    coasts = coastPoints(board),
    coast = coasts[0]!,
    outline = waterOutline(board);
  assert.equal(coasts.length, 1, 'the Classic island has one coast');
  assert.equal(outline.length, 240);
  const widths = new Set<number>();
  for (let index = 0; index < outline.length; index++) {
    const point = outline[index]!,
      next = outline[(index + 1) % outline.length]!;
    assert.ok(point.x >= WORLD.x + 9 && point.x <= WORLD.x + WORLD.width - 9);
    assert.ok(point.y >= WORLD.y + 9 && point.y <= WORLD.y + WORLD.height - 9);
    const width = coastDistance(coast, point.x, point.y);
    assert.ok(width >= 87.6 && width <= 92.4);
    assert.ok(Math.abs(width - waterWidth(Math.atan2(point.y, point.x))) < 0.001);
    widths.add(Math.round(width * 10));
    assert.ok(
      Math.hypot(next.x - point.x, next.y - point.y) < 14,
      'the outline has fine organic segments rather than hex sides',
    );
  }
  assert.ok(widths.size > 10, 'the water edge retains a gentle natural variation');
  const widthsByAngle = outline.map((point) => waterWidth(Math.atan2(point.y, point.x)));
  const variation = widthsByAngle.reduce(
    (sum, width, index) => sum + Math.abs(width - widthsByAngle[(index + 1) % widthsByAngle.length]!),
    0,
  );
  assert.ok(variation < 40, 'small broad curves replace the old high-frequency ripples');
  assert.ok(coastDistance(coast, 0, 0) < 0);
  assert.ok(coast.every((point) => coastDistance(outline, point.x, point.y) < 0));
});

test('coast-aligned ships and outer trade badges fit every coast, with separate boarding points', () => {
  for (const seed of [1, 42, 2026, 98765]) {
    const board = generateBoard(seed);
    const [shore, ...more] = coastline(board);
    assert.equal(more.length, 0);
    const coast = shore!.split(' ').map((p) => p.split(',').map(Number));
    assert.equal(coast.length, 30);
    for (let i = 0; i < coast.length; i++) {
      const a = coast[i]!,
        b = coast[(i + 1) % coast.length]!;
      assert.ok(Math.abs(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) - HEX_SIZE) < 0.02);
    }
    for (const edge of board.edges.filter((e) => e.hexes.length === 1)) {
      const pose = portPlacement(board, edge.id);
      const a = board.vertices[edge.a]!,
        b = board.vertices[edge.b]!,
        h = board.hexes[edge.hexes[0]!]!;
      assert.ok(Math.abs(pose.nx * (b.x - a.x) + pose.ny * (b.y - a.y)) < 0.001);
      assert.ok((pose.x - h.x * HEX_SIZE) * pose.nx + (pose.y - h.y * HEX_SIZE) * pose.ny > 0);
      assert.ok(Math.abs(pose.x - ((a.x + b.x) * HEX_SIZE) / 2) < 1e-8);
      assert.ok(Math.abs(pose.y - ((a.y + b.y) * HEX_SIZE) / 2) < 1e-8);
      const angle = (pose.angle * Math.PI) / 180;
      assert.ok(
        Math.abs(Math.cos(angle) * pose.nx + Math.sin(angle) * pose.ny - 1) < 1e-8,
        'the ship side faces the coast and its length follows the edge',
      );
      assert.equal(pose.bridges.length, 2);
      assert.deepEqual(
        pose.bridges.map((bridge) => bridge.from),
        [a, b].map((vertex) => ({ x: vertex.x * HEX_SIZE, y: vertex.y * HEX_SIZE })),
      );
      for (const bridge of pose.bridges) {
        const length = Math.hypot(bridge.to.x - bridge.from.x, bridge.to.y - bridge.from.y);
        assert.ok(length > 24 && length < 34, 'piers stay short and consistent at every coast angle');
      }
      assert.notDeepEqual(pose.bridges[0]!.to, pose.bridges[1]!.to, 'each bridge has its own boarding point');
      for (const bridge of pose.bridges) {
        const localX = bridge.to.x - pose.boatX,
          localY = bridge.to.y - pose.boatY;
        const hullX = localX * Math.cos(angle) + localY * Math.sin(angle);
        const hullY = -localX * Math.sin(angle) + localY * Math.cos(angle);
        assert.ok(
          hullX < 0 && Math.abs(hullX) < SHIP_BOUNDS.width / 2 && Math.abs(hullY) < SHIP_BOUNDS.width / 2,
          'boarding is on the exposed shore-facing side of the sprite',
        );
        assert.ok(localX * pose.nx + localY * pose.ny < 0, 'boarding meets the shore-facing hull');
        assert.ok(
          (bridge.to.x - pose.x) * pose.nx + (bridge.to.y - pose.y) * pose.ny > 0,
          'bridges extend outward from the actual eligible vertices',
        );
      }
      const badgeOutward = (pose.markerX - pose.boatX) * pose.nx + (pose.markerY - pose.boatY) * pose.ny;
      assert.ok(
        badgeOutward -
          ((PORT_BADGE_BOUNDS.width / 2) * Math.abs(pose.nx) +
            (PORT_BADGE_BOUNDS.height / 2) * Math.abs(pose.ny)) >
          15,
        'the entire trade badge is beyond the seaward side of the hull',
      );
      const shipCorners = [SHIP_BOUNDS.x, SHIP_BOUNDS.x + SHIP_BOUNDS.width].flatMap((x) =>
        [SHIP_BOUNDS.y, SHIP_BOUNDS.y + SHIP_BOUNDS.height].map((y) => ({
          x: pose.boatX + x * Math.cos(angle) - y * Math.sin(angle),
          y: pose.boatY + x * Math.sin(angle) + y * Math.cos(angle),
        })),
      );
      assert.ok(
        Math.abs((pose.boatX - pose.x) * pose.nx + (pose.boatY - pose.y) * pose.ny - SHIP_COAST_DISTANCE) <
          1e-8,
        'the ship leaves room for two short piers',
      );
      const badgeCorners = [PORT_BADGE_BOUNDS.x, PORT_BADGE_BOUNDS.x + PORT_BADGE_BOUNDS.width].flatMap((x) =>
        [PORT_BADGE_BOUNDS.y, PORT_BADGE_BOUNDS.y + PORT_BADGE_BOUNDS.height].map((y) => ({
          x: pose.markerX + x,
          y: pose.markerY + y,
        })),
      );
      for (const { x, y } of [...shipCorners, ...badgeCorners]) {
        assert.ok(
          x >= WORLD.x + 4 && x <= WORLD.x + WORLD.width - 4,
          'ship and badge fit the camera horizontally',
        );
        assert.ok(
          y >= WORLD.y + 4 && y <= WORLD.y + WORLD.height - 4,
          'ship and badge fit the camera vertically',
        );
      }
    }
    assert.throws(
      () => portPlacement(board, board.edges.find((e) => e.hexes.length === 2)!.id),
      /coastal edge/,
    );
  }
});

test('the scene frames the board it is given: the Classic box for Classic, a bigger one for a bigger island', () => {
  for (const seed of [0, 42, 481, 2026]) assert.deepEqual(worldBox(generateBoard(seed)), WORLD);
  assert.deepEqual(WORLD, { x: -392, y: -368, width: 784, height: 736 });
  const big = bareBoard(BIG_TABLE_SHAPE),
    world = worldBox(big);
  assert.deepEqual(world, { x: -448, y: -464, width: 896, height: 928 });
  for (const v of big.vertices) {
    assert.ok(
      v.x * HEX_SIZE - world.x >= WORLD_MARGIN && world.x + world.width - v.x * HEX_SIZE >= WORLD_MARGIN,
    );
    assert.ok(
      v.y * HEX_SIZE - world.y >= WORLD_MARGIN && world.y + world.height - v.y * HEX_SIZE >= WORLD_MARGIN,
    );
  }
  // The camera fits that box's shape, not the Classic one, and still lets the whole of it be panned into view.
  const bounds = { width: 375, height: 520 },
    fitted = fitBoard(bounds, world);
  assert.ok(Math.abs(fitted.width / fitted.height - 896 / 928) < 1e-9);
  assert.ok(fitted.width <= bounds.width - 24 && fitted.height <= bounds.height - 24 + 1e-9);
  const far = constrainCamera({ scale: 2.2, x: 5000, y: -5000 }, bounds, world);
  assert.ok(
    far.x >= (fitted.width * 2.2 - bounds.width) / 2 && -far.y >= (fitted.height * 2.2 - bounds.height) / 2,
  );
  // And the SVG, the stage and the viewport take it too.
  const island = renderToStaticMarkup(
    createElement(Board, { board: big, mode: null, disabled: true, onAction: () => {}, onRobber: () => {} }),
  );
  assert.match(island, /viewBox="-448 -464 896 928"/);
  assert.match(island, /aspect-ratio:896\/928/);
  assert.match(island, /<rect class="water-band" x="-448" y="-464" width="896" height="928"/);
  assert.equal((island.match(/class="terrain-hit/g) ?? []).length, 30);
  const viewport = renderToStaticMarkup(createElement(BoardViewport, { board: big, children: 'board' }));
  assert.match(viewport, /aspect-ratio:896\/928/);
});

test('the terrain shader takes every hex of a bigger board, and refuses a board past its limit', () => {
  // Node has no WebGL: the screenshots show the Classic island painted as before, and this shows what the shader
  // is given and that its source no longer stops at the 19th hex.
  const classic = terrainUniforms(generateBoard(481));
  assert.equal(classic.count, 19);
  assert.equal(classic.land.length, 57);
  assert.deepEqual(classic.world, WORLD);
  const big = bareBoard(BIG_TABLE_SHAPE),
    uniforms = terrainUniforms(big);
  assert.equal(uniforms.count, 30);
  assert.deepEqual(
    [...uniforms.land],
    [...new Float32Array(big.hexes.flatMap((h) => [h.x * HEX_SIZE, h.y * HEX_SIZE, 5]))],
  );
  assert.deepEqual(uniforms.world, worldBox(big));
  assert.ok(
    uniforms.count <= MAX_TERRAIN_HEXES && MAX_TERRAIN_HEXES + 3 <= 224,
    'within WebGL 2 uniform space',
  );
  assert.match(
    fragmentSource,
    new RegExp(`uniform vec3 uLand\\[${MAX_TERRAIN_HEXES}\\];\\s*uniform int uCount;`),
  );
  assert.match(fragmentSource, /for\(int i=0;i<uCount;i\+\+\)\{float d=hex\(p-uLand\[i\]\.xy,64\.0\)/);
  assert.doesNotMatch(fragmentSource, /\[19\]|<19;/);
  assert.throws(() => terrainUniforms(bareBoard(hexagon(7))), /takes 128 hexes, not 169/);
});

test('every island has its own coast, whether the water between them is sea hexes or off the board', () => {
  const inIslands = (h: Axial) => hexDistance(h, { q: -2, r: 0 }) <= 1 || hexDistance(h, { q: 2, r: 0 }) <= 1;
  const apart = bareBoard(hexagon(3).filter(inIslands)),
    framed = flood(bareBoard(hexagon(4)), inIslands);
  const at = ({ x, y }: { x: number; y: number }) =>
    `${Math.round(x * 1000) || 0},${Math.round(y * 1000) || 0}`;
  const shores = [apart, framed].map((board) => {
    const coasts = coastPoints(board);
    assert.deepEqual(
      coasts.map((coast) => coast.length),
      [18, 18],
    );
    assert.deepEqual(
      coastline(board),
      coasts.map((coast) => coast.map(({ x, y }) => `${x},${y}`).join(' ')),
    );
    assert.equal(
      board.edges.filter((e) => isCoastalEdge(board, e)).length,
      36,
      'every coastal edge is walked once',
    );
    for (const coast of coasts)
      for (const [i, point] of coast.entries()) {
        const next = coast[(i + 1) % coast.length]!;
        assert.ok(Math.abs(Math.hypot(next.x - point.x, next.y - point.y) - HEX_SIZE) < 1e-9);
      }
    // Each coast holds one island's seven hexes and no sea; the sea between them is outside both.
    for (const h of board.hexes) {
      const within = coasts.filter((coast) => coastDistance(coast, h.x * HEX_SIZE, h.y * HEX_SIZE) < 0);
      assert.equal(within.length, isLand(h) ? 1 : 0);
      assert.equal(shoreDistance(coasts, h.x * HEX_SIZE, h.y * HEX_SIZE) < 0, isLand(h));
    }
    assert.ok(shoreDistance(coasts, 0, 0) > 0);
    // The painted band is still one island's (see waterOutline), but a board of two does not break it.
    const outline = waterOutline(board, WATER_FEATHER / 2);
    assert.equal(outline.length, 240);
    assert.ok(outline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    return coasts.flat().map(at).sort();
  });
  assert.deepEqual(shores[0], shores[1], 'the coasts are in the same places either way');
  // Board draws the shallows and the sand of both.
  const island = renderToStaticMarkup(
    createElement(Board, {
      board: apart,
      mode: null,
      disabled: true,
      onAction: () => {},
      onRobber: () => {},
    }),
  );
  assert.equal((island.match(/fill="#52bebf"/g) ?? []).length, 2);
  assert.equal((island.match(/fill="url\(#sand-material\)"/g) ?? []).length, 2);
  assert.ok(island.lastIndexOf('fill="#52bebf"') < island.indexOf('fill="url(#sand-material)"'));
});

test('a harbour on a coast of sea hexes is posed exactly as it is on the rim of the board', () => {
  const classic = generateBoard(42),
    ringed = flood(bareBoard(hexagon(3)), (h) => hexDistance(h, { q: 0, r: 0 }) <= 2);
  const at = (x: number, y: number) => `${Math.round(x * 1000) || 0},${Math.round(y * 1000) || 0}`;
  const expected = new Map(
    classic.edges
      .filter((e) => e.hexes.length === 1)
      .map((e) => portPlacement(classic, e.id))
      .map((pose) => [at(pose.x, pose.y), pose]),
  );
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  const coast = ringed.edges.filter((e) => isCoastalEdge(ringed, e));
  assert.equal(coast.length, 30);
  for (const e of coast) {
    const pose = portPlacement(ringed, e.id),
      want = expected.get(at(pose.x, pose.y))!;
    for (const key of ['nx', 'ny', 'boatX', 'boatY', 'markerX', 'markerY'] as const)
      close(pose[key], want[key]);
    close(((pose.angle - want.angle + 540) % 360) - 180, 0);
    const piers = (p: typeof pose) =>
      p.bridges
        .map((b) => [b.from.x, b.from.y, b.to.x, b.to.y])
        .sort((a, b) => Math.round(a[0]! - b[0]!) || a[1]! - b[1]!);
    piers(pose).forEach((pier, i) => pier.forEach((n, k) => close(n, piers(want)[i]![k]!)));
  }
  for (const e of [
    ringed.edges.find((e) => e.hexes.every((h) => hexDistance(ringed.hexes[h]!, { q: 0, r: 0 }) === 3))!,
    ringed.edges.find((e) => e.hexes.length === 1)!,
  ])
    assert.throws(() => portPlacement(ringed, e.id), /coastal edge/, 'open water has no harbour');
});

test('the feather mask covers the entire coast and becomes transparent before the world boundary', () => {
  const board = generateBoard(42),
    coast = coastPoints(board)[0]!,
    halfOpacity = waterOutline(board, WATER_FEATHER / 2),
    opaqueCore = waterOutline(board, WATER_FEATHER);
  assert.ok(coast.every(({ x, y }) => coastDistance(opaqueCore, x, y) < 0));
  for (const { x, y } of halfOpacity) {
    const width = waterWidth(Math.atan2(y, x));
    assert.ok(Math.abs(coastDistance(coast, x, y) - (width - WATER_FEATHER / 2)) < 0.001);
  }
  // Both the smoothstep shader and the fallback's inset, three-sigma mask fade
  // finish before these bounds, including where the hex footprint is widest.
  for (let step = 0; step <= 100; step++) {
    const x = WORLD.x + (WORLD.width * step) / 100,
      y = WORLD.y + (WORLD.height * step) / 100;
    for (const point of [
      { x, y: WORLD.y },
      { x, y: WORLD.y + WORLD.height },
      { x: WORLD.x, y },
      { x: WORLD.x + WORLD.width, y },
    ]) {
      assert.ok(coastDistance(coast, point.x, point.y) - waterWidth(Math.atan2(point.y, point.x)) > 8);
    }
  }
});

test('mirrored material quadrants meet continuously at internal and repeated borders with atlas gutters', () => {
  const sample = (x: number, y: number) => {
    const wrap = (value: number) => ((value % 2) + 2) % 2;
    x = wrap(x);
    y = wrap(y);
    const quad = MATERIAL_QUADRANTS.find(
      ({ x: tx, y: ty, sx, sy }) =>
        (x - tx) / sx >= 0 && (x - tx) / sx <= 1 && (y - ty) / sy >= 0 && (y - ty) / sy <= 1,
    )!;
    return [(x - quad.x) / quad.sx, (y - quad.y) / quad.sy].map(
      (uv) => MATERIAL_GUTTER + uv * (512 - 2 * MATERIAL_GUTTER),
    );
  };
  for (const boundary of [-2, -1, 0, 1, 2, 3]) {
    for (const position of [0.13, 0.6, 1.2, 1.83]) {
      const pairs = [
        [sample(boundary - 1e-7, position), sample(boundary + 1e-7, position)],
        [sample(position, boundary - 1e-7), sample(position, boundary + 1e-7)],
      ];
      for (const [before, after] of pairs) {
        for (let axis = 0; axis < 2; axis++) {
          assert.ok(Math.abs(before![axis]! - after![axis]!) < 0.0002);
          assert.ok(before![axis]! >= MATERIAL_GUTTER && before![axis]! <= 512 - MATERIAL_GUTTER);
        }
      }
    }
  }
});
