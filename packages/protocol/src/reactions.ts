/**
 * The reactions players can throw across the table.
 *
 * The artwork is ours, drawn as SVG in `ReactionArt.tsx` rather than taken from
 * the emoji font: an emoji is drawn by the reader's device, so the same
 * character is a different face on an iPhone, a Pixel and a Windows laptop, and
 * none of them belong to a carved wooden island. These are the same expression
 * everywhere, in the game's own colours, and they cost no download.
 *
 * Twelve, in the order people reach for them. The first eight are the ones a
 * game of Catan produces on its own — someone laughing at your misfortune,
 * someone furious about the robber, someone quietly plotting, someone who has
 * just been finished off by a seven. The last four are for the moments that
 * need a specific word: a player who is obviously scheming, a player begging
 * for one sheep, a decision that deserves a clown, and a play worth shouting
 * about.
 *
 * `motion` names the choreography the client plays. It lives here rather than
 * in the client so the set stays one decision: adding a reaction means adding a
 * row, a face, and a keyframe.
 */

// Keep wire IDs stable across deployments: wink and nice now use clown and hype art.
export const REACTIONS = {
  laugh: { label: 'Dying laughing', motion: 'giggle' },
  angry: { label: 'Rage', motion: 'rage' },
  evil: { label: 'Evil', motion: 'loom' },
  smug: { label: 'Smug', motion: 'swagger' },
  shock: { label: 'Shocked', motion: 'jolt' },
  eyeroll: { label: 'Eye roll', motion: 'roll' },
  sad: { label: 'Devastated', motion: 'wilt' },
  dead: { label: 'Dead', motion: 'sink' },
  suspicious: { label: 'Side-eye', motion: 'squint' },
  pleading: { label: 'Begging', motion: 'beg' },
  wink: { label: 'Clown', motion: 'honk' },
  nice: { label: 'Hype', motion: 'cheer' },
} as const;

export type ReactionName = keyof typeof REACTIONS;

/** Picker order. The array is the source of truth for what a client renders. */
export const REACTION_LIST = Object.keys(REACTIONS) as ReactionName[];

export const isReaction = (value: unknown): value is ReactionName =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(REACTIONS, value);

/**
 * Tapping away at a laugh is the point, so the limit is only there to stop a
 * stuck key or a script from burying the board: ten in a row as fast as a
 * thumb can go, and then a short cooldown until the first of them is four
 * seconds old. Nobody is held for longer than that.
 */
export const REACTION_BURST = 10;
export const REACTION_WINDOW_MS = 4000;

/**
 * How long until one more reaction is allowed, given when the previous ones
 * were sent: 0 when it can go now, otherwise the rest of the cooldown, which is
 * never longer than the window. Times ahead of `now` are left out, so a clock
 * that jumped back cannot hold anyone.
 *
 * The server holds the authoritative copy of this gate, and the picker uses the
 * same rule so a player can see the faces rest for the cooldown rather than
 * send reactions that are quietly dropped on the way out.
 */
export function reactionWaitMs(sentAt: readonly number[], now: number): number {
  const recent = sentAt
    .filter((time) => time <= now && now - time < REACTION_WINDOW_MS)
    .sort((a, b) => a - b);
  if (recent.length < REACTION_BURST) return 0;
  return recent[recent.length - REACTION_BURST]! + REACTION_WINDOW_MS - now;
}

export const reactionAllowedAt = (sentAt: readonly number[], now: number): boolean =>
  reactionWaitMs(sentAt, now) === 0;
