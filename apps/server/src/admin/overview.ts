/**
 * Live operations at a glance: the process, its sockets and rooms, the
 * database and its disk, the host's backup and watchdog reports, and recent
 * errors. What runs on the game's thread is cheap enough to read every ten
 * seconds: PRAGMAs, file sizes and a few primary-key lookups. Anything that
 * grows with the database (room counts, journal rows) comes from the room
 * index's worker, and the page still loads if that is unavailable.
 */
import { readFile, stat, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AdminContext } from './api.js';
import type { RoomIndex, RoomSummary } from './room-index.js';
import { serverErrors } from './errors.js';
import type { RuntimeMetrics } from './metrics.js';
import type { AdminOverview, StatusFile } from './types.js';

const STATUS_FILE_LIMIT = 64 * 1024;

/** A JSON report the host's scripts leave for us. Missing means "not configured". */
export async function readStatusFile(directory: string, name: string): Promise<StatusFile> {
  const path = join(directory, name);
  let modifiedAt: number | null = null;
  try {
    const info = await stat(path);
    if (!info.isFile()) return { state: 'invalid', error: 'Not a file', modifiedAt: null };
    modifiedAt = info.mtimeMs;
    if (info.size > STATUS_FILE_LIMIT) return { state: 'invalid', error: 'File is too large', modifiedAt };
    const data: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { state: 'invalid', error: 'Expected a JSON object', modifiedAt };
    return { state: 'ok', modifiedAt, data: data as Record<string, unknown> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return {
      state: 'invalid',
      error: error instanceof SyntaxError ? 'Not valid JSON' : 'Could not be read',
      modifiedAt,
    };
  }
}

async function size(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function overview(
  context: AdminContext,
  metrics: RuntimeMetrics,
  index: RoomIndex,
): Promise<AdminOverview> {
  const { store, runtime, config } = context;
  const now = context.now();
  let summary: RoomSummary | null = null;
  let indexError = '';
  try {
    summary = await index.summary(now);
  } catch (error) {
    indexError = error instanceof Error ? error.message : 'Unavailable';
  }
  const sockets = runtime.sockets();
  // Distinct people behind the open seats: accounts where there are accounts, seats otherwise.
  const account = store.db.prepare('SELECT user_id FROM seats WHERE id = ?');
  const people = new Set(sockets.seats.map((seat) => (account.get(seat)?.user_id as string | null) ?? seat));
  const pragma = (name: string) =>
    Number(Object.values(store.db.prepare(`PRAGMA ${name}`).get() ?? {})[0] ?? 0);
  const file = context.databasePath === ':memory:' ? null : resolve(context.databasePath);
  let disk: AdminOverview['disk'];
  const diskPath = file ? dirname(file) : process.cwd();
  try {
    const info = await statfs(diskPath);
    disk = { path: diskPath, freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize };
  } catch (error) {
    disk = { path: diskPath, error: error instanceof Error ? error.message : 'Unavailable' };
  }
  const memory = process.memoryUsage();
  return {
    now,
    revision: config.revision,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      pid: process.pid,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
    },
    load: metrics.snapshot(),
    sockets: {
      total: sockets.total,
      players: sockets.players,
      spectators: sockets.spectators,
      pending: Math.max(0, sockets.total - sockets.players - sockets.spectators),
    },
    rooms: summary
      ? {
          lobbies: summary.counts.lobby,
          live: summary.counts.live,
          paused: summary.counts.paused,
          finished: summary.counts.finished,
          empty: summary.counts.empty,
          total: summary.total,
          countedAt: summary.indexedAt,
        }
      : { error: indexError },
    players: { connectedSeats: sockets.seats.length, distinctPlayers: people.size },
    bots: {
      seatsInLiveGames: summary?.liveBotSeats ?? null,
      // Rows exist only while a bot is holding a seat, so this stays small.
      standIns: store.db.prepare('SELECT count(*) AS n FROM seat_standins').get()!.n as number,
    },
    database: {
      path: file ?? ':memory:',
      fileBytes: file ? await size(file) : null,
      walBytes: file ? await size(`${file}-wal`) : null,
      shmBytes: file ? await size(`${file}-shm`) : null,
      pageCount: pragma('page_count'),
      pageSize: pragma('page_size'),
      freelistPages: pragma('freelist_count'),
      journalRows: summary?.journalRows ?? null,
    },
    disk,
    status: {
      directory: config.statusDir,
      backup: await readStatusFile(config.statusDir, 'backup.json'),
      watchdog: await readStatusFile(config.statusDir, 'watchdog.json'),
    },
    errors: serverErrors.list(),
    rejections: context.rejections(),
  };
}
