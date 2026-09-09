import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Identity } from '../apps/server/src/auth.js';
const account = (id: string, name: string): Identity => ({
  id,
  name,
  profile: { ...defaultProfile(name), username: name, avatarSource: 'generated' },
  expiresAt: Date.now() + 3600000,
});
test('resuming a lobby refreshes canonical account profile atomically, retains seat ownership and clears old Ready', () => {
  const store = new Store(':memory:');
  try {
    const identity = account('same-auth-id', 'Old_name');
    const seat = store.enter('create', 'a'.repeat(32), 'ignored', undefined, identity);
    store.lobby(seat, 'old-ready-command', 0, true);
    const renamed = account('same-auth-id', 'New_name');
    renamed.profile!.avatar = 8;
    const resumed = store.enter('join', 'b'.repeat(32), 'spoof', seat.room_id, renamed);
    assert.equal(resumed.id, seat.id);
    assert.equal(resumed.name, 'New_name');
    const state = store.snapshot(seat.room_id);
    assert.equal(state.revision, 2);
    assert.equal(state.players.length, 1);
    assert.deepEqual(state.players[0]!.profile, renamed.profile);
    assert.equal(state.players[0]!.ready, false);
    const duplicate = store.enter('resume', 'b'.repeat(32), 'spoof', seat.room_id, renamed);
    assert.equal(duplicate.id, seat.id);
    assert.equal(store.snapshot(seat.room_id).revision, 2);
    assert.equal(store.lobby(seat, 'old-ready-command', 0, true).duplicate, true);
    assert.equal(
      store.snapshot(seat.room_id).players[0]!.ready,
      false,
      'old receipt cannot overwrite refreshed profile state',
    );
  } finally {
    store.close();
  }
});
test('resuming a started match preserves its recorded names, pieces and public history after account rename', () => {
  const store = new Store(':memory:');
  try {
    const seat = store.enter('create', 'a'.repeat(32), 'ignored', undefined, account('owner', 'Captain'));
    const friend = store.enter('join', 'c'.repeat(32), 'ignored', seat.room_id, account('friend', 'Builder'));
    store.lobby(friend, 'ready-friend-command', 0, true);
    store.action(seat, 'start-game-command', 1, { kind: 'start' });
    const before = store.loadGame(seat.room_id),
      history = store.history(seat.room_id);
    const resumed = store.enter(
      'join',
      'b'.repeat(32),
      'spoof',
      seat.room_id,
      account('owner', 'NewCaptain'),
    );
    assert.equal(resumed.id, seat.id);
    assert.equal(resumed.name, 'Captain');
    assert.deepEqual(store.loadGame(seat.room_id), before);
    assert.deepEqual(store.history(seat.room_id), history);
  } finally {
    store.close();
  }
});
