import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../apps/server/src/server.js';
import type { Store } from '../apps/server/src/store.js';
import type { Identity } from '../apps/server/src/auth.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import type { AdminConfig } from '../apps/server/src/admin/config.js';
import { chiSquarePValue, computeStats, diceSummary, FAIR_DICE } from '../apps/server/src/admin/analysis.js';
import type {
  AdminOverview,
  AdminStats,
  AuditPage,
  Cached,
  GameDetail,
  GamesPage,
  PlayerDetail,
  PlayerSummary,
  PrivateGameState,
  RetentionReport,
} from '../apps/server/src/admin/types.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { HistoryEntry } from '../packages/protocol/src/index.js';
import { emptyHand, gameView, robberVictims } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { readyLobby } from './helpers.js';
import { API, raw } from './admin-fixture.js';

const ORIGIN = 'http://127.0.0.1:3100';
const MUTATION = { ...API, Origin: ORIGIN, 'Content-Type': 'application/json' };

async function until(check: () => boolean, what = 'condition') {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The simplest legal move for whoever owes one. */
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

function play(store: Store, roomId: string, moves: number) {
  for (let i = 0; i < moves; i++) {
    const game = store.loadGame(roomId)!;
    if (game.phase === 'finished') return;
    const next = choose(game);
    const seat = store.snapshot(roomId).players.find((p) => p.id === next.player)!;
    store.action(
      { id: seat.id, name: seat.name, room_id: roomId },
      `admin-test-${i}`,
      store.snapshot(roomId).revision,
      next.action,
    );
  }
}

const account = (name: string, n: number): Identity => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  expiresAt: Date.now() + 3_600_000,
  isGuest: n === 3,
  profile: { ...defaultProfile(name), username: name },
});

/**
 * Four rooms on a real server with a file database: a lobby, a live game whose
 * two players are connected over WebSockets beside a bot, a paused game played
 * by three accounts, and later a finished one.
 */
async function seeded(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-admin-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'game.sqlite');
  const server = await startServer({ port: 0, databasePath, auth: null, captcha: null });
  const { store } = server;
  const clients: Connection[] = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    await server.close();
  });

  // A lobby.
  const lobbyHost = store.enter('create', newSession('Lobbyist').token, 'Lobbyist');
  store.enter('join', newSession('Waiter').token, 'Waiter', lobbyHost.room_id);

  // A paused game with three accounts and a few dozen moves, played while they were present.
  const [alice, bob, cara] = [account('Alice', 1), account('Bob', 2), account('Cara', 3)];
  const pausedHost = store.enter('create', newSession('a').token, 'a', undefined, alice);
  const pausedSeats = [
    pausedHost,
    store.enter('join', newSession('b').token, 'b', pausedHost.room_id, bob),
    store.enter('join', newSession('c').token, 'c', pausedHost.room_id, cara),
  ];
  for (const seat of pausedSeats) store.setConnected(seat, true);
  // Natural dice here; the other rooms keep the balanced default.
  store.configureSettings(pausedHost, 'classic-dice', store.snapshot(pausedHost.room_id).revision, {
    turnTimerSeconds: null,
    diceMode: 'classic',
  });
  store.action(pausedHost, 'start-paused', readyLobby(store, pausedHost.room_id), { kind: 'start' });
  play(store, pausedHost.room_id, 90);
  for (const seat of pausedSeats) store.setConnected(seat, false);

  // A live game: two local players connected over WebSockets, and a bot.
  const hostSession = newSession('Hostess');
  const guestSession = newSession('Guest');
  const liveHost = store.enter('create', hostSession.token, hostSession.name);
  const liveGuest = store.enter('join', guestSession.token, guestSession.name, liveHost.room_id);
  store.lobby(
    liveHost,
    'add-bot',
    store.snapshot(liveHost.room_id).revision,
    false,
    undefined,
    undefined,
    true,
  );
  for (const [session, seat] of [
    [hostSession, liveHost],
    [guestSession, liveGuest],
  ] as const) {
    session.roomId = seat.room_id;
    session.joined = true;
    const client = new Connection(server.url, { ...session });
    clients.push(client);
    client.start();
  }
  await until(() => clients.every((client) => client.status === 'connected'), 'clients');
  store.action(liveHost, 'start-live', readyLobby(store, liveHost.room_id), { kind: 'start' });
  server.runtime.broadcast(liveHost.room_id);
  await until(() => clients.every((client) => !!client.state?.game), 'the live game');

  const statusDir = join(dir, 'status');
  await mkdir(statusDir);
  const config: AdminConfig = {
    port: 0,
    host: '127.0.0.1',
    auth: { mode: 'local-dev' },
    origin: ORIGIN,
    statusDir,
    revision: 'deadbeef',
  };
  const admin = await startAdminServer({
    config,
    store,
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
  return {
    server,
    store,
    admin,
    get,
    post,
    clients,
    statusDir,
    lobby: lobbyHost.room_id,
    paused: pausedHost.room_id,
    live: liveHost.room_id,
    accounts: { alice, bob, cara },
  };
}

test('overview reports the process, sockets, rooms, database, status files and recent errors', async (t) => {
  const { get, store, statusDir, clients } = await seeded(t);
  console.error('Admin overview test: simulated failure', new Error('simulated storage fault'));
  // A move the database fails to save is answered as a storage error and kept for the console.
  const action = store.action.bind(store);
  store.action = () => {
    throw Object.assign(new Error('simulated SQLITE_FULL'), { code: 'ERR_SQLITE_ERROR' });
  };
  await assert.rejects(clients[0]!.action({ kind: 'roll' }), /Could not save the action/);
  store.action = action;
  let overview = await get<AdminOverview>('/api/admin/overview');
  assert.ok(
    overview.errors.some(
      (entry) => entry.source === 'websocket' && /simulated SQLITE_FULL/.test(entry.message),
    ),
  );
  assert.equal(overview.revision, 'deadbeef');
  assert.equal(overview.process.node, process.version);
  assert.ok(overview.process.memory.rss > 0 && overview.process.uptimeSeconds >= 0);
  assert.ok(overview.load.window.eventLoop.maxMs >= 0 && overview.load.cores >= 1);
  assert.deepEqual(overview.sockets, { total: 2, players: 2, spectators: 0, pending: 0 });
  assert.deepEqual(overview.players, { connectedSeats: 2, distinctPlayers: 2 });
  // Counted by the room index's worker on its own read-only connection.
  assert.ok(!('error' in overview.rooms), 'room counts are available');
  const { countedAt, ...rooms } = overview.rooms;
  assert.deepEqual(rooms, { lobbies: 1, live: 1, paused: 1, finished: 0, empty: 0, total: 3 });
  assert.ok(countedAt <= overview.now);
  assert.equal(overview.bots.seatsInLiveGames, 1);
  assert.equal(overview.bots.standIns, 0);
  assert.equal(
    overview.database.journalRows,
    store.db.prepare('SELECT count(*) AS n FROM game_events').get()!.n,
  );
  assert.ok(overview.database.pageCount > 0 && overview.database.pageSize >= 512);
  assert.ok((overview.database.fileBytes ?? 0) > 0);
  assert.ok('freeBytes' in overview.disk && overview.disk.freeBytes > 0);
  assert.deepEqual(overview.status.backup, { state: 'missing' });
  assert.deepEqual(overview.status.watchdog, { state: 'missing' });
  assert.deepEqual(overview.status.drill, { state: 'missing' });
  const logged = overview.errors.find((entry) =>
    entry.message.includes('Admin overview test: simulated failure'),
  );
  assert.ok(logged, 'console errors reach the ring buffer');
  assert.match(logged.message, /simulated storage fault/);
  // The host's scripts report in (the shape backup.py and restore_drill.py write);
  // a broken report is shown as broken, not hidden.
  const backup = {
    schema: 1,
    kind: 'backup',
    timestamp: '2026-09-23T08:00:00Z',
    result: 'success',
    reason: 'uploaded',
    durationSeconds: 3.2,
  };
  await writeFile(join(statusDir, 'backup.json'), JSON.stringify(backup));
  await writeFile(join(statusDir, 'watchdog.json'), '{not json');
  await writeFile(
    join(statusDir, 'drill.json'),
    JSON.stringify({ ...backup, kind: 'drill', result: 'failure', reason: 'game verifier failed' }),
  );
  overview = await get<AdminOverview>('/api/admin/overview');
  assert.equal(overview.status.backup.state, 'ok');
  assert.deepEqual(overview.status.backup.state === 'ok' && overview.status.backup.data, backup);
  assert.equal(overview.status.watchdog.state, 'invalid');
  assert.equal(overview.status.drill.state === 'ok' && overview.status.drill.data.result, 'failure');
});

test('games are listed by status and searchable, and a game’s detail shows its public and seat state', async (t) => {
  const { get, store, lobby, paused, live, accounts } = await seeded(t);
  const all = await get<GamesPage>('/api/admin/games');
  assert.equal(all.total, 3);
  assert.deepEqual(all.counts, { lobby: 1, live: 1, paused: 1, finished: 0, empty: 0 });
  const liveList = await get<GamesPage>('/api/admin/games?status=live');
  assert.deepEqual(
    liveList.items.map((item) => item.roomId),
    [live],
  );
  const item = liveList.items[0]!;
  assert.equal(item.roomCode, store.roomCode(live));
  assert.equal(item.status, 'live');
  assert.ok(item.phase && item.revision > 0 && item.createdAt && item.lastActivity);
  assert.equal(item.players.length, 3);
  assert.equal(item.players.filter((player) => player.bot).length, 1);
  assert.ok(
    item.players.every((player) => player.connected),
    'both people are connected, and bots always are',
  );
  assert.deepEqual(
    (await get<GamesPage>('/api/admin/games?status=lobby')).items.map((room) => room.roomId),
    [lobby],
  );
  const pausedItem = (await get<GamesPage>('/api/admin/games?status=paused')).items[0]!;
  assert.equal(pausedItem.roomId, paused);
  assert.ok(pausedItem.players.every((player) => !player.connected && player.userId));
  // Search by room code, by player name, by a fragment, and for nobody.
  for (const q of [
    store.roomCode(paused)!,
    store.roomCode(paused)!.toLowerCase(),
    'Cara',
    'car',
    paused.slice(0, 8),
  ])
    assert.deepEqual(
      (await get<GamesPage>(`/api/admin/games?q=${encodeURIComponent(q)}`)).items.map((room) => room.roomId),
      [paused],
      q,
    );
  assert.equal((await get<GamesPage>('/api/admin/games?q=nobody-here')).total, 0);
  assert.equal((await get<GamesPage>('/api/admin/games?q=%25')).total, 0, 'LIKE wildcards are literal');
  await get('/api/admin/games?status=everything', 400);
  await get('/api/admin/games?page=0', 400);

  const detail = await get<GameDetail>(`/api/admin/games/${store.roomCode(paused)}`);
  assert.equal(detail.roomId, paused);
  assert.equal(detail.status, 'paused');
  assert.equal(detail.presence.paused, true);
  assert.equal(detail.presence.absent.length, 3);
  assert.equal(detail.canEnd, true);
  assert.equal(detail.confirmation, store.roomCode(paused));
  assert.equal(detail.integrityError, null);
  assert.deepEqual(
    detail.seats.map((seat) => seat.userId).sort(),
    [accounts.alice.id, accounts.bob.id, accounts.cara.id].sort(),
  );
  assert.deepEqual(detail.seats.map((seat) => seat.accountType).sort(), ['guest', 'permanent', 'permanent']);
  // The snapshot is what a spectator sees: counts, never hands or the deck.
  const view = detail.snapshot!.game!;
  assert.ok(view.players.every((player) => player.hand === undefined && player.cards === undefined));
  assert.ok(!('deck' in view) && view.deckCount > 0);
  assert.ok(detail.history.entries.length > 0);
  assert.equal(detail.statistics!.rolls, store.statistics(paused).rolls);
  const older = await get<{ entries: HistoryEntry[] }>(
    `/api/admin/games/${paused}/history?before=${detail.history.entries.at(-1)!.revision}`,
  );
  assert.ok(older.entries.every((entry) => entry.revision < detail.history.entries.at(-1)!.revision));
  await get('/api/admin/games/ZZZZ', 404);
  await get('/api/admin/games/not-a-room', 404);
});

test('the list and the detail agree on a table that has just emptied, and word its deadlines as the game applies them', async (t) => {
  const { get, server, clients, live, paused } = await seeded(t);
  const before = await get<GamesPage>('/api/admin/games');
  assert.deepEqual(before.counts, { lobby: 1, live: 1, paused: 1, finished: 0, empty: 0 });
  // Both people at the live table leave; the room index's pass from a moment ago still says live.
  for (const client of clients) client.stop();
  await until(() => server.runtime.sockets().total === 0, 'the sockets to close');
  const after = await get<GamesPage>('/api/admin/games');
  assert.equal(after.indexedAt, before.indexedAt, 'the same pass answered');
  assert.equal(after.items.find((item) => item.roomId === live)!.status, 'paused');
  assert.deepEqual(after.counts, { lobby: 1, live: 0, paused: 2, finished: 0, empty: 0 });
  const detail = await get<GameDetail>(`/api/admin/games/${live}`);
  assert.equal(detail.status, 'paused');
  assert.equal(detail.presence.paused, true);
  assert.ok(detail.presence.pausedAt! <= Date.now());
  // A paused table's seats are given up at resignAt; a bot would have taken them 30 s after they left.
  const pausedDetail = await get<GameDetail>(`/api/admin/games/${paused}`);
  for (const absent of pausedDetail.presence.absent) {
    assert.equal(absent.standInAt, absent.disconnectedAt + 30_000);
    assert.ok(absent.resignAt >= pausedDetail.presence.pausedAt!);
  }
});

test('a room that played again dates its game from this round, not the first', async (t) => {
  const { get, store } = await seeded(t);
  const host = store.enter('create', newSession('Rae').token, 'Rae');
  const guest = store.enter('join', newSession('Sol').token, 'Sol', host.room_id);
  store.action(host, 'first-start', readyLobby(store, host.room_id), { kind: 'start' });
  // Rae is at the table, so Sol leaving hands her the game.
  store.setConnected(host, true);
  store.leave(guest, 'sol-leaves', store.snapshot(host.room_id).revision);
  assert.equal(store.loadGame(host.room_id)!.phase, 'finished');
  store.action(host, 'back-to-lobby', store.snapshot(host.room_id).revision, { kind: 'returnToLobby' });
  assert.equal((await get<GameDetail>(`/api/admin/games/${host.room_id}`)).createdAt, null, 'not started');
  await new Promise((resolve) => setTimeout(resolve, 20));
  store.lobby(host, 'add-bot-2', store.snapshot(host.room_id).revision, false, undefined, undefined, true);
  store.action(host, 'second-start', store.snapshot(host.room_id).revision, { kind: 'start' });
  const second = store.db
    .prepare(
      "SELECT json_extract(public_entry, '$.at') AS at FROM game_events WHERE room_id = ? AND json_extract(public_entry, '$.kind') = 'start' ORDER BY revision DESC LIMIT 1",
    )
    .get(host.room_id)!.at as string;
  const detail = await get<GameDetail>(`/api/admin/games/${host.room_id}`);
  assert.equal(detail.createdAt, Date.parse(second));
  assert.equal(detail.rounds.length, 1);
  assert.ok(detail.rounds[0]!.startedAt! < detail.createdAt!);
  const listed = (await get<GamesPage>(`/api/admin/games?q=${store.roomCode(host.room_id)}`)).items[0]!;
  assert.equal(listed.createdAt, detail.createdAt);
});

test('a seat’s colour is the one the table sees, picked or given, whatever order the game plays in', async (t) => {
  const { get, store, lobby, paused, accounts } = await seeded(t);
  // Nobody at the paused table picked a colour: they are dealt in the order they sat down,
  // not the shuffled order the game plays them in.
  const detail = await get<GameDetail>(`/api/admin/games/${paused}`);
  const byAccount = (id: string) => detail.seats.find((seat) => seat.userId === id)!;
  assert.deepEqual(
    [accounts.alice.id, accounts.bob.id, accounts.cara.id].map((id) => byAccount(id).color),
    ['coral', 'sky', 'violet'],
  );
  assert.ok(detail.seats.every((seat) => !seat.colorChosen));
  // In the lobby the second seat picks coral, so the first is given the next free default.
  const [host, waiter] = store.snapshot(lobby).players;
  store.lobby(
    { id: waiter!.id, name: waiter!.name, room_id: lobby },
    'pick-coral',
    store.snapshot(lobby).revision,
    false,
    undefined,
    undefined,
    undefined,
    'coral',
  );
  const seats = (await get<GameDetail>(`/api/admin/games/${lobby}`)).seats;
  assert.deepEqual(
    seats.map((seat) => [seat.id, seat.color, seat.colorChosen]),
    [
      [host!.id, 'sky', false],
      [waiter!.id, 'coral', true],
    ],
  );
});

test('viewing a game’s private state is written to the audit log first', async (t) => {
  const { get, store, paused } = await seeded(t);
  const before = store.db.prepare('SELECT count(*) AS n FROM admin_audit').get()!.n as number;
  const state = await get<PrivateGameState>(`/api/admin/games/${paused}/private`);
  const game = state.game as Game;
  assert.ok(game.players.every((player) => player.hand && Array.isArray(player.cards)));
  assert.ok(Array.isArray(game.deck));
  const audit = await get<AuditPage>('/api/admin/audit');
  assert.equal(audit.entries.length, before + 1);
  assert.equal(audit.entries[0]!.action, 'game.view_private');
  assert.equal(audit.entries[0]!.target, paused);
  assert.equal(audit.entries[0]!.actor, 'local-dev');
  assert.equal(audit.entries[0]!.detail.revision, state.revision);
  await get(`/api/admin/games/${store.roomCode(paused)}/private?x=1`);
  assert.equal((await get<AuditPage>(`/api/admin/audit?target=${paused}`)).entries.length, 2);
});

test('ending a game finishes it as abandoned, journals and audits it, and pushes it to connected players', async (t) => {
  const { get, post, store, clients, live, lobby } = await seeded(t);
  const code = store.roomCode(live)!;
  const board = store.loadGame(live)!.board;
  // The server checks the confirmation itself, whatever the page did. (The bot at this
  // table may take a setup turn meanwhile, so nothing here pins a revision number.)
  for (const confirm of ['', 'WRONG', live.slice(0, 8)])
    await post(`/api/admin/games/${code}/end`, { confirm }, 400);
  await post(`/api/admin/games/${code}/end`, { confirm: code, extra: true }, 400);
  await post(`/api/admin/games/${code}/end`, {}, 400);
  assert.notEqual(store.loadGame(live)!.phase, 'finished', 'refusals change nothing');
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM admin_audit WHERE action='game.end'").get()!.n, 0);

  const result = await post<{ revision: number }>(`/api/admin/games/${code}/end`, {
    confirm: code.toLowerCase(),
  });
  assert.equal(result.revision, store.snapshot(live).revision, 'the end is the room’s latest revision');
  const ended = store.loadGame(live)!;
  assert.equal(ended.phase, 'finished');
  assert.equal(ended.finishReason, 'abandoned');
  assert.equal(ended.winner, null);
  assert.ok(ended.players.every((player) => player.resigned));
  assert.deepEqual(ended.board, board, 'the island stays as it was');
  // Journaled like any other lifecycle event.
  const row = store.db
    .prepare(
      "SELECT command_id, actor, actor_kind, phase, json_extract(public_entry, '$.kind') AS kind, public_entry FROM game_events WHERE room_id = ? ORDER BY revision DESC LIMIT 1",
    )
    .get(live)!;
  assert.match(row.command_id as string, /^admin-end-[0-9a-f-]{36}$/);
  assert.equal(row.actor, null);
  assert.equal(row.actor_kind, 'system');
  assert.equal(row.phase, 'finished');
  assert.equal(row.kind, 'abandoned');
  assert.deepEqual((JSON.parse(row.public_entry as string) as HistoryEntry).lines, [
    'Catanova closed this game. There is no winner.',
  ]);
  assert.deepEqual(store.journalState(live, result.revision), ended);
  assert.ok(
    store.db.prepare('SELECT finished_at FROM match_records WHERE room_id = ?').get(live)!.finished_at,
  );
  // Audited in the same transaction, with the request that did it.
  const audit = store.db.prepare("SELECT * FROM admin_audit WHERE action = 'game.end'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.target, live);
  assert.equal(audit[0]!.actor, 'local-dev');
  assert.equal(`admin-end-${audit[0]!.request_id}`, row.command_id);
  assert.equal(JSON.parse(audit[0]!.detail as string).revision, result.revision);
  // Both connected players are sent the finished game.
  await until(() => clients.every((client) => client.state?.game?.phase === 'finished'), 'the finished game');
  assert.ok(clients.every((client) => client.state!.game!.finishReason === 'abandoned'));
  // The room is now listed as finished and cannot be ended twice; a lobby has nothing to end.
  assert.equal((await get<GamesPage>('/api/admin/games?status=finished')).items[0]!.roomId, live);
  assert.equal((await get<GameDetail>(`/api/admin/games/${live}`)).canEnd, false);
  await post(`/api/admin/games/${live}/end`, { confirm: code }, 409);
  await post(`/api/admin/games/${lobby}/end`, { confirm: store.roomCode(lobby) }, 409);
  // As after any abandoned game, every seat has resigned: players leave, and the room stays closed.
  await assert.rejects(clients[0]!.action({ kind: 'returnToLobby' }), /left this game/);
  await clients[1]!.leave();
  assert.equal(
    store.db.prepare('SELECT departed FROM seats WHERE room_id = ? AND bot = 0 AND departed = 1').all(live)
      .length,
    1,
  );
});

test('players can be found by name or id, with their record and current game', async (t) => {
  const { get, accounts, paused } = await seeded(t);
  const found = await get<{ players: PlayerSummary[] }>('/api/admin/players?q=ali');
  assert.deepEqual(
    found.players.map((player) => player.userId),
    [accounts.alice.id],
  );
  assert.equal(found.players[0]!.name, 'Alice');
  assert.equal(found.players[0]!.currentRoom?.roomId, paused);
  assert.deepEqual(
    (await get<{ players: PlayerSummary[] }>(`/api/admin/players?q=${accounts.cara.id}`)).players.map(
      (player) => player.userId,
    ),
    [accounts.cara.id],
  );
  // An id prefix matches every account that shares it.
  assert.equal(
    (await get<{ players: PlayerSummary[] }>('/api/admin/players?q=00000000-0000')).players.length,
    3,
  );
  await get('/api/admin/players?q=a', 400);
  assert.equal((await get<{ players: PlayerSummary[] }>('/api/admin/players?q=%25%25')).players.length, 0);
  const detail = await get<PlayerDetail>(`/api/admin/players/${accounts.cara.id}`);
  assert.deepEqual(detail.names, ['Cara']);
  assert.equal(detail.accountType, 'guest');
  assert.equal(detail.record.matches, 1);
  assert.equal(detail.record.playing, 1);
  assert.equal(detail.matches[0]!.roomId, paused);
  assert.equal(detail.matches[0]!.players.length, 3);
  assert.equal(detail.seats[0]!.roomId, paused);
  await get('/api/admin/players/00000000-0000-4000-8000-000000000099', 404);
});

test('statistics come from a worker on a read-only connection, and match the journal', async (t) => {
  const { get, store, paused } = await seeded(t);
  const cached = await get<Cached<AdminStats>>('/api/admin/stats');
  const stats = cached.value;
  assert.equal(cached.fresh, true);
  assert.equal(stats.days.length, 30);
  assert.equal(stats.weeks.length, 8);
  const today = stats.days.at(-1)!;
  assert.equal(today.day, new Date().toISOString().slice(0, 10));
  assert.equal(today.started, 2, 'the paused and the live match started today');
  assert.equal(today.players, 3, 'three accounts played; local seats are not accounts');
  assert.equal(stats.totals.matches, 2);
  assert.equal(stats.totals.running, 2);
  assert.equal(stats.totals.accounts, 3);
  assert.deepEqual(stats.bots, { matches: 2, matchesWithBots: 1, seats: 6, botSeats: 1 });
  const rolls = store.db
    .prepare("SELECT count(*) AS n FROM game_events WHERE json_extract(public_entry, '$.kind') = 'roll'")
    .get()!.n as number;
  assert.ok(rolls > 5, 'the scripted game rolled');
  assert.equal(stats.dice.overall.rolls, rolls);
  // Split by each room's dice setting: every roll so far was in the natural-dice room.
  assert.equal(stats.dice.byMode.classic!.rolls, rolls);
  assert.equal(stats.dice.byMode.balanced, undefined, 'modes without rolls are left out');
  assert.deepEqual(stats.dice.overall.counts, store.statistics(paused).diceCounts);
  assert.equal(stats.dice.overall.expected.length, 11);
  assert.ok(stats.dice.overall.pValue! >= 0 && stats.dice.overall.pValue! <= 1);
  // The same numbers as computing on the game's own connection.
  assert.deepEqual(computeStats(store.db, stats.generatedAt), stats);
  // Cached until refreshed.
  assert.equal((await get<Cached<AdminStats>>('/api/admin/stats')).fresh, false);
});

test('the retention report runs on demand in the worker and is cached for ten minutes', async (t) => {
  const { get, post, store } = await seeded(t);
  assert.deepEqual(await get('/api/admin/reports/retention?days=30'), { days: 30, report: null });
  await get('/api/admin/reports/retention?days=5', 400);
  await post('/api/admin/reports/retention', { days: 5 }, 400);
  await post('/api/admin/reports/retention', { days: 30, extra: 1 }, 400);
  const generated = await post<{ report: Cached<RetentionReport> }>('/api/admin/reports/retention', {
    days: 30,
  });
  assert.equal(generated.report.fresh, true);
  const report = generated.report.value;
  assert.equal(report.days, 30);
  const started = report.metrics.find(
    (metric) => metric.section === 'Matches · all' && metric.metric === 'Started',
  );
  assert.equal(started?.value, 2);
  assert.match(report.csv, /^"section","metric","value","denominator","unit"\n/);
  const again = await post<{ report: Cached<RetentionReport> }>('/api/admin/reports/retention', { days: 30 });
  assert.equal(again.report.fresh, false);
  assert.equal(again.report.cachedAt, generated.report.cachedAt);
  assert.equal(
    (await get<{ report: Cached<RetentionReport> }>('/api/admin/reports/retention?days=30')).report.fresh,
    false,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM admin_audit WHERE action = 'report.retention'").get()!.n,
    2,
  );
});

test('dice statistics compare fairly with two fair dice', () => {
  assert.equal(Math.round(FAIR_DICE.reduce((sum, p) => sum + p, 0) * 1e9) / 1e9, 1);
  assert.ok(Math.abs(chiSquarePValue(18.307, 10) - 0.05) < 0.0005);
  assert.ok(Math.abs(chiSquarePValue(10, 10) - 0.4405) < 0.0005);
  assert.ok(Math.abs(chiSquarePValue(3.94, 10) - 0.95) < 0.0005);
  assert.equal(chiSquarePValue(0, 10), 1);
  const exact = diceSummary(FAIR_DICE.map((p) => p * 3600));
  assert.equal(exact.chiSquare, 0);
  assert.equal(exact.pValue, 1);
  const loaded = diceSummary([0, 0, 0, 0, 0, 3600, 0, 0, 0, 0, 0]);
  assert.ok(loaded.pValue! < 1e-6);
  assert.deepEqual(diceSummary(Array(11).fill(0)), {
    rolls: 0,
    counts: Array(11).fill(0),
    expected: Array(11).fill(0),
    chiSquare: null,
    pValue: null,
  });
});
