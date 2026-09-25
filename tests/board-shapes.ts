/**
 * Board shapes that no preset deals yet, for testing that the board code takes any list of hexes rather than
 * the Classic island alone. See docs/BIGGER-MAPS-AND-MODES.md.
 */
import type { BoardShape } from '../packages/rules/src/board.js';

/** The 5–6 player island: rows of 3, 4, 5, 6, 5, 4 and 3 hexes, each row centred under the one above. */
export const BIG_TABLE_SHAPE: BoardShape = [3, 4, 5, 6, 5, 4, 3].flatMap((length, row) =>
  Array.from({ length }, (_, k) => ({ q: Math.max(-3, -row) + k, r: row - 3 })),
);
