/**
 * The parts of a bot seat that travel over the wire.
 *
 * These live in the protocol, not in `@catanova/bot`, because the browser needs
 * them to render the lobby while the bot package itself is server-only: it
 * reads credentials from the environment and talks to a decision service, and
 * neither belongs in a client bundle.
 */

/**
 * How hard a bot plays.
 *
 * `steady` follows its own plan and mostly leaves you alone. `sharp` also
 * spends effort getting in the way of whoever is winning. `champ` plays to win:
 * it reads the awards and the gap to the target, rethinks its plan whenever the
 * board moves under it, and considers more of the board before every choice.
 *
 * None of them see anything a player at the table cannot. They are given the
 * same filtered view of the game the browser is given — no hidden hands, no
 * peeking at the deck, no adjusted dice — so a champ that beats you beat you
 * with what was on the table.
 */
export const BOT_LEVELS = ['steady', 'sharp', 'champ'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const isBotLevel = (value: unknown): value is BotLevel => BOT_LEVELS.includes(value as BotLevel);

export const BOT_LEVEL_LABEL: Record<BotLevel, string> = {
  steady: 'Steady',
  sharp: 'Sharp',
  champ: 'Champion',
};

/**
 * How often each one turns up.
 *
 * Not evenly: a champion you meet every third game is a difficulty setting you
 * did not choose, while one in five is an occasional bad afternoon. Must sum
 * to one.
 */
export const BOT_LEVEL_ODDS: Record<BotLevel, number> = {
  steady: 0.4,
  sharp: 0.4,
  champ: 0.2,
};

/**
 * Which one turns up when a seat is filled.
 *
 * The host asks for a bot, not for a difficulty: you find out who you have
 * drawn by playing them, which is also what happens when a stranger sits down.
 * The server draws it, so the choice is never the client's to make.
 */
export function randomBotLevel(random: () => number = Math.random): BotLevel {
  let roll = random();
  for (const level of BOT_LEVELS) {
    roll -= BOT_LEVEL_ODDS[level];
    if (roll < 0) return level;
  }
  // Only reachable if the source returns exactly 1, or the odds drift.
  return BOT_LEVELS[BOT_LEVELS.length - 1]!;
}

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
