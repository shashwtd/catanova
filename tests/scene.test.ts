import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard } from '../packages/rules/src/board.js';
import {
  coastline,
  HEX_SIZE,
  oceanBoundary,
  oceanRing,
  portPlacement,
  WORLD,
} from '../apps/client/src/scene.js';

test('one continuous ocean ring surrounds the land and fits the rendering viewport', () => {
  const ring = oceanRing();
  assert.equal(ring.length, 18);
  assert.equal(new Set(ring.map((h) => `${h.q},${h.r}`)).size, 18);
  for (const h of ring) {
    assert.equal(Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)), 3);
    assert.ok(h.x - HEX_SIZE >= WORLD.x && h.x + HEX_SIZE <= WORLD.x + WORLD.width);
    assert.ok(h.y - HEX_SIZE >= WORLD.y && h.y + HEX_SIZE <= WORLD.y + WORLD.height);
  }
  const boundary = oceanBoundary();
  assert.equal(boundary.length, 42);
  const endpoints = new Map<string, number>();
  for (const [ax, ay, bx, by] of boundary) {
    assert.ok(Math.abs(Math.hypot(bx! - ax!, by! - ay!) - HEX_SIZE) < 1e-8);
    for (const [x, y] of [
      [ax!, ay!],
      [bx!, by!],
    ]) {
      const key = `${Math.round(x! * 1000)},${Math.round(y! * 1000)}`;
      endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
    }
  }
  assert.equal(endpoints.size, 42);
  assert.ok([...endpoints.values()].every((n) => n === 2));
});

test('every dock is perpendicular to its own coastal edge, facing outward, anchored at the midpoint', () => {
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
      assert.ok(Math.abs(Math.hypot(pose.markerX - pose.x, pose.markerY - pose.y) - 106) < 1e-8);
    }
    assert.throws(
      () => portPlacement(board, board.edges.find((e) => e.hexes.length === 2)!.id),
      /coastal edge/,
    );
  }
});
