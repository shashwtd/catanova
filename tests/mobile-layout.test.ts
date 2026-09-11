import test from 'node:test';
import assert from 'node:assert/strict';
import { profileGainPosition } from '../apps/client/src/GameEffects.js';

test('portrait resource gains stay under their own profile without collapsing onto the first player', () => {
  const viewport = { width: 320, height: 700 };
  const badges = Array.from({ length: 4 }, (_, index) =>
    profileGainPosition({ left: 10 + index * 76, top: 17, width: 72, height: 85 }, viewport),
  );
  assert.equal(new Set(badges.map((badge) => badge.left)).size, 4);
  for (const badge of badges) {
    assert.equal(badge.placement, 'below');
    assert.equal(badge.top, 109);
    assert.ok(badge.left - badge.maxWidth / 2 >= 8);
    assert.ok(badge.left + badge.maxWidth / 2 <= viewport.width - 8);
  }
  for (let index = 1; index < badges.length; index++) {
    const previous = badges[index - 1]!,
      current = badges[index]!;
    assert.ok(previous.left + previous.maxWidth / 2 < current.left - current.maxWidth / 2);
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
    88,
  );
});
