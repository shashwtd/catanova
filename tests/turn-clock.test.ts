import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/protocol/src/index.js';
import { parseRoomSettings, TURN_TIMER_STEPS } from '../packages/protocol/src/settings.js';
import type { TurnTimerSeconds } from '../packages/protocol/src/settings.js';
import { activePlayer, applyAction, emptyHand, gameView, pieces, total } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { readyLobby } from './helpers.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for clock state');
    await pause(5);
  }
}
function lobby(store: Store) {
  const sessions = ['Host', 'Second', 'Third'].map((name) => newSession(name));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const seats = [host, ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, host.room_id))];
  return { host, seats, sessions };
}
function start(store: Store, seconds: TurnTimerSeconds | null = 40) {
  const room = lobby(store);
  if (seconds !== null)
    store.configureSettings(room.host, 'configure-timer', 0, { turnTimerSeconds: seconds });
  store.action(room.host, 'start-timed-game', readyLobby(store, room.host.room_id), { kind: 'start' });
  let step = 0;
  while (!store.loadGame(room.host.room_id)!.turn) {
    const game = store.loadGame(room.host.room_id)!,
      player = activePlayer(game);
    const legal = gameView(game, player.id).legal;
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! };
    store.action(
      { ...player, room_id: room.host.room_id },
      `setup-command-${step++}`,
      store.snapshot(room.host.room_id).revision,
      action,
    );
  }
  return room;
}
function activeSeat(store: Store, roomId: string): Seat {
  return { ...activePlayer(store.loadGame(roomId)!), room_id: roomId };
}
/** Seed a controlled economic scenario, preserving the ledger's current snapshot checksum. */
function fixture(store: Store, roomId: string, edit: (game: Game) => void) {
  const game = store.loadGame(roomId)!;
  edit(game);
  const state = JSON.stringify(game),
    checksum = createHash('sha256').update(state).digest('hex');
  store.db.prepare('UPDATE games SET state = ? WHERE room_id = ?').run(state, roomId);
  store.db
    .prepare(
      'UPDATE game_events SET state = ?, state_hash = ? WHERE room_id = ? AND revision = (SELECT MAX(revision) FROM game_events WHERE room_id = ?)',
    )
    .run(state, checksum, roomId, roomId);
}
function conserved(game: Game) {
  for (const resource of RESOURCES)
    assert.equal(game.bank[resource] + game.players.reduce((n, p) => n + p.hand[resource], 0), 19);
}

test('settings are bounded, host-only, revision checked, durable and reset readiness without allowing stale Ready', () => {
  const store = new Store(':memory:');
  try {
    const { host, seats } = lobby(store),
      roomId = host.room_id;
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: null });
    assert.deepEqual(TURN_TIMER_STEPS, [40, 65, 90, 115, 140]);
    for (const seconds of [39, 41, 141, 60, '40', undefined, NaN])
      assert.throws(() => parseRoomSettings({ turnTimerSeconds: seconds }));
    for (const seconds of [null, ...TURN_TIMER_STEPS])
      assert.deepEqual(parseRoomSettings({ turnTimerSeconds: seconds }), { turnTimerSeconds: seconds });
    assert.throws(
      () => store.configureSettings(seats[1]!, 'not-host-settings', 0, { turnTimerSeconds: 40 }),
      /Only the host/,
    );
    const revision = readyLobby(store, roomId);
    store.db.exec(
      "CREATE TEMP TRIGGER fail_settings_receipt BEFORE INSERT ON settings_receipts BEGIN SELECT RAISE(ABORT,'Settings receipt failure'); END",
    );
    assert.throws(
      () => store.configureSettings(host, 'failed-settings', revision, { turnTimerSeconds: 65 }),
      /Settings receipt failure/,
    );
    assert.equal(store.snapshot(roomId).revision, revision);
    assert.ok(store.snapshot(roomId).players.every((p) => p.ready));
    assert.equal(store.settings(roomId).turnTimerSeconds, null);
    store.db.exec('DROP TRIGGER fail_settings_receipt');
    assert.throws(
      () => store.configureSettings(host, 'stale-settings', 0, { turnTimerSeconds: 40 }),
      /latest settings/,
    );
    const receipt = store.configureSettings(host, 'host-settings', revision, { turnTimerSeconds: 90 });
    assert.ok(store.snapshot(roomId).players.every((p) => !p.ready));
    assert.deepEqual(store.preview(roomId).settings, { turnTimerSeconds: 90 });
    assert.throws(() => store.lobby(seats[1]!, 'stale-ready-command', revision, true), /settings changed/);
    assert.equal(
      store.configureSettings(host, 'host-settings', revision, { turnTimerSeconds: 90 }).duplicate,
      true,
    );
    assert.equal(store.snapshot(roomId).revision, receipt.revision);
    assert.throws(
      () => store.configureSettings(host, 'host-settings', revision, { turnTimerSeconds: 140 }),
      /different intent/,
    );
    for (const call of [
      () => store.lobby(host, 'host-settings', receipt.revision, true),
      () => store.increment(host, 'host-settings', receipt.revision),
      () => store.leave(host, 'host-settings', receipt.revision),
      () => store.action(host, 'host-settings', receipt.revision, { kind: 'start' }),
    ])
      assert.throws(call, /already used/);
    store.lobby(host, 'new-host-ready', receipt.revision, true);
    assert.throws(
      () => store.configureSettings(host, 'new-host-ready', receipt.revision, { turnTimerSeconds: 65 }),
      /already used/,
    );
    for (const [i, seat] of seats.entries())
      store.lobby(seat, `ready-again-${i}`, store.snapshot(roomId).revision, i !== 0);
    assert.equal(
      store.snapshot(roomId).players[0]!.ready,
      false,
      'host Start is their consent; no separate Ready step',
    );
    store.action(host, 'start-locked-settings', store.snapshot(roomId).revision, { kind: 'start' });
    assert.throws(
      () =>
        store.configureSettings(host, 'settings-after-start', store.snapshot(roomId).revision, {
          turnTimerSeconds: null,
        }),
      /locked/,
    );
    assert.equal(
      store.configureSettings(host, 'host-settings', revision, { turnTimerSeconds: 90 }).duplicate,
      true,
    );
    assert.equal(store.clock(roomId), undefined, 'setup has no deadline');
  } finally {
    store.close();
  }
});

test('normal turn deadline survives actions and seat resume; late commands finish only that turn exactly once', () => {
  let now = 1700000000000;
  const store = new Store(':memory:', { now: () => now, random: () => 0.34 });
  try {
    const { host, sessions } = start(store),
      roomId = host.room_id;
    const first = store.clock(roomId)!;
    assert.equal(first.deadlineAt, now + 40000);
    now += 5000;
    const seat = activeSeat(store, roomId),
      revision = store.snapshot(roomId).revision;
    const roll = store.action(seat, 'manual-roll-once', revision, { kind: 'roll' });
    assert.equal(store.loadGame(roomId)!.phase, 'actions');
    assert.deepEqual(store.clock(roomId), first);
    store.enter('resume', sessions[0]!.token, 'Host', roomId);
    assert.deepEqual(store.clock(roomId), first);
    now = first.deadlineAt;
    assert.throws(
      () => store.action(seat, 'late-manual-move', roll.revision, { kind: 'endTurn' }),
      /State changed/,
    );
    assert.equal(store.loadGame(roomId)!.turn, 2);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 40000);
    assert.equal(store.expireRoom(roomId), false);
    assert.equal(store.action(seat, 'manual-roll-once', revision, { kind: 'roll' }).duplicate, true);
    const automatic = store.history(roomId).entries.filter((e) => e.automatic);
    assert.equal(automatic.length, 1);
    assert.equal(automatic[0]!.kind, 'endTurn');
    assert.ok(automatic[0]!.lines.some((line) => line.includes('timer expired')));
    assert.equal(store.snapshot(roomId).serverNow, now);
  } finally {
    store.close();
  }
});

test('restart preserves a saved deadline and an overdue unrolled turn is rolled and ended without simulating downtime turns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-clock-')),
    path = join(dir, 'game.sqlite');
  let now = 1700000000000,
    store = new Store(path, { now: () => now, random: () => 0.34 });
  try {
    const { host } = start(store, 65),
      roomId = host.room_id,
      saved = store.clock(roomId)!;
    now += 12000;
    store.close();
    store = new Store(path, { now: () => now, random: () => 0.34 });
    assert.deepEqual(store.clock(roomId), saved);
    assert.equal(store.settings(roomId).turnTimerSeconds, 65);
    assert.equal(store.expireRoom(roomId), false);
    now += 86400000;
    assert.deepEqual(store.dueRooms(), [roomId]);
    assert.equal(store.expireRoom(roomId), true);
    assert.equal(store.loadGame(roomId)!.turn, 2);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 65000);
    assert.deepEqual(
      store
        .history(roomId)
        .entries.filter((e) => e.automatic)
        .map((e) => e.kind),
      ['endTurn', 'roll'],
    );
    assert.equal(store.expireRoom(roomId), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seven pauses active time and gives independent full discard deadlines; expired discards conserve resources and resume remaining time', () => {
  let now = 1700000000000,
    calls = 0,
    diceSeven = false;
  const store = new Store(':memory:', {
    now: () => now,
    random: () => (diceSeven ? (++calls % 2 ? 0.34 : 0.51) : 0.34),
  });
  try {
    const { host } = start(store),
      roomId = host.room_id,
      original = store.clock(roomId)!;
    fixture(store, roomId, (game) => {
      for (const p of game.players)
        for (const r of RESOURCES) {
          game.bank[r] += p.hand[r];
          p.hand[r] = 0;
        }
      game.players[0]!.hand.wood = 10;
      game.bank.wood -= 10;
      game.players[1]!.hand.brick = 10;
      game.bank.brick -= 10;
    });
    now += 10000;
    diceSeven = true;
    store.action(activeSeat(store, roomId), 'roll-seven-manual', store.snapshot(roomId).revision, {
      kind: 'roll',
    });
    diceSeven = false;
    const paused = store.clock(roomId)!;
    assert.equal(paused.pausedAt, now);
    assert.equal(paused.deadlineAt, original.deadlineAt);
    assert.deepEqual(Object.values(paused.discardDeadlines!), [now + 40000, now + 40000]);
    const game = store.loadGame(roomId)!,
      second = game.players[1]!;
    now += 5000;
    store.action({ ...second, room_id: roomId }, 'second-discard-manual', store.snapshot(roomId).revision, {
      kind: 'discard',
      resources: { ...emptyHand(), brick: 5 },
    });
    assert.equal(
      store.clock(roomId)!.discardDeadlines![game.players[0]!.id],
      paused.discardDeadlines![game.players[0]!.id],
    );
    assert.equal(store.clock(roomId)!.discardDeadlines![second.id], undefined);
    now = original.deadlineAt + 5000;
    assert.equal(
      store.expireRoom(roomId),
      false,
      'the active player is not punished while waiting for a full discard countdown',
    );
    now = paused.discardDeadlines![game.players[0]!.id]!;
    assert.equal(store.expireRoom(roomId), true);
    assert.equal(store.loadGame(roomId)!.phase, 'robber');
    assert.equal(store.loadGame(roomId)!.turn, 1);
    assert.equal(store.clock(roomId)!.pausedAt, undefined);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 30000);
    conserved(store.loadGame(roomId)!);
    assert.equal(store.history(roomId).entries.filter((e) => e.automatic).length, 1);
    now += 30000;
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.turn, 2);
    conserved(store.loadGame(roomId)!);
  } finally {
    store.close();
  }
});

test('an expired auto-roll of seven waits through discards and then completes the mandatory robber before ending', () => {
  let now = 1700000000000,
    calls = 0,
    diceSeven = false;
  const store = new Store(':memory:', {
    now: () => now,
    random: () => (diceSeven ? (++calls % 2 ? 0.34 : 0.51) : 0.34),
  });
  try {
    const { host } = start(store),
      roomId = host.room_id;
    fixture(store, roomId, (game) => {
      for (const p of game.players)
        for (const r of RESOURCES) {
          game.bank[r] += p.hand[r];
          p.hand[r] = 0;
        }
      game.players[1]!.hand.sheep = 9;
      game.bank.sheep -= 9;
    });
    now = store.clock(roomId)!.deadlineAt;
    diceSeven = true;
    store.expireRoom(roomId);
    diceSeven = false;
    assert.equal(store.loadGame(roomId)!.phase, 'discard');
    const paused = store.clock(roomId)!;
    now += 10000;
    assert.equal(store.expireRoom(roomId), false);
    now = Object.values(paused.discardDeadlines!)[0]!;
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.turn, 2);
    assert.deepEqual(
      store
        .history(roomId)
        .entries.filter((e) => e.automatic)
        .map((e) => e.kind),
      ['endTurn', 'robber', 'discard', 'roll'],
    );
    conserved(store.loadGame(roomId)!);
  } finally {
    store.close();
  }
});

test('paused discard deadlines survive a restart without granting new discard time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-discard-clock-')),
    path = join(dir, 'game.sqlite');
  let now = 1700000000000,
    calls = 0,
    diceSeven = false;
  const options = { now: () => now, random: () => (diceSeven ? (++calls % 2 ? 0.34 : 0.51) : 0.34) };
  let store = new Store(path, options);
  try {
    const { host } = start(store),
      roomId = host.room_id;
    fixture(store, roomId, (game) => {
      for (const p of game.players)
        for (const r of RESOURCES) {
          game.bank[r] += p.hand[r];
          p.hand[r] = 0;
        }
      game.players[1]!.hand.ore = 8;
      game.bank.ore -= 8;
      game.players[2]!.hand.wheat = 8;
      game.bank.wheat -= 8;
    });
    now += 8000;
    diceSeven = true;
    store.action(activeSeat(store, roomId), 'restart-seven-roll', store.snapshot(roomId).revision, {
      kind: 'roll',
    });
    diceSeven = false;
    const paused = store.clock(roomId)!;
    store.close();
    now += 12000;
    store = new Store(path, options);
    assert.deepEqual(store.clock(roomId), paused);
    assert.equal(store.expireRoom(roomId), false);
    now = Object.values(paused.discardDeadlines!)[0]!;
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.phase, 'robber');
    assert.equal(store.clock(roomId)!.deadlineAt, now + 32000);
    assert.deepEqual(store.loadGame(roomId)!.discards, {});
    assert.equal(
      store.history(roomId).entries.filter((entry) => entry.automatic && entry.kind === 'discard').length,
      2,
    );
    conserved(store.loadGame(roomId)!);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restart in the middle of automatic completion preserves a committed roll and retries only the unsaved end-turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-partial-clock-')),
    path = join(dir, 'game.sqlite');
  let now = 1700000000000,
    store = new Store(path, { now: () => now, random: () => 0.34 });
  try {
    const { host } = start(store),
      roomId = host.room_id;
    now = store.clock(roomId)!.deadlineAt;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_timed_end BEFORE INSERT ON game_events WHEN json_extract(NEW.action, '$.kind') = 'endTurn' BEGIN SELECT RAISE(ABORT,'End turn unavailable'); END",
    );
    assert.throws(() => store.expireRoom(roomId), /End turn unavailable/);
    assert.equal(store.loadGame(roomId)!.phase, 'actions');
    assert.deepEqual(store.loadGame(roomId)!.dice, [3, 3]);
    assert.equal(store.history(roomId).entries.filter((entry) => entry.automatic).length, 1);
    store.close();
    now += 2000;
    store = new Store(path, { now: () => now, random: () => 0.9 });
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.turn, 2);
    assert.deepEqual(
      store
        .history(roomId)
        .entries.filter((entry) => entry.automatic)
        .map((entry) => entry.kind),
      ['endTurn', 'roll'],
    );
    assert.ok(
      store
        .history(roomId)
        .entries.find((entry) => entry.automatic && entry.kind === 'roll')!
        .lines.some((line) => line.includes('3 + 3 = 6')),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timeout finishes an already played Knight or Road Building card without spending cards or playing other development cards', () => {
  for (const kind of ['knight', 'roadBuilding'] as const) {
    let now = 1700000000000;
    const store = new Store(':memory:', { now: () => now, random: () => 0.34 });
    try {
      const { host } = start(store),
        roomId = host.room_id;
      fixture(store, roomId, (game) => {
        activePlayer(game).cards = [
          { id: 'selected', kind, boughtTurn: 0 },
          { id: 'untouched', kind: 'monopoly', boughtTurn: 0 },
        ];
      });
      const seat = activeSeat(store, roomId);
      store.action(seat, 'play-selected-card', store.snapshot(roomId).revision, {
        kind: 'playCard',
        cardId: 'selected',
      });
      const roads = pieces(store.loadGame(roomId)!, seat.id).roads;
      now = store.clock(roomId)!.deadlineAt;
      store.expireRoom(roomId);
      const game = store.loadGame(roomId)!;
      assert.equal(game.turn, 2);
      assert.deepEqual(
        game.players.find((p) => p.id === seat.id)!.cards.map((c) => c.id),
        ['untouched'],
      );
      if (kind === 'roadBuilding') assert.equal(pieces(game, seat.id).roads, roads + 2);
      assert.ok(
        store
          .history(roomId)
          .entries.filter((e) => e.automatic)
          .every((e) => !['buyCard', 'playCard', 'bankTrade', 'offerTrade'].includes(e.kind)),
      );
      conserved(game);
    } finally {
      store.close();
    }
  }
});

test('clock, game, history and receipt roll back together on save failure; retry never applies the first action twice', () => {
  let now = 1700000000000;
  const store = new Store(':memory:', { now: () => now, random: () => 0.34 });
  try {
    const { host } = start(store),
      roomId = host.room_id;
    const game = store.loadGame(roomId),
      clock = store.clock(roomId),
      revision = store.snapshot(roomId).revision;
    now = clock!.deadlineAt;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_timer_receipt BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT,'Timer receipt failure'); END",
    );
    assert.throws(() => store.expireRoom(roomId), /Timer receipt failure/);
    assert.deepEqual(store.loadGame(roomId), game);
    assert.deepEqual(store.clock(roomId), clock);
    assert.equal(store.history(roomId).entries[0]!.revision, revision);
    store.db.exec('DROP TRIGGER fail_timer_receipt');
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.turn, 2);
    assert.equal(store.snapshot(roomId).revision, revision + 2);
    store.expireRoom(roomId);
    assert.equal(store.snapshot(roomId).revision, revision + 2);
  } finally {
    store.close();
  }
});

test('timer-off rooms and setup are untimed; mandatory defaults are unavailable to other players and never mutate input', () => {
  let now = 1700000000000;
  const store = new Store(':memory:', { now: () => now, random: () => 0.34 });
  try {
    const { host } = start(store, null),
      roomId = host.room_id,
      game = store.loadGame(roomId)!;
    now += 86400000;
    assert.equal(store.expireRoom(roomId), false);
    assert.equal(store.clock(roomId), undefined);
    assert.deepEqual(store.dueRooms(), []);
    const before = structuredClone(game);
    assert.equal(
      timeoutAction(game, game.players[(game.active + 1) % 3]!.id, () => 0.34),
      undefined,
    );
    const action = timeoutAction(game, activePlayer(game).id, () => 0.34)!;
    assert.deepEqual(action, { kind: 'roll' });
    const next = applyAction(game, activePlayer(game).id, action, () => 0.34);
    assert.equal(next.phase, 'actions');
    assert.deepEqual(game, before);
  } finally {
    store.close();
  }
});

test('settings protocol and real multiplayer broadcasts carry server timestamps and enforce expiry for disconnected seats', async (t) => {
  const parsed = parseClientMessage(
    JSON.stringify({
      type: 'settings',
      commandId: 'configure-network',
      expectedRevision: 0,
      settings: { turnTimerSeconds: 140 },
    }),
  );
  assert.equal(parsed.type, 'settings');
  assert.throws(() =>
    parseClientMessage(
      JSON.stringify({
        type: 'settings',
        commandId: 'configure-network',
        expectedRevision: 0,
        settings: { turnTimerSeconds: 10 },
      }),
    ),
  );
  let now = 1700000000000;
  const server = await startServer({ port: 0, databasePath: ':memory:', now: () => now });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  for (let i = 0; i < 3; i++) {
    const c = new Connection(server.url, newSession(`Clock ${i}`, clients[0]?.session.roomId));
    clients.push(c);
    c.start();
    await until(() => c.status === 'connected');
  }
  const host = clients[0]!,
    roomId = host.session.roomId!;
  await until(() => host.state!.players.length === 3);
  // Use the public socket protocol through a replacement host tab to cover the new command itself.
  const { WebSocket } = await import('ws');
  const socket = new WebSocket(server.url),
    messages: any[] = [];
  t.after(() => socket.terminate());
  socket.on('message', (data) => messages.push(JSON.parse(String(data))));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(JSON.stringify({ type: 'resume', version: PROTOCOL_VERSION, ...host.session }));
  await until(() => messages.some((m) => m.type === 'welcome'));
  socket.send(
    JSON.stringify({
      type: 'settings',
      commandId: 'configure-network',
      expectedRevision: host.state!.revision,
      settings: { turnTimerSeconds: 40 },
    }),
  );
  await until(() => messages.some((m) => m.type === 'ack' && m.commandId === 'configure-network'));
  await until(() => clients[1]!.state!.settings?.turnTimerSeconds === 40);
  assert.equal(clients[1]!.state!.serverNow, now);
  socket.send(JSON.stringify({ type: 'ping', nonce: 'clock-probe' }));
  await until(() => messages.some((m) => m.type === 'pong' && m.nonce === 'clock-probe'));
  assert.equal(messages.find((m) => m.type === 'pong' && m.nonce === 'clock-probe').serverNow, now);
  const hostSeat = server.store.snapshot(roomId).players[0]!;
  server.store.action(
    { ...hostSeat, room_id: roomId },
    'network-game-start',
    readyLobby(server.store, roomId),
    { kind: 'start' },
  );
  let setup = 0;
  while (!server.store.loadGame(roomId)!.turn) {
    const game = server.store.loadGame(roomId)!,
      seat = activeSeat(server.store, roomId),
      legal = gameView(game, seat.id).legal;
    server.store.action(
      seat,
      `network-setup-${setup++}`,
      server.store.snapshot(roomId).revision,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
    );
  }
  const activeId = activeSeat(server.store, roomId).id;
  for (const c of clients) if (c.playerId === activeId) c.stop();
  if (host.playerId === activeId) socket.close();
  now = server.store.clock(roomId)!.deadlineAt;
  await until(() => server.store.loadGame(roomId)!.turn === 2);
  await until(() => clients.filter((c) => c.status === 'connected').every((c) => c.state!.game?.turn === 2));
  assert.ok(clients.filter((c) => c.status === 'connected').every((c) => c.state!.game!.turn === 2));
  assert.ok(server.store.history(roomId).entries.some((e) => e.automatic));
});
