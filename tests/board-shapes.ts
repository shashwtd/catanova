/**
 * Board shapes for testing that the board code takes any list of hexes rather than the Classic island alone.
 * See docs/BIGGER-MAPS-AND-MODES.md.
 */
import { topology } from '../packages/rules/src/board.js';
import type { Board, BoardShape, Hex } from '../packages/rules/src/board.js';

/** The 5–6 player island, which big-table-balanced-v1 deals. */
export { BIG_TABLE_SHAPE } from '../packages/rules/src/board.js';

/**
 * Turns every hex that fails `land` into sea, as Open Sea's presets do, for shapes that no preset deals. The
 * coast rule asks isLand, which knows sea by name.
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
