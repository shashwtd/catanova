/**
 * Checks for the presets that deal Big Table and Outer Isles boards (docs/MAP_GENERATION.md), written apart
 * from the generator so that a test does not grade the generator by its own code. Also writes the fixture
 * that pins the boards those presets deal, seed by seed:
 *
 *   npx tsx tests/board-presets.ts      rewrite tests/fixtures/preset-boards.json from this checkout
 *
 * Rewrite it only to pin a new preset. A change to how an existing preset deals makes a new preset version
 * instead (docs/MAP_GENERATION.md, Versions), so that saved games and this fixture keep their boards.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  BIG_TABLE_BALANCED_V1,
  OUTER_ISLES_V1,
  generateBoard,
  hexDistance,
  isCoastalEdge,
  isLand,
  seededRandom,
} from '../packages/rules/src/board.js';
import type { Axial, Board, BoardPreset, Edge, Port, Terrain } from '../packages/rules/src/board.js';

export const PRESET_FIXTURE = new URL('./fixtures/preset-boards.json', import.meta.url);
/** Byte for byte, key order included, as classic-board.json pins Classic's boards. */
export const boardHash = (board: Board) => createHash('sha256').update(JSON.stringify(board)).digest('hex');

/** How many of `items` share each key, keys in the order they first appear. */
export function tally<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}
/** A hex's place as text, for sets and tallies. */
export const place = ({ q, r }: Axial) => `${q},${r}`;

/** Edge k of a hex joins its corners k and k + 1 and faces this axial direction: NE, E, SE, SW, W, NW. */
const FACING = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;
/** The hex across a coastal edge from its land hex: a sea hex on an Open Sea board, or open water. */
export function seaAcross(board: Board, edge: Edge): Axial {
  const land = edge.hexes.map((id) => board.hexes[id]!).find(isLand)!;
  const k = land.vertices.findIndex((v, i) => {
    const w = land.vertices[(i + 1) % 6]!;
    return (v === edge.a && w === edge.b) || (v === edge.b && w === edge.a);
  });
  return { q: land.q + FACING[k]![0], r: land.r + FACING[k]![1] };
}

/** The coastal edges of the hexes in `island`, or of the whole board: edges with land on one side only. */
export const coastOf = (board: Board, island?: ReadonlySet<number>) =>
  board.edges.filter((e) => isCoastalEdge(board, e) && (!island || e.hexes.some((h) => island.has(h))));
/**
 * The edges of a coast in order round it, from its first edge in either direction, or null when they do not
 * make one loop: some corner on it with other than two of them, or more than one loop.
 */
export function coastWalk(coast: readonly Edge[]): Edge[] | null {
  const at = new Map<number, Edge[]>();
  for (const e of coast) for (const v of [e.a, e.b]) at.set(v, [...(at.get(v) ?? []), e]);
  if ([...at.values()].some((edges) => edges.length !== 2)) return null;
  const walk = [coast[0]!];
  let v = coast[0]!.b;
  for (;;) {
    const next = at.get(v)!.find((e) => e !== walk[walk.length - 1])!;
    if (next === walk[0]) break;
    walk.push(next);
    v = next.a === v ? next.b : next.a;
  }
  return walk.length === coast.length ? walk : null;
}

/**
 * Each rotation of a preset's slots round `loop`, as the edge ids it puts harbours on, sorted, and whether it
 * keeps them apart: `seas` when no two face the same or neighbouring sea hexes, or open water, and `corners`
 * when no two share or sit on neighbouring intersections.
 */
export function harbourRotations(board: Board, loop: readonly Edge[], slots: readonly number[]) {
  const near = (e: Edge, f: Edge) =>
    [e.a, e.b].some((v) => [v, ...board.vertices[v]!.neighbors].some((n) => n === f.a || n === f.b));
  return loop.map((_, offset) => {
    const edges = slots.map((slot) => loop[(slot + offset) % loop.length]!);
    const pairs = edges.flatMap((e, i) => edges.slice(i + 1).map((f) => [e, f] as const));
    return {
      edges: edges.map((e) => e.id).sort((a, b) => a - b),
      seas: pairs.every(([e, f]) => hexDistance(seaAcross(board, e), seaAcross(board, f)) >= 2),
      corners: pairs.every(([e, f]) => !near(e, f)),
    };
  });
}
/** Every rule that keeps a board's harbours apart, as one message per problem. */
export function harbourProblems(board: Board): string[] {
  const problems: string[] = [];
  const ends = board.ports.map((p) => [board.edges[p.edge]!.a, board.edges[p.edge]!.b] as const);
  for (const [i, [a, b]] of ends.entries())
    for (const [c, d] of ends.slice(i + 1)) {
      if ([a, b].some((v) => v === c || v === d)) problems.push('two harbours share an intersection');
      else if ([a, b].some((v) => board.vertices[v]!.neighbors.some((n) => n === c || n === d)))
        problems.push('two harbours on neighbouring intersections');
    }
  const seas = board.ports.map((p) => seaAcross(board, board.edges[p.edge]!));
  for (const [i, sea] of seas.entries())
    for (const other of seas.slice(i + 1))
      if (hexDistance(sea, other) < 2) problems.push('two harbours on the same or neighbouring sea hexes');
  return problems;
}

/**
 * The docs' measure of starting room: the fewest intersections touching two or more of `island`'s hexes that
 * can be left for the last starting settlement, when each of the `earlier` settlements before it is placed,
 * under the distance rule, to take away as many of them as it can. Placing one takes away its own
 * intersection and every neighbour's. A shape measure only: it ignores the desert and the numbers.
 */
export function startingRoom(board: Board, island: ReadonlySet<number>, earlier: number) {
  const corners = board.vertices.filter((v) => v.hexes.some((h) => island.has(h))).map((v) => v.id);
  const index = new Map(corners.map((v, i) => [v, i]));
  const good = corners.map((v) => board.vertices[v]!.hexes.filter((h) => island.has(h)).length >= 2);
  const closed = corners.map((v, i) => [
    i,
    ...board.vertices[v]!.neighbors.flatMap((n) => index.get(n) ?? []),
  ]);
  const order = corners
    .map((_, i) => i)
    .sort((a, b) => closed[b]!.filter((u) => good[u]).length - closed[a]!.filter((u) => good[u]).length);
  const most = Math.max(...closed.map((c) => c.length));
  const blocked = new Uint8Array(corners.length);
  let best = 0;
  const settle = (from: number, left: number, removed: number) => {
    if (removed + left * most <= best) return;
    if (!left) return void (best = removed);
    for (let k = from; k < order.length; k++) {
      const i = order[k]!;
      if (blocked[i]) continue;
      const newly = closed[i]!.filter((u) => !blocked[u]);
      for (const u of newly) blocked[u] = 1;
      settle(k + 1, left - 1, removed + newly.filter((u) => good[u]).length);
      for (const u of newly) blocked[u] = 0;
    }
  };
  settle(0, earlier, 0);
  const total = good.filter(Boolean).length;
  return { good: total, left: total - best };
}

/** Edges a ship may take: between two hexes, at least one of them sea. The rim of the board takes nothing. */
export const shipEdges = (board: Board) =>
  board.edges.filter((e) => e.hexes.length === 2 && e.hexes.some((h) => !isLand(board.hexes[h]!)));
/**
 * How many ship edges it takes to reach each intersection from the nearest of `from`, avoiding every edge of
 * the hex `pirate` if one is given. Intersections out of reach are left out.
 */
export function shipSteps(board: Board, from: Iterable<number>, pirate?: number): Map<number, number> {
  const next = new Map<number, number[]>();
  for (const e of shipEdges(board))
    if (pirate === undefined || !e.hexes.includes(pirate))
      for (const [a, b] of [
        [e.a, e.b],
        [e.b, e.a],
      ] as const)
        next.set(a, [...(next.get(a) ?? []), b]);
  const steps = new Map([...from].map((v) => [v, 0]));
  const queue = [...steps.keys()];
  for (const v of queue)
    for (const w of next.get(v) ?? [])
      if (!steps.has(w)) {
        steps.set(w, steps.get(v)! + 1);
        queue.push(w);
      }
  return steps;
}

/** Each preset or template the fixture pins, by name. */
export const PINNED_PRESETS: Record<string, BoardPreset> = {
  'big-table-balanced-v1': BIG_TABLE_BALANCED_V1,
  'outer-isles-v1/3': OUTER_ISLES_V1[3],
  'outer-isles-v1/4': OUTER_ISLES_V1[4],
};
export type PresetFixture = Record<
  string,
  {
    boards: [seed: number, hash: string][];
    deal: {
      seed: number;
      hexes: [Terrain, number][];
      ports: Port[];
      robberStart?: number;
      pirateStart?: number;
    };
  }
>;
/**
 * The first 20 seeds, a spread across the 32-bit range and its ends, and a negative seed that wraps round.
 */
function pinnedSeeds() {
  const random = seededRandom(0xb16_7ab1);
  return [
    ...Array.from({ length: 20 }, (_, seed) => seed),
    ...Array.from({ length: 5 }, () => Math.floor(random() * 2 ** 32)),
    2 ** 31,
    2 ** 32 - 1,
    -1,
  ];
}
/** Written out in full for each preset, so that a drifted board shows what moved. */
const DEALT_SEED = 42;

export function presetFixture(): PresetFixture {
  return Object.fromEntries(
    Object.entries(PINNED_PRESETS).map(([name, preset]) => {
      const { hexes, ports, robberStart, pirateStart } = generateBoard(DEALT_SEED, preset);
      return [
        name,
        {
          boards: pinnedSeeds().map((seed) => [seed, boardHash(generateBoard(seed, preset))]),
          deal: {
            seed: DEALT_SEED,
            hexes: hexes.map((h) => [h.terrain, h.number]),
            ports,
            robberStart,
            pirateStart,
          },
        },
      ];
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(PRESET_FIXTURE);
  const options = { ...(await resolveConfig(path)), filepath: path };
  writeFileSync(path, await format(JSON.stringify(presetFixture(), null, 2), options));
}
