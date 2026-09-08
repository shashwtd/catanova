import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class ProtocolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type Seat = { id: string; room_id: string; name: string };
type Receipt = { expected_revision: number; revision: number; counter: number };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
    `);
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  enter(mode: 'create' | 'join' | 'resume', token: string, name: string, roomId?: string): Seat {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id, room_id, name FROM seats WHERE token_hash = ?').get(hash(token)) as Seat | undefined;
      // Retrying a handshake after its reply was lost returns the same seat and room.
      if (existing) {
        if (roomId && existing.room_id !== roomId) throw new ProtocolError('INVALID_SESSION', 'Seat belongs to another room');
        return existing;
      }
      if (mode === 'resume') throw new ProtocolError('INVALID_SESSION', 'This seat cannot be resumed');
      if (mode === 'create') {
        if ((this.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()!.n as number) >= 1000) throw new ProtocolError('CAPACITY', 'Probe room limit reached');
        do { roomId = randomBytes(5).toString('base64url').replace(/[^A-Za-z2-9]/g, '').toUpperCase().padEnd(8, 'X').slice(0, 8); }
        while (this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId));
        this.db.prepare('INSERT INTO rooms(id) VALUES (?)').run(roomId);
      } else if (!this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId!)) {
        throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
      }
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM seats WHERE room_id = ?').get(roomId!)!.n as number) >= 4) throw new ProtocolError('ROOM_FULL', 'Room already has four seats');
      const seat = { id: randomUUID(), room_id: roomId!, name };
      this.db.prepare('INSERT INTO seats(id, room_id, token_hash, name) VALUES (?, ?, ?, ?)').run(seat.id, seat.room_id, hash(token), name);
      return seat;
    });
  }
  snapshot(roomId: string) {
    const room = this.db.prepare('SELECT revision, counter FROM rooms WHERE id = ?').get(roomId) as { revision: number; counter: number };
    const players = this.db.prepare('SELECT id, name FROM seats WHERE room_id = ? ORDER BY rowid').all(roomId) as { id: string; name: string }[];
    return { roomId, ...room, players };
  }
  increment(seat: Seat, commandId: string, expectedRevision: number) {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT expected_revision, revision, counter FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
        .get(seat.room_id, seat.id, commandId) as Receipt | undefined;
      if (old) {
        if (old.expected_revision !== expectedRevision) throw new ProtocolError('COMMAND_REUSED', 'A command ID cannot be reused with a different payload');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const state = this.snapshot(seat.room_id);
      if (state.revision !== expectedRevision) throw new ProtocolError('STALE_STATE', 'State changed; review the latest snapshot and try again');
      const revision = state.revision + 1;
      const counter = state.counter + 1;
      this.db.prepare('UPDATE rooms SET revision = ?, counter = ? WHERE id = ?').run(revision, counter, seat.room_id);
      this.db.prepare('INSERT INTO receipts(room_id, player_id, command_id, expected_revision, revision, counter) VALUES (?, ?, ?, ?, ?, ?)')
        .run(seat.room_id, seat.id, commandId, expectedRevision, revision, counter);
      return { revision, counter, duplicate: false };
    });
  }
  close() { this.db.close(); }
}
