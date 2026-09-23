/**
 * The admin audit log: who did what to which thing, from where, when.
 *
 * Every change made through the admin console writes its row in the same
 * transaction as the change, so there is never a change without its record or
 * a record of a change that rolled back. Reading a game's private state (hands
 * and deck) is recorded too. Rows are append-only: triggers refuse updates and
 * deletes, so no code path in this process can rewrite history by accident.
 */
import type { DatabaseSync } from 'node:sqlite';

export type AuditEntry = {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  requestId: string;
};
export type AuditInput = Omit<AuditEntry, 'id'>;

export const AUDIT_PAGE_SIZE = 50;

/** Run `work` in one immediate transaction on the game database. Admin writes are rare and short. */
export function immediate<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export class AdminAudit {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT NOT NULL DEFAULT '{}',
        ip TEXT,
        request_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target, id);
      CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit
        BEGIN SELECT RAISE(ABORT, 'admin_audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete BEFORE DELETE ON admin_audit
        BEGIN SELECT RAISE(ABORT, 'admin_audit is append-only'); END;
    `);
  }

  /** Call inside the transaction that makes the change being recorded. */
  record(entry: AuditInput): number {
    const result = this.db
      .prepare(
        'INSERT INTO admin_audit(at, actor, action, target, detail, ip, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        Math.round(entry.at),
        entry.actor,
        entry.action,
        entry.target,
        JSON.stringify(entry.detail),
        entry.ip,
        entry.requestId,
      );
    return Number(result.lastInsertRowid);
  }

  /** Newest first, `AUDIT_PAGE_SIZE` at a time; `before` is the last id already shown. */
  list(options: { before?: number; target?: string } = {}): {
    entries: AuditEntry[];
    nextBefore: number | null;
  } {
    const rows = this.db
      .prepare(
        `SELECT id, at, actor, action, target, detail, ip, request_id AS requestId FROM admin_audit
         WHERE id < ? AND (? IS NULL OR target = ?) ORDER BY id DESC LIMIT ?`,
      )
      .all(
        options.before ?? Number.MAX_SAFE_INTEGER,
        options.target ?? null,
        options.target ?? null,
        AUDIT_PAGE_SIZE + 1,
      ) as (Omit<AuditEntry, 'detail'> & { detail: string })[];
    const entries = rows.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
      id: row.id,
      at: row.at,
      actor: row.actor,
      action: row.action,
      target: row.target,
      detail: JSON.parse(row.detail) as Record<string, unknown>,
      ip: row.ip,
      requestId: row.requestId,
    }));
    return {
      entries,
      nextBefore: rows.length > AUDIT_PAGE_SIZE ? (entries.at(-1)?.id ?? null) : null,
    };
  }
}
