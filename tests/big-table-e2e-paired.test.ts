import test from 'node:test';
import assert from 'node:assert/strict';
import { playAndCheck } from './big-table-e2e.js';

test('§6: five and six players finish games of paired turns, replayed, verified and analysed', () => {
  const { events, seen } = playAndCheck('paired', [
    { players: 5, seed: 11, timer: 65 },
    { players: 6, seed: 11, timer: 65 },
    { players: 5, seed: 29, timer: null },
    { players: 6, seed: 47, timer: 65 },
  ]);
  assert.ok(events.partnerRoadsLapsed > 0, 'a Partner’s clock ran out with free roads owed (§9.3)');
  assert.ok(events.partnerKnightExpired > 0, 'a Partner’s clock ran out with a Knight’s robber owed (§9.3)');
  assert.ok(seen.partnerPhases > 50);
  assert.ok(seen.singleTurns > 0, 'a five-player game went to single turns when a player left (§6.8)');
});
