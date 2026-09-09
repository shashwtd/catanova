import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { AccountService } from '../apps/server/src/accounts.js';
import { startServer } from '../apps/server/src/server.js';
import type { Identity } from '../apps/server/src/auth.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Account } from '../packages/protocol/src/profile.js';

async function until(check: () => boolean) {
  const deadline = performance.now() + 6000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for account/socket state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(t: TestContext, isGuest = false) {
  const profile = { ...defaultProfile('Captain'), username: 'Captain', avatarSource: 'generated' as const };
  const account: Account = {
    id: 'account-captain',
    username: 'Captain',
    isGuest,
    registered: true,
    profile,
    googleAvatarUrl: null,
    lastActiveAt: new Date().toISOString(),
    expiresAt: isGuest ? new Date(Date.now() + 7 * 86400000).toISOString() : null,
  };
  const identity: Identity = {
    id: account.id,
    name: profile.name,
    profile,
    isGuest,
    expiresAt: Date.now() + 60000,
    ...(isGuest ? { guestExpiresAt: Date.parse(account.expiresAt!) } : {}),
  };
  // The account-service boundary is controlled; sockets, seat ownership, and commits are real.
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    auth: { url: 'http://127.0.0.1:1', publishableKey: 'sb_publishable_test' },
    verifyIdentity: async () => ({ ...identity }),
  });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
  });
  const connect = async (previous?: Connection) => {
    const client = new Connection(server.url, previous ? { ...previous.session } : newSession('Untrusted'), {
      accessToken: async () => 'test-access',
      minRetryMs: 30,
      maxRetryMs: 100,
    });
    clients.push(client);
    client.start();
    await until(() => client.status === 'connected');
    return client;
  };
  return { server, account, profile, identity, connect };
}

test('a deferred canonical profile lookup cannot commit after another socket resumes the seat', async (t) => {
  const gate = deferred<Account>();
  const lookup = t.mock.method(AccountService.prototype, 'get', () => gate.promise);
  const { server, account, profile, connect } = await fixture(t);
  t.after(() => gate.resolve(account));
  const original = await connect(),
    before = original.state!.revision,
    pending = original.lobby(true, profile).catch((error: Error) => error);
  await until(() => lookup.mock.callCount() === 1);
  const replacement = await connect(original);
  await until(() => original.status === 'closed');
  gate.resolve(account);
  await setImmediate();
  assert.ok((await pending) instanceof Error);
  assert.equal(server.store.snapshot(original.session.roomId!).revision, before);
  assert.equal(server.store.snapshot(original.session.roomId!).players[0]!.ready, false);
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM lobby_receipts').get()!.n, 0);
  const accepted = await replacement.increment();
  assert.equal(accepted.revision, before + 1, 'the current socket alone retains authority');
});

test('guest acknowledgements and subsequent accepted actions do not wait for an unfinished activity write', async (t) => {
  const gate = deferred<Account>();
  const touch = t.mock.method(AccountService.prototype, 'touch', () => gate.promise);
  const { server, account, connect } = await fixture(t, true);
  t.after(() => gate.resolve(account));
  const guest = await connect();
  let firstConfirmed = false;
  const first = guest.increment().then((ack) => {
    firstConfirmed = true;
    return ack;
  });
  // Observe before resolving the activity request, so an awaited network write would fail this test.
  await until(() => firstConfirmed && touch.mock.callCount() === 1);
  assert.equal((await first).counter, 1);
  const second = await guest.increment();
  assert.equal(second.counter, 2);
  assert.equal(
    touch.mock.callCount(),
    1,
    'pending activity is coalesced instead of stalling or duplicating writes',
  );
  assert.equal(server.store.snapshot(guest.session.roomId!).counter, 2);
  gate.resolve(account);
  await setImmediate();
  assert.equal(
    server.store.snapshot(guest.session.roomId!).counter,
    2,
    'finishing activity cannot replay moves',
  );
});

test('token expiry during a canonical profile lookup rejects its pending mutation', async (t) => {
  const gate = deferred<Account>();
  const lookup = t.mock.method(AccountService.prototype, 'get', () => gate.promise);
  const { server, account, profile, identity, connect } = await fixture(t);
  t.after(() => gate.resolve(account));
  const client = await connect(),
    before = client.state!.revision,
    pending = client.lobby(true, profile).catch((error: Error) => error);
  await until(() => lookup.mock.callCount() === 1);
  // Advance the verified deadline without depending on short wall-clock timers or reconnect races.
  t.mock.method(Date, 'now', () => identity.expiresAt + 1);
  gate.resolve(account);
  const result = await pending;
  assert.ok(result instanceof Error);
  assert.match(result.message, /AUTH_REQUIRED/);
  assert.equal(server.store.snapshot(client.session.roomId!).revision, before);
  assert.equal(server.store.snapshot(client.session.roomId!).players[0]!.ready, false);
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM lobby_receipts').get()!.n, 0);
});

test('a handshake whose verified deadline expires during lookup creates no room or seat', async (t) => {
  const gate = deferred<Identity>();
  const identity: Identity = {
    id: 'account-expiring',
    name: 'Captain',
    profile: defaultProfile('Captain'),
    expiresAt: Date.now() + 60000,
  };
  let verificationStarted = false;
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    auth: { url: 'http://127.0.0.1:1', publishableKey: 'sb_publishable_test' },
    verifyIdentity: async () => {
      verificationStarted = true;
      return gate.promise;
    },
  });
  const client = new Connection(server.url, newSession('Untrusted'), {
    accessToken: async () => 'test-access',
  });
  const errors: string[] = [];
  client.subscribe((message) => {
    if (message.type === 'error') errors.push(message.code);
  });
  t.after(async () => {
    gate.resolve(identity);
    client.stop();
    await server.close();
  });
  client.start();
  await until(() => verificationStarted);
  t.mock.method(Date, 'now', () => identity.expiresAt + 1);
  gate.resolve(identity);
  await until(() => client.status === 'closed');
  assert.deepEqual(errors, ['AUTH_REQUIRED']);
  assert.equal(client.state, null, 'no welcome snapshot was accepted');
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM rooms').get()!.n, 0);
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM seats').get()!.n, 0);
});
