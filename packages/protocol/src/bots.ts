/**
 * The parts of a bot seat that travel over the wire.
 *
 * These live in the protocol, not in `@catanova/bot`, because the browser needs
 * them to render the lobby while the bot package itself is server-only: it
 * reads credentials from the environment and talks to a decision service, and
 * neither belongs in a client bundle.
 */

/** How hard a bot plays. `steady` follows its own plan; `sharp` also spends
 *  effort getting in the way of whoever is winning. */
export const BOT_LEVELS = ['steady', 'sharp'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const isBotLevel = (value: unknown): value is BotLevel => BOT_LEVELS.includes(value as BotLevel);

export const BOT_LEVEL_LABEL: Record<BotLevel, string> = {
  steady: 'Steady',
  sharp: 'Sharp',
};

/** Bots play under fixed names so no model ever has to invent one, and so a bot
 *  can never take a name a person has reserved. */
export const BOT_NAMES = [
  'Anchor',
  'Beacon',
  'Compass',
  'Drift',
  'Ember',
  'Fathom',
  'Grove',
  'Harbour',
] as const;

export function botName(taken: readonly string[]): string {
  const lowered = new Set(taken.map((name) => name.toLowerCase()));
  return BOT_NAMES.find((name) => !lowered.has(name.toLowerCase())) ?? `Bot ${taken.length + 1}`;
}
