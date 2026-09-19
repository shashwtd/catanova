/**
 * The reactions players can throw across the table.
 *
 * The artwork is ours, drawn as SVG in `ReactionArt.tsx` rather than taken from
 * the emoji font: an emoji is drawn by the reader's device, so the same
 * character is a different face on an iPhone, a Pixel and a Windows laptop, and
 * none of them belong to a carved wooden island. These are the same expression
 * everywhere, in the game's own colours, and they cost no download.
 *
 * Ordered by how often the feeling actually comes up in a game of Catan, so the
 * first row of the picker is the one people reach for: someone laughing at your
 * misfortune, someone furious about the robber, someone quietly plotting. The
 * long tail is still there, it is just further along.
 *
 * `motion` names the choreography the client plays. It lives here rather than
 * in the client so the set stays one decision: adding a reaction means adding a
 * row, a face, and a keyframe.
 */

export const REACTIONS = {
  laugh: { label: 'Laughing', motion: 'giggle' },
  angry: { label: 'Furious', motion: 'rage' },
  evil: { label: 'Plotting', motion: 'loom' },
  smug: { label: 'Smug', motion: 'swagger' },
  sad: { label: 'Devastated', motion: 'wilt' },
  shock: { label: 'Shocked', motion: 'jolt' },
  nice: { label: 'Nice one', motion: 'cheer' },
  suspicious: { label: 'Suspicious', motion: 'squint' },
  eyeroll: { label: 'Oh, please', motion: 'roll' },
  pleading: { label: 'Please trade', motion: 'beg' },
  nervous: { label: 'Nervous', motion: 'jitter' },
  bored: { label: 'Roll already', motion: 'drift' },
  wink: { label: 'Cheeky', motion: 'cheeky' },
  dead: { label: 'I am finished', motion: 'sink' },
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
