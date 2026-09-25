/**
 * Board shapes that no preset deals yet, for testing that the board code takes any list of hexes rather than
 * the Classic island alone. See docs/BIGGER-MAPS-AND-MODES.md.
 */
import { topology } from '../packages/rules/src/board.js';
import type { Board, BoardShape, Hex } from '../packages/rules/src/board.js';

/** The 5–6 player island: rows of 3, 4, 5, 6, 5, 4 and 3 hexes, each row centred under the one above. */
export const BIG_TABLE_SHAPE: BoardShape = [3, 4, 5, 6, 5, 4, 3].flatMap((length, row) =>
  Array.from({ length }, (_, k) => ({ q: Math.max(-3, -row) + k, r: row - 3 })),
);

/**
 * Turns every hex that fails `land` into sea, as Open Sea will deal it. Sea is not a Terrain yet, so no preset
 * can; the coast rule asks isLand, which already knows the name.
 */
export function flood<T extends Pick<Board, 'hexes'>>(board: T, land: (hex: Hex) => boolean): T {
  for (const hex of board.hexes) if (!land(hex)) Object.assign(hex, { terrain: 'sea' });
  return board;
}
/** A whole Board of the given shape for the renderer's functions, with nothing dealt on it. */
export const bareBoard = (shape: BoardShape): Board => ({
  seed: 0,
  preset: 'balanced-v2',
  ...topology(shape),
  ports: [],
});
