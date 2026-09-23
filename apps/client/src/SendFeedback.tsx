/**
 * "Send feedback", from the game menu and the player lobby.
 *
 * Three choices and a message, in the same parchment panel as Settings. The
 * technical details are on by default because they are what makes a bug
 * report useful, and the switch says exactly what they are. Nothing is sent
 * until the player presses Send, and nothing about their hand or the board is
 * ever included.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX,
  FeedbackError,
  parseFeedbackSubmission,
} from '../../../packages/protocol/src/feedback.js';
import type { FeedbackCategory, FeedbackContext } from '../../../packages/protocol/src/feedback.js';
import type { ConnectionStatus } from './connection.js';
import { GameLoader } from './GameLoader.js';
import { Check } from './GameIcons.js';

/** What the game knows at the moment the dialog opens. */
export type FeedbackDetails = {
  roomCode?: string | undefined;
  revision?: number | undefined;
  connection?: ConnectionStatus | undefined;
  lastError?: string | undefined;
};

/** The running build, named by its own content-hashed script file. */
export function clientBuild(url: string = import.meta.url): string {
  if (import.meta.env?.DEV) return 'development';
  try {
    return new URL(url).pathname.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function feedbackContext(
  details: FeedbackDetails,
  environment: { userAgent: string; width: number; height: number; pixelRatio: number } = {
    userAgent: navigator.userAgent,
    width: innerWidth,
    height: innerHeight,
    pixelRatio: devicePixelRatio,
  },
): FeedbackContext {
  return {
    ...(details.roomCode ? { roomCode: details.roomCode } : {}),
    ...(details.revision !== undefined ? { revision: details.revision } : {}),
    clientBuild: clientBuild(),
    userAgent: environment.userAgent,
    viewport: `${Math.round(environment.width)}x${Math.round(environment.height)} @${Math.round(environment.pixelRatio * 100) / 100}x`,
    ...(details.connection ? { connection: details.connection } : {}),
    ...(details.lastError ? { lastError: details.lastError } : {}),
  };
}

export async function sendFeedback(body: unknown, token?: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('Could not reach Catanova. Check your connection and try again.');
  }
  if (response.ok) return;
  const value = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(value?.error ?? 'Could not send your feedback. Try again.');
}

/** Remembers the most recent message shown, even after it is dismissed. */
export function useLastMessage(message: string): string | undefined {
  const [last, setLast] = useState<string>();
  useEffect(() => {
    if (message) setLast(message);
  }, [message]);
  return message || last;
}

export function SendFeedback({
  details,
  accessToken,
  onClose,
}: {
  details: FeedbackDetails;
  /** Supplies the account token when the server has accounts; absent in local play. */
  accessToken?: () => Promise<string | undefined>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [includeDetails, setIncludeDetails] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const base = useId().replaceAll(':', '');
  const field = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sent) closeButton.current?.focus();
    else field.current?.focus({ preventScroll: true });
  }, [sent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setError('');
    let body;
    try {
      body = parseFeedbackSubmission({
        category,
        message,
        context: includeDetails ? feedbackContext(details) : null,
      });
    } catch (problem) {
      setError(problem instanceof FeedbackError ? problem.message : 'Check your message and try again.');
      return;
    }
    setSending(true);
    try {
      await sendFeedback(body, accessToken ? await accessToken() : undefined);
      setSent(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not send your feedback. Try again.');
    } finally {
      setSending(false);
    }
  }

  if (sent)
    return (
      <div className="settings-content settings-menu feedback-form feedback-sent" role="status">
        <p className="feedback-thanks">
          <Check size={18} /> Thank you. Every message is read.
        </p>
        <div className="dialog-actions">
          <button ref={closeButton} type="button" className="gold-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  return (
    <form className="settings-content settings-menu feedback-form" onSubmit={(event) => void submit(event)}>
      <div className="settings-tabs feedback-kinds" role="radiogroup" aria-label="Kind of feedback">
        {FEEDBACK_CATEGORIES.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={category === kind}
            tabIndex={category === kind ? 0 : -1}
            className="settings-tab"
            onClick={() => setCategory(kind)}
            onKeyDown={(event) => {
              const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
                ? 1
                : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? -1
                  : 0;
              if (!step) return;
              event.preventDefault();
              const index = FEEDBACK_CATEGORIES.indexOf(category);
              const next =
                FEEDBACK_CATEGORIES[
                  (index + step + FEEDBACK_CATEGORIES.length) % FEEDBACK_CATEGORIES.length
                ]!;
              setCategory(next);
              (
                event.currentTarget.parentElement?.children[FEEDBACK_CATEGORIES.indexOf(next)] as HTMLElement
              )?.focus();
            }}
          >
            {FEEDBACK_CATEGORY_LABELS[kind]}
          </button>
        ))}
      </div>
      <div className="feedback-message">
        <textarea
          ref={field}
          id={`${base}-message`}
          value={message}
          maxLength={FEEDBACK_MESSAGE_MAX}
          rows={5}
          placeholder={
            category === 'bug'
              ? 'What happened, and what did you expect?'
              : category === 'idea'
                ? 'What would make Catanova better?'
                : 'What would you like to tell us?'
          }
          aria-label="Message"
          aria-describedby={`${base}-count`}
          onChange={(event) => {
            setMessage(event.target.value);
            setError('');
          }}
        />
        <span id={`${base}-count`} className="feedback-count">
          {message.length}/{FEEDBACK_MESSAGE_MAX}
        </span>
      </div>
      <section className="settings-privacy feedback-details" aria-labelledby={`${base}-details-label`}>
        <div className="settings-row-heading">
          <label id={`${base}-details-label`} htmlFor={`${base}-details`}>
            Include technical details
          </label>
          <label className="settings-switch">
            <span aria-hidden="true">{includeDetails ? 'On' : 'Off'}</span>
            <input
              id={`${base}-details`}
              type="checkbox"
              role="switch"
              aria-labelledby={`${base}-details-label`}
              aria-describedby={`${base}-details-caption`}
              checked={includeDetails}
              onChange={(event) => setIncludeDetails(event.target.checked)}
            />
          </label>
        </div>
        <p id={`${base}-details-caption`} className="settings-caption">
          Room code, game version, browser, screen size, connection and the last error shown. Never your
          cards.
        </p>
      </section>
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="dark-button" disabled={sending} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="gold-button" disabled={sending || !message.trim()}>
          {sending ? <GameLoader compact label="Sending…" /> : null}
          Send
        </button>
      </div>
    </form>
  );
}
