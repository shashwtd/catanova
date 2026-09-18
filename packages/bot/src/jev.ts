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

export class JevUnavailable extends Error {}

export type JevClient = {
  /** The model build in use, for logs and the bot status line. */
  readonly model: string;
  evaluate(state: unknown, questions: Record<string, Question>): Promise<Evaluation>;
};

export function createJevClient(
  options: { route?: Route | null; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): JevClient | null {
  const chosen = options.route === undefined ? route() : options.route;
  if (!chosen) return null;
  const timeoutMs = options.timeoutMs ?? 8000;
  const doFetch = options.fetchImpl ?? fetch;

  return {
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
      for (const [id, raw] of Object.entries((payload?.answers ?? {}) as Record<string, any>)) {
        const probabilities = (raw.probabilities ?? {}) as Record<string, number>;
        if (raw.type === 'choice')
          answers[id] = {
            type: 'choice',
            choice: String(raw.choice),
            probabilities,
            confidence: confidenceOf(probabilities),
          };
        else if (raw.type === 'score')
          answers[id] = {
            type: 'score',
            score: Number(raw.score),
            probabilities,
            confidence: confidenceOf(probabilities),
          };
        else {
          const probability = Number(raw.noul);
          answers[id] = { type: 'noul', probability, confidence: confidenceOf(undefined, probability) };
        }
      }
      for (const id of Object.keys(questions))
        if (!answers[id]) throw new JevUnavailable(`no answer for "${id}"`);

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
  };
}
