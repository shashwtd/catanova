/** The admin console's Modes tab: who may pick each game mode, changed while the server runs, and audited. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../apps/server/src/server.js';
import { ProtocolError } from '../apps/server/src/store.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import type { AdminModes, AuditPage, PlayerDetail } from '../apps/server/src/admin/types.js';
import { CLASSIC_ONLY, ModeAccess, readModeSwitches } from '../apps/server/src/modes.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { BIG_TABLE, CLASSIC, OPEN_SEA, rulesets } from '../packages/rules/src/rulesets.js';
import { API, raw } from './admin-fixture.js';

const ORIGIN = 'http://127.0.0.1:3100';
const MUTATION = { ...API, Origin: ORIGIN, 'Content-Type': 'application/json' };
const HOST = '0a1b2c3d-0000-4000-8000-000000000001';
const FRIEND = '0a1b2c3d-0000-4000-8000-000000000002';

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('the console’s choices override the start-up switches, survive a restart, and never close Classic', () => {
  const db = new DatabaseSync(':memory:');
  const quiet = () => {};
  const access = new ModeAccess(
    db,
    readModeSwitches({ CATANOVA_MODES: OPEN_SEA.id, CATANOVA_MODE_TESTERS: 'ACCT-ENV' }, quiet),
  );
  // Before the console sets anything: production.env opens Open Sea, and every other mode is for testers.
  assert.deepEqual(
    access.settings().map((setting) => [setting.id, setting.state, setting.source]),
    [
      [CLASSIC.id, 'everyone', 'always'],
      [BIG_TABLE.id, 'testers', 'default'],
      [OPEN_SEA.id, 'everyone', 'environment'],
    ],
  );
  assert.deepEqual(access.modesFor(undefined), [CLASSIC.id, OPEN_SEA.id]);
  assert.deepEqual(access.modesFor('acct-env'), [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id]);

  // The console wins over production.env, and Off is off for testers too.
  assert.deepEqual(access.setState(BIG_TABLE.id, 'everyone', 'owner', 1000), {
    from: 'testers',
    to: 'everyone',
  });
  assert.deepEqual(access.setState(OPEN_SEA.id, 'off', 'owner', 2000), { from: 'everyone', to: 'off' });
  assert.deepEqual(access.modesFor(undefined), [CLASSIC.id, BIG_TABLE.id]);
  assert.deepEqual(access.modesFor('acct-env'), [CLASSIC.id, BIG_TABLE.id]);
  assert.throws(() => access.setState(CLASSIC.id, 'off', 'owner', 3000), /cannot be switched/);
  assert.throws(() => access.setState('ocean-v9', 'off', 'owner', 3000), /cannot be switched/);

  // Testers are matched whatever their case, and adding one twice changes nothing.
  assert.equal(access.setTester('ACCT-1', true, 'owner', 4000), true);
  assert.equal(access.setTester('acct-1', true, 'owner', 5000), false);
  access.setState(OPEN_SEA.id, 'testers', 'owner', 6000);
  assert.deepEqual(access.modesFor('Acct-1'), [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id]);
  assert.deepEqual(access.modesFor('acct-2'), [CLASSIC.id, BIG_TABLE.id]);
  assert.deepEqual(access.testers(), [
    { userId: 'acct-env', source: 'environment', addedAt: null, addedBy: null },
    { userId: 'acct-1', source: 'console', addedAt: 4000, addedBy: 'owner' },
  ]);
  assert.deepEqual(access.tester('ACCT-ENV')?.source, 'environment');
  assert.equal(access.tester(null), null);

  // A server started again on the same database keeps the console's choices, whatever production.env says.
  const again = new ModeAccess(db, CLASSIC_ONLY);
  assert.deepEqual(again.modesFor('acct-1'), [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id]);
  assert.equal(again.settings()[2]!.changedBy, 'owner');
  // A mode this build does not know, left in the table by a newer one, is ignored.
  db.prepare("INSERT INTO mode_access VALUES ('ocean-v9', 'everyone', 1, 'owner')").run();
  assert.deepEqual(again.modesFor(undefined), [CLASSIC.id, BIG_TABLE.id]);
  assert.equal(again.setTester('acct-1', false, 'owner', 7000), true);
  assert.deepEqual(again.modesFor('acct-1'), [CLASSIC.id, BIG_TABLE.id]);
  assert.throws(() => db.prepare("INSERT INTO mode_testers VALUES ('Upper', 1, 'x')").run(), /CHECK/);
});

/** A signed-in game server and its admin listener on one file database. */
async function running(t: TestContext, modes?: ModeSwitches) {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-admin-modes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'game.sqlite');
  const server = await startServer({
    port: 0,
    databasePath,
    captcha: null,
    ...(modes ? { modes } : {}),
    verifyIdentity: async (token) => {
      if (token !== 'host' && token !== 'friend') throw new ProtocolError('AUTH_REQUIRED', 'Sign in');
      return {
        id: token === 'host' ? HOST : FRIEND,
        name: token === 'host' ? 'Hosta' : 'Fren',
        expiresAt: Date.now() + 3_600_000,
      };
    },
  });
  const clients: Connection[] = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    await server.close();
  });
  const admin = await startAdminServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      auth: { mode: 'local-dev' },
      origin: ORIGIN,
      statusDir: join(dir, 'status'),
      revision: 'test',
    },
    store: server.store,
    runtime: server.runtime,
    databasePath,
    assetsDirectory: join(dir, 'no-build'),
    log: () => {},
  });
  t.after(() => admin.close());
  const get = async <T>(path: string, expect = 200): Promise<T> => {
    const response = await raw(admin.port, path, { headers: API });
    assert.equal(response.status, expect, `${path}: ${response.body}`);
    return JSON.parse(response.body) as T;
  };
  const post = async <T>(path: string, body: unknown, expect = 200): Promise<T> => {
    const response = await raw(admin.port, path, {
      method: 'POST',
      headers: MUTATION,
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expect, `${path}: ${response.body}`);
    return JSON.parse(response.body) as T;
  };
  /** A signed-in tab of today's client, creating a room or joining one. */
  const open = async (token: 'host' | 'friend', roomId?: string) => {
    const client = new Connection(server.url, newSession(token, roomId), {
      accessToken: async () => token,
      rulesets: rulesets().map((ruleset) => ruleset.id),
      minRetryMs: 30,
      maxRetryMs: 100,
    });
    clients.push(client);
    client.start();
    await until(() => client.status === 'connected' && !!client.state, `${token} to connect`);
    return client;
  };
  return { server, store: server.store, get, post, open };
}

test('the Modes tab opens and closes a mode at once, shows the waiting host, and audits each change', async (t) => {
  const { store, get, post, open } = await running(t);
  const host = await open('host');
  const friend = await open('friend', host.session.roomId);
  const roomId = host.state!.roomId;
  // Nothing is open beyond Classic, so the host is sent no choice at all.
  assert.equal(host.state!.modes, undefined);
  const before = await get<AdminModes>('/api/admin/modes');
  assert.deepEqual(
    before.modes.map((mode) => [mode.id, mode.state, mode.source]),
    [
      [CLASSIC.id, 'everyone', 'always'],
      [BIG_TABLE.id, 'testers', 'default'],
      [OPEN_SEA.id, 'testers', 'default'],
    ],
  );
  assert.deepEqual(before.modes[1]!.seats, { min: 5, max: 6 });
  assert.deepEqual(before.testers, []);

  // Open to everyone: the host's picker appears without anyone reconnecting, and only the host is sent it.
  const opened = await post<AdminModes>(`/api/admin/modes/${BIG_TABLE.id}`, { state: 'everyone' });
  assert.deepEqual(
    [opened.modes[1]!.state, opened.modes[1]!.source, opened.modes[1]!.changedBy],
    ['everyone', 'console', 'local-dev'],
  );
  await until(() => same(host.state?.modes, [CLASSIC.id, BIG_TABLE.id]), 'the host to be offered Big Table');
  assert.equal(friend.state!.modes, undefined);
  await host.settings({ turnTimerSeconds: 90, mode: BIG_TABLE.id });
  assert.equal(host.state!.settings?.mode, BIG_TABLE.id);

  // Off again: the picker goes, and the room cannot start in it, though the host chose it while it was open.
  await post(`/api/admin/modes/${BIG_TABLE.id}`, { state: 'off' });
  await until(() => host.state?.modes === undefined, 'the host’s choice to close');
  assert.throws(
    () => store.startingRules(roomId),
    (error: ProtocolError) => error.code === 'MODE_UNAVAILABLE',
  );
  // Choosing what is already set records nothing.
  await post(`/api/admin/modes/${BIG_TABLE.id}`, { state: 'off' });

  // Refusals change nothing.
  await post(`/api/admin/modes/${BIG_TABLE.id}`, { state: 'on' }, 400);
  await post(`/api/admin/modes/${BIG_TABLE.id}`, { state: 'off', extra: 1 }, 400);
  await post(`/api/admin/modes/${CLASSIC.id}`, { state: 'off' }, 409);
  await post('/api/admin/modes/ocean-v9', { state: 'off' }, 404);
  await post(`/api/admin/testers/${HOST}`, { tester: 'yes' }, 400);
  await post('/api/admin/testers/ffffffff-0000-4000-8000-000000000009', { tester: true }, 404);
  assert.deepEqual(store.modes.testers(), []);

  // A tester's room may pick the modes open to testers, which Open Sea is until the console says otherwise.
  const added = await post<AdminModes>(`/api/admin/testers/${HOST.toUpperCase()}`, { tester: true });
  assert.deepEqual(
    added.testers.map((tester) => [tester.userId, tester.name, tester.source, tester.addedBy]),
    [[HOST, 'Hosta', 'console', 'local-dev']],
  );
  await until(() => same(host.state?.modes, [CLASSIC.id, OPEN_SEA.id]), 'the tester to be offered Open Sea');
  assert.equal(friend.state!.modes, undefined, 'the friend is not the host');
  assert.equal((await get<PlayerDetail>(`/api/admin/players/${HOST}`)).tester?.source, 'console');
  assert.equal((await get<PlayerDetail>(`/api/admin/players/${FRIEND}`)).tester, null);
  await post(`/api/admin/testers/${HOST}`, { tester: false });
  await until(() => host.state?.modes === undefined, 'the host to stop testing');

  const audit = await get<AuditPage>('/api/admin/audit');
  assert.deepEqual(
    audit.entries.map((entry) => [entry.action, entry.target, entry.actor, entry.detail]),
    [
      ['mode.tester_remove', `player:${HOST}`, 'local-dev', { name: 'Hosta' }],
      ['mode.tester_add', `player:${HOST}`, 'local-dev', { name: 'Hosta' }],
      ['mode.set', `mode:${BIG_TABLE.id}`, 'local-dev', { from: 'everyone', to: 'off' }],
      ['mode.set', `mode:${BIG_TABLE.id}`, 'local-dev', { from: 'testers', to: 'everyone' }],
    ],
  );
});

test('a tester from production.env stays one, whatever the console is asked', async (t) => {
  const { get, post, open } = await running(
    t,
    readModeSwitches({ CATANOVA_MODE_TESTERS: HOST }, () => {}),
  );
  const host = await open('host');
  assert.deepEqual(host.state!.modes, [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id]);
  await post(`/api/admin/testers/${HOST}`, { tester: false }, 409);
  // Asking for what it already is changes nothing and records nothing.
  await post(`/api/admin/testers/${HOST}`, { tester: true });
  const page = await get<AdminModes>('/api/admin/modes');
  assert.deepEqual(
    page.testers.map((tester) => [tester.userId, tester.name, tester.source]),
    [[HOST, 'Hosta', 'environment']],
  );
  assert.equal((await get<AuditPage>('/api/admin/audit')).entries.length, 0);
  // The console can still close a mode to everyone, testers included.
  await post(`/api/admin/modes/${OPEN_SEA.id}`, { state: 'off' });
  await until(() => same(host.state?.modes, [CLASSIC.id, BIG_TABLE.id]), 'Open Sea to close for the tester');
});
