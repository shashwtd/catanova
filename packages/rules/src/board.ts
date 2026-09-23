import { NUMBER_SPIRAL, RESOURCES } from './index.js';
import type { Resource } from './index.js';

export type Terrain = Resource | 'desert';
export type Hex = {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  terrain: Terrain;
  number: number;
  vertices: number[];
  neighbors: number[];
};
export type Vertex = {
  id: number;
  x: number;
  y: number;
  hexes: number[];
  neighbors: number[];
  edges: number[];
};
export type Edge = { id: number; a: number; b: number; hexes: number[] };
export type Port = { edge: number; resource: Resource | 'any' };
export type Board = {
  seed: number;
  /**
   * The generator that dealt this board: a seed reproduces a board only under its own preset. New boards
   * are balanced-v2; saved games keep the board JSON they were dealt, so balanced-v1 boards stay valid.
   */
  preset: 'balanced-v1' | 'balanced-v2';
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
};
export const pips = (n: number) => (n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0);
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(input: readonly T[], random: () => number): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
export const hexDistance = (a: Hex, b: Hex) =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

export function topology(): Omit<Board, 'seed' | 'preset' | 'ports'> {
  const hexes: Hex[] = [],
    vertices: Vertex[] = [],
    edges: Edge[] = [];
  const pointIds = new Map<string, number>(),
    edgeIds = new Map<string, number>();
  for (let r = -2; r <= 2; r++)
    for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
      const h: Hex = {
        id: hexes.length,
        q,
        r,
        x: Math.sqrt(3) * (q + r / 2),
        y: 1.5 * r,
        terrain: 'desert',
        number: 0,
        vertices: [],
        neighbors: [],
      };
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI / 180) * (60 * k - 90);
        const x = h.x + Math.cos(angle),
          y = h.y + Math.sin(angle);
        const key = `${Math.round(x * 10000)},${Math.round(y * 10000)}`;
        let id = pointIds.get(key);
        if (id === undefined) {
          id = vertices.length;
          pointIds.set(key, id);
          vertices.push({ id, x, y, hexes: [], neighbors: [], edges: [] });
        }
        vertices[id]!.hexes.push(h.id);
        h.vertices.push(id);
      }
      for (let k = 0; k < 6; k++) {
        const a = h.vertices[k]!,
          b = h.vertices[(k + 1) % 6]!;
        const key = [a, b].sort((a, b) => a - b).join(',');
        let id = edgeIds.get(key);
        if (id === undefined) {
          id = edges.length;
          edgeIds.set(key, id);
          edges.push({ id, a, b, hexes: [] });
          vertices[a]!.neighbors.push(b);
          vertices[b]!.neighbors.push(a);
          vertices[a]!.edges.push(id);
          vertices[b]!.edges.push(id);
        }
        edges[id]!.hexes.push(h.id);
      }
      hexes.push(h);
    }
  for (const h of hexes)
    h.neighbors = hexes.filter((other) => hexDistance(h, other) === 1).map((other) => other.id);
  return { hexes, vertices, edges };
}

const red = (n: number) => n === 6 || n === 8;
/**
 * Numbers that may not share a border, and the issue each pairing raises. Red numbers together stack the
 * likeliest rolls in one place, equal numbers pay out twice to every corner they share, and a 2 beside the 12
 * leaves a patch of island that almost never produces. The official A–R number spiral never does any of these.
 */
const BORDER_RULES: [issue: string, clash: (a: number, b: number) => boolean][] = [
  ['Adjacent red numbers', (a, b) => red(a) && red(b)],
  ['Adjacent equal numbers', (a, b) => a > 0 && a === b],
  ['Adjacent 2 and 12', (a, b) => (a === 2 && b === 12) || (a === 12 && b === 2)],
];
/** The generator tests these rules for every token it deals, so it reads them from a table by number pair. */
const CLASHES = Array.from({ length: 13 }, (_, a) =>
  Array.from({ length: 13 }, (_, b) => BORDER_RULES.some(([, clash]) => clash(a, b))),
);

/**
 * Inspectable constraints: fairness means bounded extremes, not identical starting spots. These are the
 * balanced-v2 rules; balanced-v1 boards in saved games predate the equal-number and 2/12 rules.
 */
export function fairnessIssues(board: Pick<Board, 'hexes' | 'vertices'>): string[] {
  const issues: string[] = [];
  for (const resource of RESOURCES) {
    const tiles = board.hexes.filter((h) => h.terrain === resource);
    const visited = new Set<number>();
    for (const tile of tiles) {
      if (visited.has(tile.id)) continue;
      const stack = [tile.id];
      let size = 0;
      while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        size++;
        stack.push(
          ...board.hexes[id]!.neighbors.filter(
            (n) => board.hexes[n]!.terrain === resource && !visited.has(n),
          ),
        );
      }
      if (size > 2) issues.push(`${resource}: cluster larger than two`);
    }
    if (!tiles.some((a) => tiles.some((b) => hexDistance(a, b) >= 3)))
      issues.push(`${resource}: insufficient spread`);
    const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
    if (production < Math.ceil(tiles.length * 2.5) || production > tiles.length * 4)
      issues.push(`${resource}: production outside range`);
  }
  for (const [issue, clash] of BORDER_RULES)
    for (const h of board.hexes)
      if (h.neighbors.some((n) => clash(h.number, board.hexes[n]!.number))) issues.push(issue);
  for (const v of board.vertices)
    if (v.hexes.reduce((sum, h) => sum + pips(board.hexes[h]!.number), 0) > 11)
      issues.push('Intersection above 11 pips');
  return issues;
}

/**
 * Deals the number tokens onto `land` in a uniformly random order, giving up as soon as a token lands beside one
 * it may not touch. Every deal abandoned here would fail fairnessIssues anyway, so accepted numberings stay
 * uniformly random among the valid ones, exactly as with whole shuffles; most failures just cost a few draws
 * instead of a full check. Returns whether the deal completed.
 */
function dealNumbers(hexes: readonly Hex[], land: readonly Hex[], random: () => number): boolean {
  const tokens: number[] = [...NUMBER_SPIRAL];
  for (const h of land) h.number = 0;
  for (let i = 0; i < land.length; i++) {
    const j = i + Math.floor(random() * (tokens.length - i));
    [tokens[i], tokens[j]] = [tokens[j]!, tokens[i]!];
    const token = tokens[i]!;
    if (land[i]!.neighbors.some((n) => CLASHES[token]![hexes[n]!.number])) return false;
    land[i]!.number = token;
  }
  return true;
}

/** Nine harbours around the 30 coastal edges, spaced 3, 3 and 4 edges apart. */
const HARBOUR_SLOTS = [0, 3, 6, 10, 13, 16, 20, 23, 26];

/**
 * The harbour edges of each rotation of HARBOUR_SLOTS that keeps harbours off the same and neighbouring sea
 * spaces. With nine harbours on the eighteen sea spaces round the island, that makes harbour and open sea
 * alternate all the way round, as on the fixed frame in docs/SETUP.md, with harbours off three of the six tips.
 * The other four of every ten rotations put three pairs of harbours side by side and leave every tip bare.
 */
function harbourLayouts(graph: Pick<Board, 'hexes' | 'vertices' | 'edges'>): Edge[][] {
  // Twice the edge's midpoint. Its angle orders the coast, and subtracting the land hex's centre gives the centre
  // of the sea space across the edge: neighbouring sea spaces are √3 apart, any other two at least 3.
  const out = (e: Edge) => ({
    x: graph.vertices[e.a]!.x + graph.vertices[e.b]!.x,
    y: graph.vertices[e.a]!.y + graph.vertices[e.b]!.y,
  });
  const sea = (e: Edge) => ({
    x: out(e).x - graph.hexes[e.hexes[0]!]!.x,
    y: out(e).y - graph.hexes[e.hexes[0]!]!.y,
  });
  const apart = (e: Edge, f: Edge) => Math.hypot(sea(e).x - sea(f).x, sea(e).y - sea(f).y) > 2;
  const coast = graph.edges
    .filter((e) => e.hexes.length === 1)
    .sort((a, b) => Math.atan2(out(a).y, out(a).x) - Math.atan2(out(b).y, out(b).x));
  return coast
    .map((_, offset) => HARBOUR_SLOTS.map((slot) => coast[(slot + offset) % coast.length]!))
    .filter((edges) => edges.every((e, i) => edges.slice(i + 1).every((f) => apart(e, f))));
}

export function generateBoard(seed: number): Board {
  const random = seededRandom(seed),
    graph = topology(),
    harbours = harbourLayouts(graph);
  const terrain: Terrain[] = [
    'desert',
    ...RESOURCES.flatMap((r) => Array<Terrain>(r === 'brick' || r === 'ore' ? 3 : 4).fill(r)),
  ];
  // Hard limits make an impossible future constraint fail visibly rather than hang or silently relax.
  for (let layout = 0; layout < 10000; layout++) {
    const shuffled = shuffle(terrain, random);
    for (const h of graph.hexes) {
      h.terrain = shuffled[h.id]!;
      h.number = 0;
    }
    if (fairnessIssues(graph).some((issue) => issue.includes('cluster') || issue.includes('spread')))
      continue;
    const land = graph.hexes.filter((h) => h.terrain !== 'desert');
    for (let attempt = 0; attempt < 20000; attempt++) {
      if (!dealNumbers(graph.hexes, land, random) || fairnessIssues(graph).length) continue;
      const resources = shuffle<Resource | 'any'>(['any', 'any', 'any', 'any', ...RESOURCES], random);
      const ports = harbours[Math.floor(random() * harbours.length)]!.map((edge, n) => ({
        edge: edge.id,
        resource: resources[n]!,
      }));
      return { seed: seed >>> 0, preset: 'balanced-v2', ...graph, ports };
    }
  }
  throw new Error('Could not generate a balanced island within the search limit');
}
