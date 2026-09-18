/**
 * A minimal client for TypeSafe AI's Jev, the decision model the bots think with.
 *
 * Jev does not write text. It takes a state plus typed questions and returns a
 * chosen option, an ordered score, or a probability, each with a distribution.
 * Every question here is answered from options this codebase computed, so a bot
 * can never invent a move that the rules did not offer.
 *
 * Two routes are supported because their dialects differ: OpenRouter and
 * TypeSafe call the yes/no primitive `noul`, Vercel renames it `boolean` and
 * carries the model id in a header. Questions are written once in the neutral
 * dialect and translated on the way out.
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

type Route = { url: string; model: string; key: string; boolean: boolean; header: boolean };

/** Resolve a route from the environment. OpenRouter is the default: it reports the
 *  exact model build and, unlike the Vercel free tier, did not rate-limit us. */
export function route(env: NodeJS.ProcessEnv = process.env): Route | null {
  if (env.OPENROUTER_API_KEY)
    return {
      url: 'https://openrouter.ai/api/alpha/decisions',
      model: env.CATANOVA_BOT_MODEL ?? '~typesafe/jev-latest',
      key: env.OPENROUTER_API_KEY,
      boolean: false,
      header: false,
    };
  if (env.AI_GATEWAY_API_KEY)
    return {
      url: 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model',
      model: env.CATANOVA_BOT_MODEL ?? 'typesafe-ai/jev',
      key: env.AI_GATEWAY_API_KEY,
      boolean: true,
      header: true,
    };
  return null;
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
    async evaluate(state, questions) {
      const translated: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(questions))
        translated[id] = q.type === 'noul' && chosen.boolean ? { ...q, type: 'boolean' } : q;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${chosen.key}`,
        'Content-Type': 'application/json',
      };
      if (chosen.header)
        Object.assign(headers, {
          'ai-gateway-protocol-version': '0.0.1',
          'ai-gateway-auth-method': 'api-key',
          'ai-evaluation-model-specification-version': '4',
          'ai-model-id': chosen.model,
        });
      const body: Record<string, unknown> = { state, questions: translated };
      if (!chosen.header) body.model = chosen.model;

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
          const probability = Number(raw.probability ?? raw.noul);
          answers[id] = { type: 'noul', probability, confidence: confidenceOf(undefined, probability) };
        }
      }
      for (const id of Object.keys(questions))
        if (!answers[id]) throw new JevUnavailable(`no answer for "${id}"`);

      const usage = payload?.usage ?? {};
      const inputTokens = Number(usage.inputTokens ?? usage.input_tokens ?? 0);
      return {
        answers,
        inputTokens,
        costUsd: Number(usage.cost ?? (inputTokens / 1e6) * 0.042),
        latencyMs: Date.now() - started,
        model: String(payload?.model ?? chosen.model),
      };
    },
  };
}
