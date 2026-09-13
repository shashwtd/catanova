import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFloatingPanel } from '../apps/client/src/floating-panel.js';

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
