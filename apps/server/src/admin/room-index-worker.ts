/**
 * The room index's thread (see room-index.ts): its own read-only connection,
 * answering one question at a time from a pass at most a few seconds old.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { RoomIndexCache } from './room-index.js';
import type { RoomIndexReply, RoomIndexRequest } from './room-index.js';

const { databasePath, leaseMs, maxAgeMs } = workerData as {
  databasePath: string;
  leaseMs: number;
  maxAgeMs: number;
};
const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
db.exec('PRAGMA query_only = ON');
const cache = new RoomIndexCache(db, {
  leaseMs,
  maxAgeMs,
  // One snapshot per pass, so its counts agree. In WAL mode it never blocks the game's writes.
  read: (work) => {
    db.exec('BEGIN');
    try {
      return work();
    } finally {
      db.exec('COMMIT');
    }
  },
});

parentPort!.on('message', (message: RoomIndexRequest) => {
  if (message.kind === 'invalidate') return cache.invalidate();
  let reply: RoomIndexReply;
  try {
    reply = { id: message.id, ok: true, result: cache.answer(message) };
  } catch (error) {
    reply = { id: message.id, ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
  parentPort!.postMessage(reply);
});
