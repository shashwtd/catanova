import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyAction, createGame, gameView, parseGameAction } from '../../../packages/rules/src/game.js';
import type { Game, GameAction } from '../../../packages/rules/src/game.js';
import { generateBoard, shuffle } from '../../../packages/rules/src/board.js';
import type { Board } from '../../../packages/rules/src/board.js';

export class ProtocolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Seat = { id: string; room_id: string; name: string };
type Receipt = { expected_revision: number; revision: number; counter: number };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const privateRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** Single-process probe store. Cloud play will use the Postgres adapter described in docs. */
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
        counter INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS seats (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
        token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS seats_room ON seats(room_id);
      CREATE TABLE IF NOT EXISTS receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS games (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS room_boards (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), board TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leave_receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL, released INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
    `);
    if (
      !this.db
        .prepare('PRAGMA table_info(seats)')
        .all()
        .some((column) => column.name === 'departed')
    )
      this.db.exec('ALTER TABLE seats ADD COLUMN departed INTEGER NOT NULL DEFAULT 0');
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  enter(mode: 'create' | 'join' | 'resume', token: string, name: string, roomId?: string): Seat {
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT id, room_id, name, departed FROM seats WHERE token_hash = ?')
        .get(hash(token)) as (Seat & { departed: number }) | undefined;
      // Retrying a handshake after its reply was lost returns the same seat and room.
      if (existing) {
        if (existing.departed) throw new ProtocolError('SEAT_LEFT', 'You left this lobby');
        if (roomId && existing.room_id !== roomId)
          throw new ProtocolError('INVALID_SESSION', 'Seat belongs to another room');
        return { id: existing.id, room_id: existing.room_id, name: existing.name };
      }
      if (mode === 'resume') throw new ProtocolError('INVALID_SESSION', 'This seat cannot be resumed');
      if (mode === 'create') {
        if ((this.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()!.n as number) >= 1000)
          throw new ProtocolError('CAPACITY', 'Probe room limit reached');
        do {
          roomId = randomBytes(5)
            .toString('base64url')
            .replace(/[^A-Za-z2-9]/g, '')
            .toUpperCase()
            .padEnd(8, 'X')
            .slice(0, 8);
        } while (this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId));
        this.db.prepare('INSERT INTO rooms(id) VALUES (?)').run(roomId);
        this.board(roomId);
      } else if (!this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId!)) {
        throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
      }
      if (
        (this.db.prepare('SELECT COUNT(*) AS n FROM seats WHERE room_id = ? AND departed = 0').get(roomId!)!
          .n as number) >= 4
      )
        throw new ProtocolError('ROOM_FULL', 'Room already has four seats');
      if (this.loadGame(roomId!))
        throw new ProtocolError('GAME_STARTED', 'This game has already started; existing players can resume');
      const seat = { id: randomUUID(), room_id: roomId!, name };
      this.db
        .prepare('INSERT INTO seats(id, room_id, token_hash, name) VALUES (?, ?, ?, ?)')
        .run(seat.id, seat.room_id, hash(token), name);
      return seat;
    });
  }
  snapshot(roomId: string, viewer?: string) {
    const room = this.db.prepare('SELECT revision, counter FROM rooms WHERE id = ?').get(roomId) as {
      revision: number;
      counter: number;
    };
    const players = this.db
      .prepare('SELECT id, name FROM seats WHERE room_id = ? AND departed = 0 ORDER BY rowid')
      .all(roomId) as { id: string; name: string }[];
    const game = viewer ? this.loadGame(roomId) : undefined;
    return {
      roomId,
      ...room,
      players,
      board: this.board(roomId),
      ...(game ? { game: gameView(game, viewer!) } : {}),
    };
  }
  board(roomId: string): Board {
    const game = this.loadGame(roomId);
    if (game) return game.board;
    const saved = this.db.prepare('SELECT board FROM room_boards WHERE room_id = ?').get(roomId) as
      { board: string } | undefined;
    if (saved) return JSON.parse(saved.board) as Board;
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId))
      throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
    const board = generateBoard(randomInt(0, 2 ** 32));
    this.db
      .prepare('INSERT INTO room_boards(room_id, board) VALUES (?, ?)')
      .run(roomId, JSON.stringify(board));
    return board;
  }
  preview(roomId: string) {
    const state = this.snapshot(roomId);
    return { roomId, board: state.board, players: state.players, started: !!this.loadGame(roomId) };
  }
  leave(seat: Seat, commandId: string, expectedRevision: number) {
    return this.transaction(() => {
      if (
        this.db
          .prepare('SELECT 1 FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId) ||
        this.db
          .prepare('SELECT 1 FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used');
      const old = this.db
        .prepare(
          'SELECT expected_revision, revision, counter, released FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { expected_revision: number; revision: number; counter: number; released: number } | undefined;
      if (old) {
        if (old.expected_revision !== expectedRevision)
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used with different intent');
        return { revision: old.revision, counter: old.counter, released: !!old.released, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      if (room.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'The room changed; try leaving again');
      const released = !this.loadGame(seat.room_id);
      const revision = room.revision + (released ? 1 : 0);
      if (released) {
        this.db.prepare('UPDATE seats SET departed = 1 WHERE id = ?').run(seat.id);
        this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      }
      this.db
        .prepare(
          'INSERT INTO leave_receipts(room_id, player_id, command_id, expected_revision, revision, counter, released) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, expectedRevision, revision, room.counter, Number(released));
      return { revision, counter: room.counter, released, duplicate: false };
    });
  }
  loadGame(roomId: string): Game | undefined {
    const row = this.db.prepare('SELECT state FROM games WHERE room_id = ?').get(roomId) as
      { state: string } | undefined;
    if (!row) return undefined;
    const game = JSON.parse(row.state) as Game;
    if (game.schema !== 1)
      throw new ProtocolError('VERSION_MISMATCH', 'This saved game needs a compatible server version');
    return game;
  }
  action(seat: Seat, commandId: string, expectedRevision: number, input: GameAction) {
    const action = parseGameAction(input);
    const payloadHash = hash(JSON.stringify({ expectedRevision, action }));
    return this.transaction(() => {
      if (
        this.db
          .prepare('SELECT 1 FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for leaving');
      if (
        this.db
          .prepare('SELECT 1 FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for another operation');
      const old = this.db
        .prepare(
          'SELECT payload_hash, revision, counter FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { payload_hash: string; revision: number; counter: number } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new ProtocolError('COMMAND_REUSED', 'A command ID cannot be reused with a different payload');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      if (room.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'State changed; review the latest snapshot and try again');
      const current = this.loadGame(seat.room_id);
      let next: Game;
      if (action.kind === 'start') {
        if (current) throw new ProtocolError('GAME_STARTED', 'This game is already underway');
        if (room.players[0]?.id !== seat.id)
          throw new ProtocolError('NOT_HOST', 'Only the room creator can start the game');
        next = createGame(shuffle(room.players, privateRandom), room.board.seed, privateRandom);
      } else {
        if (!current) throw new ProtocolError('NOT_STARTED', 'Start the game first');
        next = applyAction(current, seat.id, action, privateRandom);
      }
      const revision = room.revision + 1;
      this.db
        .prepare(
          'INSERT INTO games(room_id, state) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET state = excluded.state',
        )
        .run(seat.room_id, JSON.stringify(next));
      this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare(
          'INSERT INTO game_receipts(room_id, player_id, command_id, payload_hash, revision, counter) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, payloadHash, revision, room.counter);
      return { revision, counter: room.counter, duplicate: false };
    });
  }
  increment(seat: Seat, commandId: string, expectedRevision: number) {
    return this.transaction(() => {
      if (
        this.db
          .prepare('SELECT 1 FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for leaving');
      if (
        this.db
          .prepare('SELECT 1 FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for another operation');
      if (this.loadGame(seat.room_id))
        throw new ProtocolError('GAME_STARTED', 'Connectivity counters are disabled during games');
      const old = this.db
        .prepare(
          'SELECT expected_revision, revision, counter FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as Receipt | undefined;
      if (old) {
        if (old.expected_revision !== expectedRevision)
          throw new ProtocolError('COMMAND_REUSED', 'A command ID cannot be reused with a different payload');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const state = this.snapshot(seat.room_id);
      if (state.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'State changed; review the latest snapshot and try again');
      const revision = state.revision + 1;
      const counter = state.counter + 1;
      this.db
        .prepare('UPDATE rooms SET revision = ?, counter = ? WHERE id = ?')
        .run(revision, counter, seat.room_id);
      this.db
        .prepare(
          'INSERT INTO receipts(room_id, player_id, command_id, expected_revision, revision, counter) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, expectedRevision, revision, counter);
      return { revision, counter, duplicate: false };
    });
  }
  close() {
    this.db.close();
  }
}
