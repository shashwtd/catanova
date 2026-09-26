/**
 * Which game modes a host may pick, from two switches read once at start-up.
 *
 *   CATANOVA_MODES          the modes any host may pick, as ruleset ids separated by commas. Unset: Classic.
 *   CATANOVA_MODE_TESTERS   account ids whose rooms may pick any mode this build contains.
 *
 * Classic is always open. An id this build does not know is logged and left out, and never stops the server:
 * a rollback that leaves a newer mode in production.env must still start. A room's host decides what the room
 * may pick; in local playtest mode nobody has an account, so CATANOVA_MODES alone decides. See
 * docs/GAME-MODES.md, "The staged rollout".
 */
import { CLASSIC, findRuleset, rulesets } from '../../../packages/rules/src/rulesets.js';

export type ModeSwitches = { open: readonly string[]; testers: ReadonlySet<string> };
export const CLASSIC_ONLY: ModeSwitches = { open: [CLASSIC.id], testers: new Set() };

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function readModeSwitches(
  env: Record<string, string | undefined> = process.env,
  log: (event: Record<string, unknown>) => void = (event) => console.warn(JSON.stringify(event)),
): ModeSwitches {
  const open = [CLASSIC.id];
  for (const id of list(env.CATANOVA_MODES))
    if (!findRuleset(id)) log({ event: 'mode_unavailable', variable: 'CATANOVA_MODES', mode: id });
    else if (!open.includes(id)) open.push(id);
  // Account ids are matched whatever their case, as they may be copied from wherever they were shown.
  return { open, testers: new Set(list(env.CATANOVA_MODE_TESTERS).map((id) => id.toLowerCase())) };
}

/** The modes a room whose host has this account may pick, Classic first. */
export function modesFor(switches: ModeSwitches, account: string | null | undefined): string[] {
  if (account && switches.testers.has(account.toLowerCase())) return rulesets().map((ruleset) => ruleset.id);
  return switches.open.filter((id) => findRuleset(id));
}
