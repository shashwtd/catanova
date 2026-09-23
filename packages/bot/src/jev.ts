/**
 * A minimal client for TypeSafe AI's Jev, the decision model the bots think with.
 *
 * Jev does not write text. It takes a state plus typed questions and returns a
 * chosen option, an ordered score, or a probability, each with a distribution.
 * Every question here is answered from options this codebase computed, so a bot
 * can never invent a move that the rules did not offer.
 *
 * Calls go straight to TypeSafe's own API. Gateways resell the same model, but
 * a direct account is the one that holds the credits and the only one that can
 * be held to a rate limit we can read, so there is deliberately no fallback: if
 * the service is unreachable the bots play from their own heuristics instead.
 */

export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';

export type Entry = string | number | Record<string, unknown> | unknown[] | null;
export type Question =
  | { type: 'choice'; instructions: Entry; criteria: Record<string, Entry> }
  | { type: 'score'; instructions: Entry; criteria: Entry[] }
  | { type: 'noul'; instructions: Entry; criteria?: { true?: Entry; false?: Entry } };

export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; probability: number; confidence: number };

export type Evaluation = {
  answers: Record<string, Answer>;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
  model: string;
};

export const choice = (instructions: Entry, criteria: Record<string, Entry>): Question => ({
  type: 'choice',
  instructions,
  criteria,
});
export const score = (instructions: Entry, criteria: Entry[]): Question => ({
  type: 'score',
  instructions,
  criteria,
});
export const noul = (instructions: Entry, criteria?: { true?: Entry; false?: Entry }): Question => ({
  type: 'noul',
  instructions,
  ...(criteria ? { criteria } : {}),
});

type Route = { url: string; model: string; key: string };

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';

/**
 * Resolve the route from the environment. `CATANOVA_BOT_MODEL` pins a build,
 * which is worth doing in production because the `-latest` alias moves.
 */
export function route(env: NodeJS.ProcessEnv = process.env): Route | null {
  const key = env.TYPESAFE_API_KEY;
  if (!key) return null;
  return { url: env.TYPESAFE_BASE_URL ?? ENDPOINT, model: env.CATANOVA_BOT_MODEL ?? DEFAULT_MODEL, key };
}

/** Confidence computed here rather than read from the provider, so both routes
 *  are comparable: the gap between the top two options, or distance from a coin
 *  flip for a yes/no. */
function confidenceOf(probabilities: Record<string, number> | undefined, probability?: number): number {
  if (probability !== undefined) return Math.abs(probability - 0.5) * 2;
  const ordered = Object.values(probabilities ?? {}).sort((a, b) => b - a);
  return Math.max(0, Math.min(1, (ordered[0] ?? 0) - (ordered[1] ?? 0)));
}

/**
 * One answer off the wire, or null when it is not one.
 *
 * The reply comes from another company's service, so it is read as untrusted
 * data: a null where an answer should be, a missing choice or a probability
 * that is not a number is no answer at all. Reading it any other way turned a
 * bad reply into a TypeError, which the bots treat as a bug rather than as the
 * service being unavailable, so the seat stopped moving instead of playing on.
 */
function readAnswer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;
  const probabilities = (
    answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {}
  ) as Record<string, number>;
  if (answer.type === 'choice') {
    if (typeof answer.choice !== 'string' && typeof answer.choice !== 'number') return null;
    return {
      type: 'choice',
      choice: String(answer.choice),
      probabilities,
      confidence: confidenceOf(probabilities),
    };
  }
  if (answer.type === 'score') {
    if (typeof answer.score !== 'number' || !Number.isFinite(answer.score)) return null;
    return { type: 'score', score: answer.score, probabilities, confidence: confidenceOf(probabilities) };
  }
  // Anything else is read as a yes/no, as it always has been, but only when it
  // carries a probability that is actually a number.
  if (typeof answer.noul !== 'number' || !Number.isFinite(answer.noul)) return null;
  return { type: 'noul', probability: answer.noul, confidence: confidenceOf(undefined, answer.noul) };
}

export class JevUnavailable extends Error {}

export type JevClient = {
  /** The model build in use, for logs and the bot status line. */
  readonly model: string;
  evaluate(state: unknown, questions: Record<string, Question>): Promise<Evaluation>;
};

export function createJevClient(
  options: {
    route?: Route | null;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Injectable so tests can move through the breaker's rest. */
    now?: () => number;
  } = {},
): JevClient | null {
  const chosen = options.route === undefined ? route() : options.route;
  if (!chosen) return null;
  const timeoutMs = options.timeoutMs ?? 8000;
  const doFetch = options.fetchImpl ?? fetch;

  return withBreaker(options.now ?? Date.now, {
    model: chosen.model,
    async evaluate(state, questions) {
      const headers = {
        Authorization: `Bearer ${chosen.key}`,
        'Content-Type': 'application/json',
      };
      const body = { state, model: chosen.model, questions };

      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let payload: any;
      try {
        const res = await doFetch(chosen.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) throw new JevUnavailable(`decision service returned ${res.status}`);
        payload = await res.json();
      } catch (cause) {
        throw cause instanceof JevUnavailable
          ? cause
          : new JevUnavailable(cause instanceof Error ? cause.message : 'decision service unreachable');
      } finally {
        clearTimeout(timer);
      }

      const answers: Record<string, Answer> = {};
      const replied = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};
      for (const id of Object.keys(questions)) {
        const answer = readAnswer(Object.hasOwn(replied, id) ? replied[id] : null);
        if (!answer) throw new JevUnavailable(`no answer for "${id}"`);
        answers[id] = answer;
      }

      // TypeSafe bills input tokens only and does not return a cost, so it is
      // computed here at the published rate.
      const inputTokens = Number(payload?.usage?.input_tokens ?? 0);
      return {
        answers,
        inputTokens,
        costUsd: (inputTokens / 1e6) * 0.042,
        latencyMs: Date.now() - started,
        model: String(payload?.model ?? chosen.model),
      };
    },
  });
}

/** Failures in a row before the client stops asking, and for how long. */
const BREAKER = { failures: 3, restMs: 60_000 } as const;

/**
 * Stop asking a service that has stopped answering.
 *
 * A request to a service that hangs holds the bot's move for the whole
 * timeout, and in an outage every decision that needed judgement paid it:
 * eight seconds at a time, well over a hundred times in a game of four bots.
 * So after a few failures in a row this fails at once, without a request, and
 * the bots play from their own judgement at full speed. When the rest is over
 * one request is let through to see whether the service is back: a success
 * opens it up again, another failure starts another rest.
 *
 * The count is shared by every seat the client serves, which on the server is
 * every bot, so one table finding the service down spares all the others.
 */
function withBreaker(now: () => number, client: JevClient): JevClient {
  let failures = 0;
  let restingUntil = 0;
  let probing = false;
  return {
    model: client.model,
    async evaluate(state, questions) {
      const tripped = failures >= BREAKER.failures;
      if (tripped && (probing || now() < restingUntil))
        throw new JevUnavailable(`decision service skipped after ${failures} failures in a row`);
      if (tripped) probing = true;
      try {
        const evaluation = await client.evaluate(state, questions);
        failures = 0;
        return evaluation;
      } catch (error) {
        if (error instanceof JevUnavailable && ++failures >= BREAKER.failures)
          restingUntil = now() + BREAKER.restMs;
        throw error;
      } finally {
        if (tripped) probing = false;
      }
    },
  };
}
