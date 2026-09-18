/**
 * A minimal client for TypeSafe AI's Jev, the decision model the bots think with.
 *
 * Jev does not write text. It takes a state plus typed questions and returns a
 * chosen option, an ordered score, or a probability, each with a distribution.
 * Every question here is answered from options this codebase computed, so a bot
 * can never invent a move that the rules did not offer.
 *
 * Three routes reach the same model and their dialects differ: TypeSafe's own
 * API and OpenRouter call the yes/no primitive `noul`, while Vercel renames it
 * `boolean` and carries the model id in a header. Questions are written once in
 * the neutral dialect and translated on the way out. TypeSafe is preferred
 * because it is the most direct path, with no gateway in between.
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

export type RouteName = 'typesafe' | 'openrouter' | 'vercel';
type Route = {
  name: RouteName;
  url: string;
  model: string;
  key: string;
  boolean: boolean;
  header: boolean;
};

/** The same model, reachable three ways. Only the dialect differs: Vercel
 *  renames the yes/no primitive `boolean` and puts the model id in a header,
 *  while TypeSafe and OpenRouter use `noul` and carry it in the body. */
const ROUTES: Record<
  RouteName,
  { env: string; url: string; model: string; boolean: boolean; header: boolean }
> = {
  // TypeSafe's own API. The most direct path, with no gateway in between.
  typesafe: {
    env: 'TYPESAFE_API_KEY',
    url: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    boolean: false,
    header: false,
  },
  openrouter: {
    env: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/alpha/decisions',
    model: '~typesafe/jev-latest',
    boolean: false,
    header: false,
  },
  vercel: {
    env: 'AI_GATEWAY_API_KEY',
    url: 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model',
    model: 'typesafe-ai/jev',
    boolean: true,
    header: true,
  },
};

const ORDER: RouteName[] = ['typesafe', 'openrouter', 'vercel'];

/**
 * Resolve a route from the environment, preferring TypeSafe's own API and
 * falling back to a gateway. `CATANOVA_BOT_ROUTE` forces one when more than one
 * key is present; `CATANOVA_BOT_MODEL` pins a build, which is worth doing in
 * production because the `-latest` aliases move.
 */
export function route(env: NodeJS.ProcessEnv = process.env): Route | null {
  const forced = env.CATANOVA_BOT_ROUTE as RouteName | undefined;
  const names = forced && forced in ROUTES ? [forced] : ORDER;
  for (const name of names) {
    const spec = ROUTES[name];
    const key = env[spec.env];
    if (key)
      return {
        name,
        url: spec.url,
        model: env.CATANOVA_BOT_MODEL ?? spec.model,
        key,
        ...{ boolean: spec.boolean, header: spec.header },
      };
  }
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
  /** Which route is in use, for logs and the bot status line. */
  readonly route: RouteName;
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
    route: chosen.name,
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
