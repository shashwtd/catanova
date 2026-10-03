/**
 * What the room shows about its game modes besides their rules: a line on each, the icon a mode is known by where
 * it has one, its painted emblem for the mode's place beside Start, how many it seats, and which modes a host is
 * offered. The mode's name is its ruleset's.
 */

import { BIG_TABLE, CLASSIC, OPEN_SEA, findRuleset } from '../../../packages/rules/src/rulesets.js';
import type { Ruleset } from '../../../packages/rules/src/rulesets.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { GameIconName } from './GameIcons.js';

export type ModeCopy = {
  name: string;
  /** One line on what the mode is, short enough for two lines in the mode chooser. */
  tagline: string;
  /** The game's own icons for what sets the mode apart, each with its words for a tooltip. */
  icons: { icon: GameIconName; label: string }[];
  /** The mode's painted emblem (masters in assets/source-art/mode-emblems, see docs/art/mode-emblems.md). */
  emblem: string;
};

const COPY: Readonly<Record<string, Omit<ModeCopy, 'name'>>> = {
  [CLASSIC.id]: {
    tagline: 'The island everyone knows. Settle, trade and race to ten.',
    icons: [],
    emblem: '/art/optimized/mode-emblem-classic.61d640b72787.webp',
  },
  [BIG_TABLE.id]: {
    tagline: 'A bigger island for bigger groups. Paired turns at five or six.',
    icons: [],
    emblem: '/art/optimized/mode-emblem-big-world.3ca68fd7e99b.webp',
  },
  [OPEN_SEA.id]: {
    tagline: 'Sail to small isles for gold and bonus points.',
    icons: [{ icon: 'boat', label: 'Ships that sail between the islands' }],
    emblem: '/art/optimized/mode-emblem-open-seas.36e342521043.webp',
  },
};

export const modeCopy = (ruleset: Ruleset): ModeCopy => ({
  name: ruleset.name,
  ...(COPY[ruleset.id] ?? { tagline: ruleset.summary, icons: [], emblem: '' }),
});

/** "2–4 players", or "6 players" for a mode that seats one number only. */
export const seatsText = (ruleset: Ruleset) =>
  ruleset.seats.min === ruleset.seats.max
    ? `${ruleset.seats.max} players`
    : `${ruleset.seats.min}–${ruleset.seats.max} players`;

/** The modes a room's host is shown: those offered to them, and the room's own even if it no longer is. */
export function roomModes(room: RoomState): Ruleset[] {
  const roomMode = room.settings?.mode ?? CLASSIC.id;
  const offered = room.modes ?? [CLASSIC.id];
  return [...new Set([...offered, roomMode])].flatMap((id) => findRuleset(id) ?? []);
}
