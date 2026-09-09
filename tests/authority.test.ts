import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { Store } from '../apps/server/src/store.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { snapshotProblem } from '../apps/client/src/state.js';
import { createGame, gameView, emptyHand, robberVictims } from '../packages/rules/src/game.js';
import type { GameAction, Game } from '../packages/rules/src/game.js';
import type { RoomState, HistoryEntry } from '../packages/protocol/src/index.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { readyLobby } from './helpers.js';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await pause(5);
  }
}
function choose(g: Game): { player: string; action: GameAction } {
  let player = g.players[g.active]!.id;
  const legal = gameView(g, player).legal;
  let action: GameAction;
  if (g.phase === 'setupSettlement') action = { kind: 'settlement', vertex: legal.settlements[0]! };
  else if (g.phase === 'setupRoad') action = { kind: 'road', edge: legal.roads[0]! };
  else if (g.phase === 'roll') action = { kind: 'roll' };
  else if (g.phase === 'actions') action = { kind: 'endTurn' };
  else if (g.phase === 'robber') {
    const hex = (g.robber + 1) % 19,
      victim = robberVictims(g, player, hex)[0];
    action = { kind: 'robber', hex, ...(victim ? { victim } : {}) };
  } else {
    player = Object.keys(g.discards)[0]!;
    let left = g.discards[player]!;
    const resources = emptyHand();
    for (const r of RESOURCES) {
      resources[r] = Math.min(left, g.players.find((p) => p.id === player)!.hand[r]);
      left -= resources[r];
    }
    action = { kind: 'discard', resources };
  }
  return { player, action };
}
test('every accepted game action has durable history, private outcomes and a hash-linked state; failed receipts roll everything back', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const session = newSession('One'),
    host = store.enter('create', session.token, session.name);
  for (const name of ['Two', 'Three']) {
    const s = newSession(name);
    store.enter('join', s.token, name, host.room_id);
  }
  store.action(host, 'start-ledger-game', readyLobby(store, host.room_id), { kind: 'start' });
  for (let i = 0; i < 150; i++) {
    const g = store.loadGame(host.room_id)!,
      next = choose(g);
    const p = store.snapshot(host.room_id).players.find((p) => p.id === next.player)!;
    store.action(
      { ...p, room_id: host.room_id },
      `event-command-${i}`,
      store.snapshot(host.room_id).revision,
      next.action,
    );
  }
  const saved = structuredClone(store.loadGame(host.room_id)!);
  assert.equal(saved.log.length, 80);
  const entries: HistoryEntry[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = store.history(host.room_id, cursor);
    entries.push(...page.entries);
    if (!page.hasMore) break;
    cursor = page.entries.at(-1)!.revision;
  }
  assert.equal(entries.length, 151);
  assert.equal(new Set(entries.map((e) => e.revision)).size, 151);
  assert.ok(entries.every((e) => e.lines.length > 0));
  assert.equal(entries.at(-1)!.kind, 'start');
  assert.ok(!JSON.stringify(entries).includes('"hand":'));
  assert.ok(!JSON.stringify(entries).includes('"deck":'));
  const rows = store.db
    .prepare('SELECT previous_hash,state_hash,state FROM game_events ORDER BY revision')
    .all() as { previous_hash: string | null; state_hash: string; state: string }[];
  rows.forEach((row, i) => {
    assert.equal(createHash('sha256').update(row.state).digest('hex'), row.state_hash);
    assert.equal(row.previous_hash, i ? rows[i - 1]!.state_hash : null);
  });
  const next = choose(saved),
    p = store.snapshot(host.room_id).players.find((p) => p.id === next.player)!,
    seat = { ...p, room_id: host.room_id },
    revision = store.snapshot(host.room_id).revision;
  store.db.exec(
    "CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT,'Receipt failure'); END",
  );
  assert.throws(() => store.action(seat, 'retry-ledger-command', revision, next.action));
  assert.deepEqual(store.loadGame(host.room_id), saved);
  assert.equal(store.history(host.room_id).entries[0]!.revision, revision);
  store.db.exec('DROP TRIGGER fail_receipt');
  const receipt = store.action(seat, 'retry-ledger-command', revision, next.action);
  assert.equal(store.action(seat, 'retry-ledger-command', revision, next.action).duplicate, true);
  assert.equal(store.history(host.room_id).entries[0]!.revision, receipt.revision);
  const corrupted = store.loadGame(host.room_id)!;
  delete corrupted.roads[Number(Object.keys(corrupted.roads)[0])];
  store.db.prepare('UPDATE games SET state=? WHERE room_id=?').run(JSON.stringify(corrupted), host.room_id);
  assert.throws(() => store.snapshot(host.room_id), /needs recovery/);
});

test('client retains permanent pieces and refuses rollback snapshots while allowing city upgrades and presence changes', () => {
  const g = createGame(
    [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
      { id: 'three', name: 'Three' },
    ],
    24,
    () => 0.3,
  );
  g.roads[0] = 'one';
  g.buildings[0] = { player: 'one', kind: 'settlement' };
  const current: RoomState = {
    roomId: 'ABCD2345',
    revision: 8,
    counter: 0,
    players: [],
    game: gameView(g, 'one'),
  };
  const stale = structuredClone(current);
  stale.revision = 7;
  assert.equal(snapshotProblem(current, stale), 'stale');
  const lost = structuredClone(current);
  lost.revision = 9;
  delete lost.game!.roads[0];
  assert.match(snapshotProblem(current, lost)!, /road/);
  const changed = structuredClone(current);
  changed.revision = 9;
  changed.game!.buildings[0]!.kind = 'city';
  assert.equal(snapshotProblem(current, changed), null);
  assert.match(snapshotProblem(changed, current)!, /stale/);
  assert.equal(snapshotProblem(current, { ...current, players: [] }), null);
});

test('a move waits for its committed snapshot; out-of-order or missing-piece frames cannot erase a road', async (t) => {
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const address = wss.address();
  assert.ok(address && typeof address !== 'string');
  const g = createGame(
    [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
      { id: 'three', name: 'Three' },
    ],
    24,
    () => 0.3,
  );
  const state: RoomState = {
    roomId: 'ABCD2345',
    revision: 0,
    counter: 0,
    players: [],
    game: gameView(g, 'one'),
  };
  let peer: WebSocket | undefined,
    commandId: string | undefined,
    syncs = 0;
  wss.on('connection', (ws) => {
    peer = ws;
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.type === 'create' || m.type === 'resume')
        ws.send(JSON.stringify({ type: 'welcome', version: 1, playerId: 'one', state }));
      if (m.type === 'action') {
        commandId = m.commandId;
        ws.send(JSON.stringify({ type: 'ack', commandId, revision: 1, counter: 0, duplicate: false }));
      }
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', nonce: m.nonce, revision: 0 }));
      if (m.type === 'sync') syncs++;
    });
  });
  const c = new Connection(`ws://127.0.0.1:${address.port}`, newSession('One'), {
    minRetryMs: 20,
    maxRetryMs: 30,
  });
  t.after(async () => {
    c.stop();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
  });
  c.start();
  await until(() => c.status === 'connected');
  let resolved = false;
  const pending = c.action({ kind: 'road', edge: 0 }).then(() => {
    resolved = true;
  });
  await until(() => !!commandId);
  await pause(30);
  assert.equal(resolved, false);
  assert.equal(c.awaitingConfirmation, true);
  const next = structuredClone(state);
  next.revision = 1;
  next.game!.roads[0] = 'one';
  peer!.send(JSON.stringify({ type: 'state', state: next }));
  await pending;
  assert.equal(c.awaitingConfirmation, false);
  peer!.send(JSON.stringify({ type: 'state', state }));
  const missing = structuredClone(next);
  missing.revision = 2;
  delete missing.game!.roads[0];
  peer!.send(JSON.stringify({ type: 'state', state: missing }));
  await until(() => syncs > 0);
  assert.equal(c.state!.game!.roads[0], 'one');
  assert.equal(c.state!.revision, 1);
  assert.ok(c.metrics.rejectedSnapshots >= 2);
  for (let i = 0; i < 50; i++) peer!.send(JSON.stringify({ type: 'state', state: missing }));
  await pause(50);
  assert.equal(syncs, 1, 'invalid frames cannot cause an unbounded resync loop');
  peer!.send(JSON.stringify({ type: 'state', state: next }));
  await until(() => !c.metrics.syncIssue);
  assert.ok(c.metrics.samples.some((s) => s.rtt !== null));
  const oldPeer = peer;
  peer!.close();
  await until(() => peer !== oldPeer && c.status === 'connected' && !!c.metrics.syncIssue);
  assert.equal(c.state!.revision, 1);
  assert.equal(c.state!.game!.roads[0], 'one');
  await assert.rejects(c.action({ kind: 'road', edge: 1 }), /Resynchronizing/);
  peer!.send(JSON.stringify({ type: 'state', state: next }));
  await until(() => !c.metrics.syncIssue);
});
