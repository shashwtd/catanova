import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/protocol/src/index.js';
import { CLASSIC } from '../packages/rules/src/rulesets.js';
import { TEST_TABLE, useTestTable } from './test-ruleset.js';

useTestTable();
const TEST = TEST_TABLE.id;
const OPEN: ModeSwitches = { open: [CLASSIC.id, TEST], testers: new Set() };

async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the room');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('a tab that cannot draw the room’s mode is kept out of it, and told to refresh', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-modes-capability-'));
  const server = await startServer({
    port: 0,
    databasePath: join(directory, 'game.sqlite'),
    auth: null,
    modes: OPEN,
  });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const modern = { minRetryMs: 30, maxRetryMs: 100, rulesets: [CLASSIC.id, TEST] };
  const open = (name: string, roomId?: string, options: object = modern, spectating = false) => {
    const client = new Connection(
      server.url,
      { ...newSession(name, roomId), ...(spectating ? { spectating } : {}) },
      {
        minRetryMs: 30,
        maxRetryMs: 100,
        ...options,
      },
    );
    const errors: string[] = [];
    client.subscribe((message) => {
      if (message.type === 'error') errors.push(`${message.code}: ${message.message}`);
    });
    clients.push(client);
    client.start();
    return { client, errors };
  };
  // The capability is a field of the join message, like preloadGame; the protocol version stays 1.
  assert.equal(PROTOCOL_VERSION, 1);
  const joining = { type: 'join', version: 1, token: 'a'.repeat(64), name: 'A', roomId: 'ABCD' };
  const drawable = (rulesets: unknown) =>
    (parseClientMessage(JSON.stringify({ ...joining, rulesets })) as { rulesets?: string[] }).rulesets;
  assert.equal(parseClientMessage(JSON.stringify({ ...joining, rulesets: [TEST, CLASSIC.id] })).type, 'join');
  assert.deepEqual(drawable([TEST, TEST, CLASSIC.id]), [TEST, CLASSIC.id]);
  // The field never costs a tab its handshake, whatever a later client sends: after a rollback it must
  // still reconnect. What is not a ruleset id is dropped, repeats too, and at most 32 are kept.
  assert.deepEqual(drawable([CLASSIC.id, 'Test Table', 7, null, { id: TEST }, '', TEST]), [CLASSIC.id, TEST]);
  assert.equal(drawable('test-table-v1'), undefined);
  assert.equal(drawable({ [TEST]: true }), undefined);
  const many = Array.from({ length: 40 }, (_, i) => `mode-${i}-v1`);
  assert.deepEqual(drawable([...many, ...many]), many.slice(0, 32));
  assert.deepEqual(drawable([...Array.from({ length: 40 }, () => 'Not An Id'), TEST]), [TEST]);

  const host = open('Host');
  await until(() => host.client.status === 'connected');
  const roomId = host.client.session.roomId!;
  // An older tab can still join a Classic room.
  const early = open('Early', roomId, {});
  await until(() => early.client.status === 'connected');
  await host.client.settings({ turnTimerSeconds: 90, mode: TEST });
  await until(() => host.client.state?.settings?.mode === TEST);
  // A tab that cannot draw the test mode cannot join its lobby, and no seat is left behind by trying.
  const old = open('Old', roomId, {});
  await until(() => old.errors.length > 0);
  assert.deepEqual(old.errors, ['CLIENT_UPDATE_REQUIRED: Refresh to play Test Table']);
  assert.equal(old.client.status, 'closed');
  assert.equal(server.store.snapshot(roomId).players.length, 2);
  // The older tab already seated stops the start until it refreshes.
  // A current tab joins; ids it lists that are not ruleset ids are simply dropped.
  const current = open('Current', roomId, {
    ...modern,
    rulesets: ['Not An Id', ...modern.rulesets, 'x'.repeat(100)],
  });
  await until(() => host.client.state?.players.length === 3);
  // Ready is refused against settings a tab has not seen yet, so both see the new mode first.
  await until(() => [early.client, current.client].every((client) => client.state?.settings?.mode === TEST));
  for (const client of [early.client, current.client]) await client.lobby(true);
  await assert.rejects(
    host.client.action({ kind: 'start' }),
    /Ask every player to refresh Catanova to play Test Table/,
  );
  assert.equal(server.store.loadGame(roomId), undefined);
  early.client.stop();
  await until(
    () =>
      host.client.state?.players.find((p) => p.name === 'Player 2' || p.id === early.client.playerId)
        ?.connected === false,
  );
  const refreshed = new Connection(server.url, { ...early.client.session }, modern);
  clients.push(refreshed);
  refreshed.start();
  await until(() => refreshed.status === 'connected');
  await until(() => host.client.state?.players.every((p) => p.connected) === true);
  await refreshed.lobby(true).catch(() => undefined);
  await until(() => host.client.state?.players.filter((p) => p.ready).length === 2);
  const started = await host.client.action({ kind: 'start' });
  await until(() => (host.client.state?.revision ?? 0) >= started.revision);
  assert.equal(server.store.loadGame(roomId)!.ruleset, TEST);
  // An older tab can neither resume its seat in the game nor watch it.
  refreshed.stop();
  const stale = new Connection(server.url, { ...refreshed.session }, { minRetryMs: 30, maxRetryMs: 100 });
  const staleErrors: string[] = [];
  stale.subscribe((message) => {
    if (message.type === 'error') staleErrors.push(`${message.code}: ${message.message}`);
  });
  clients.push(stale);
  assert.equal(refreshed.session.joined, true, 'the older tab resumes the seat it holds');
  stale.start();
  await until(() => staleErrors.length > 0);
  assert.deepEqual(staleErrors, ['CLIENT_UPDATE_REQUIRED: Refresh to play Test Table']);
  const watcher = open('Watcher', roomId, {}, true);
  await until(() => watcher.errors.length > 0);
  assert.deepEqual(watcher.errors, ['CLIENT_UPDATE_REQUIRED: Refresh to play Test Table']);
  const reader = open('Reader', roomId, modern, true);
  await until(() => reader.client.status === 'connected');
  assert.equal(reader.client.state?.game?.ruleset, TEST);
});

test('a room that cannot start in its mode says so before the loading screen, not after it', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-modes-launch-'));
  const server = await startServer({
    port: 0,
    databasePath: join(directory, 'game.sqlite'),
    auth: null,
    modes: OPEN,
  });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const options = { minRetryMs: 30, maxRetryMs: 100, rulesets: [CLASSIC.id, TEST], preloadGame: true };
  const host = new Connection(server.url, newSession('Host'), options);
  clients.push(host);
  host.start();
  await until(() => host.status === 'connected');
  const roomId = host.session.roomId!;
  for (const name of ['Second', 'Third']) {
    const guest = new Connection(server.url, newSession(name, roomId), options);
    clients.push(guest);
    guest.start();
  }
  await until(() => host.state?.players.length === 3);
  await host.settings({ turnTimerSeconds: 90, mode: TEST });
  // Ready is refused against settings a tab has not seen yet, so every guest sees the new mode first.
  await until(() => clients.every((client) => client.state?.settings?.mode === TEST));
  for (const guest of clients.slice(1)) await guest.lobby(true);
  await until(() => host.state?.players.filter((p) => p.ready).length === 2);
  // A bot seated some other way, by an older release or a race, has no place in a mode without bots:
  // refused at once, with the reason, and no launch begins.
  server.store.db
    .prepare(
      "INSERT INTO seats(id, room_id, token_hash, name, profile, ready, bot, bot_level) VALUES ('bot-seat', ?, 'no-token', 'Anchor', NULL, 1, 1, 'steady')",
    )
    .run(roomId);
  await assert.rejects(host.action({ kind: 'start' }), /MODE_BOTS: Bots play Classic only/);
  assert.equal(host.state?.launch, undefined);
  assert.equal(server.store.loadGame(roomId), undefined);
});
