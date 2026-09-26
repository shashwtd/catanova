import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { modesFor, readModeSwitches } from '../apps/server/src/modes.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { RoomInviteService } from '../apps/server/src/room-invites.js';
import { GameLaunch } from '../apps/server/src/game-launch.js';
import { newSession } from '../apps/client/src/connection.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Account } from '../packages/protocol/src/profile.js';
import { parseRoomSettings } from '../packages/protocol/src/settings.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import { generateBoard } from '../packages/rules/src/board.js';
import { TEST_TABLE, useTestTable } from './test-ruleset.js';

useTestTable();
const TEST = TEST_TABLE.id;
const OPEN: ModeSwitches = { open: [CLASSIC.id, TEST], testers: new Set() };
const identity = (id: string) => ({ id, name: 'Account', expiresAt: Date.now() + 3_600_000 });
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

let readiness = 0;
/** Everyone in the lobby presses Ready, with command ids of their own; returns the revision to start at. */
function ready(store: Store, roomId: string) {
  readiness++;
  for (const p of store.snapshot(roomId).players)
    if (!p.ready)
      store.lobby(
        { ...p, room_id: roomId },
        `ready-${readiness}-${p.id}`,
        store.snapshot(roomId).revision,
        true,
      );
  return store.snapshot(roomId).revision;
}
/** A lobby of `count` people, the first of them its host, signed in as `host` when given. */
function lobby(store: Store, count: number, host?: string) {
  const sessions = Array.from({ length: count }, (_, i) => newSession(`Player ${i + 1}`));
  const first = store.enter(
    'create',
    sessions[0]!.token,
    sessions[0]!.name,
    undefined,
    host ? identity(host) : undefined,
  );
  const seats: Seat[] = [
    first,
    ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, first.room_id)),
  ];
  const revision = () => store.snapshot(first.room_id).revision;
  return { host: first, seats, roomId: first.room_id, revision };
}

test('the switches: Classic always, open modes for every host, every mode for testers, unknown ids logged', () => {
  const logged: Record<string, unknown>[] = [];
  const log = (event: Record<string, unknown>) => logged.push(event);
  assert.deepEqual(readModeSwitches({}, log), { open: [CLASSIC.id], testers: new Set() });
  const switches = readModeSwitches(
    {
      CATANOVA_MODES: ' test-table-v1, big-table-v2,test-table-v1 ,',
      CATANOVA_MODE_TESTERS: 'acct-1, acct-2',
    },
    log,
  );
  assert.deepEqual(switches.open, [CLASSIC.id, TEST]);
  assert.deepEqual([...switches.testers], ['acct-1', 'acct-2']);
  // A mode this build does not contain is left out and logged; the server still starts.
  assert.deepEqual(logged, [{ event: 'mode_unavailable', variable: 'CATANOVA_MODES', mode: 'big-table-v2' }]);
  const testers = readModeSwitches({ CATANOVA_MODE_TESTERS: 'acct-1' }, log);
  // Testers may pick every mode the build contains: Big Table ships in it, and this file registers the test mode.
  assert.deepEqual(modesFor(testers, 'acct-1'), [CLASSIC.id, BIG_TABLE.id, TEST]);
  assert.deepEqual(modesFor(testers, 'acct-9'), [CLASSIC.id]);
  // Local playtest mode has no accounts, so CATANOVA_MODES alone decides.
  assert.deepEqual(modesFor(testers, undefined), [CLASSIC.id]);
  assert.deepEqual(modesFor(switches, undefined), [CLASSIC.id, TEST]);
});

test('room settings carry the mode, and a target is checked against its own mode', () => {
  assert.deepEqual(parseRoomSettings({ turnTimerSeconds: 90, mode: TEST, victoryPoints: 13 }), {
    victoryPoints: 13,
    turnTimerSeconds: 90,
    mode: TEST,
  });
  assert.throws(() => parseRoomSettings({ turnTimerSeconds: 90, mode: TEST, victoryPoints: 8 }), /9 to 13/);
  for (const mode of ['Big Table', 7, '', null])
    assert.throws(() => parseRoomSettings({ turnTimerSeconds: 90, mode }), /Choose a game mode/);
  // A saved room in a mode this version does not know still reads back, target and all.
  assert.deepEqual(parseRoomSettings({ turnTimerSeconds: null, mode: 'open-sea-v1', victoryPoints: 18 }), {
    victoryPoints: 18,
    turnTimerSeconds: null,
    mode: 'open-sea-v1',
  });
  // Without a mode, Classic's range, as before.
  assert.throws(() => parseRoomSettings({ turnTimerSeconds: null, victoryPoints: 16 }), /8 to 15/);
});

test('picking a mode resets the target to its default and deals its island; an older tab keeps the mode', () => {
  const store = new Store(':memory:', { modes: OPEN });
  try {
    const { host, seats, roomId, revision } = lobby(store, 3);
    // A Classic room's settings are exactly what they were before modes.
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 90, diceMode: 'balanced' });
    store.configureSettings(host, 'classic-12', revision(), {
      turnTimerSeconds: 90,
      diceMode: 'balanced',
      victoryPoints: 12,
    });
    const classicBoard = store.board(roomId);
    ready(store, roomId);
    store.configureSettings(host, 'to-test', revision(), {
      turnTimerSeconds: 90,
      diceMode: 'balanced',
      victoryPoints: 12,
      mode: TEST,
    });
    // The target is the new mode's own default, 11, which is what an absent target means.
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 90, diceMode: 'balanced', mode: TEST });
    assert.ok(
      store.snapshot(roomId).players.every((p) => !p.ready),
      'a new mode is a change to confirm',
    );
    const testBoard = store.board(roomId);
    assert.notDeepEqual(testBoard, classicBoard, 'a new mode deals a new island');
    assert.equal(testBoard.preset, TEST_TABLE.board);
    // A tab from before modes saves the timer with no mode: the room keeps its mode and its island.
    store.configureSettings(host, 'old-tab', revision(), { turnTimerSeconds: 40 });
    assert.equal(store.settings(roomId).mode, TEST);
    assert.deepEqual(store.board(roomId), testBoard);
    // In the test mode the target runs from 9 to 13, however the change arrives.
    store.configureSettings(host, 'target-13', revision(), {
      turnTimerSeconds: 40,
      mode: TEST,
      victoryPoints: 13,
    });
    assert.equal(store.settings(roomId).victoryPoints, 13);
    assert.throws(
      () =>
        store.configureSettings(host, 'old-target', revision(), { turnTimerSeconds: 40, victoryPoints: 14 }),
      (error: Error) => code('INVALID_SETTINGS')(error) && /9 to 13/.test(error.message),
    );
    assert.throws(
      () =>
        store.configureSettings(seats[1]!, 'not-host', revision(), {
          turnTimerSeconds: 40,
          mode: CLASSIC.id,
        }),
      /Only the host/,
    );
    // Back to Classic takes saying so, and resets the target again.
    store.configureSettings(host, 'back', revision(), {
      turnTimerSeconds: 40,
      mode: CLASSIC.id,
      victoryPoints: 13,
    });
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 40 });
    assert.equal(store.board(roomId).preset, CLASSIC.board);
    assert.notDeepEqual(store.board(roomId), testBoard);
  } finally {
    store.close();
  }
});

test('a mode change is refused while the mode is closed to the host, the table is too big, or bots sit at it', () => {
  const store = new Store(':memory:', { modes: { open: [CLASSIC.id], testers: new Set(['tester']) } });
  try {
    const plain = lobby(store, 2, 'someone');
    assert.throws(
      () =>
        store.configureSettings(plain.host, 'closed', plain.revision(), { turnTimerSeconds: 90, mode: TEST }),
      code('MODE_UNAVAILABLE'),
    );
    assert.equal(store.snapshot(plain.roomId, plain.host.id).modes, undefined, 'Classic alone goes unsaid');
    // A tester's room may pick every mode the build contains, and only its host is told.
    const tester = lobby(store, 2, 'tester');
    assert.deepEqual(store.snapshot(tester.roomId, tester.host.id).modes, [CLASSIC.id, BIG_TABLE.id, TEST]);
    assert.equal(store.snapshot(tester.roomId, tester.seats[1]!.id).modes, undefined);
    assert.equal(store.snapshot(tester.roomId).modes, undefined);
    assert.throws(
      () =>
        store.configureSettings(tester.host, 'unknown', tester.revision(), {
          turnTimerSeconds: 90,
          mode: 'big-table-v2',
        }),
      code('MODE_UNAVAILABLE'),
    );
    // Too few players never blocks a switch: two may pick a mode for three to five, and wait.
    store.configureSettings(tester.host, 'two-pick-test', tester.revision(), {
      turnTimerSeconds: 90,
      mode: TEST,
    });
    assert.equal(store.settings(tester.roomId).mode, TEST);
    // Five may sit at the test mode's table; Classic seats four, so it is refused until someone leaves.
    for (const name of ['Third', 'Fourth', 'Fifth']) {
      const session = newSession(name);
      store.enter('join', session.token, session.name, tester.roomId);
    }
    assert.throws(
      () =>
        store.configureSettings(tester.host, 'five-to-classic', tester.revision(), {
          turnTimerSeconds: 90,
          mode: CLASSIC.id,
        }),
      (error: Error) => code('MODE_SEATS')(error) && /Classic seats up to four players/.test(error.message),
    );
    // Bots play Classic only: a Classic table with a bot cannot switch, and no bot sits down in the test mode.
    const botStore = new Store(':memory:', { modes: OPEN });
    try {
      const classic = lobby(botStore, 2);
      botStore.lobby(classic.host, 'add-bot', classic.revision(), false, undefined, undefined, true);
      assert.throws(
        () =>
          botStore.configureSettings(classic.host, 'bots-to-test', classic.revision(), {
            turnTimerSeconds: 90,
            mode: TEST,
          }),
        (error: Error) => code('MODE_BOTS')(error) && /Bots play Classic only/.test(error.message),
      );
      const test = lobby(botStore, 2);
      botStore.configureSettings(test.host, 'to-test', test.revision(), { turnTimerSeconds: 90, mode: TEST });
      assert.throws(
        () => botStore.lobby(test.host, 'no-bots', test.revision(), false, undefined, undefined, true),
        (error: Error) => code('MODE_BOTS')(error) && /Bots play Classic only/.test(error.message),
      );
    } finally {
      botStore.close();
    }
  } finally {
    store.close();
  }
});

test('the seat caps read the mode: joining, bots, invitations and the loading screen', async () => {
  const store = new Store(':memory:', { modes: OPEN });
  try {
    const classic = lobby(store, 4);
    const fifth = newSession('Fifth');
    assert.throws(
      () => store.enter('join', fifth.token, fifth.name, classic.roomId),
      (error: Error) => code('ROOM_FULL')(error) && /four seats/.test(error.message),
    );
    assert.throws(
      () => store.lobby(classic.host, 'fifth-bot', classic.revision(), false, undefined, undefined, true),
      /already has four seats/,
    );
    const test = lobby(store, 2);
    store.configureSettings(test.host, 'to-test', test.revision(), { turnTimerSeconds: 90, mode: TEST });
    for (const name of ['Third', 'Fourth', 'Fifth']) {
      const session = newSession(name);
      store.enter('join', session.token, session.name, test.roomId);
    }
    assert.equal(store.snapshot(test.roomId).players.length, 5);
    assert.equal(store.seatLimit(test.roomId), 5);
    const sixth = newSession('Sixth');
    assert.throws(
      () => store.enter('join', sixth.token, sixth.name, test.roomId),
      (error: Error) => code('ROOM_FULL')(error) && /five seats/.test(error.message),
    );
    // Invitations stay open until the mode's own seats are full.
    const account = (n: number): Account => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      username: `Player${n}`,
      registered: true,
      isGuest: false,
      profile: { ...defaultProfile(`Player${n}`), username: `Player${n}` },
      lastActiveAt: new Date(1).toISOString(),
      expiresAt: null,
    });
    const [sender, friend] = [account(1), account(2)];
    const invites = new RoomInviteService(store, {
      get: async (token) => (token === 'friend' ? friend : sender),
      friends: async () => ({
        friends: [{ id: friend.id, username: friend.username!, isGuest: false, profile: friend.profile! }],
        incoming: [],
        outgoing: [],
      }),
    });
    const hosted = store.enter(
      'create',
      newSession('Inviter').token,
      'Inviter',
      undefined,
      identity(sender.id),
    );
    store.configureSettings(hosted, 'to-test', store.snapshot(hosted.room_id).revision, {
      turnTimerSeconds: 90,
      mode: TEST,
    });
    for (const name of ['B', 'C', 'D']) store.enter('join', newSession(name).token, name, hosted.room_id);
    assert.equal(store.snapshot(hosted.room_id).players.length, 4);
    const invite = await invites.send('sender', { roomId: hosted.room_id, other: friend.id });
    assert.equal(invite.players, 4, 'a fifth seat is still open in the test mode');
    store.enter('join', newSession('E').token, 'E', hosted.room_id);
    assert.deepEqual((await invites.list('friend')).incoming, [], 'full at five');
    // The loading screen asks for the mode's minimum too.
    const launch = new GameLaunch({
      now: () => 0,
      state: () =>
        ({
          roomId: 'r',
          revision: 1,
          counter: 0,
          players: [
            { id: 'a', name: 'A', connected: true },
            { id: 'b', name: 'B', connected: true, ready: true },
          ],
          settings: { turnTimerSeconds: 90, mode: TEST },
        }) as RoomState,
      commit: () => {},
      changed: () => {},
      failed: () => {},
    });
    assert.throws(
      () => launch.begin({ roomId: 'r', hostId: 'a', commandId: 'launch-test', revision: 1 }),
      (error: Error) =>
        code('NOT_ENOUGH_PLAYERS')(error) && /Test Table needs at least three players/.test(error.message),
    );
  } finally {
    store.close();
  }
});

test('Start plays the mode frozen in: its minimum seats, its board, and a switch that may have closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-modes-start-'));
  const path = join(directory, 'game.sqlite');
  let store = new Store(path, { modes: OPEN });
  try {
    const small = lobby(store, 2);
    store.configureSettings(small.host, 'to-test', small.revision(), { turnTimerSeconds: 90, mode: TEST });
    assert.throws(
      () => store.action(small.host, 'start-two', ready(store, small.roomId), { kind: 'start' }),
      /Start with three to five players/,
    );
    const table = lobby(store, 3);
    store.configureSettings(table.host, 'to-test', table.revision(), { turnTimerSeconds: 90, mode: TEST });
    // A lobby's island must be one its mode plays; an older Classic deal is refused, not played.
    const board = store.board(table.roomId);
    store.db
      .prepare('UPDATE room_boards SET board = ? WHERE room_id = ?')
      .run(JSON.stringify({ ...generateBoard(board.seed), preset: 'balanced-v1' }), table.roomId);
    assert.throws(
      () => store.action(table.host, 'start-old-board', ready(store, table.roomId), { kind: 'start' }),
      code('BOARD_MISMATCH'),
    );
    store.db
      .prepare('UPDATE room_boards SET board = ? WHERE room_id = ?')
      .run(JSON.stringify(board), table.roomId);
    // The kill switch: the server restarts with the mode closed, and a lobby already set to it cannot start.
    store.close();
    store = new Store(path);
    assert.throws(
      () => store.action(table.host, 'start-closed', ready(store, table.roomId), { kind: 'start' }),
      (error: Error) => code('MODE_UNAVAILABLE')(error) && /Test Table is not open/.test(error.message),
    );
    store.close();
    store = new Store(path, { modes: OPEN });
    store.action(table.host, 'start-test', ready(store, table.roomId), { kind: 'start' });
    const game = store.loadGame(table.roomId)!;
    assert.equal(game.ruleset, TEST);
    assert.deepEqual(game.board, board);
    assert.equal(game.victoryPoints, 11);
    assert.equal(game.bank.wood, 24);
    // Settings lock once the game starts, the mode with them.
    assert.throws(
      () =>
        store.configureSettings(table.host, 'locked', store.snapshot(table.roomId).revision, {
          turnTimerSeconds: 90,
          mode: CLASSIC.id,
        }),
      code('GAME_STARTED'),
    );
    // A rematch keeps the mode: the room returns to the lobby still set to it, on a new island of its own.
    game.phase = 'finished';
    game.winner = game.players[0]!.id;
    const state = JSON.stringify(game);
    store.db.prepare('UPDATE games SET state = ? WHERE room_id = ?').run(state, table.roomId);
    store.db
      .prepare(
        'UPDATE game_events SET state = ?, state_z = NULL, state_hash = ? WHERE room_id = ? AND revision = (SELECT max(revision) FROM game_events WHERE room_id = ?)',
      )
      .run(state, createHash('sha256').update(state).digest('hex'), table.roomId, table.roomId);
    store.action(table.host, 'rematch', store.snapshot(table.roomId).revision, { kind: 'returnToLobby' });
    assert.equal(store.settings(table.roomId).mode, TEST);
    assert.equal(store.board(table.roomId).preset, TEST_TABLE.board);
    assert.notDeepEqual(store.board(table.roomId), board);
    store.action(table.host, 'start-again', ready(store, table.roomId), { kind: 'start' });
    assert.equal(store.loadGame(table.roomId)!.ruleset, TEST);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
