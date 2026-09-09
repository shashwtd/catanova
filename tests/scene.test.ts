import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard } from '../packages/rules/src/board.js';
import {
  coastline,
  HEX_SIZE,
  coastDistance,
  coastPoints,
  waterOutline,
  waterWidth,
  portPlacement,
  WORLD,
  MATERIAL_GUTTER,
  MATERIAL_QUADRANTS,
  SHIP_BOUNDS,
  SHIP_CARGO_AFT,
  SHIP_HULL_PATH,
  WATER_FEATHER,
} from '../apps/client/src/scene.js';

/** Sample the rendered hull's actual Bézier segments for cargo containment checks. */
function shipHullPoints() {
  const points: { x: number; y: number }[] = [];
  let from = { x: 0, y: 0 };
  for (const [, command, coordinates] of SHIP_HULL_PATH.matchAll(/([MCQZ])([^MCQZ]*)/g)) {
    const values = (coordinates!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (command === 'M') {
      from = { x: values[0]!, y: values[1]! };
      points.push(from);
    } else if (command === 'C' || command === 'Q') {
      const controls = [
        from,
        ...Array.from({ length: values.length / 2 }, (_, index) => ({
          x: values[index * 2]!,
          y: values[index * 2 + 1]!,
        })),
      ];
      for (let step = 1; step <= 24; step++) {
        const t = step / 24;
        let level = controls;
        while (level.length > 1)
          level = level.slice(0, -1).map((point, index) => ({
            x: point.x * (1 - t) + level[index + 1]!.x * t,
            y: point.y * (1 - t) + level[index + 1]!.y * t,
          }));
        points.push(level[0]!);
      }
      from = controls.at(-1)!;
    }
  }
  if (points.at(-1)?.x === points[0]?.x && points.at(-1)?.y === points[0]?.y) points.pop();
  return points;
}

test('the calm continuous water band follows the coast and leaves room for its shadow within the scene', () => {
  const board = generateBoard(42),
    coast = coastPoints(board),
    outline = waterOutline(board);
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

test('every dock is perpendicular to its own coastal edge, facing outward, anchored at the midpoint', () => {
  const hull = shipHullPoints();
  for (const seed of [1, 42, 2026, 98765]) {
    const board = generateBoard(seed);
    const coast = coastline(board)
      .split(' ')
      .map((p) => p.split(',').map(Number));
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
      assert.ok(Math.abs(Math.sin(angle) - pose.nx) < 1e-8);
      assert.ok(Math.abs(-Math.cos(angle) - pose.ny) < 1e-8);
      assert.equal(pose.bridges.length, 2);
      assert.deepEqual(
        pose.bridges.map((bridge) => bridge.from),
        [a, b].map((vertex) => ({ x: vertex.x * HEX_SIZE, y: vertex.y * HEX_SIZE })),
      );
      for (const bridge of pose.bridges)
        assert.ok(Math.abs(Math.hypot(bridge.to.x - pose.x, bridge.to.y - pose.y) - 34) < 1e-8);
      assert.ok(Math.abs(pose.markerX - pose.boatX + pose.nx * SHIP_CARGO_AFT) < 1e-8);
      assert.ok(Math.abs(pose.markerY - pose.boatY + pose.ny * SHIP_CARGO_AFT) < 1e-8);
      assert.ok(
        SHIP_CARGO_AFT > 0 && SHIP_CARGO_AFT < 12,
        'cargo stays in the aft deck, away from the bow sail',
      );
      const shipCorners = [SHIP_BOUNDS.x, SHIP_BOUNDS.x + SHIP_BOUNDS.width].flatMap((x) =>
        [SHIP_BOUNDS.y, SHIP_BOUNDS.y + SHIP_BOUNDS.height].map((y) => ({
          x: pose.boatX + x * Math.cos(angle) - y * Math.sin(angle),
          y: pose.boatY + x * Math.sin(angle) + y * Math.cos(angle),
        })),
      );
      const cargoCorners = [-22, 22].flatMap((x) =>
        [-27, 31].map((y) => ({
          x: pose.markerX + x,
          y: pose.markerY + y,
        })),
      );
      for (const x of [-22, 22])
        for (const y of [-27, 31]) {
          const localX = x * Math.cos(angle) + y * Math.sin(angle);
          const localY = -x * Math.sin(angle) + y * Math.cos(angle) + SHIP_CARGO_AFT;
          assert.ok(
            coastDistance(hull, localX, localY) < 0,
            `upright cargo stays on ship: edge ${edge.id}, local ${localX},${localY}`,
          );
        }
      for (const { x, y } of [...shipCorners, ...cargoCorners]) {
        assert.ok(
          x >= WORLD.x + 4 && x <= WORLD.x + WORLD.width - 4,
          'ship and cargo fit the camera horizontally',
        );
        assert.ok(
          y >= WORLD.y + 4 && y <= WORLD.y + WORLD.height - 4,
          'ship and cargo fit the camera vertically',
        );
      }
    }
    assert.throws(
      () => portPlacement(board, board.edges.find((e) => e.hexes.length === 2)!.id),
      /coastal edge/,
    );
  }
});

test('the feather mask covers the entire coast and becomes transparent before the world boundary', () => {
  const board = generateBoard(42),
    coast = coastPoints(board),
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
