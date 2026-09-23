import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Identity } from '../apps/server/src/auth.js';

const identity = (id: string): Identity => ({
  id,
  name: id,
  profile: defaultProfile(id),
  expiresAt: Date.now() + 3600000,
});
const token = (n: number) => n.toString(16).padStart(64, '0');

test('one account can reconnect across browsers but cannot enter another room during a match', () => {
  const store = new Store(':memory:');
  try {
    const owner = identity('Captain');
    const a = store.enter('create', token(1), '', undefined, owner);
    const b = store.enter('join', token(2), '', a.room_id, identity('Friend'));
    store.lobby(b, 'ready', 0, true);
    store.action(a, 'start', 1, { kind: 'start' });
    const before = store.loadGame(a.room_id);
    const count = store.db.prepare('SELECT count(*) n FROM rooms').get()!.n;
    assert.throws(() => store.enter('create', token(3), '', undefined, owner), /Resume or leave/);
    assert.equal(
      store.db.prepare('SELECT count(*) n FROM rooms').get()!.n,
      count,
      'failed admission creates no orphan room',
    );
    const other = store.enter('create', token(4), '', undefined, identity('Other'));
    assert.throws(() => store.enter('join', token(5), '', other.room_id, owner), /already have a game/);
    const resumed = store.enter('join', token(6), '', a.room_id, owner);
    assert.equal(resumed.id, a.id);
    assert.deepEqual(store.loadGame(a.room_id), before);
    store.leave(resumed, 'leave', store.snapshot(a.room_id).revision);
    assert.doesNotThrow(() => store.enter('create', token(7), '', undefined, owner));
  } finally {
    store.close();
  }
});

test('a seat signed in with Google shows its account to the table, and never in an invite preview', () => {
  const store = new Store(':memory:');
  try {
    const host = store.enter('create', token(20), '', undefined, { ...identity('Host'), isGuest: false });
    store.enter('join', token(21), '', host.room_id, { ...identity('Visitor'), isGuest: true });
    store.enter('join', token(22), 'Local', host.room_id);
    const accounts = (players: { name: string; accountId?: string }[]) =>
      players.map(({ name, accountId }) => [name, accountId]);
    assert.deepEqual(accounts(store.snapshot(host.room_id, host.id).players), [
      ['Host', 'Host'],
      ['Visitor', undefined],
      ['Local', undefined],
    ]);
    assert.deepEqual(accounts(store.snapshot(host.room_id, '@spectator').players)[0], ['Host', 'Host']);
    assert.ok(store.preview(host.room_id).players.every((player) => !('accountId' in player)));
  } finally {
    store.close();
  }
});

test('starting checks every account, including a ready guest with another lobby open', () => {
  const store = new Store(':memory:');
  try {
    const shared = { ...identity('Guest'), isGuest: true };
    const first = store.enter('create', token(10), '', undefined, shared);
    const firstFriend = store.enter('join', token(11), '', first.room_id, identity('FirstFriend'));
    const second = store.enter('create', token(12), '', undefined, identity('SecondHost'));
    const secondSeat = store.enter('join', token(13), '', second.room_id, shared);
    store.lobby(firstFriend, 'ready-one', 0, true);
    store.lobby(secondSeat, 'ready-two', 0, true);
    store.action(first, 'start-first', 1, { kind: 'start' });
    assert.throws(
      () => store.action(second, 'start-second', 1, { kind: 'start' }),
      /Guest is already playing another game/,
    );
    assert.equal(store.loadGame(second.room_id), undefined);
    assert.equal(store.snapshot(second.room_id).revision, 1);
    store.leave(first, 'leave-first', store.snapshot(first.room_id).revision);
    assert.doesNotThrow(() => store.action(second, 'start-again', 1, { kind: 'start' }));
  } finally {
    store.close();
  }
});
