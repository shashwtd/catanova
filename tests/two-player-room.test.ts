import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { gameView } from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';

async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the two-player room');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const retry = { minRetryMs: 30, maxRetryMs: 100 };

test('two invited clients finish snake setup and recover private accepted state after a seat disconnect and server restart; solo start is rejected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-two-player-'));
  const databasePath = join(directory, 'game.sqlite');
  let server = await startServer({ port: 0, databasePath, auth: null });
  const port = server.port,
    clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const host = new Connection(server.url, newSession('Host'), retry);
  clients.push(host);
  host.start();
  await until(() => host.status === 'connected');
  const soloRevision = host.state!.revision;
  await assert.rejects(host.action({ kind: 'start' }), /two to four players/);
  assert.equal(host.state!.revision, soloRevision);
  assert.equal(server.store.loadGame(host.session.roomId!), undefined);

  const friend = new Connection(server.url, newSession('Friend', host.session.roomId), retry);
  clients.push(friend);
  friend.start();
  await until(() => clients.every((client) => client.state?.players.length === 2));
  await assert.rejects(host.action({ kind: 'start' }), /NOT_READY/);
  for (const client of clients) {
    const ready = await client.lobby(true);
    await until(() => clients.every((peer) => peer.state!.revision === ready.revision));
  }
  const started = await host.action({ kind: 'start' });
  await until(() => clients.every((client) => client.state!.revision === started.revision));
  const order = host.state!.game!.players.map((player) => player.id),
    settlementOrder: string[] = [];
  let absent: Connection | undefined, online: Connection | undefined;
  for (let move = 0; move < 8; move++) {
    const game = host.state!.game!,
      actor = clients.find((client) => client.playerId === game.players[game.active]!.id)!;
    const legal = actor.state!.game!.legal;
    if (game.phase === 'setupSettlement') settlementOrder.push(actor.playerId!);
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! };
    if (move === 7) {
      online = actor;
      absent = clients.find((client) => client !== actor)!;
      absent.stop();
      await until(() =>
        actor.state!.players.some((player) => player.id === absent!.playerId && !player.connected),
      );
    }
    const accepted = await actor.action(action);
    await until(() =>
      clients
        .filter((client) => client !== absent)
        .every((client) => client.state!.revision === accepted.revision),
    );
  }
  assert.deepEqual(settlementOrder, [order[0], order[1], order[1], order[0]]);
  const roomId = host.session.roomId!,
    saved = structuredClone(server.store.loadGame(roomId)!),
    savedRevision = server.store.snapshot(roomId).revision;
  assert.equal(saved.phase, 'roll');
  assert.equal(saved.turn, 1);
  assert.equal(Object.keys(saved.roads).length, 4);
  assert.equal(Object.keys(saved.buildings).length, 4);
  for (const player of saved.players) {
    assert.equal(Object.values(saved.roads).filter((owner) => owner === player.id).length, 2);
    assert.equal(Object.values(saved.buildings).filter((piece) => piece.player === player.id).length, 2);
  }
  const resumed = new Connection(server.url, { ...absent!.session }, retry);
  clients.push(resumed);
  resumed.start();
  await until(
    () => resumed.status === 'connected' && online!.state!.players.every((player) => player.connected),
  );
  assert.equal(resumed.playerId, absent!.playerId);
  assert.equal(resumed.state!.players.length, 2, 'resume reclaims the same seat');
  assert.equal(resumed.state!.revision, savedRevision);
  for (const client of [online!, resumed]) {
    assert.deepEqual(client.state!.game, gameView(saved, client.playerId!));
    for (const player of client.state!.game!.players) {
      assert.equal(player.hand !== undefined, player.id === client.playerId);
      assert.equal(player.cards !== undefined, player.id === client.playerId);
    }
    assert.ok(!JSON.stringify(client.state).includes('"deck":'));
  }
  const sessions = [online!, resumed].map((client) => ({ ...client.session }));
  clients.forEach((client) => client.stop());
  await server.close();
  server = await startServer({ port, databasePath, auth: null });
  for (const session of sessions) {
    const client = new Connection(server.url, session, retry);
    clients.push(client);
    client.start();
    await until(() => client.status === 'connected');
    assert.equal(client.state!.revision, savedRevision);
    assert.deepEqual(client.state!.game, gameView(saved, client.playerId!));
  }
  assert.deepEqual(server.store.loadGame(roomId), saved);
  assert.equal(server.store.history(roomId).entries.filter((entry) => entry.kind === 'road').length, 4);
});

test('invited rooms retain a four-seat limit and refuse a fifth real client without changing the room', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null }),
    clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
  });
  for (const name of ['Host', 'Second', 'Third', 'Fourth']) {
    const client = new Connection(server.url, newSession(name, clients[0]?.session.roomId), retry);
    clients.push(client);
    client.start();
    await until(() => client.status === 'connected');
  }
  await until(() => clients.every((client) => client.state?.players.length === 4));
  const host = clients[0]!,
    before = structuredClone(server.store.snapshot(host.session.roomId!));
  const fifth = new Connection(server.url, newSession('Fifth', host.session.roomId), retry);
  clients.push(fifth);
  let rejected = '';
  fifth.subscribe((message) => {
    if (message.type === 'error') rejected = message.code;
  });
  fifth.start();
  await until(() => !!rejected);
  assert.equal(rejected, 'ROOM_FULL');
  assert.equal(fifth.playerId, null);
  assert.equal(fifth.status, 'closed');
  const after = server.store.snapshot(host.session.roomId!);
  assert.deepEqual({ ...after, serverNow: 0 }, { ...before, serverNow: 0 });
});
