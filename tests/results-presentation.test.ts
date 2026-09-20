import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { createGame } from '../packages/rules/src/game.js';
import { retainedResults } from '../apps/client/src/results-presentation.js';
import type { RoomState } from '../packages/protocol/src/index.js';

test('two clients retain results independently when one resets the shared room', () => {
  const store = new Store(':memory:');
  try {
    const a = store.enter('create', 'a'.repeat(32), 'Alpha');
    const b = store.enter('join', 'b'.repeat(32), 'Beta', a.room_id);
    const game = createGame([a, b], 42, () => 0.3);
    game.phase = 'finished';
    game.winner = a.id;
    store.db.prepare('INSERT INTO games VALUES (?,?)').run(a.room_id, JSON.stringify(game));
    const view = (id: string) => store.snapshot(a.room_id, id) as RoomState;
    const aResults = retainedResults(null, view(a.id));
    const bResults = retainedResults(null, view(b.id));
    store.action(a, 'return', view(a.id).revision, { kind: 'returnToLobby' });
    assert.equal(view(b.id).game, undefined, 'reproduce the shared reset');
    assert.deepEqual(retainedResults(bResults, view(b.id))?.game, bResults?.game);
    assert.deepEqual(retainedResults(aResults, view(a.id))?.game, aResults?.game);
    assert.ok(view(b.id).previousResults, 'a refreshed participant can recover results');
    assert.equal(view(b.id).players.find((p) => p.id === b.id)?.ready, false);
    assert.equal(retainedResults(bResults, null), null, 'leaving the room clears results');
  } finally {
    store.close();
  }
});
