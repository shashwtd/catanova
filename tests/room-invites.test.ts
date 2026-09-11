import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, ProtocolError } from '../apps/server/src/store.js';
import {
  RoomInviteService,
  ROOM_INVITE_TTL_MS,
  ROOM_INVITE_ACCOUNT_LIMIT,
} from '../apps/server/src/room-invites.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Account, PublicAccount } from '../packages/protocol/src/profile.js';
import { newSession } from '../apps/client/src/connection.js';

const user = (n: number, isGuest = false): Account => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  username: `Player${n}`,
  registered: true,
  isGuest,
  profile: { ...defaultProfile(`Player${n}`), username: `Player${n}` },
  lastActiveAt: new Date(1).toISOString(),
  expiresAt: isGuest ? new Date(999_999_999).toISOString() : null,
});
const publicUser = (a: Account): PublicAccount => ({
  id: a.id,
  username: a.username!,
  isGuest: a.isGuest,
  profile: a.profile!,
});
function fixture(path = ':memory:') {
  let now = 1000;
  const store = new Store(path, { now: () => now });
  const accounts = new Map<string, Account>(),
    links = new Map<string, Set<string>>();
  const api = {
    async get(token: string | undefined) {
      const account = token && accounts.get(token);
      if (!account) throw new ProtocolError('AUTH_REQUIRED', 'Sign in');
      return account;
    },
    async friends(token: string | undefined) {
      const account = await this.get(token);
      return {
        friends: [...(links.get(account.id) ?? [])].map((id) => publicUser(accounts.get(id)!)),
        incoming: [],
        outgoing: [],
      };
    },
  };
  const service = new RoomInviteService(store, api, () => now);
  const add = (n: number, guest = false) => {
    const account = user(n, guest);
    accounts.set(account.id, account);
    return account;
  };
  const befriend = (a: Account, b: Account) => {
    for (const [left, right] of [
      [a, b],
      [b, a],
    ] as const) {
      const set = links.get(left.id) ?? new Set<string>();
      set.add(right.id);
      links.set(left.id, set);
    }
  };
  const room = (account: Account) => {
    const session = newSession(account.username!);
    return store.enter('create', session.token, session.name, undefined, {
      id: account.id,
      expiresAt: Infinity,
      name: account.username!,
      profile: account.profile!,
    });
  };
  return {
    store,
    api,
    service,
    accounts,
    links,
    add,
    befriend,
    room,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('an accepted friend receives a durable room invitation without exposing unrelated accounts', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2),
    stranger = f.add(3);
  f.befriend(host, friend);
  const room = f.room(host);
  const invite = await f.service.send(host.id, { roomId: room.room_id, other: friend.id });
  assert.equal(invite.roomId, room.room_id);
  assert.equal(invite.roomCode, f.store.roomCode(room.room_id));
  assert.equal(invite.from.id, host.id);
  assert.equal(invite.players, 1);
  assert.equal(invite.expiresAt - invite.createdAt, ROOM_INVITE_TTL_MS);
  assert.deepEqual((await f.service.list(friend.id)).incoming, [invite]);
  assert.equal((await f.service.list(host.id)).sent[0]!.to, friend.id);
  assert.deepEqual(await f.service.list(stranger.id), { incoming: [], sent: [] });
  assert.ok(!JSON.stringify(invite).includes('token'));
});

test('guests, strangers, short-code requests and nonmembers cannot send friend room invitations', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2),
    other = f.add(3),
    guest = f.add(4, true);
  f.befriend(host, friend);
  f.befriend(other, friend);
  const room = f.room(host);
  for (const [token, input, code] of [
    [undefined, { roomId: room.room_id, other: friend.id }, 'AUTH_REQUIRED'],
    [guest.id, { roomId: room.room_id, other: friend.id }, 'GOOGLE_REQUIRED'],
    [host.id, { roomId: room.room_id, other: other.id }, 'INVITE_NOT_FRIENDS'],
    [other.id, { roomId: room.room_id, other: friend.id }, 'INVITE_ROOM_UNAVAILABLE'],
    [host.id, { roomId: f.store.roomCode(room.room_id), other: friend.id }, 'INVITE_INVALID'],
    [host.id, { roomId: room.room_id, other: host.id }, 'INVITE_INVALID'],
  ] as const)
    await assert.rejects(
      f.service.send(token, input),
      (error: unknown) => error instanceof ProtocolError && error.code === code,
    );
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM room_invites').get()!.n, 0);
});

test('retries do not extend expiry and only the recipient may dismiss an invitation', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2),
    other = f.add(3);
  f.befriend(host, friend);
  const room = f.room(host),
    input = { roomId: room.room_id, other: friend.id };
  const original = await f.service.send(host.id, input);
  f.advance(10_000);
  assert.deepEqual(await f.service.send(host.id, input), original);
  await f.service.dismiss(other.id, { id: original.id });
  assert.equal((await f.service.list(friend.id)).incoming.length, 1);
  await f.service.dismiss(friend.id, { id: original.id });
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
  assert.equal((await f.service.list(host.id)).sent.length, 1, 'dismissal does not invite repeated nudges');
  await assert.rejects(f.service.send(host.id, input), /already invited/);
  f.advance(ROOM_INVITE_TTL_MS);
  assert.deepEqual(await f.service.list(host.id), { incoming: [], sent: [] });
  const renewed = await f.service.send(host.id, input);
  assert.notEqual(renewed.id, original.id);
});

test('removed friendships, departed senders and joined recipients invalidate outstanding invitations', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2);
  f.befriend(host, friend);
  const room = f.room(host);
  await f.service.send(host.id, { roomId: room.room_id, other: friend.id });
  f.links.get(friend.id)!.clear();
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
  f.befriend(host, friend);
  f.store.db.prepare('UPDATE seats SET departed=1 WHERE id=?').run(room.id);
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
  f.store.db.prepare('UPDATE seats SET departed=0 WHERE id=?').run(room.id);
  const session = newSession(friend.username!);
  f.store.enter('join', session.token, session.name, room.room_id, {
    id: friend.id,
    expiresAt: Infinity,
    name: friend.username!,
    profile: friend.profile!,
  });
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
  await assert.rejects(
    f.service.send(host.id, { roomId: room.room_id, other: friend.id }),
    /no longer available/,
  );
});

test('full and started rooms cannot send invitations or remain in a recipient inbox', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2);
  f.befriend(host, friend);
  const room = f.room(host);
  await f.service.send(host.id, { roomId: room.room_id, other: friend.id });
  for (const n of [3, 4, 5]) {
    const member = f.add(n);
    const session = newSession(member.username!);
    f.store.enter('join', session.token, session.name, room.room_id, {
      id: member.id,
      expiresAt: Infinity,
      name: member.username!,
      profile: member.profile!,
    });
  }
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
  await assert.rejects(f.service.send(host.id, { roomId: room.room_id, other: friend.id }), /full/);
  f.store.db.prepare('UPDATE seats SET departed=1 WHERE room_id=? AND id<>?').run(room.room_id, room.id);
  f.store.db.prepare('INSERT INTO games(room_id,state) VALUES(?,?)').run(room.room_id, '{"phase":"roll"}');
  assert.equal((await f.service.list(friend.id)).incoming.length, 0);
});

test('sender invitation capacity is bounded even when recipients dismiss', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    room = f.room(host);
  for (let n = 2; n < ROOM_INVITE_ACCOUNT_LIMIT + 2; n++) {
    const friend = f.add(n);
    f.befriend(host, friend);
    const invite = await f.service.send(host.id, { roomId: room.room_id, other: friend.id });
    await f.service.dismiss(friend.id, { id: invite.id });
  }
  const extra = f.add(100);
  f.befriend(host, extra);
  await assert.rejects(f.service.send(host.id, { roomId: room.room_id, other: extra.id }), /too many/);
  f.advance(ROOM_INVITE_TTL_MS);
  await f.service.send(host.id, { roomId: room.room_id, other: extra.id });
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM room_invites').get()!.n, 1);
});

test('invitations survive a server restart with the same identity and deadline', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-room-invites-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'game.sqlite');
  const f = fixture(path);
  const host = f.add(1),
    friend = f.add(2);
  f.befriend(host, friend);
  const room = f.room(host),
    invite = await f.service.send(host.id, { roomId: room.room_id, other: friend.id });
  f.store.close();
  const restored = new Store(path, { now: () => 2000 });
  t.after(() => restored.close());
  const service = new RoomInviteService(restored, f.api, () => 2000);
  assert.deepEqual((await service.list(friend.id)).incoming, [invite]);
});

test('a recipient cannot be flooded past its bounded invitation capacity', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const recipient = f.add(99);
  for (let n = 1; n <= ROOM_INVITE_ACCOUNT_LIMIT; n++) {
    const sender = f.add(n);
    f.befriend(sender, recipient);
    const room = f.room(sender);
    await f.service.send(sender.id, { roomId: room.room_id, other: recipient.id });
  }
  const sender = f.add(50);
  f.befriend(sender, recipient);
  const room = f.room(sender);
  await assert.rejects(f.service.send(sender.id, { roomId: room.room_id, other: recipient.id }), /too many/);
  assert.equal((await f.service.list(recipient.id)).incoming.length, ROOM_INVITE_ACCOUNT_LIMIT);
});

test('room membership is checked again after the asynchronous friendship authority lookup', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const host = f.add(1),
    friend = f.add(2);
  f.befriend(host, friend);
  const room = f.room(host);
  const original = f.api.friends.bind(f.api);
  f.api.friends = async (token) => {
    const value = await original(token);
    f.store.db.prepare('UPDATE seats SET departed=1 WHERE id=?').run(room.id);
    return value;
  };
  await assert.rejects(
    f.service.send(host.id, { roomId: room.room_id, other: friend.id }),
    /no longer available/,
  );
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM room_invites').get()!.n, 0);
});
