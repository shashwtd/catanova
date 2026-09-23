/**
 * The room index behind the overview's room counts and the games list.
 *
 * Classifying a room takes a few indexed lookups, but rooms are kept for good,
 * so a pass over all of them grows with every room ever opened: about 0.14 s
 * at 50,000 rooms and 0.75 s at 200,000. `node:sqlite` is synchronous, so on
 * the game's own connection each pass would freeze every table in play, and
 * the console's pages refresh every 10 to 15 seconds. The pass therefore runs
 * on one worker thread with its own read-only connection, at most once every
 * few seconds however many pages are open, and only the counts and the page
 * being shown travel back. The worker exits when the console goes quiet. It
 * also runs the player search, the other read that scans a whole table.
 *
 * Status comes from cheap columns: whether a `games` row exists, the phase
 * recorded on the room's newest journal row, and the presence row's pause
 * mark. Journal rows are read only through their `phase` column and public
 * entry; no saved game or journal state is opened here. A single room
 * (`indexRoom`) is a handful of primary-key lookups and is read directly.
 */
import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from 'node:sqlite';
import { isShortRoomCode, normalizeRoomReference } from '../../../../packages/protocol/src/room-reference.js';
import { AdminRequestError } from './api.js';
import { serverErrors } from './errors.js';
import type { RoomStatus } from './types.js';

export const ROOM_STATUSES: RoomStatus[] = ['lobby', 'live', 'paused', 'finished', 'empty'];
export const GAMES_PAGE_SIZE = 25;
/** A pass over every room is reused for this long, whoever asks. */
export const ROOM_INDEX_MAX_AGE_MS = 5_000;
/** Longer than any pass should take; the admin listener answers well inside Cloudflare's limit. */
export const ROOM_INDEX_TIMEOUT_MS = 20_000;
/** The worker exits after this long without a question, giving back its memory. */
export const ROOM_INDEX_IDLE_MS = 60_000;
/** Most distinct name searches remembered alongside one pass. */
const NAME_SEARCHES = 32;

export type IndexedRoom = {
  id: string;
  revision: number;
  code: string | null;
  seats: number;
  humans: number;
  hasGame: boolean;
  paused: boolean;
  /** When the table emptied, while it is paused. */
  pausedAt: number | null;
  phase: string | null;
  turn: number | null;
  lastActivity: number | null;
  status: RoomStatus;
};

export type RoomCounts = Record<RoomStatus, number>;

export type RoomSummary = {
  indexedAt: number;
  counts: RoomCounts;
  total: number;
  /** Bot seats at tables whose game is live. */
  liveBotSeats: number;
  journalRows: number;
};

export type RoomListQuery = { status: RoomStatus | 'all'; q: string; page: number };

export type RoomList = { indexedAt: number; counts: RoomCounts; total: number; rooms: IndexedRoom[] };

export type RoomIndexQuery =
  | { kind: 'summary'; now: number }
  | { kind: 'list'; now: number; query: RoomListQuery }
  | { kind: 'accounts'; q: string };

type Answer = RoomSummary | RoomList | string[];

export type RoomIndexRequest = ({ id: number } & RoomIndexQuery) | { kind: 'invalidate' };

export type RoomIndexReply =
  { id: number; ok: true; result: Answer } | { id: number; ok: false; error: string };

type RoomRow = {
  id: string;
  revision: number;
  code: string | null;
  codeExpires: number | null;
  seats: number;
  humans: number;
  hasGame: number;
  pausedAt: number | null;
};

const ROOMS = `SELECT r.id AS id, r.revision AS revision,
    (SELECT c.code FROM room_codes c WHERE c.room_id = r.id AND c.expires_at > ?) AS code,
    (SELECT c.expires_at FROM room_codes c WHERE c.room_id = r.id) AS codeExpires,
    (SELECT count(*) FROM seats s WHERE s.room_id = r.id AND s.departed = 0) AS seats,
    (SELECT count(*) FROM seats s WHERE s.room_id = r.id AND s.departed = 0 AND s.bot = 0) AS humans,
    EXISTS (SELECT 1 FROM games g WHERE g.room_id = r.id) AS hasGame,
    (SELECT json_extract(p.state, '$.pausedAt') FROM room_presence p WHERE p.room_id = r.id) AS pausedAt
  FROM rooms r`;

// The newest journal row of a room with a game describes that game: its phase
// column, and its public entry's time and turn.
const HEAD = `SELECT phase, json_extract(public_entry, '$.at') AS at, json_extract(public_entry, '$.turn') AS turn
  FROM game_events WHERE room_id = ? ORDER BY revision DESC LIMIT 1`;

const time = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** `leaseMs` is the room code lease: codes are renewed on every admission and move, so a lease dates activity. */
function classify(db: DatabaseSync, rows: RoomRow[], leaseMs: number): IndexedRoom[] {
  const head = db.prepare(HEAD);
  return rows.map((row): IndexedRoom => {
    const event = row.hasGame
      ? (head.get(row.id) as { phase: string | null; at: string | null; turn: number | null } | undefined)
      : undefined;
    const phase = event?.phase ?? null;
    const paused = row.pausedAt !== null;
    const touched = row.codeExpires === null ? null : row.codeExpires - leaseMs;
    const eventAt = time(event?.at);
    return {
      id: row.id,
      revision: row.revision,
      code: row.code,
      seats: row.seats,
      humans: row.humans,
      hasGame: !!row.hasGame,
      paused,
      pausedAt: row.pausedAt,
      phase,
      turn: typeof event?.turn === 'number' ? event.turn : null,
      lastActivity: touched === null ? eventAt : eventAt === null ? touched : Math.max(touched, eventAt),
      status: row.hasGame
        ? phase === 'finished'
          ? 'finished'
          : paused
            ? 'paused'
            : 'live'
        : row.humans > 0
          ? 'lobby'
          : 'empty',
    };
  });
}

/** Every room with its status, most recently active first. Grows with the room count: keep it off the game's thread. */
export function indexRooms(db: DatabaseSync, now: number, leaseMs: number): IndexedRoom[] {
  return classify(db, db.prepare(ROOMS).all(now) as RoomRow[], leaseMs).sort(
    (a, b) => (b.lastActivity ?? -1) - (a.lastActivity ?? -1) || a.id.localeCompare(b.id),
  );
}

/** One room by its permanent id: primary-key lookups only. */
export function indexRoom(
  db: DatabaseSync,
  now: number,
  leaseMs: number,
  roomId: string,
): IndexedRoom | undefined {
  return classify(db, db.prepare(`${ROOMS} WHERE r.id = ?`).all(now, roomId) as RoomRow[], leaseMs)[0];
}

const UUID_PREFIX = /^[0-9a-f-]{8,36}$/i;

/**
 * Up to 50 accounts whose seat or profile name contains `q`, or whose id
 * starts with it, most recently seated first. LIKE wildcards in `q` are literal.
 */
export function matchingAccounts(db: DatabaseSync, q: string): string[] {
  const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
  const like = `%${escaped}%`;
  // An id is matched by prefix only; an empty pattern matches nothing.
  const idLike = UUID_PREFIX.test(q) ? `${escaped.toLowerCase()}%` : '';
  // Seats carry every account that ever sat down; the local profile table covers
  // accounts that only ever saved a profile.
  const ids = db
    .prepare(
      `SELECT user_id AS userId, max(rowid) AS latest FROM seats
       WHERE user_id IS NOT NULL AND (name LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\')
       GROUP BY user_id
       UNION
       SELECT user_id, 0 FROM profiles
       WHERE json_extract(profile, '$.name') LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\'
       ORDER BY latest DESC LIMIT 200`,
    )
    .all(like, idLike, like, idLike)
    .map((row) => row.userId as string);
  return [...new Set(ids)].slice(0, 50);
}

export function countStatuses(rooms: IndexedRoom[]): RoomCounts {
  const counts = Object.fromEntries(ROOM_STATUSES.map((status) => [status, 0])) as RoomCounts;
  for (const room of rooms) counts[room.status]++;
  return counts;
}

type Pass = {
  at: number;
  clock: number;
  rooms: IndexedRoom[];
  counts: RoomCounts;
  liveBotSeats: number;
  journalRows: number;
};

/** Answers index questions from one pass over every room, redone once it is `maxAgeMs` old. */
export class RoomIndexCache {
  private pass: Pass | null = null;
  private readonly named = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: {
      leaseMs: number;
      maxAgeMs: number;
      /** Runs a pass; the worker gives it one read transaction so its numbers agree. */
      read?: <T>(work: () => T) => T;
      clock?: () => number;
    },
  ) {}

  invalidate(): void {
    this.pass = null;
    this.named.clear();
  }

  answer(query: RoomIndexQuery): Answer {
    if (query.kind === 'accounts') return matchingAccounts(this.db, query.q);
    return query.kind === 'summary' ? this.summary(query.now) : this.list(query.now, query.query);
  }

  summary(now: number): RoomSummary {
    const pass = this.current(now);
    return {
      indexedAt: pass.at,
      counts: { ...pass.counts },
      total: pass.rooms.length,
      liveBotSeats: pass.liveBotSeats,
      journalRows: pass.journalRows,
    };
  }

  /** The rooms matching a search (room code, room id prefix or seat name) and status, one page of them. */
  list(now: number, query: RoomListQuery): RoomList {
    const pass = this.current(now);
    const q = query.q;
    let rooms = pass.rooms;
    if (q) {
      const reference = normalizeRoomReference(q);
      const code = isShortRoomCode(reference) ? reference : null;
      const idPrefix = /^[0-9a-f-]{4,36}$/i.test(q) ? q.toLowerCase() : null;
      const named = this.roomsNamed(q);
      rooms = rooms.filter(
        (room) =>
          (code !== null && room.code === code) ||
          (idPrefix !== null && room.id.startsWith(idPrefix)) ||
          named.has(room.id),
      );
    }
    const filtered = query.status === 'all' ? rooms : rooms.filter((room) => room.status === query.status);
    const start = (query.page - 1) * GAMES_PAGE_SIZE;
    return {
      indexedAt: pass.at,
      counts: q ? countStatuses(rooms) : { ...pass.counts },
      total: filtered.length,
      rooms: filtered.slice(start, start + GAMES_PAGE_SIZE),
    };
  }

  private current(now: number): Pass {
    const clock = (this.options.clock ?? (() => performance.now()))();
    if (this.pass && clock - this.pass.clock < this.options.maxAgeMs) return this.pass;
    this.invalidate();
    const read = this.options.read ?? (<T>(work: () => T) => work());
    this.pass = read(() => {
      const rooms = indexRooms(this.db, now, this.options.leaseMs);
      let liveBotSeats = 0;
      for (const room of rooms) if (room.status === 'live') liveBotSeats += room.seats - room.humans;
      return {
        at: now,
        clock,
        rooms,
        counts: countStatuses(rooms),
        liveBotSeats,
        journalRows: this.db.prepare('SELECT count(*) AS n FROM game_events').get()!.n as number,
      };
    });
    return this.pass;
  }

  /** Rooms with a seat whose name contains `q`, literally: LIKE wildcards are escaped. */
  private roomsNamed(q: string): ReadonlySet<string> {
    let found = this.named.get(q);
    if (!found) {
      const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
      found = new Set(
        this.db
          .prepare("SELECT DISTINCT room_id FROM seats WHERE name LIKE ? ESCAPE '\\' LIMIT 500")
          .all(`%${escaped}%`)
          .map((row) => row.room_id as string),
      );
      if (this.named.size >= NAME_SEARCHES) this.named.delete(this.named.keys().next().value!);
      this.named.set(q, found);
    }
    return found;
  }
}

const WORKER = new URL(
  `./room-index-worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
);

type Waiting = {
  resolve: (result: Answer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const unavailable = (code: string, message: string) => new AdminRequestError(503, code, message);

/**
 * The index as the admin routes use it. Questions go to the worker in order
 * and are answered from its current pass. A private in-memory database cannot
 * be opened by another thread, so that one (tests, local experiments) is read
 * directly instead.
 */
export class RoomIndex {
  private readonly inline: RoomIndexCache | null;
  private worker: Worker | null = null;
  /** Settles when a worker that was told to stop has exited. */
  private stopping: Promise<void> | null = null;
  private readonly waiting = new Map<number, Waiting>();
  private nextId = 1;
  private idle: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly options: {
      databasePath: string;
      db: DatabaseSync;
      leaseMs: number;
      maxAgeMs?: number;
      timeoutMs?: number;
      idleMs?: number;
    },
  ) {
    this.inline =
      options.databasePath === ':memory:'
        ? new RoomIndexCache(options.db, {
            leaseMs: options.leaseMs,
            maxAgeMs: options.maxAgeMs ?? ROOM_INDEX_MAX_AGE_MS,
          })
        : null;
  }

  summary(now: number): Promise<RoomSummary> {
    return this.ask({ kind: 'summary', now }) as Promise<RoomSummary>;
  }

  list(now: number, query: RoomListQuery): Promise<RoomList> {
    return this.ask({ kind: 'list', now, query }) as Promise<RoomList>;
  }

  /** See `matchingAccounts`. Not cached: each search is typed by hand. */
  accounts(q: string): Promise<string[]> {
    return this.ask({ kind: 'accounts', q }) as Promise<string[]>;
  }

  /** Whether a worker thread is up (or still stopping). */
  get running(): boolean {
    return this.worker !== null || this.stopping !== null;
  }

  /** Drop the current pass, after the console itself changed a room. */
  invalidate(): void {
    this.inline?.invalidate();
    this.worker?.postMessage({ kind: 'invalidate' } satisfies RoomIndexRequest);
  }

  /** Stop answering and stop the worker. Does not wait for a statement still running in it. */
  close(): void {
    this.closed = true;
    clearTimeout(this.idle);
    this.failAll(unavailable('SHUTTING_DOWN', 'The admin console is shutting down'));
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate().catch(() => undefined);
  }

  private ask(query: RoomIndexQuery): Promise<Answer> {
    if (this.closed)
      return Promise.reject(unavailable('SHUTTING_DOWN', 'The admin console is shutting down'));
    if (this.inline) {
      try {
        return Promise.resolve(this.inline.answer(query));
      } catch (error) {
        return Promise.reject(error as Error);
      }
    }
    // A timed-out pass may still be running inside SQLite; never start a second one beside it.
    if (this.stopping)
      return Promise.reject(
        unavailable(
          'ROOM_INDEX_BUSY',
          'The last room count ran too long and is still stopping. Try again shortly.',
        ),
      );
    const worker = this.worker ?? this.start();
    clearTimeout(this.idle);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.retire(unavailable('ROOM_INDEX_TIMEOUT', 'Counting rooms took too long and was stopped')),
        this.options.timeoutMs ?? ROOM_INDEX_TIMEOUT_MS,
      );
      this.waiting.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...query } satisfies RoomIndexRequest);
    });
  }

  private start(): Worker {
    const worker = new Worker(WORKER, {
      workerData: {
        databasePath: this.options.databasePath,
        leaseMs: this.options.leaseMs,
        maxAgeMs: this.options.maxAgeMs ?? ROOM_INDEX_MAX_AGE_MS,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    // It never keeps the process alive; shutting down does not wait for it.
    worker.unref();
    worker.on('message', (reply: RoomIndexReply) => {
      const waiting = this.waiting.get(reply.id);
      if (!waiting) return;
      this.waiting.delete(reply.id);
      clearTimeout(waiting.timer);
      if (reply.ok) waiting.resolve(reply.result);
      else {
        serverErrors.record('admin', `Room index failed: ${reply.error}`);
        waiting.reject(unavailable('ROOM_INDEX_FAILED', `The room index failed: ${reply.error}`));
      }
      if (!this.waiting.size) this.rest(worker);
    });
    worker.on('error', (error) => {
      serverErrors.record('admin', 'Room index worker stopped', error);
      if (this.worker === worker)
        this.retire(unavailable('ROOM_INDEX_FAILED', 'The room index stopped unexpectedly'));
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.failAll(unavailable('ROOM_INDEX_FAILED', 'The room index stopped unexpectedly'));
    });
    this.worker = worker;
    return worker;
  }

  /** Once nobody has asked for a while, let the idle worker go. */
  private rest(worker: Worker): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.worker !== worker || this.waiting.size) return;
      this.worker = null;
      void worker.terminate().catch(() => undefined);
    }, this.options.idleMs ?? ROOM_INDEX_IDLE_MS);
    this.idle.unref();
  }

  /**
   * Give up on the current worker. A statement already running inside SQLite
   * cannot be interrupted from here, so the thread lives until it returns;
   * until then new questions are refused rather than starting a second pass.
   */
  private retire(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    clearTimeout(this.idle);
    this.failAll(error);
    if (!worker) return;
    const stopping: Promise<void> = worker
      .terminate()
      .catch(() => undefined)
      .then(() => {
        if (this.stopping === stopping) this.stopping = null;
      });
    this.stopping = stopping;
  }

  private failAll(error: Error): void {
    for (const [id, waiting] of this.waiting) {
      this.waiting.delete(id);
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
  }
}
