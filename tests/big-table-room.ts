/**
 * A Big Table room on a fake clock, played through the Store as the server plays it: every move through
 * Store.action, every clock and absence through Store.expireRoom. For the server's Big Table tests.
 */
import { createHash } from 'node:crypto';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { newSession } from '../apps/client/src/connection.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { BIG_TABLE_BALANCED_V1, generateBoard, seededRandom } from '../packages/rules/src/board.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import type { TurnStructure } from '../packages/rules/src/rulesets.js';
import type { TurnTimerSeconds } from '../packages/protocol/src/settings.js';
import { NAMES } from './big-table-helpers.js';

/** Big Table open to every host, as CATANOVA_MODES=big-table-v1 opens it. */
export const OPEN: ModeSwitches = { open: [CLASSIC.id, BIG_TABLE.id], testers: new Set() };

export type RoomOptions = {
  players?: number;
  turns?: TurnStructure;
  timer?: TurnTimerSeconds | null;
  victoryPoints?: number;
  clock?: { now: number };
  /** The store's private randomness: its dice, steals, seat order and clock moves. */
  random?: () => number;
  /** The island's seed. The store deals a lobby's island from the server's own randomness, so a test sets it. */
  boardSeed?: number;
};

/**
 * A started Big Table game: the host makes a room, picks Big Table (a Classic room holds four, so the mode comes
 * first), the others join and ready up, and the host starts. Every seat is connected.
 */
export function bigTableRoom(options: RoomOptions = {}) {
  const clock = options.clock ?? { now: 1_000_000 };
  const store = new Store(':memory:', {
    now: () => clock.now,
    trackPresence: true,
    modes: OPEN,
    random: options.random ?? seededRandom(4242),
  });
  const sessions = NAMES.slice(0, options.players ?? 5).map((name) => newSession(name));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const roomId = host.room_id;
  let commands = 0;
  const revision = () => store.snapshot(roomId).revision;
  store.setConnected(host, true);
  store.configureSettings(host, `settings-${++commands}`, revision(), {
    turnTimerSeconds: options.timer === undefined ? null : options.timer,
    diceMode: 'classic',
    mode: BIG_TABLE.id,
    ...(options.turns ? { turns: options.turns } : {}),
  });
  if (options.victoryPoints)
    store.configureSettings(host, `settings-${++commands}`, revision(), {
      ...store.settings(roomId),
      victoryPoints: options.victoryPoints,
    });
  const seats: Seat[] = [host];
  for (const session of sessions.slice(1)) {
    const seat = store.enter('join', session.token, session.name, roomId);
    store.setConnected(seat, true);
    seats.push(seat);
  }
  // The same island every run, so that a game plays the same way every time.
  store.db
    .prepare('UPDATE room_boards SET board = ? WHERE room_id = ?')
    .run(JSON.stringify(generateBoard(options.boardSeed ?? 4242, BIG_TABLE_BALANCED_V1)), roomId);
  for (const seat of seats.slice(1)) store.lobby(seat, `ready-${seat.id}`, revision(), true);
  store.action(host, 'start', revision(), { kind: 'start' });
  const game = () => store.loadGame(roomId)!;
  const seatOf = (id: string) => seats.find((seat) => seat.id === id)!;
  /** A move by a player, through the Store. */
  const act = (id: string, action: GameAction) =>
    store.action(seatOf(id), `move-${++commands}`, revision(), action);
  /** The first player the game waits on makes the clock's move for themselves. */
  const step = (random = seededRandom(commands + 1)) => {
    const owed = owedMoves(game())[0]!;
    act(owed.player, timeoutAction(game(), owed.player, random)!);
  };
  /** Rewrite the saved game as a test scenario, keeping the journal head's hash in step with it. */
  const rig = (edit: (game: Game) => void) => {
    const g = game();
    edit(g);
    const state = JSON.stringify(g);
    store.db.prepare('UPDATE games SET state = ? WHERE room_id = ?').run(state, roomId);
    store.db
      .prepare(
        'UPDATE game_events SET state = ?, state_z = NULL, state_hash = ? WHERE room_id = ? AND revision = (SELECT max(revision) FROM game_events WHERE room_id = ?)',
      )
      .run(state, createHash('sha256').update(state).digest('hex'), roomId, roomId);
  };
  /** The game's own id for a seat's name. */
  const idOf = (name: string) => seats.find((seat) => seat.name === name)!.id;
  return { store, clock, roomId, seats, revision, game, seatOf, act, step, rig, idOf };
}
export type Room = ReturnType<typeof bigTableRoom>;

/** Play the setup draft with the clock's placements. */
export function throughSetup(room: Room) {
  while (room.game().turn === 0) room.step();
}
