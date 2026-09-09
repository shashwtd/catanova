import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardViewport } from '../apps/client/src/BoardViewport.js';
import { constrainCamera, fitBoard, pinchScale, wheelScale } from '../apps/client/src/camera.js';
import { WORLD } from '../apps/client/src/scene.js';
import { FantasyTransition, FANTASY_TRANSITION_MS } from '../apps/client/src/FantasyTransition.js';

test('initial island fit keeps the complete scene in view across narrow and short viewports', () => {
  for (const bounds of [
    { width: 180, height: 520 },
    { width: 940, height: 240 },
    { width: 620, height: 560 },
    { width: 280, height: 190 },
  ]) {
    const fitted = fitBoard(bounds);
    assert.ok(fitted.width <= bounds.width - 24 && fitted.height <= bounds.height - 24 + 1e-8);
    assert.ok(Math.abs(fitted.width / fitted.height - WORLD.width / WORLD.height) < 1e-8);
  }
  assert.ok(wheelScale(1, -10000) < 1.023 && wheelScale(1, 10000) > 0.978);
  assert.equal(pinchScale(1, 10000, 1), 1.035);
  assert.equal(pinchScale(1, 1, 10000), 0.965);
  const moved = constrainCamera({ scale: 1, x: 40, y: -30 }, { width: 600, height: 600 });
  assert.deepEqual(
    moved,
    { scale: 1, x: 40, y: -30 },
    'a fitted island and its table can still be panned together',
  );
});

test('camera presents a straight-down island and a matching wooden world with gestures and no buttons', () => {
  const html = renderToStaticMarkup(createElement(BoardViewport, { seed: 42, children: 'board' }));
  assert.equal([...html.matchAll(/<button/g)].length, 0);
  assert.match(html, /Scroll or pinch to zoom/);
  assert.ok(!html.includes('rotateX') && !html.includes('rotateY') && !html.includes('zoom-controls'));
  assert.match(html, /class="board-world-surface"/);
  assert.match(html, /patternTransform="translate\(0 0\) scale\(1\)"/);
  const reduced = renderToStaticMarkup(
    createElement(BoardViewport, { seed: 42, reducedMotion: true, children: 'board' }),
  );
  assert.ok(!reduced.includes('gently tilt'));
});

test('new-match curtain has two opposing cloud shapes and a bounded reduced-motion mode', () => {
  const html = renderToStaticMarkup(
    createElement(FantasyTransition, { id: 'room:started', reducedMotion: true }),
  );
  assert.match(html, /fantasy-transition-reduced/);
  assert.equal([...html.matchAll(/class="fantasy-clouds fantasy-clouds-/g)].length, 2);
  assert.match(html, /translate\(700 0\) scale\(-1 1\)/);
  assert.ok(FANTASY_TRANSITION_MS >= 600 && FANTASY_TRANSITION_MS <= 850);
  assert.match(html, /aria-hidden="true"/);
});
