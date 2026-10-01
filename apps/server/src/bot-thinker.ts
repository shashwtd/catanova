/**
 * Where bot thinking happens: on the main thread, or in a worker.
 *
 * Tests and tools think inline, which is simple and deterministic. The server
 * thinks in a worker thread (`bot-worker.ts`), so a Champion's search never
 * holds the sockets of every other room while it runs. The two are
 * interchangeable: the same context goes in, the same decision comes out.
 *
 * A worker that dies is replaced on the next request, and a request that takes
 * far too long is abandoned, which the bot driver treats like any other failed
 * decision: it retries, and after three failures makes the required move.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { decide, respond } from '../../../packages/bot/src/index.js';
import type { DecideContext, Decision, JevClient, Mind } from '../../../packages/bot/src/index.js';

export type Answer = Awaited<ReturnType<typeof respond>>;

export type BotThinker = {
  decide(ctx: DecideContext): Promise<Decision>;
  respond(ctx: DecideContext): Promise<Answer>;
  close(): void;
};

/** Thinking on the calling thread, with the given decision function (tests inject their own). */
export function inlineThinker(decideWith: typeof decide = decide): BotThinker {
  return { decide: (ctx) => decideWith(ctx), respond: (ctx) => respond(ctx), close: () => {} };
}

/** How long one decision may take in the worker before it is given up. */
const WORKER_TIMEOUT_MS = 20_000;

/**
 * Thinking in a worker thread. The decision service client lives in the worker
 * (it reads the same environment), so the `jev` in a context is not sent.
 */
export function workerThinker(): BotThinker {
  // Compiled, the worker is a .js file beside this one; run from source, it is the .ts.
  const compiled = new URL('./bot-worker.js', import.meta.url);
  const entry = existsSync(fileURLToPath(compiled)) ? compiled : new URL('./bot-worker.ts', import.meta.url);
  let worker: Worker | null = null;
  let next = 1;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const fail = (error: Error) => {
    for (const [id, w] of waiting) {
      clearTimeout(w.timer);
      w.reject(error);
      waiting.delete(id);
    }
    worker = null;
  };
  const start = () => {
    const w = new Worker(entry);
    w.unref();
    w.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    w.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
    w.on('exit', () => fail(new Error('bot worker stopped')));
    return w;
  };
  const ask = <T>(kind: 'decide' | 'respond', ctx: DecideContext): Promise<T> => {
    worker ??= start();
    const id = next++;
    const { jev: _jev, random: _random, ...rest } = ctx;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('bot worker took too long'));
      }, WORKER_TIMEOUT_MS);
      timer.unref?.();
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      worker!.postMessage({ id, kind, ctx: rest });
    });
  };
  return {
    decide: (ctx) => ask<Decision>('decide', ctx),
    respond: (ctx) => ask<Answer>('respond', ctx),
    close: () => {
      const w = worker;
      worker = null;
      void w?.terminate();
    },
  };
}

/**
 * Fold the memory a decision returns into the bot's current memory.
 *
 * Thinking in a worker works on a copy, and the table may move while it thinks:
 * the card counting and what the bot has learnt about each player are kept up to
 * date on the main thread by watching every move, so those stay as they are.
 * What the decision itself decides comes back: the long plan, offers made this
 * turn, the wait on its own offer, whom it robbed, how often it has offered.
 */
export function mergeMind(current: Mind, decided: Mind | undefined): Mind {
  if (!decided || decided === current) return decided ?? current;
  return {
    ...current,
    strategy: decided.strategy,
    strategyTurn: decided.strategyTurn,
    offers: decided.offers,
    offerSince: decided.offerSince,
    lastVictim: decided.lastVictim,
    trading: { made: decided.trading.made, filled: Math.max(current.trading.filled, decided.trading.filled) },
  };
}

export type { JevClient };
