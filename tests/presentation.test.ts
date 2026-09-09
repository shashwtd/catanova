import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../apps/client/src/Board.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  constrainCamera,
  pinchScale,
  wheelScale,
  zoomAt,
} from '../apps/client/src/camera.js';

test('all road orientations render as visible solid pieces without zero-width SVG filter bounds', () => {
  const g = createGame(
      [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
        { id: 'three', name: 'Three' },
      ],
      42,
      () => 0.3,
    ),
    view = gameView(g, 'one');
  view.roads = Object.fromEntries(g.board.edges.map((e) => [e.id, 'one']));
  const html = renderToStaticMarkup(
    createElement(Board, {
      board: g.board,
      game: view,
      me: 'one',
      mode: null,
      disabled: true,
      onAction: () => {},
      onRobber: () => {},
    }),
  );
  assert.equal([...html.matchAll(/data-road-id=/g)].length, 72);
  assert.ok(g.board.edges.some((e) => g.board.vertices[e.a]!.x === g.board.vertices[e.b]!.x));
  const groups = [...html.matchAll(/<g[^>]*data-road-id="(\d+)"[^>]*>([\s\S]*?)<\/g>/g)];
  assert.equal(groups.length, 72);
  for (const [, id, content] of groups) {
    assert.ok(!content!.includes('<filter'));
    const body = /<rect[^>]*class="road-body"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(content!)!;
    assert.ok(body, `road ${id} has a solid body`);
    assert.ok(Number(body[1]) > 0 && Number(body[2]) > 0);
  }
  assert.equal([...html.matchAll(/data-port-entrance=/g)].length, 18);
});
test('zoom has uniform bounded steps, retains its focal point, and cannot shrink the board away or pan out of reach', () => {
  const bounds = { width: 600, height: 600 };
  const initial = { scale: 1.4, x: 0, y: 0 };
  const focal = { x: 20, y: 10 };
  const next = zoomAt(initial, 1.6, focal, bounds);
  assert.ok(Math.abs((focal.x - initial.x) / initial.scale - (focal.x - next.x) / next.scale) < 1e-8);
  assert.equal(zoomAt(initial, 100, focal, bounds).scale, MAX_ZOOM);
  assert.equal(zoomAt(initial, 0.001, focal, bounds).scale, MIN_ZOOM);
  assert.ok(wheelScale(1, -10000) < 1.08);
  assert.ok(wheelScale(1, 10000) > 0.92);
  assert.equal(pinchScale(1, 10000, 1), 1.035);
  assert.equal(pinchScale(1, 1, 10000), 0.965);
  assert.deepEqual(constrainCamera({ scale: 0.9, x: 9999, y: -9999 }, bounds), { scale: 0.9, x: 90, y: -80 });
  const bounded = constrainCamera({ scale: 2, x: 9999, y: -9999 }, bounds);
  assert.ok(Math.abs(bounded.x) < bounds.width && Math.abs(bounded.y) < bounds.height);
});
