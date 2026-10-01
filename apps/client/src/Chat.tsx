/**
 * Table chat: a button in the game tools, a panel with the conversation, and a
 * glimpse of a new message beside the button while the panel is closed.
 *
 * The server numbers every message within the room and replays the recent ones
 * on every welcome, so this tab keeps what it has been told by id, in order,
 * and merges a replay rather than replacing what it shows. Its own messages
 * show at once, faintly, until the server's echo confirms them.
 *
 * Text is shown as text: React escapes it, nothing in it becomes a link, and
 * the protocol has already removed control and invisible characters.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { CHAT_HISTORY, CHAT_MAX_LENGTH, chatWaitMs, cleanChatText } from '../../../packages/protocol/src/chat.js';
import type { ChatEntry } from '../../../packages/protocol/src/chat.js';
import { GameIcon } from './GameIcons.js';

/** How long a new message stays beside the closed chat button. */
const GLIMPSE_MS = 5000;

type Unconfirmed = { clientId: string; text: string; at: number };
export type ChatLine = ChatEntry & { pending?: boolean };

/** The table's conversation as this tab knows it, and what is new since the panel was last open. */
export function useTableChat(me: string | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<Unconfirmed[]>([]);
  const [unread, setUnread] = useState(0);
  const [glimpse, setGlimpse] = useState<ChatEntry | null>(null);
  const open = useRef(false);
  const sentAt = useRef<number[]>([]);
  /** Ids already shown, so a replay or a repeated echo is never news. */
  const seen = useRef(new Set<number>());
  const meRef = useRef(me);
  meRef.current = me;

  const merge = useCallback((incoming: ChatEntry[]) => {
    for (const entry of incoming) seen.current.add(entry.id);
    setEntries((known) => {
      const byId = new Map(known.map((entry) => [entry.id, entry]));
      for (const entry of incoming) byId.set(entry.id, entry);
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY * 2);
    });
    const confirmed = new Set(incoming.map((entry) => entry.clientId).filter(Boolean));
    setUnconfirmed((list) => list.filter((line) => !confirmed.has(line.clientId)));
  }, []);

  /** One new message from the server. */
  const receive = useCallback(
    (entry: ChatEntry) => {
      const fresh = !seen.current.has(entry.id);
      merge([entry]);
      if (fresh && entry.playerId !== meRef.current && !open.current) {
        setUnread((n) => n + 1);
        setGlimpse(entry);
      }
    },
    [merge],
  );

  /** The recent messages, replayed after a (re)connect: merged, never counted as new. */
  const replay = useCallback((history: ChatEntry[]) => merge(history), [merge]);

  /** This tab sent a message: show it at once, faintly, until its echo arrives. */
  const sent = useCallback((clientId: string, text: string) => {
    const at = Date.now();
    sentAt.current = [...sentAt.current.filter((t) => at - t < 60_000), at];
    setUnconfirmed((list) => [...list, { clientId, text, at }]);
  }, []);

  const setOpen = useCallback((value: boolean) => {
    open.current = value;
    if (value) {
      setUnread(0);
      setGlimpse(null);
    }
  }, []);

  useEffect(() => {
    if (!glimpse) return;
    const timer = window.setTimeout(() => setGlimpse(null), GLIMPSE_MS);
    return () => window.clearTimeout(timer);
  }, [glimpse]);

  const lines = useMemo<ChatLine[]>(
    () => [
      ...entries,
      ...unconfirmed.map((line, i) => ({
        id: Number.MAX_SAFE_INTEGER - unconfirmed.length + i,
        playerId: me ?? '',
        name: '',
        text: line.text,
        at: line.at,
        clientId: line.clientId,
        pending: true,
      })),
    ],
    [entries, unconfirmed, me],
  );

  return {
    lines,
    unread,
    glimpse,
    receive,
    replay,
    sent,
    setOpen,
    /** Milliseconds until another message may go, by the server's own rule. */
    waitMs: () => chatWaitMs(sentAt.current, Date.now()),
  };
}

/** The chat button for the game tools, with its unread count and the glimpse of a new message. */
export function ChatButton({
  open,
  unread,
  glimpse,
  colors,
  onToggle,
}: {
  open: boolean;
  unread: number;
  glimpse: ChatEntry | null;
  colors: Record<string, string>;
  onToggle: () => void;
}) {
  const label = unread ? `Table chat, ${unread} new` : 'Table chat';
  return (
    <div className="chat-tool">
      <button
        className="icon-button chat-trigger"
        data-game-tool="chat"
        aria-label={label}
        title={label}
        aria-pressed={open}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <GameIcon name="chat" />
        {unread > 0 && (
          <span className="chat-unread" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {glimpse && !open && (
        <button
          type="button"
          className="chat-glimpse"
          onClick={onToggle}
          aria-label={`Open chat. ${glimpse.name}: ${glimpse.text}`}
        >
          <strong style={{ '--who': colors[glimpse.playerId] } as CSSProperties}>{glimpse.name}</strong>
          <span>{glimpse.text}</span>
        </button>
      )}
    </div>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The conversation and the box to add to it. Keeps itself scrolled to the
 * newest message unless the reader has scrolled up to read earlier ones.
 */
export function ChatLog({
  lines,
  me,
  myName,
  colors,
  canWrite,
  connected,
  waitMs,
  onSend,
}: {
  lines: ChatLine[];
  me: string | null;
  myName: string;
  colors: Record<string, string>;
  /** False for a spectator: they read the table's chat but do not write in it. */
  canWrite: boolean;
  connected: boolean;
  waitMs: () => number;
  onSend: (text: string) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  const [draft, setDraft] = useState('');
  const [hold, setHold] = useState(0);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    if (canWrite) input.current?.focus({ preventScroll: true });
  }, [canWrite]);

  useEffect(() => {
    if (hold <= 0) return;
    const timer = window.setTimeout(() => setHold(Math.max(0, waitMs())), Math.min(hold, 1000));
    return () => window.clearTimeout(timer);
  }, [hold, waitMs]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = cleanChatText(draft);
    if (!text || !connected) return;
    const wait = waitMs();
    if (wait > 0) {
      setHold(wait);
      return;
    }
    onSend(text);
    setDraft('');
    pinned.current = true;
  };

  const left = CHAT_MAX_LENGTH - [...draft].length;
  return (
    <div className="table-chat">
      <ol
        ref={list}
        className="chat-lines"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        {lines.length === 0 && (
          <li className="chat-empty">
            {canWrite ? 'Say hello to the table.' : 'Nobody has said anything yet.'}
          </li>
        )}
        {lines.map((line) => {
          const mine = line.playerId === me;
          return (
            <li
              key={line.pending ? `pending-${line.clientId}` : line.id}
              className={`chat-line${mine ? ' is-mine' : ''}${line.pending ? ' is-pending' : ''}`}
              title={line.pending ? 'Sending…' : time(line.at)}
            >
              <strong style={{ '--who': colors[line.playerId] } as CSSProperties}>{mine ? myName || 'You' : line.name}</strong>
              <span className="chat-text">{line.text}</span>
            </li>
          );
        })}
      </ol>
      {canWrite ? (
        <form className="chat-compose" onSubmit={submit}>
          <input
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_MAX_LENGTH * 2}
            placeholder={connected ? 'Message the table' : 'Reconnecting…'}
            aria-label="Message the table"
            enterKeyHint="send"
            autoComplete="off"
            disabled={!connected}
          />
          <button type="submit" className="chat-send" disabled={!connected || !cleanChatText(draft) || left < 0}>
            Send
          </button>
          {(left <= 20 || hold > 0) && (
            <p className="chat-note" role="status">
              {hold > 0 ? `Slow down a moment (${Math.ceil(hold / 1000)}s)` : `${left} left`}
            </p>
          )}
        </form>
      ) : (
        <p className="chat-note chat-readonly">Watching: only players write here.</p>
      )}
    </div>
  );
}
