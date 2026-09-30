/**
 * Catanova's bot players.
 *
 * A bot thinks with its own engine, in `brain/`: the race to ten points, card
 * counting, a search over whole turns played by the real rules, an opening
 * solver, and selfish trading. TypeSafe AI's Jev is an advisor it asks only when
 * the engine's numbers leave a choice open. `decide.ts` routes each phase of the
 * game to the brain; `plan.ts` renders what the bot is doing as a sentence.
 */

export { createJevClient, route, JevUnavailable, choice, score, noul } from './jev.js';
export type { JevClient, Question, Answer, Evaluation } from './jev.js';

export { decide, respond } from './decide.js';
export type { Decision, DecideContext } from './decide.js';

export { newMind } from './brain/mind.js';
export type { Mind } from './brain/mind.js';
export { watch } from './brain/watch.js';
export { reactTo, reacted } from './brain/reactions.js';
export type { TableEvent } from './brain/facts.js';

export {
  PLAY_STYLES,
  PLAY_STYLE_LIST,
  STYLE_ARCHETYPE,
  STYLE_LABEL,
  isPlayStyle,
  observe,
  parseStandInStyle,
  profileStyle,
  styleFromRecord,
} from './style.js';
export type { PlayStyle, StandInStyle, Observation } from './style.js';

export { initialPlan, describe, planIsStale, ARCHETYPES, FOCUS_LABEL } from './plan.js';
export type { BotPlan, Archetype, Focus, Threat } from './plan.js';

export {
  affordable,
  cornerFacts,
  rankCorners,
  rankRoads,
  rankRobberHexes,
  robberTargets,
  discardChoice,
  needsAndSurplus,
  leaderOf,
} from './heuristics.js';
export type { CornerFacts, Buildable } from './heuristics.js';

/** Level and naming live in the protocol package: the browser needs them to
 *  render the lobby, and this package is server-only. */
export { BOT_LEVELS, BOT_NAMES, botName, isBotLevel } from '../../protocol/src/bots.js';
export type { BotLevel } from '../../protocol/src/bots.js';

/** Running totals, so the cost of a game is a measured number rather than an
 *  estimate. Surfaced per room for the token report in the docs. */
export type BotUsage = {
  calls: number;
  tokens: number;
  costUsd: number;
  decisions: number;
  degraded: number;
};

export const emptyUsage = (): BotUsage => ({ calls: 0, tokens: 0, costUsd: 0, decisions: 0, degraded: 0 });

export function addUsage(
  into: BotUsage,
  decision: { calls: number; tokens: number; costUsd: number; degraded?: boolean },
): BotUsage {
  into.calls += decision.calls;
  into.tokens += decision.tokens;
  into.costUsd += decision.costUsd;
  into.decisions += 1;
  if (decision.degraded) into.degraded += 1;
  return into;
}
