/**
 * The last few hundred server errors, kept in memory for the admin overview.
 *
 * Nothing here is persisted or sent anywhere. Errors reach it two ways: the
 * game server records storage failures it answers a player with, and, while
 * the admin listener runs, everything written to `console.error` is copied in
 * as well, so the turn clock, presence writes and anything added later show up
 * without each call site having to know about the admin console.
 */
import { format } from 'node:util';

export type ServerErrorEntry = {
  at: number;
  /** Where it was seen: `websocket`, `console`, `admin`, ... */
  source: string;
  message: string;
  stack?: string;
  /** Identical consecutive errors are folded into one entry. */
  count: number;
};

const MESSAGE_LIMIT = 600;
const STACK_LIMIT = 2400;

function describe(values: unknown[]): { message: string; stack?: string } {
  const error = values.find((value): value is Error => value instanceof Error);
  const text = values
    .map((value) => (value instanceof Error ? `${value.name}: ${value.message}` : format('%s', value)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    message: text.slice(0, MESSAGE_LIMIT) || 'Unknown error',
    ...(error?.stack ? { stack: error.stack.slice(0, STACK_LIMIT) } : {}),
  };
}

export class ErrorLog {
  private readonly entries: ServerErrorEntry[] = [];
  constructor(
    private readonly capacity = 200,
    private readonly now: () => number = Date.now,
  ) {}
  record(source: string, ...values: unknown[]): void {
    const { message, stack } = describe(values);
    const last = this.entries.at(-1);
    if (last && last.source === source && last.message === message) {
      last.count++;
      last.at = this.now();
      return;
    }
    this.entries.push({ at: this.now(), source, message, ...(stack ? { stack } : {}), count: 1 });
    if (this.entries.length > this.capacity) this.entries.shift();
  }
  /** Newest first. */
  list(): ServerErrorEntry[] {
    return this.entries.map((entry) => ({ ...entry })).reverse();
  }
}

/** One log per process, shared by the game server and the admin listener. */
export const serverErrors = new ErrorLog();

let captures = 0;
let original: typeof console.error | null = null;

/**
 * Copy `console.error` into the shared log until every returned release
 * function has been called. Nested captures share one wrapper.
 */
export function captureConsoleErrors(): () => void {
  if (captures++ === 0) {
    const write = console.error;
    original = write;
    console.error = (...values: unknown[]) => {
      try {
        serverErrors.record('console', ...values);
      } catch {
        /* Recording must never stop the original message from being written. */
      }
      write.apply(console, values);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--captures === 0 && original) {
      console.error = original;
      original = null;
    }
  };
}
