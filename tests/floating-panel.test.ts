import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFloatingPanel, placeGamePanel } from '../apps/client/src/floating-panel.js';

test('card choices stay inside laptop, phone, landscape and keyboard-reduced viewports', () => {
  for (const viewport of [
    { left: 0, top: 0, width: 1440, height: 900 },
    { left: 0, top: 0, width: 320, height: 568 },
    { left: 0, top: 0, width: 740, height: 360 },
    { left: 45, top: 120, width: 270, height: 220 },
  ]) {
    for (const x of [-20, 4, viewport.width - 30]) {
      for (const y of [8, viewport.height - 70]) {
        const result = fitFloatingPanel(
          { left: x, top: y, width: 60, height: 90 },
          { width: 360, height: 300 },
          viewport,
        );
        assert.ok(result.left >= viewport.left + 12);
        assert.ok(result.top >= viewport.top + 12);
        assert.ok(result.left + result.width <= viewport.left + viewport.width - 12);
        assert.ok(result.top + Math.min(300, result.maxHeight) <= viewport.top + viewport.height - 12);
      }
    }
  }
});

test('a left-side development card anchors its choices above the hand without a centering transform', () => {
  const position = fitFloatingPanel(
    { left: 68, top: 696, width: 60, height: 90 },
    { width: 360, height: 240 },
    { left: 0, top: 0, width: 1280, height: 800 },
  );
  assert.equal(position.left, 68);
  assert.equal(position.top, 444);
});

test('tool panels follow top and bottom buttons and their notches meet the button center', () => {
  const viewport = { left: 0, top: 0, width: 1280, height: 800 };
  for (const top of [14, 640]) {
    const anchor = { left: 12, top, width: 44, height: 44 };
    const result = placeGamePanel(anchor, { width: 390, height: 300 }, viewport, 'beside');
    assert.equal(result.left, 68);
    assert.equal(result.top, top < 400 ? top : top + 44 - 300);
    assert.equal(result.notchSide, 'left');
    assert.equal(result.top + result.notch, top + 22);
  }
});

test('tall card choices stay above the hand while content loads or changes', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 700 };
  const anchor = { left: 260, top: 470, width: 44, height: 66 };
  for (const height of [Infinity, 2000, 550, 240, 180]) {
    const result = placeGamePanel(anchor, { width: 360, height }, viewport, 'above');
    assert.equal(result.notchSide, 'bottom');
    assert.equal(result.top + Math.min(height, result.maxHeight), anchor.top - 12);
    assert.equal(result.width, 360);
    assert.ok(result.left >= 12 && result.left + result.width <= 378);
  }
});

test('side panels adapt to phones, narrow landscape and visual viewport offsets without covering their trigger', () => {
  for (const viewport of [
    { left: 0, top: 0, width: 320, height: 568 },
    { left: 40, top: 120, width: 260, height: 260 },
    { left: 0, top: 0, width: 740, height: 360 },
  ]) {
    const anchor = {
      left: viewport.left + 12,
      top: viewport.top + viewport.height - 70,
      width: 44,
      height: 44,
    };
    const result = placeGamePanel(anchor, { width: 390, height: 600 }, viewport, 'beside');
    const height = Math.min(600, result.maxHeight);
    assert.ok(result.left >= viewport.left + 12);
    assert.ok(result.top >= viewport.top + 12);
    assert.ok(result.left + result.width <= viewport.left + viewport.width - 12);
    assert.ok(result.top + height <= viewport.top + viewport.height - 12);
    assert.ok(
      result.notchSide === 'left'
        ? result.left >= anchor.left + anchor.width + 12
        : result.top + height <= anchor.top - 12,
    );
  }
});
