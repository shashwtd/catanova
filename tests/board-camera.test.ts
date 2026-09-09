import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardViewport } from '../apps/client/src/BoardViewport.js';
import { constrainTilt, dragTilt, REST_PITCH } from '../apps/client/src/camera.js';
import { FantasyTransition, FANTASY_TRANSITION_MS } from '../apps/client/src/FantasyTransition.js';

test('board tilt is bounded and large pointer jumps cannot fling its viewing angle', () => {
  const rest = { pitch: REST_PITCH, yaw: 0 };
  assert.deepEqual(dragTilt(rest, 10000, -10000), { pitch: 13, yaw: 1 });
  assert.deepEqual(dragTilt(rest, -10000, 10000), { pitch: 11, yaw: -1 });
  let tilt = rest;
  for (let i = 0; i < 1000; i++) tilt = dragTilt(tilt, 15, -15);
  assert.deepEqual(tilt, { pitch: 16, yaw: 5 });
  for (let i = 0; i < 1000; i++) tilt = dragTilt(tilt, -15, 15);
  assert.deepEqual(tilt, { pitch: 8, yaw: -5 });
  assert.deepEqual(constrainTilt({ pitch: -999, yaw: 999 }), { pitch: 8, yaw: 5 });
});

test('camera keeps gestures and keyboard controls with one fit button and offers a flat view', () => {
  const html = renderToStaticMarkup(createElement(BoardViewport, { seed: 42, children: 'board' }));
  assert.equal([...html.matchAll(/<button/g)].length, 1);
  assert.match(html, /aria-label="Fit board view"/);
  assert.match(html, /Scroll or pinch to zoom/);
  assert.match(html, /rotateX\(12deg\) rotateY\(0deg\)/);
  assert.ok(!html.includes('zoom-controls') && !html.includes('100%'));
  const flat = renderToStaticMarkup(
    createElement(BoardViewport, { seed: 42, depth: false, children: 'board' }),
  );
  assert.match(flat, /data-depth="false"/);
  assert.ok(!flat.includes('rotateX') && !flat.includes('gently tilt'));
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
