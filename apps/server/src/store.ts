import { defaultProfile, parseProfile } from '../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import type { Identity } from './auth.js';
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
      CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, profile TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lobby_receipts (
        room_id TEXT NOT NULL, player_id TEXT NOT NULL, command_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS game_events (
        room_id TEXT NOT NULL REFERENCES rooms(id), revision INTEGER NOT NULL,
        command_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL,
        previous_hash TEXT, state_hash TEXT NOT NULL, state TEXT NOT NULL,
        public_entry TEXT NOT NULL, PRIMARY KEY(room_id, revision)
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
    const columns = this.db
      .prepare('PRAGMA table_info(seats)')
      .all()
      .map((c) => c.name);
    for (const [name, type] of [
      ['user_id', 'TEXT'],
      ['profile', 'TEXT'],
      ['ready', 'INTEGER NOT NULL DEFAULT 0'],
    ])
      if (!columns.includes(name)) this.db.exec('ALTER TABLE seats ADD COLUMN ' + name + ' ' + type);
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS seat_account_room ON seats(user_id, room_id) WHERE user_id IS NOT NULL AND departed = 0',
    );
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
  enter(
    mode: 'create' | 'join' | 'resume',
    token: string,
    name: string,
    roomId?: string,
    identity?: Identity,
    requestedProfile?: Profile,
  ): Seat {
    return this.transaction(() => {
      let existing = this.db
        .prepare('SELECT id, room_id, name, departed, user_id FROM seats WHERE token_hash = ?')
        .get(hash(token)) as (Seat & { departed: number; user_id: string | null }) | undefined;
      if (existing?.user_id && existing.user_id !== identity?.id)
        throw new ProtocolError('AUTH_MISMATCH', 'This seat belongs to another account');
      if (!existing && identity && roomId) {
        existing = this.db
          .prepare(
            'SELECT id, room_id, name, departed, user_id FROM seats WHERE user_id = ? AND room_id = ? AND departed = 0',
          )
          .get(identity.id, roomId) as (Seat & { departed: number; user_id: string | null }) | undefined;
        if (existing)
          this.db.prepare('UPDATE seats SET token_hash = ? WHERE id = ?').run(hash(token), existing.id);
      }
      // Retrying a handshake after its reply was lost returns the same seat and room.
      if (existing) {
        if (existing.departed) throw new ProtocolError('SEAT_LEFT', 'You left this lobby');
        if (roomId && existing.room_id !== roomId)
          throw new ProtocolError('INVALID_SESSION', 'Seat belongs to another room');
        if (identity && !existing.user_id)
          this.db.prepare('UPDATE seats SET user_id = ? WHERE id = ?').run(identity.id, existing.id);
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
      const profile = identity
        ? this.profile(identity.id, identity.name)
        : parseProfile(requestedProfile ?? defaultProfile(name));
      const seat = { id: randomUUID(), room_id: roomId!, name: profile.name };
      this.db
        .prepare(
          'INSERT INTO seats(id, room_id, token_hash, name, user_id, profile) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.id, seat.room_id, hash(token), profile.name, identity?.id ?? null, JSON.stringify(profile));
      return seat;
    });
  }
  snapshot(roomId: string, viewer?: string) {
    const room = this.db.prepare('SELECT revision, counter FROM rooms WHERE id = ?').get(roomId) as {
      revision: number;
      counter: number;
    };
    const players = this.db
      .prepare('SELECT id, name, profile, ready FROM seats WHERE room_id = ? AND departed = 0 ORDER BY rowid')
      .all(roomId) as { id: string; name: string; profile: string | null; ready: number }[];
    const game = viewer ? this.loadGame(roomId) : undefined;
    return {
      roomId,
      ...room,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        profile: p.profile ? (JSON.parse(p.profile) as Profile) : defaultProfile(p.name),
        ready: !!p.ready,
      })),
      historyRevision: this.eventHead(roomId)?.revision ?? 0,
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
  hasAccountSeat(roomId: string, userId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM seats WHERE room_id = ? AND user_id = ? AND departed = 0')
      .get(roomId, userId);
  }
  leave(seat: Seat, commandId: string, expectedRevision: number) {
    return this.transaction(() => {
      if (
        this.db
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
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
  profile(userId: string, name = 'Player'): Profile {
    const row = this.db.prepare('SELECT profile FROM profiles WHERE user_id = ?').get(userId) as
      { profile: string } | undefined;
    if (row) return parseProfile(JSON.parse(row.profile));
    const profile = defaultProfile(name);
    this.saveProfile(userId, profile);
    return profile;
  }
  saveProfile(userId: string, input: Profile): Profile {
    const profile = parseProfile(input);
    this.db
      .prepare(
        'INSERT INTO profiles(user_id, profile) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile',
      )
      .run(userId, JSON.stringify(profile));
    return profile;
  }
  private eventHead(roomId: string) {
    return this.db
      .prepare(
        'SELECT revision, state_hash FROM game_events WHERE room_id = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(roomId) as { revision: number; state_hash: string } | undefined;
  }
  private recordEvent(
    roomId: string,
    revision: number,
    commandId: string,
    actor: string | null,
    action: unknown,
    game: Game,
    lines: string[],
    kind: string,
  ) {
    const state = JSON.stringify(game);
    const entry: HistoryEntry = {
      revision,
      actor,
      kind,
      turn: game.turn,
      at: new Date().toISOString(),
      lines,
    };
    this.db
      .prepare(
        'INSERT INTO game_events(room_id, revision, command_id, actor, action, previous_hash, state_hash, state, public_entry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        roomId,
        revision,
        commandId,
        actor,
        JSON.stringify(action),
        this.eventHead(roomId)?.state_hash ?? null,
        hash(state),
        state,
        JSON.stringify(entry),
      );
  }
  history(roomId: string, before = Number.MAX_SAFE_INTEGER) {
    const rows = this.db
      .prepare(
        'SELECT public_entry FROM game_events WHERE room_id = ? AND revision < ? ORDER BY revision DESC LIMIT 41',
      )
      .all(roomId, before) as { public_entry: string }[];
    return {
      entries: rows.slice(0, 40).map((r) => JSON.parse(r.public_entry) as HistoryEntry),
      hasMore: rows.length > 40,
    };
  }
  lobby(seat: Seat, commandId: string, expectedRevision: number, ready: boolean, input?: Profile) {
    const profile = input ? parseProfile(input) : undefined;
    const payloadHash = hash(JSON.stringify({ expectedRevision, ready, profile }));
    return this.transaction(() => {
      for (const table of ['receipts', 'game_receipts', 'leave_receipts'])
        if (
          this.db
            .prepare('SELECT 1 FROM ' + table + ' WHERE room_id = ? AND player_id = ? AND command_id = ?')
            .get(seat.room_id, seat.id, commandId)
        )
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used');
      const old = this.db
        .prepare(
          'SELECT payload_hash, revision, counter FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { payload_hash: string; revision: number; counter: number } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used with different intent');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      // Readiness is an explicit intent for this seat, independent of another seat's update.
      if (expectedRevision > room.revision)
        throw new ProtocolError('STALE_STATE', 'The lobby changed; try again');
      if (this.loadGame(seat.room_id)) throw new ProtocolError('GAME_STARTED', 'The game has started');
      if (!room.players.some((p) => p.id === seat.id))
        throw new ProtocolError('SEAT_LEFT', 'You left this lobby');
      if (profile) {
        this.db
          .prepare('UPDATE seats SET name = ?, profile = ? WHERE id = ?')
          .run(profile.name, JSON.stringify(profile), seat.id);
        const account = this.db.prepare('SELECT user_id FROM seats WHERE id = ?').get(seat.id)!;
        if (typeof account.user_id === 'string') this.saveProfile(account.user_id, profile);
      }
      this.db.prepare('UPDATE seats SET ready = ? WHERE id = ?').run(Number(ready), seat.id);
      const revision = room.revision + 1;
      this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare('INSERT INTO lobby_receipts VALUES (?, ?, ?, ?, ?, ?)')
        .run(seat.room_id, seat.id, commandId, payloadHash, revision, room.counter);
      return { revision, counter: room.counter, duplicate: false };
    });
  }
  loadGame(roomId: string): Game | undefined {
    const row = this.db.prepare('SELECT state FROM games WHERE room_id = ?').get(roomId) as
      { state: string } | undefined;
    const head = this.eventHead(roomId);
    if (head && (!row || hash(row.state) !== head.state_hash))
      throw new ProtocolError('STATE_INTEGRITY', 'Saved game needs recovery; no moves were discarded');
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
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
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
        if (!room.players.every((p) => p.ready))
          throw new ProtocolError('NOT_READY', 'Every player must be ready');
        next = createGame(
          shuffle(
            room.players.map((p) => ({ id: p.id, name: p.name })),
            privateRandom,
          ),
          room.board.seed,
          privateRandom,
        );
      } else {
        if (!current) throw new ProtocolError('NOT_STARTED', 'Start the game first');
        next = applyAction(current, seat.id, action, privateRandom);
      }
      if (current && !this.eventHead(seat.room_id))
        this.recordEvent(
          seat.room_id,
          room.revision,
          'legacy-history',
          null,
          {},
          current,
          [
            'Earlier game imported; only its last saved journal entries are available.',
            ...current.log.map((e) => e.text),
          ],
          'legacy',
        );
      const revision = room.revision + 1;
      this.recordEvent(
        seat.room_id,
        revision,
        commandId,
        seat.id,
        action,
        next,
        next.log.filter((e) => e.id >= (current?.nextLog ?? 0)).map((e) => e.text),
        action.kind,
      );
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
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
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
