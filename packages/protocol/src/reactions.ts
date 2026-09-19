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
  angry: { label: 'Furious', motion: 'rage' },
  evil: { label: 'Plotting', motion: 'loom' },
  smug: { label: 'Smug', motion: 'swagger' },
  shock: { label: 'Shocked', motion: 'jolt' },
  eyeroll: { label: 'Oh, please', motion: 'roll' },
  sad: { label: 'Devastated', motion: 'wilt' },
  dead: { label: 'Completely cooked', motion: 'sink' },
  suspicious: { label: 'Suspicious', motion: 'squint' },
  pleading: { label: 'Please trade', motion: 'beg' },
  wink: { label: 'Clown move', motion: 'honk' },
  nice: { label: 'Hyped', motion: 'cheer' },
} as const;

export type ReactionName = keyof typeof REACTIONS;

/** Picker order. The array is the source of truth for what a client renders. */
export const REACTION_LIST = Object.keys(REACTIONS) as ReactionName[];

export const isReaction = (value: unknown): value is ReactionName =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(REACTIONS, value);

/** Two a second is plenty for delight and short of a nuisance. */
export const REACTION_MIN_GAP_MS = 500;
/** A short burst is fine; a stream is not. */
export const REACTION_BURST = 4;
export const REACTION_WINDOW_MS = 6000;

/**
 * Whether one more reaction is allowed, given when the previous ones were sent.
 *
 * The server holds the authoritative copy of this gate, and the picker uses the
 * same rule so a player can see the control rest for a beat rather than send
 * reactions that are quietly dropped on the way out.
 */
export function reactionAllowedAt(sentAt: readonly number[], now: number): boolean {
  const recent = sentAt.filter((time) => now - time < REACTION_WINDOW_MS);
  if (recent.length >= REACTION_BURST) return false;
  const last = recent[recent.length - 1];
  return last === undefined || now - last >= REACTION_MIN_GAP_MS;
}
