/**
 * Table chat: short text messages between the people at a table.
 *
 * Chat changes no game state, so like a reaction it carries no command id and
 * no revision. Unlike a reaction it is worth keeping: the server numbers each
 * message within its room, keeps the recent ones with the room, and replays
 * them to anyone who joins, reconnects or reloads, so a dropped socket or a
 * deploy never loses the conversation. A message carries an id the sending
 * tab made up, so a message resent after a reconnect is stored once.
 *
 * Bots never chat. Spectators read the table's chat but do not write in it.
 */

/** The longest message, in characters, after cleaning. */
export const CHAT_MAX_LENGTH = 200;
/** How many recent messages a room keeps and replays. */
export const CHAT_HISTORY = 100;
/**
 * A quick exchange is fine; a stream is not: five messages in a row, then a
 * short wait until the first of them is ten seconds old.
 */
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 10_000;

export type ChatEntry = {
  /** Order within the room, from 1. */
  id: number;
  playerId: string;
  /** The sender's table name when they wrote it. */
  name: string;
  text: string;
  /** Server time, in milliseconds. */
  at: number;
  /** The sending tab's own id for the message, so it can match its echo. */
  clientId?: string;
};

/**
 * A message as it may be stored and shown: Unicode-normalised, control and
 * formatting characters removed (no hidden text, no bidirectional tricks), runs
 * of whitespace collapsed to one space, trimmed, and cut to the limit without
 * splitting a character. Empty means there is nothing to send.
 */
export function cleanChatText(raw: string): string {
  const text = raw
    .normalize('NFC')
    // Controls, format characters (bidirectional overrides, zero-width joiners
    // used to hide text), line and paragraph separators.
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...text].slice(0, CHAT_MAX_LENGTH).join('').trim();
}

/** A tab's id for a message: short, plain, and unguessable enough to keep apart. */
export const isChatClientId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{6,40}$/.test(value);

/**
 * How long until one more message is allowed, given when the previous ones were
 * sent: 0 when it can go now. Times ahead of `now` are left out, so a clock
 * that jumped back cannot hold anyone. The server holds the authoritative copy;
 * the chat box uses the same rule to say how long to wait.
 */
export function chatWaitMs(sentAt: readonly number[], now: number): number {
  const recent = sentAt.filter((time) => time <= now && now - time < CHAT_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < CHAT_BURST) return 0;
  return recent[recent.length - CHAT_BURST]! + CHAT_WINDOW_MS - now;
}
