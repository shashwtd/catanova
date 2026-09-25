import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { generateBoard } from '../packages/rules/src/board.js';
import { BoardViewport } from '../apps/client/src/BoardViewport.js';
import { CORD_HEIGHT, StringLights, cordY } from '../apps/client/src/StringLights.js';
import {
  BoardGesture,
  constrainCamera,
  fitBoard,
  maxZoom,
  pinchScale,
  wheelScale,
  zoomAt,
} from '../apps/client/src/camera.js';
import type { Camera, Point } from '../apps/client/src/camera.js';
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
  assert.equal(pinchScale(1, 200, 100), 2);
  assert.equal(pinchScale(2, 100, 200), 1);
  const moved = constrainCamera({ scale: 1, x: 40, y: -30 }, { width: 600, height: 600 });
  assert.deepEqual(
    moved,
    { scale: 1, x: 40, y: -30 },
    'a fitted island and its table can still be panned together',
  );
});

const phoneBounds = { width: 360, height: 440 },
  largeBounds = { width: 800, height: 700 },
  centered: Camera = { scale: 1, x: 0, y: 0 };
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

test('pinch follows finger distance and moving midpoint without depending on event frequency', () => {
  function pinch(steps: number) {
    const gesture = new BoardGesture();
    let camera = centered;
    gesture.start(1, { x: -80, y: 0 }, camera);
    gesture.start(2, { x: 80, y: 0 }, camera);
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      camera =
        gesture.update(1, { x: -80 - 40 * progress, y: -15 * progress }, camera, largeBounds) ?? camera;
      camera = gesture.update(2, { x: 80 + 80 * progress, y: 35 * progress }, camera, largeBounds) ?? camera;
    }
    return camera;
  }
  const sparse = pinch(1),
    dense = pinch(30);
  close(sparse.scale, Math.hypot(280, 50) / 160);
  close(sparse.x, 20);
  close(sparse.y, 10);
  close(sparse.scale, dense.scale);
  close(sparse.x, dense.x);
  close(sparse.y, dense.y);
});

test('pinch preserves the island point under the fingers on an already panned camera and is reversible', () => {
  const gesture = new BoardGesture(),
    initial: Camera = { scale: 1.2, x: 20, y: -10 };
  let camera = initial;
  const a: Point = { x: -100, y: -60 },
    b: Point = { x: 80, y: 20 };
  gesture.start(1, a, camera);
  gesture.start(2, b, camera);
  const world = { x: (-10 - camera.x) / camera.scale, y: (-20 - camera.y) / camera.scale };
  camera = gesture.update(1, { x: -150, y: -90 }, camera, largeBounds) ?? camera;
  camera = gesture.update(2, { x: 110, y: 10 }, camera, largeBounds) ?? camera;
  close(world.x * camera.scale + camera.x, -20);
  close(world.y * camera.scale + camera.y, -40);
  camera = gesture.update(1, a, camera, largeBounds) ?? camera;
  camera = gesture.update(2, b, camera, largeBounds) ?? camera;
  close(camera.scale, initial.scale);
  close(camera.x, initial.x);
  close(camera.y, initial.y);
});

test('lifting one finger continues panning and rejoining starts a fresh pinch without jumping', () => {
  const gesture = new BoardGesture();
  let camera = centered;
  gesture.start(1, { x: -60, y: 0 }, camera);
  gesture.start(2, { x: 60, y: 0 }, camera);
  camera = gesture.update(2, { x: 100, y: 0 }, camera, phoneBounds) ?? camera;
  gesture.end(2, camera);
  const beforePan = camera;
  camera = gesture.update(1, { x: -57, y: 4 }, camera, phoneBounds) ?? camera;
  close(camera.x, beforePan.x + 3);
  close(camera.y, beforePan.y + 4);
  close(camera.scale, beforePan.scale);
  gesture.start(3, { x: 120, y: 40 }, camera);
  const beforePinch = camera;
  camera = gesture.update(3, { x: 120, y: 40 }, camera, phoneBounds) ?? camera;
  assert.deepEqual(camera, beforePinch);
  assert.ok(gesture.blocksClick(1));
  gesture.end(1, camera);
  gesture.end(3, camera);
  assert.ok(gesture.blocksClick(1), 'neither release may place a piece after a pinch');
});

test('a third contact does not disturb the pair and replaces a lifted contact without stale baselines', () => {
  const gesture = new BoardGesture();
  let camera = centered;
  gesture.start(1, { x: -50, y: 0 }, camera);
  gesture.start(2, { x: 50, y: 0 }, camera);
  gesture.start(3, { x: 120, y: 80 }, camera);
  assert.equal(gesture.update(3, { x: 130, y: 80 }, camera, phoneBounds), null);
  gesture.end(1, camera);
  assert.deepEqual(gesture.pointerIds, [2, 3]);
  assert.deepEqual(gesture.update(2, { x: 50, y: 0 }, camera, phoneBounds), camera);
  camera = gesture.update(3, { x: 150, y: 80 }, camera, phoneBounds) ?? camera;
  assert.ok(camera.scale > 1, 'the remaining two contacts continue pinching');
});

test('transferring implicit SVG touch capture keeps both fingers active; only real viewport capture loss retires one', () => {
  const gesture = new BoardGesture();
  gesture.start(1, { x: -50, y: 0 }, centered);
  gesture.start(2, { x: 50, y: 0 }, centered);
  // The SVG child's lostpointercapture bubbles after setPointerCapture on the viewport.
  assert.equal(gesture.captureLost(1, centered, { fromViewport: false, stillCaptured: true }), false);
  assert.equal(gesture.captureLost(2, centered, { fromViewport: false, stillCaptured: true }), false);
  assert.deepEqual(gesture.pointerIds, [1, 2]);
  const zoomed = gesture.update(2, { x: 100, y: 0 }, centered, phoneBounds)!;
  close(zoomed.scale, 1.5);
  assert.equal(gesture.dragging, true);
  assert.equal(gesture.captureLost(1, zoomed, { fromViewport: true, stillCaptured: true }), false);
  assert.equal(gesture.captureLost(1, zoomed, { fromViewport: true, stillCaptured: false }), true);
  assert.deepEqual(gesture.pointerIds, [2]);
  const panned = gesture.update(2, { x: 104, y: 3 }, zoomed, phoneBounds)!;
  close(panned.x, zoomed.x + 4);
  close(panned.y, zoomed.y + 3);
  assert.ok(gesture.blocksClick(1));
});

test('single taps survive touch jitter, while cancelled gestures suppress pointer clicks but not keyboard activation', () => {
  const gesture = new BoardGesture();
  gesture.start(1, { x: 0, y: 0 }, centered);
  assert.equal(gesture.update(1, { x: 3, y: 3 }, centered, phoneBounds), null);
  gesture.end(1, centered);
  assert.equal(gesture.blocksClick(1), false);
  gesture.start(2, { x: -50, y: 0 }, centered);
  gesture.start(3, { x: 50, y: 0 }, centered);
  gesture.cancel();
  assert.equal(gesture.dragging, false);
  assert.deepEqual(gesture.pointerIds, []);
  assert.equal(gesture.update(3, { x: 200, y: 20 }, centered, phoneBounds), null);
  assert.equal(gesture.blocksClick(1), true);
  assert.equal(gesture.blocksClick(0), false);
  gesture.start(4, { x: 10, y: 10 }, centered);
  gesture.end(4, centered);
  assert.equal(gesture.blocksClick(1), false, 'the next deliberate tap can select a build site');
});

test('camera limits remain bounded, allow useful phone magnification and reverse promptly after overshoot', () => {
  assert.equal(maxZoom(largeBounds), 2.2);
  assert.ok(maxZoom(phoneBounds) > 2.2 && maxZoom({ width: 160, height: 240 }) <= 4);
  const focal = { x: 70, y: -40 };
  const zoomed = zoomAt(centered, 1.2, focal, phoneBounds);
  close((focal.x - zoomed.x) / zoomed.scale, focal.x);
  close((focal.y - zoomed.y) / zoomed.scale, focal.y);
  const gesture = new BoardGesture();
  let camera = centered;
  gesture.start(1, { x: -50, y: 0 }, camera);
  gesture.start(2, { x: 50, y: 0 }, camera);
  camera = gesture.update(1, { x: -1000, y: 0 }, camera, phoneBounds) ?? camera;
  camera = gesture.update(2, { x: 1000, y: 0 }, camera, phoneBounds) ?? camera;
  close(camera.scale, maxZoom(phoneBounds));
  const smaller = gesture.update(2, { x: 900, y: 0 }, camera, phoneBounds)!;
  assert.ok(smaller.scale < camera.scale);
  assert.deepEqual(constrainCamera(smaller, phoneBounds), smaller);
  gesture.end(2, smaller);
  const dragged = gesture.update(1, { x: 10000, y: 10000 }, smaller, phoneBounds)!;
  assert.ok(Math.abs(dragged.x) < 1000 && Math.abs(dragged.y) < 1000);
});

test('camera presents a straight-down island and a matching wooden world with gestures and no buttons', () => {
  const html = renderToStaticMarkup(
    createElement(BoardViewport, { board: generateBoard(42), children: 'board' }),
  );
  assert.equal([...html.matchAll(/<button/g)].length, 0);
  assert.match(html, /Scroll or pinch to zoom/);
  assert.ok(!html.includes('rotateX') && !html.includes('rotateY') && !html.includes('zoom-controls'));
  assert.match(html, /class="board-world-surface"/);
  assert.match(html, /patternTransform="translate\(0 0\) scale\(1\)"/);
  const reduced = renderToStaticMarkup(
    createElement(BoardViewport, { board: generateBoard(42), reducedMotion: true, children: 'board' }),
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
  assert.match(html, /aria-label="Entering the game"/);
  const loading = renderToStaticMarkup(
    createElement(FantasyTransition, {
      id: 'loading',
      waiting: true,
      players: [{ id: 'a', name: 'Captain', connected: true }],
      readyPlayers: ['a'],
      progress: 1,
    }),
  );
  assert.match(loading, /is-loading/);
  assert.match(loading, /Preparing the island/);
  assert.match(loading, /Captain/);
  assert.match(loading, /Game art loaded/);
});

test('the table is lit, the board is not, and none of the lighting can be clicked', () => {
  const html = renderToStaticMarkup(
    createElement(BoardViewport, { board: generateBoard(7), children: createElement('div', null, 'island') }),
  );
  const css = readFileSync('apps/client/src/table-light.css', 'utf8');
  // The lighting is scenery: it must never take a click meant for a corner.
  for (const selector of ['.table-light', '.table-vignette']) {
    assert.ok(html.includes(selector.slice(1)), selector);
    const block = css.slice(css.indexOf(`${selector} {`));
    const body = block.slice(0, block.indexOf('}'));
    assert.ok(body.includes('pointer-events: none'), selector);
    // Fixed to the window like the wood itself: anything drawn to the
    // viewport's own edges outlines a rectangle that is not really there.
    assert.match(body, /position: fixed/);
  }
  // The string of lights is kept but not hung, so the board ships without it.
  assert.ok(!html.includes('string-lights'), 'no string is hung above the board');
});

test('the string of lights still hangs together, for whenever it goes back up', () => {
  const html = renderToStaticMarkup(createElement(StringLights, null));
  assert.equal((html.match(/class="string-lantern"/g) ?? []).length, 11);
  // Every lantern sits on the cord rather than near it: one function places
  // both, so a change to the ripple can never leave one hanging in mid air.
  for (const style of html.matchAll(/left:([\d.]+)%;top:([\d.]+)px/g))
    assert.ok(
      Math.abs(Number(style[2]) - cordY(Number(style[1]) / 100)) < 0.01,
      `a lantern at ${style[1]}% hangs off the wire`,
    );
  // A ripple, not a swag: it has to stay out of the way of the board, which is
  // the thing anybody is actually looking at.
  const cord = html.match(/ d="M0 ([\d.]+)([^"]*)"/)![0];
  const heights = [...cord.matchAll(/[ML]\d+ ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...heights) <= CORD_HEIGHT, 'the cord stays inside its own box');
  assert.ok(CORD_HEIGHT <= 24, `the cord box is ${CORD_HEIGHT}px tall`);
  let turns = 0;
  for (let i = 1; i < heights.length - 1; i++)
    if (
      (heights[i]! - heights[i - 1]!) * (heights[i + 1]! - heights[i]!) < 0 ||
      (heights[i] === heights[i - 1] && heights[i] !== heights[i + 1])
    )
      turns++;
  assert.ok(turns >= 4, `the cord only changes direction ${turns} times`);

  const css = readFileSync('apps/client/src/table-light.css', 'utf8');
  const lights = css.slice(css.indexOf('.string-lights {'));
  const body = lights.slice(0, lights.indexOf('}'));
  assert.ok(body.includes('pointer-events: none'));
  assert.ok(Number(body.match(/height: (\d+)px/)![1]) <= 56, 'the string stays a small thing');
  assert.match(css, /prefers-reduced-motion[\s\S]*animation: none/);
});
