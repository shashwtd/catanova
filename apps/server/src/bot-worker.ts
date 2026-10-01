/**
 * The bot brain, running in its own thread.
 *
 * A Champion scores up to two thousand positions before a move, which on the
 * production machine is most of a second of solid computation. On the server's
 * main thread that second would hold every socket in every room. Here it holds
 * nothing but this thread. See `bot-thinker.ts` for the other side.
 *
 * Each message is one decision or one answer to a trade offer. The decision
 * service client lives here too, so a bot can consult Jev without the main thread
 * passing it anything that cannot be copied.
 */

import { parentPort } from 'node:worker_threads';
import { createJevClient, decide, respond } from '../../../packages/bot/src/index.js';
import type { DecideContext } from '../../../packages/bot/src/index.js';

const jev = createJevClient();

type Request = { id: number; kind: 'decide' | 'respond'; ctx: Omit<DecideContext, 'jev'> };

parentPort?.on('message', async (request: Request) => {
  try {
    const ctx = { ...request.ctx, jev } as DecideContext;
    const result = request.kind === 'decide' ? await decide(ctx) : await respond(ctx);
    parentPort!.postMessage({ id: request.id, result });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
