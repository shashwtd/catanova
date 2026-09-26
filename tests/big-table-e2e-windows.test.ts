import test from 'node:test';
import assert from 'node:assert/strict';
import { playAndCheck } from './big-table-e2e.js';

test('§7: five and six players finish games of Between-turns build, replayed, verified and analysed', () => {
  const { seen } = playAndCheck('betweenTurnsBuild', [
    { players: 5, seed: 11, timer: 65 },
    { players: 6, seed: 29, timer: null },
    { players: 5, seed: 47, timer: null },
    { players: 6, seed: 47, timer: 65 },
  ]);
  assert.ok(seen.windows > 200);
  assert.ok(seen.windowsWithoutTimer > 100, 'windows ran in rooms without a turn timer too (§9.2)');
  assert.equal(seen.singleTurns, 0, 'windows go on at any player count (§7.2)');
});
