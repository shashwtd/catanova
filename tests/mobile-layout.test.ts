import test from 'node:test';
import assert from 'node:assert/strict';
import { profileGainPosition } from '../apps/client/src/GameEffects.js';

test('portrait gains stay inside the correct cell in a two-row player layout', () => {
  const viewport = { width: 320, height: 700 };
  const cells = Array.from({ length: 4 }, (_, i) => ({
    left: 10 + (i % 2) * 156,
    top: 8 + Math.floor(i / 2) * 58,
    width: 144,
    height: 48,
  }));
  const badges = cells.map((box) => profileGainPosition(box, viewport));
  assert.equal(new Set(badges.map((b) => `${b.left}:${b.top}`)).size, 4);
  for (const [i, badge] of badges.entries()) {
    const box = cells[i]!;
    assert.equal(badge.placement, 'within');
    assert.ok(badge.left - badge.maxWidth / 2 >= box.left + 48);
    assert.ok(badge.left + badge.maxWidth / 2 <= box.left + box.width);
    assert.ok(badge.top - 18 >= box.top);
    assert.ok(badge.top + 18 <= box.top + box.height);
  }
});

test('rotating to a side rail retains its established gain anchor and wide profiles keep compact badges', () => {
  const side = { left: 650, top: 90, width: 150, height: 52 };
  assert.deepEqual(profileGainPosition(side, { width: 812, height: 375 }), {
    left: 642,
    top: 116,
    maxWidth: 178,
    placement: 'beside',
  });
  const desktop = { left: 1100, top: 24, width: 230, height: 100 };
  assert.deepEqual(profileGainPosition(desktop, { width: 1440, height: 900 }), {
    left: 1092,
    top: 62,
    maxWidth: 178,
    placement: 'beside',
  });
  assert.equal(
    profileGainPosition({ left: 10, top: 17, width: 180, height: 85 }, { width: 390, height: 844 }).maxWidth,
    108,
  );
});
