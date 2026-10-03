import test from 'node:test';
import assert from 'node:assert/strict';
import { playAndCheck } from './big-table-e2e.js';

test('§1.1 and §6.8: four players finish games of single turns, replayed, verified and analysed', () => {
  const { seen } = playAndCheck('paired', [
    { players: 4, seed: 11, timer: 65 },
    { players: 4, seed: 29, timer: null },
  ]);
  assert.equal(seen.partnerPhases, 0, 'nobody takes a Partner’s phase at a table of four');
  assert.equal(seen.singleTurns, 0, 'a game for four has no drop below five to announce');
});
