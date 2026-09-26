/**
 * Board shapes that no preset deals yet, for testing that the board code takes any list of hexes rather than
 * the Classic island alone. See docs/BIGGER-MAPS-AND-MODES.md.
 */
import { isCoastalEdge, topology } from '../packages/rules/src/board.js';
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

/** Outer Isles for four players (docs/MAP_GENERATION.md): every hex with −4 ≤ r ≤ 4 and −8 ≤ 2q + r ≤ 8. */
export const OUTER_ISLES_4_SHAPE: BoardShape = Array.from({ length: 9 }, (_, row) => row - 4).flatMap((r) =>
  Array.from({ length: 17 }, (_, k) => ({ q: k - 8, r })).filter(({ q }) => Math.abs(2 * q + r) <= 8),
);
/** Its land: the main island's rows of 2, 4, 7, 4, 2 and 1, and the four small isles. */
const OUTER_ISLES_4_LAND = [
  ...[
    [-2, 0, 1],
    [-1, -1, 2],
    [0, -3, 3],
    [1, -2, 1],
    [2, -1, 0],
    [3, -1, -1],
  ].flatMap(([r, from, to]) => Array.from({ length: to! - from! + 1 }, (_, k) => `${from! + k},${r}`)),
  '-1,-3',
  '-2,-2',
  '3,-3',
  '4,-3',
  '4,-2',
  '2,2',
  '1,3',
  '-4,2',
  '-4,3',
  '-3,3',
];
/** The four-player Outer Isles frame, all sea but its islands, whose hexes are left as bareBoard deals them. */
export const outerIsles4 = () =>
  flood(bareBoard(OUTER_ISLES_4_SHAPE), (h) => OUTER_ISLES_4_LAND.includes(`${h.q},${h.r}`));
/**
 * The four-player frame with something on it to draw: a gold field on two small isles, carrying a 9, and one
 * harbour, on the main island's eastern coast.
 */
export function dealtOuterIsles4() {
  const board = outerIsles4();
  for (const [q, r] of [
    [-4, 2],
    [2, 2],
  ])
    Object.assign(
      board.hexes.find((h) => h.q === q && h.r === r)!,
      { terrain: 'gold', number: 9 },
    );
  const east = board.hexes.find((h) => h.q === 3 && h.r === 0)!;
  const edge = board.edges.find((e) => e.hexes.includes(east.id) && isCoastalEdge(board, e))!;
  board.ports = [{ edge: edge.id, resource: 'any' }];
  return board;
}
