/**
 * Player feedback: what the in-game and lobby "Send feedback" dialog submits.
 *
 * The same parser runs in the browser, to explain a problem before sending,
 * and on the server, which trusts nothing it was sent. Technical details are
 * optional and limited to a fixed set of short fields; anything else is
 * dropped rather than stored.
 */
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  idea: 'Idea',
  other: 'Other',
};
export const FEEDBACK_MESSAGE_MAX = 2000;

/** Technical details a player can choose to attach. */
export type FeedbackContext = {
  roomCode?: string;
  revision?: number;
  clientBuild?: string;
  userAgent?: string;
  viewport?: string;
  connection?: string;
  lastError?: string;
};
export type FeedbackSubmission = {
  category: FeedbackCategory;
  message: string;
  context: FeedbackContext | null;
};

const CONTEXT_LIMITS: Record<Exclude<keyof FeedbackContext, 'revision'>, number> = {
  roomCode: 40,
  clientBuild: 120,
  userAgent: 400,
  viewport: 40,
  connection: 40,
  lastError: 300,
};

export class FeedbackError extends Error {}

/**
 * Control characters out, except the newlines and tabs a message may use, and
 * bidirectional overrides, which can make text read differently from what it says.
 */
const clean = (value: string, multiline: boolean) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(
      multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g,
      multiline ? '' : ' ',
    )
    .trim();

export function parseFeedbackContext(value: unknown): FeedbackContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new FeedbackError('Invalid technical details');
  const input = value as Record<string, unknown>;
  const context: FeedbackContext = {};
  for (const [key, limit] of Object.entries(CONTEXT_LIMITS) as [keyof typeof CONTEXT_LIMITS, number][]) {
    const field = input[key];
    if (typeof field !== 'string') continue;
    const text = clean(field, false).slice(0, limit);
    if (text) context[key] = text;
  }
  if (Number.isSafeInteger(input.revision) && (input.revision as number) >= 0)
    context.revision = input.revision as number;
  return Object.keys(context).length ? context : null;
}

export function parseFeedbackSubmission(value: unknown): FeedbackSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FeedbackError('Invalid feedback');
  const input = value as Record<string, unknown>;
  if (!FEEDBACK_CATEGORIES.includes(input.category as FeedbackCategory))
    throw new FeedbackError('Choose Bug, Idea or Other');
  if (typeof input.message !== 'string') throw new FeedbackError('Write a message');
  const message = clean(input.message, true);
  if (!message) throw new FeedbackError('Write a message');
  if (message.length > FEEDBACK_MESSAGE_MAX)
    throw new FeedbackError(`Keep it under ${FEEDBACK_MESSAGE_MAX} characters`);
  return {
    category: input.category as FeedbackCategory,
    message,
    context: parseFeedbackContext(input.context),
  };
}
