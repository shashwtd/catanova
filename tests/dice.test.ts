import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DIE_FACES,
  DiceThrow,
  DiceResult,
  diceLanding,
  diceTrajectory,
  DICE_ROLL_MS,
  DICE_PRESENTATION_MS,
  DICE_HOLD_MS,
  DICE_READABLE_MS,
  DICE_IMPACT_MS,
  diceStageAt,
  advanceDiceStage,
  diceDockSize,
} from '../apps/client/src/DiceThrow.js';
import { soundScore } from '../apps/client/src/sound.js';

test('all six server results finish with the correct face toward the viewer and opposite faces total seven', () => {
  for (const face of DIE_FACES) {
    const landing = diceLanding(face.value);
    const x = (landing.x * Math.PI) / 180,
      y = (landing.y * Math.PI) / 180;
    const [nx, ny, nz] = face.normal;
    // CSS rotateX(...) rotateY(...) applies Y first, then X.
    const rx = nx * Math.cos(y) + nz * Math.sin(y),
      rz = -nx * Math.sin(y) + nz * Math.cos(y);
    const normal = [rx, ny * Math.cos(x) - rz * Math.sin(x), ny * Math.sin(x) + rz * Math.cos(x)];
    assert.ok(Math.abs(normal[0]!) < 1e-9 && Math.abs(normal[1]!) < 1e-9);
    assert.ok(Math.abs(normal[2]! - 1) < 1e-9, `result ${face.value} faces the viewer`);
    const opposite = DIE_FACES.find((other) => other.normal.every((n, i) => n === -face.normal[i]!));
    assert.equal(opposite!.value + face.value, 7);
  }
  assert.throws(() => diceLanding(0), RangeError);
  assert.throws(() => diceLanding(1.5), RangeError);
});

test('throw paths vary per event within safe bounds and never determine the outcome', () => {
  assert.deepEqual(diceTrajectory('room:move:42', 0), diceTrajectory('room:move:42', 0));
  assert.notDeepEqual(diceTrajectory('room:move:42', 0), diceTrajectory('room:move:43', 0));
  for (let n = 0; n < 100; n++) {
    for (const index of [0, 1]) {
      const t = diceTrajectory(`room:${n}`, index);
      assert.ok(Math.abs(t.startX) >= 75 && Math.abs(t.startX) < 145);
      assert.ok(t.startY >= -140 && t.startY <= -100);
      assert.ok(Math.abs(t.angle) >= 7 && Math.abs(t.angle) <= 20);
    }
  }
  const html = renderToStaticMarkup(
    createElement(DiceThrow, { id: 'accepted-roll', dice: [2, 5], reducedMotion: true }),
  );
  assert.equal([...html.matchAll(/dice-flat-face/g)].length, 2);
  assert.ok(!html.includes('class="dice-cube"'), 'reduced motion has only two flat faces');
  assert.match(html, /data-result="2"/);
  assert.match(html, /data-result="5"/);
  assert.match(html, /dice-throw-reduced/);
  assert.match(html, /aria-label="Dice: 2 and 5"/);
  assert.equal([...html.matchAll(/data-result-face="true"/g)].length, 2);
  assert.ok(!html.includes('dice-throw-result') && !html.includes('2 + 5'));
  assert.ok(DICE_ROLL_MS >= 900 && DICE_ROLL_MS <= 1400);
  assert.ok(DICE_PRESENTATION_MS > DICE_ROLL_MS);
});

test('dice settle flat, hold for reading, then dock once without replaying on preference changes', () => {
  assert.equal(diceStageAt(0), 'rolling');
  assert.equal(diceStageAt(DICE_ROLL_MS), 'held');
  assert.equal(diceStageAt(DICE_READABLE_MS - 1), 'held');
  assert.equal(diceStageAt(DICE_READABLE_MS), 'docking');
  assert.equal(diceStageAt(DICE_PRESENTATION_MS), 'docked');
  assert.equal(diceStageAt(DICE_PRESENTATION_MS, true), 'docked');
  assert.equal(diceStageAt(0, false, true), 'docked');
  assert.equal(diceStageAt(0, true), 'held');
  assert.ok(DICE_HOLD_MS >= 1000);
  const html = renderToStaticMarkup(
    createElement(DiceThrow, { id: 'restored', dice: [1, 6], initiallyDocked: true }),
  );
  assert.equal(html, '', 'restored dice never leave a full-screen overlay at the board center');
  const contacts = soundScore('dice');
  for (const impact of DICE_IMPACT_MS) {
    assert.ok(contacts.some((note) => Math.abs(note.at - impact / 1000) < 0.00001));
    assert.ok(impact < DICE_ROLL_MS, 'dice sounds stop before the readable hold');
  }
});

test('lasting dice results have two flat faces and no throw/perspective tree', () => {
  for (let value = 1; value <= 6; value++) {
    const html = renderToStaticMarkup(
      createElement(DiceResult, { id: 'restored', dice: [value, 7 - value] }),
    );
    assert.match(html, /class="dice-result-dock"/);
    assert.equal([...html.matchAll(/data-result-face="true"/g)].length, 2);
    assert.equal([...html.matchAll(/class="dice-pip"/g)].length, 7);
    assert.ok(
      !html.includes('dice-throw') &&
        !html.includes('class="dice-cube"') &&
        !html.includes('dice-flight-path'),
    );
  }
  assert.equal(diceStageAt(60_000), 'docked', 'returning from a background tab skips an expired throw');
});

test('changing motion preferences never resurrects a completed throw or spins a held result', () => {
  const held = advanceDiceStage('rolling', 500, true);
  assert.equal(held, 'held');
  assert.equal(advanceDiceStage(held, 600, false), 'held');
  const docked = advanceDiceStage(held, 1200, true);
  assert.equal(docked, 'docked');
  assert.equal(advanceDiceStage(docked, 1500, false), 'docked');
  assert.equal(advanceDiceStage('docking', 60_000), 'docked');
});

test('the docking endpoint matches the lasting 2D dice at phone and desktop sizes', () => {
  for (const size of [40, 48, 57]) {
    const dock = diceDockSize(size);
    assert.equal(size * dock.scale, 23);
    assert.ok(Math.abs(dock.gap * dock.scale - 7) < 1e-8);
  }
});
