/**
 * Dev-only boards for the design preview, `/dev/lounge?board=big-table`, `isles3` or `isles4`: a Big Table island
 * and the two Outer Isles templates of docs/MAP_GENERATION.md, dealt once by hand. They show how the board draws;
 * the presets that deal real games are built elsewhere.
 *
 * Each row lists its hexes west to east, starting at `q`. `~` is sea. Any other hex is a terrain letter (w Timber,
 * b Clay, s Sheep, h Hay, o Rock, d desert, g gold field), then its number, then `/x` if it is on small isle x
 * rather than the main island.
 */
import { topology } from '../../../../packages/rules/src/board.js';
import type { Board, Edge, Hex } from '../../../../packages/rules/src/board.js';
import type { Resource } from '../../../../packages/rules/src/index.js';
import type { SceneTerrain } from '../scene.js';

/** A hex's corners from the top, clockwise, and its sides, each named by the neighbour across it. */
const CORNERS = ['n', 'ne', 'se', 's', 'sw', 'nw'] as const;
const SIDES = ['ne', 'e', 'se', 'sw', 'w', 'nw'] as const;
type Corner = (typeof CORNERS)[number];
type Side = (typeof SIDES)[number];
type At = [q: number, r: number];
type Sample = {
  rows: [r: number, q: number, hexes: string][];
  harbours: [...At, Side, Resource | 'any'][];
  pirate?: At;
};
const TERRAIN: Record<string, SceneTerrain> = {
  w: 'wood',
  b: 'brick',
  s: 'sheep',
  h: 'wheat',
  o: 'ore',
  d: 'desert',
  g: 'gold',
};

const SAMPLES = {
  'big-table': {
    rows: [
      [-3, 0, 'b8 w10 h6'],
      [-2, -1, 'o9 s2 w3 s12'],
      [-1, -2, 'h10 o3 s5 h8 h11'],
      [0, -3, 'w8 w11 h6 d b4 b12'],
      [1, -3, 'o3 o2 w10 s11 s6'],
      [2, -3, 's9 b4 d o5'],
      [3, -3, 'h5 w9 b4'],
    ],
    harbours: [
      [-1, 3, 'se', 'any'],
      [-2, 3, 'sw', 'wood'],
      [-3, 3, 'w', 'wheat'],
      [-3, 1, 'w', 'any'],
      [-3, 0, 'nw', 'any'],
      [-1, -2, 'nw', 'ore'],
      [0, -3, 'ne', 'brick'],
      [2, -3, 'ne', 'any'],
      [2, -2, 'e', 'sheep'],
      [2, 0, 'e', 'sheep'],
      [1, 1, 'se', 'any'],
    ],
  },
  isles3: {
    rows: [
      [-4, -1, '~ ~ ~ ~ ~ ~ ~ ~'],
      [-3, -2, '~ ~ ~ o8/a h9/a g10/a ~ ~'],
      [-2, -2, '~ ~ ~ ~ ~ ~ ~ ~'],
      [-1, -3, '~ h3 b9 s12 s8 w4 ~ ~'],
      [0, -3, '~ ~ w10 o4 b11 w5 h6 ~'],
      [1, -4, '~ g4/b ~ d s10 h6 ~ ~'],
      [2, -4, '~ w2/b ~ s2 b11 ~ o12/c ~'],
      [3, -5, '~ ~ h6/b ~ o8 ~ b5/c ~'],
      [4, -5, '~ ~ ~ ~ ~ ~ ~ ~'],
    ],
    harbours: [
      [-1, 1, 'sw', 'wood'],
      [-1, -1, 'sw', 'brick'],
      [-2, -1, 'ne', 'any'],
      [0, -1, 'ne', 'sheep'],
      [2, -1, 'e', 'wheat'],
      [3, 0, 'e', 'any'],
      [1, 1, 'se', 'ore'],
      [-1, 3, 'se', 'any'],
    ],
    pirate: [4, -2],
  },
  isles4: {
    rows: [
      [-4, -2, '~ ~ ~ ~ ~ ~ ~ ~ ~'],
      [-3, -2, '~ h8/a ~ ~ ~ w11/b o6/b ~'],
      [-2, -3, '~ o2/a ~ b4 w8 ~ ~ h4/b ~'],
      [-1, -3, '~ ~ b8 o10 b3 s9 ~ ~'],
      [0, -4, '~ s6 o3 w11 w2 h5 s10 w6 ~'],
      [1, -4, '~ ~ h9 d s10 h11 ~ ~'],
      [2, -5, '~ g5/d ~ ~ s12 b5 ~ o3/c ~'],
      [3, -5, '~ b12/d h9/d ~ o4 ~ g10/c ~'],
      [4, -6, '~ ~ ~ ~ ~ ~ ~ ~ ~'],
    ],
    harbours: [
      [1, -2, 'ne', 'brick'],
      [2, -1, 'ne', 'sheep'],
      [3, 0, 'ne', 'any'],
      [1, 1, 'e', 'any'],
      [-1, 3, 'e', 'any'],
      [-1, 2, 'w', 'ore'],
      [-2, 1, 'w', 'wood'],
      [-3, 0, 'nw', 'any'],
      [-1, -1, 'nw', 'wheat'],
    ],
    pirate: [2, 4],
  },
} satisfies Record<string, Sample>;
export type SampleBoardName = keyof typeof SAMPLES;
export const SAMPLE_BOARDS = Object.keys(SAMPLES) as SampleBoardName[];

/** A board with the fields the map presets add: where the robber and the pirate start, and its seats. */
export type SampleBoard = Board & { robberStart: number; pirateStart?: number; players: number };

const find = (board: Board, [q, r]: At): Hex => {
  const hex = board.hexes.find((h) => h.q === q && h.r === r);
  if (!hex) throw new Error(`The sample board has no hex ${q},${r}`);
  return hex;
};
/** A corner of the hex at `at`, named from the top clockwise. */
export const corner = (board: Board, at: At, name: Corner) =>
  find(board, at).vertices[CORNERS.indexOf(name)]!;
/** A side of the hex at `at`, named by the neighbour across it. */
export function side(board: Board, at: At, name: Side): number {
  const hex = find(board, at),
    k = SIDES.indexOf(name),
    ends = [hex.vertices[k]!, hex.vertices[(k + 1) % 6]!];
  return board.edges.find((e: Edge) => ends.includes(e.a) && ends.includes(e.b))!.id;
}

/** One of the sample boards, built with topology() like any other. `seed` keeps each one's layers apart. */
export function sampleBoard(name: SampleBoardName, seed: number): SampleBoard {
  const sample: Sample = SAMPLES[name];
  const cells = sample.rows.flatMap(([r, q, hexes]) =>
    hexes.split(' ').map((cell, k) => ({ q: q + k, r, cell })),
  );
  const board = { seed, preset: 'balanced-v2' as const, ...topology(cells), ports: [] as Board['ports'] };
  for (const [i, { cell }] of cells.entries()) {
    const [, letter, number, island] = /^([~wbshodg])(\d*)(?:\/([a-z]))?$/.exec(cell)!;
    // Sea and gold are the client's terrains before they are the rules': assigned as the preview's own data.
    Object.assign(board.hexes[i]!, {
      terrain: letter === '~' ? 'sea' : TERRAIN[letter!],
      number: Number(number || 0),
      ...(letter === '~' ? {} : { island: island ?? 'main' }),
    });
  }
  board.ports = sample.harbours.map(([q, r, name, resource]) => ({
    edge: side(board, [q, r], name),
    resource,
  }));
  return {
    ...board,
    robberStart: board.hexes.find((h) => h.terrain === 'desert')!.id,
    ...(sample.pirate ? { pirateStart: find(board, sample.pirate).id } : {}),
    players: name === 'big-table' ? 6 : name === 'isles3' ? 3 : 4,
  };
}

type Pieces = {
  /** Where each seat, by index, has a settlement or a city. */
  buildings: [...At, Corner, number, 'settlement' | 'city'][];
  roads: [...At, Side, number][];
  ships: [...At, Side, number][];
};
/**
 * A few pieces for each Outer Isles board, to compare their sizes: houses on the main island's coast, roads
 * beside them, and ships on coastal edges, out in open water, on a harbour's edge and up to a small isle. Big
 * Table takes the Classic sample's setup moves instead, which its all-land board allows.
 */
const PIECES: Partial<Record<SampleBoardName, Pieces>> = {
  isles3: {
    buildings: [
      [0, -1, 'n', 0, 'settlement'],
      [-2, -1, 'n', 1, 'settlement'],
      [1, 1, 's', 2, 'city'],
      [-1, 0, 's', 1, 'settlement'],
    ],
    roads: [
      [0, -1, 'nw', 0],
      [-2, -1, 'nw', 1],
      [1, 1, 'sw', 2],
      [-1, 0, 'sw', 1],
    ],
    ships: [
      [0, -1, 'ne', 0],
      [1, -2, 'w', 0],
      [-2, -2, 'e', 1],
      [1, 1, 'se', 2],
      [1, 2, 'ne', 2],
    ],
  },
  isles4: {
    buildings: [
      [1, -2, 'n', 0, 'settlement'],
      [-3, 0, 'nw', 1, 'settlement'],
      [2, 0, 'se', 2, 'city'],
      [2, 2, 'n', 2, 'settlement'],
      [-2, 1, 'sw', 3, 'settlement'],
      [0, 1, 's', 3, 'settlement'],
    ],
    roads: [
      [1, -2, 'nw', 0],
      [-3, 0, 'w', 1],
      [2, 0, 'e', 2],
      [-2, 1, 'sw', 3],
      [0, 1, 'sw', 3],
    ],
    ships: [
      [1, -2, 'ne', 0],
      [2, -2, 'nw', 0],
      [2, -3, 'e', 0],
      [-4, 0, 'ne', 1],
      [3, 0, 'sw', 2],
      [2, 1, 'e', 2],
      [-3, 1, 'se', 3],
      [-3, 2, 'w', 3],
    ],
  },
};
/** The sample's pieces for a board with sea, by player id, or null for a board that takes real setup moves. */
export function samplePieces(name: SampleBoardName, board: Board, players: readonly string[]) {
  const pieces = PIECES[name];
  if (!pieces) return null;
  return {
    buildings: Object.fromEntries(
      pieces.buildings.map(([q, r, at, seat, kind]) => [
        corner(board, [q, r], at),
        { player: players[seat]!, kind },
      ]),
    ),
    roads: Object.fromEntries(
      pieces.roads.map(([q, r, at, seat]) => [side(board, [q, r], at), players[seat]!]),
    ),
    ships: Object.fromEntries(
      pieces.ships.map(([q, r, at, seat]) => [side(board, [q, r], at), players[seat]!]),
    ),
  };
}
/** The hex at `q,r`, as `/dev/lounge?pirate=q,r` names one to move the pirate to. */
export const hexAt = (board: Board, at: At) => find(board, at).id;
