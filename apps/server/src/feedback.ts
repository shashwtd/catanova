/**
 * Player feedback: POST /api/feedback on the public server, and the table the
 * admin inbox reads.
 *
 * With accounts configured, only a signed-in, registered, unexpired account
 * can send feedback, verified exactly as the /api/account routes verify it.
 * A local playtest server accepts it without an account. Either way it is
 * limited to five an hour per account and per address, and stored as plain
 * text that is only ever rendered as text.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { ProtocolError } from './store.js';
import type { Store } from './store.js';
import { accountFailure } from './accounts.js';
import type { AccountService } from './accounts.js';
import { RoomAccessLimit } from './room-access.js';
import { FeedbackError, parseFeedbackSubmission } from '../../../packages/protocol/src/feedback.js';
import type {
  FeedbackCategory,
  FeedbackContext,
  FeedbackSubmission,
} from '../../../packages/protocol/src/feedback.js';

export const FEEDBACK_PER_HOUR = 5;
export const FEEDBACK_BODY_LIMIT = 16 * 1024;
export const FEEDBACK_PAGE_SIZE = 50;

export type FeedbackStatus = 'new' | 'resolved';
export type FeedbackItem = {
  id: number;
  at: number;
  userId: string | null;
  username: string | null;
  category: FeedbackCategory;
  message: string;
  context: FeedbackContext | null;
  status: FeedbackStatus;
  resolvedAt: number | null;
  resolvedBy: string | null;
};

type Row = {
  id: number;
  at: number;
  user_id: string | null;
  username: string | null;
  category: FeedbackCategory;
  message: string;
  context: string | null;
  status: FeedbackStatus;
  resolved_at: number | null;
  resolved_by: string | null;
};

const item = (row: Row): FeedbackItem => ({
  id: row.id,
  at: row.at,
  userId: row.user_id,
  username: row.username,
  category: row.category,
  message: row.message,
  context: row.context ? (JSON.parse(row.context) as FeedbackContext) : null,
  status: row.status,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
});

export class FeedbackStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        user_id TEXT,
        username TEXT,
        category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
        message TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
        resolved_at INTEGER,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS feedback_status ON feedback(status, id);
      CREATE INDEX IF NOT EXISTS feedback_account ON feedback(user_id, id);
    `);
  }

  add(at: number, account: { id: string; username: string | null } | null, submission: FeedbackSubmission) {
    const result = this.db
      .prepare(
        'INSERT INTO feedback(at, user_id, username, category, message, context) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        at,
        account?.id ?? null,
        account?.username ?? null,
        submission.category,
        submission.message,
        submission.context ? JSON.stringify(submission.context) : null,
      );
    return Number(result.lastInsertRowid);
  }

  get(id: number): FeedbackItem | undefined {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Row | undefined;
    return row ? item(row) : undefined;
  }

  /** Newest first. `before` is the last id already shown. */
  list(options: { status?: FeedbackStatus; category?: FeedbackCategory; before?: number; userId?: string }) {
    const rows = this.db
      .prepare(
        `SELECT * FROM feedback WHERE id < ? AND (? IS NULL OR status = ?) AND (? IS NULL OR category = ?)
         AND (? IS NULL OR user_id = ?) ORDER BY id DESC LIMIT ?`,
      )
      .all(
        options.before ?? Number.MAX_SAFE_INTEGER,
        options.status ?? null,
        options.status ?? null,
        options.category ?? null,
        options.category ?? null,
        options.userId ?? null,
        options.userId ?? null,
        FEEDBACK_PAGE_SIZE + 1,
      ) as Row[];
    const items = rows.slice(0, FEEDBACK_PAGE_SIZE).map(item);
    const counts = Object.fromEntries(
      (
        this.db.prepare('SELECT status, count(*) AS n FROM feedback GROUP BY status').all() as {
          status: FeedbackStatus;
          n: number;
        }[]
      ).map((row) => [row.status, row.n]),
    );
    return {
      items,
      nextBefore: rows.length > FEEDBACK_PAGE_SIZE ? (items.at(-1)?.id ?? null) : null,
      counts: { new: counts.new ?? 0, resolved: counts.resolved ?? 0 },
    };
  }

  /** Call inside the transaction that audits it. */
  setStatus(id: number, resolved: boolean, actor: string, at: number): FeedbackItem | undefined {
    this.db
      .prepare('UPDATE feedback SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(resolved ? 'resolved' : 'new', resolved ? at : null, resolved ? actor : null, id);
    return this.get(id);
  }
}

class FeedbackRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ACCOUNT_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  ONBOARDING_REQUIRED: 403,
  GUEST_EXPIRED: 410,
  ACCOUNT_SETUP_REQUIRED: 503,
  ACCOUNT_UNAVAILABLE: 503,
};

export class PlayerFeedback {
  readonly feedback: FeedbackStore;
  private readonly byAccount = new RoomAccessLimit(FEEDBACK_PER_HOUR, 60 * 60_000);
  private readonly byAddress = new RoomAccessLimit(FEEDBACK_PER_HOUR, 60 * 60_000);

  constructor(
    private readonly options: {
      store: Store;
      /** Present when the server verifies accounts; absent in local playtest mode. */
      authenticated: boolean;
      accounts?: AccountService;
      now: () => number;
      clientAddress: (request: IncomingMessage) => string;
      allowedOrigins: string[];
    },
  ) {
    this.feedback = new FeedbackStore(options.store.db);
  }

  private limit(bucket: RoomAccessLimit, key: string, response: ServerResponse) {
    const access = bucket.consume(key, this.options.now());
    if (access.allowed) return;
    response.setHeader('Retry-After', String(access.retryAfter));
    throw new FeedbackRequestError(
      429,
      'FEEDBACK_RATE_LIMIT',
      'You have sent a lot of feedback. Try again later.',
    );
  }

  private async body(request: IncomingMessage): Promise<unknown> {
    const declared = request.headers['content-length'];
    if (declared !== undefined && Number(declared) > FEEDBACK_BODY_LIMIT)
      throw new FeedbackRequestError(413, 'FEEDBACK_TOO_LARGE', 'That message is too long');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > FEEDBACK_BODY_LIMIT)
        throw new FeedbackRequestError(413, 'FEEDBACK_TOO_LARGE', 'That message is too long');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new FeedbackRequestError(400, 'FEEDBACK_INVALID', 'Invalid feedback');
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new FeedbackRequestError(405, 'METHOD_NOT_ALLOWED', 'Send feedback with POST');
      }
      // JSON only: an HTML form on another site cannot send it without a preflight.
      if (!/^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i.test(request.headers['content-type'] ?? ''))
        throw new FeedbackRequestError(415, 'FEEDBACK_INVALID', 'Send feedback as JSON');
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (
        origin &&
        origin !== `http://${host}` &&
        origin !== `https://${host}` &&
        !this.options.allowedOrigins.includes(origin)
      )
        throw new FeedbackRequestError(403, 'FEEDBACK_ORIGIN', 'Feedback must come from the game');
      this.limit(this.byAddress, this.options.clientAddress(request), response);
      let account: { id: string; username: string | null } | null = null;
      if (this.options.authenticated) {
        const accounts = this.options.accounts;
        if (!accounts)
          throw new ProtocolError(
            'ACCOUNT_SETUP_REQUIRED',
            'Supabase accounts are not configured on this server',
          );
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        // The same checks as /api/account: Supabase verifies the token and returns only this caller.
        const verified = await accounts.get(token);
        const expiresAt = verified.expiresAt === null ? Infinity : Date.parse(verified.expiresAt);
        if (expiresAt <= this.options.now()) throw accountFailure('GUEST_EXPIRED');
        if (!verified.registered || !verified.profile) throw accountFailure('ONBOARDING_REQUIRED');
        this.limit(this.byAccount, verified.id, response);
        account = { id: verified.id, username: verified.username };
      }
      let submission: FeedbackSubmission;
      try {
        submission = parseFeedbackSubmission(await this.body(request));
      } catch (error) {
        if (error instanceof FeedbackError)
          throw new FeedbackRequestError(400, 'FEEDBACK_INVALID', error.message);
        throw error;
      }
      const id = this.feedback.add(this.options.now(), account, submission);
      response.writeHead(201).end(JSON.stringify({ id }));
    } catch (error) {
      const status =
        error instanceof FeedbackRequestError
          ? error.status
          : error instanceof ProtocolError
            ? (ACCOUNT_STATUS[error.code] ?? 400)
            : 500;
      const code =
        error instanceof FeedbackRequestError || error instanceof ProtocolError
          ? error.code
          : 'FEEDBACK_FAILED';
      if (status === 413) response.setHeader('Connection', 'close');
      if (status === 500) console.error('Could not save player feedback:', error);
      response.writeHead(status).end(
        JSON.stringify({
          code,
          error:
            error instanceof FeedbackRequestError || error instanceof ProtocolError
              ? error.message
              : 'Could not send your feedback. Try again.',
        }),
      );
    }
  }
}
