import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { PendingCommand } from '../apps/client/src/connection.js';
import type { GameAction } from '../packages/rules/src/game.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) { const end = Date.now() + 8000; while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for multiplayer state'); await pause(10); } }
test('four real clients finish setup, keep hands private, and recover an accepted dice roll after restart and page reload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-game-')); const path = join(directory, 'game.sqlite');
  let server = await startServer({ port: 0, databasePath: path }); const port = server.port;
  const clients: Connection[] = [];
  t.after(async () => { clients.forEach(c => c.stop()); await server.close(); await rm(directory, { recursive: true, force: true }); });
  const a = new Connection(server.url, newSession('First'), { minRetryMs: 30, maxRetryMs: 100 }); clients.push(a); a.start(); await until(() => a.status === 'connected');
  for (let i = 1; i < 4; i++) { const c = new Connection(server.url, newSession(`Player ${i + 1}`, a.session.roomId), { minRetryMs: 30, maxRetryMs: 100 }); clients.push(c); c.start(); await until(() => c.status === 'connected'); }
  await until(() => clients.every(c => c.state?.players.length === 4));
  await assert.rejects(clients[1]!.action({ kind: 'start' }), /NOT_HOST/);
  await a.action({ kind: 'start' }); await until(() => clients.every(c => !!c.state?.game));
  for (let i = 0; i < 16; i++) {
    const g = a.state!.game!; const actor = clients.find(c => c.playerId === g.players[g.active]!.id)!;
    const legal = actor.state!.game!.legal;
    const action: GameAction = g.phase === 'setupSettlement' ? { kind: 'settlement', vertex: legal.settlements[0]! } : { kind: 'road', edge: legal.roads[0]! };
    const ack = await actor.action(action); await until(() => clients.every(c => c.state!.revision === ack.revision));
  }
  for (const c of clients) {
    assert.equal(c.state!.game!.phase, 'roll');
    assert.deepEqual(c.state!.game!.board, a.state!.game!.board);
    for (const p of c.state!.game!.players) { assert.equal(!!p.hand, p.id === c.playerId); assert.equal(!!p.cards, p.id === c.playerId); }
    assert.ok(!JSON.stringify(c.state).includes('"deck":'));
  }
  const g = a.state!.game!, actor = clients.find(c => c.playerId === g.players[g.active]!.id)!;
  const command: PendingCommand = { type: 'action', action: { kind: 'roll' }, expectedRevision: actor.state!.revision, commandId: 'persisted-dice-command' };
  const seat = server.store.snapshot(a.session.roomId!).players.find(p => p.id === actor.playerId)!;
  // Commit while deliberately withholding the reply, as if a browser closed at that exact moment.
  server.store.action({ ...seat, room_id: a.session.roomId! }, command.commandId, command.expectedRevision, command.action);
  const saved = structuredClone(server.store.loadGame(a.session.roomId!)!);
  actor.stop(); await server.close();
  server = await startServer({ port, databasePath: path });
  let cleared = false;
  const reloaded = new Connection(server.url, { ...actor.session }, { pending: command, onPending: p => { if (!p) cleared = true; } }); clients.push(reloaded); reloaded.start();
  await until(() => cleared && clients.filter(c => c !== actor).every(c => c.status === 'connected'));
  assert.equal(reloaded.playerId, actor.playerId); assert.deepEqual(reloaded.state!.game!.dice, saved.dice);
  assert.equal(server.store.snapshot(a.session.roomId!).revision, command.expectedRevision + 1);
  assert.deepEqual(server.store.loadGame(a.session.roomId!), saved);
  assert.throws(() => server.store.action({ ...seat, room_id: a.session.roomId! }, command.commandId, command.expectedRevision, { kind: 'endTurn' }), /different payload/);
});
test('game writes roll back on storage failure and started three-player rooms refuse new seats', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' }); t.after(() => server.close());
  const hostSession = newSession('Host'); const host = server.store.enter('create', hostSession.token, hostSession.name);
  for (const name of ['Second', 'Third']) { const s = newSession(name); server.store.enter('join', s.token, name, host.room_id); }
  server.store.db.exec('PRAGMA query_only = ON');
  assert.throws(() => server.store.action(host, 'failed-start-command', 0, { kind: 'start' }));
  assert.equal(server.store.snapshot(host.room_id).revision, 0); assert.equal(server.store.loadGame(host.room_id), undefined);
  server.store.db.exec('PRAGMA query_only = OFF');
  server.store.action(host, 'failed-start-command', 0, { kind: 'start' });
  const fourth = newSession('Fourth'); assert.throws(() => server.store.enter('join', fourth.token, fourth.name, host.room_id), /already started/);
  assert.equal(server.store.enter('resume', hostSession.token, 'Host', host.room_id).id, host.id);
});
