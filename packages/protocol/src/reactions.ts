/**
 * The reactions players can throw across the table.
 *
 * Ordered by how often the feeling actually comes up in a game of Catan, so the
 * first row of the picker is the one people reach for: someone laughing at your
 * misfortune, someone furious about the robber, someone quietly plotting. The
 * long tail is still there, it is just further along.
 *
 * `motion` names the choreography the client plays. It lives here rather than in
 * the client so the set stays one decision: adding a reaction means adding a
 * row, an SVG, and a keyframe.
 */

export const REACTIONS = {
  laugh: { label: 'Laughing', motion: 'giggle' },
  angry: { label: 'Furious', motion: 'rage' },
  evil: { label: 'Plotting', motion: 'loom' },
  smug: { label: 'Smug', motion: 'swagger' },
  sad: { label: 'Devastated', motion: 'wilt' },
  shock: { label: 'Shocked', motion: 'jolt' },
  trade: { label: 'Let us trade', motion: 'barter' },
  nice: { label: 'Nice one', motion: 'cheer' },
  suspicious: { label: 'Suspicious', motion: 'squint' },
  eyeroll: { label: 'Oh, please', motion: 'roll' },
  clown: { label: 'Clown move', motion: 'tumble' },
  fire: { label: 'On a run', motion: 'flare' },
  dice: { label: 'Roll better', motion: 'tumble' },
  skull: { label: 'I am finished', motion: 'sink' },
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
