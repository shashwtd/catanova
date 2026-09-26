import { NUMBER_SPIRAL, RESOURCES } from './index.js';
import type { Resource } from './index.js';

export type Terrain = Resource | 'desert' | 'gold' | 'sea';
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
   * The BoardPreset that dealt this board: a seed reproduces a board only under its own preset. New Classic
   * boards are balanced-v2; saved games keep the board JSON they were dealt, so balanced-v1 boards stay
   * valid.
   */
  preset: 'balanced-v1' | 'balanced-v2' | 'big-table-balanced-v1' | 'outer-isles-v1';
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
  /**
   * The desert the robber starts on, for a preset that chooses it: Big Table picks one of its two deserts
   * with the seed. Classic boards leave it out, having only the one.
   */
  robberStart?: number;
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
export const hexDistance = (a: Pick<Hex, 'q' | 'r'>, b: Pick<Hex, 'q' | 'r'>) =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

/** A hex's place on the board in axial coordinates: `r` counts rows down, `q` steps right along a row. */
export type Axial = { q: number; r: number };
/** Every hex on a board, in id order. */
export type BoardShape = readonly Axial[];
/** The hexes within `radius` steps of the origin, row by row from the top and left to right along each row. */
export function hexagon(radius: number): Axial[] {
  const shape: Axial[] = [];
  for (let r = -radius; r <= radius; r++)
    for (let q = Math.max(-radius, -r - radius); q <= Math.min(radius, -r + radius); q++)
      shape.push({ q, r });
  return shape;
}
/** The Classic island: 19 hexes, radius 2. */
export const CLASSIC_SHAPE: BoardShape = hexagon(2);

/**
 * The hexes, corners and edges of a board, numbered in the order the shape lists its hexes. Positions are in
 * hex radii, and the middle of the board's extent sits on the origin, where the renderer centres its scene; a
 * shape centred on a hex, like the Classic island, is not moved at all.
 */
export function topology(shape: BoardShape = CLASSIC_SHAPE): Omit<Board, 'seed' | 'preset' | 'ports'> {
  const hexes: Hex[] = [],
    vertices: Vertex[] = [],
    edges: Edge[] = [];
  const pointIds = new Map<string, number>(),
    edgeIds = new Map<string, number>();
  const centre = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  const cx = centre(shape.map(({ q, r }) => Math.sqrt(3) * (q + r / 2))),
    cy = centre(shape.map(({ r }) => 1.5 * r));
  const seen = new Set<string>();
  for (const { q, r } of shape) {
    if (!Number.isInteger(q) || !Number.isInteger(r))
      throw new Error(`The board shape has ${q},${r}, which is not a hex`);
    if (seen.has(`${q},${r}`)) throw new Error(`The board shape lists ${q},${r} twice`);
    seen.add(`${q},${r}`);
    const h: Hex = {
      id: hexes.length,
      q,
      r,
      x: Math.sqrt(3) * (q + r / 2) - cx,
      y: 1.5 * r - cy,
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

/**
 * Whether a hex is land. Classic and Big Table boards are all land; Open Sea makes the sea out of hexes of
 * its own terrain (docs/BIGGER-MAPS-AND-MODES.md, Phase 2). Whatever looks for the coast asks this, rather
 * than counting an edge's hexes, because once the sea is hexes too every inland-looking edge touches two.
 */
export const isLand = (hex: { terrain: string }) => hex.terrain !== 'sea';
/**
 * An edge is on the coast when exactly one of the hexes it touches is land. That is an edge between land and sea,
 * or an edge of a land hex at the rim of the board, where nothing lies beyond. The rim of a sea hex is open water.
 */
export const isCoastalEdge = (board: Pick<Board, 'hexes'>, edge: Edge) =>
  edge.hexes.filter((id) => isLand(board.hexes[id]!)).length === 1;
/** The land side of a coastal edge: the hex its harbour serves and its ship moors off. */
export function shoreHex(board: Pick<Board, 'hexes'>, edge: Edge): Hex {
  const land = edge.hexes.map((id) => board.hexes[id]!).filter(isLand);
  if (land.length !== 1) throw new Error('Only a coastal edge has a shore');
  return land[0]!;
}

const red = (n: number) => n === 6 || n === 8;
/**
 * Numbers that may not share a border, and the issue each pairing raises. Red numbers together stack the
 * likeliest rolls in one place, equal numbers pay out twice to every corner they share, and a 2 beside the 12
 * leaves a patch of island that almost never produces. The official A–R number spiral never does any of these.
 * balanced-v2 added the equal-number and 2/12 rules, which a balanced-v1 board in a saved game may break.
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

/** The limits a balanced deal must keep within, besides BORDER_RULES, which fairnessIssues always checks. */
export type FairnessRules = {
  /** The most hexes of one resource that may touch one another as a group. */
  largestCluster: number;
  /** Some two hexes of each resource must be at least this many steps apart. */
  spread: number;
  /** A resource's pips, per hex of it: its total must be within this range, the lower end rounded up. */
  pipsPerHex: readonly [low: number, high: number];
  /** The most pips one corner may touch. */
  cornerPips: number;
  /** Big Table: no two deserts border each other, which would make one wider dead patch. */
  desertsApart?: boolean;
};
/** The limits balanced-v1 and balanced-v2 both deal within. */
export const BALANCED_FAIRNESS: FairnessRules = {
  largestCluster: 2,
  spread: 3,
  pipsPerHex: [2.5, 4],
  cornerPips: 11,
};

/** Inspectable constraints: fairness means bounded extremes, not identical starting spots. */
export function fairnessIssues(
  board: Pick<Board, 'hexes' | 'vertices'>,
  rules: FairnessRules = BALANCED_FAIRNESS,
): string[] {
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
      if (size > rules.largestCluster)
        issues.push(`${resource}: cluster larger than ${rules.largestCluster}`);
    }
    if (!tiles.some((a) => tiles.some((b) => hexDistance(a, b) >= rules.spread)))
      issues.push(`${resource}: insufficient spread`);
    const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
    const [low, high] = rules.pipsPerHex;
    if (production < Math.ceil(tiles.length * low) || production > tiles.length * high)
      issues.push(`${resource}: production outside range`);
  }
  for (const [issue, clash] of BORDER_RULES)
    for (const h of board.hexes)
      if (h.neighbors.some((n) => clash(h.number, board.hexes[n]!.number))) issues.push(issue);
  for (const v of board.vertices)
    if (v.hexes.reduce((sum, h) => sum + pips(board.hexes[h]!.number), 0) > rules.cornerPips)
      issues.push(`Intersection above ${rules.cornerPips} pips`);
  if (
    rules.desertsApart &&
    board.hexes.some(
      (h) => h.terrain === 'desert' && h.neighbors.some((n) => board.hexes[n]!.terrain === 'desert'),
    )
  )
    issues.push('Deserts border each other');
  return issues;
}

/**
 * Deals the number tokens onto `numbered` in a uniformly random order, giving up as soon as a token lands beside
 * one it may not touch. Every deal abandoned here would fail fairnessIssues anyway, so accepted numberings stay
 * uniformly random among the valid ones, exactly as with whole shuffles; most failures just cost a few draws
 * instead of a full check. Returns whether the deal completed.
 */
function dealNumbers(
  hexes: readonly Hex[],
  numbered: readonly Hex[],
  numbers: readonly number[],
  random: () => number,
): boolean {
  const tokens: number[] = [...numbers];
  for (const h of numbered) h.number = 0;
  for (let i = 0; i < numbered.length; i++) {
    const j = i + Math.floor(random() * (tokens.length - i));
    [tokens[i], tokens[j]] = [tokens[j]!, tokens[i]!];
    const token = tokens[i]!;
    if (numbered[i]!.neighbors.some((n) => CLASHES[token]![hexes[n]!.number])) return false;
    numbered[i]!.number = token;
  }
  return true;
}

/**
 * The harbour edges of each rotation of the slots that keeps harbours off the same and neighbouring sea
 * spaces. With the Classic island's nine harbours on its eighteen sea spaces, that makes harbour and open sea
 * alternate all the way round, as on the fixed frame in docs/SETUP.md, with harbours off three of the six tips.
 * The other four of every ten rotations put three pairs of harbours side by side and leave every tip bare.
 */
function harbourLayouts(
  graph: Pick<Board, 'hexes' | 'vertices' | 'edges'>,
  slots: readonly number[],
): Edge[][] {
  // Twice the edge's midpoint. Its angle orders the coast, and subtracting the land hex's centre gives the centre
  // of the sea space across the edge: neighbouring sea spaces are √3 apart, any other two at least 3.
  const out = (e: Edge) => ({
    x: graph.vertices[e.a]!.x + graph.vertices[e.b]!.x,
    y: graph.vertices[e.a]!.y + graph.vertices[e.b]!.y,
  });
  const sea = (e: Edge) => ({
    x: out(e).x - shoreHex(graph, e).x,
    y: out(e).y - shoreHex(graph, e).y,
  });
  const apart = (e: Edge, f: Edge) => Math.hypot(sea(e).x - sea(f).x, sea(e).y - sea(f).y) > 2;
  const coast = graph.edges
    .filter((e) => isCoastalEdge(graph, e))
    .sort((a, b) => Math.atan2(out(a).y, out(a).x) - Math.atan2(out(b).y, out(b).x));
  if (coast.length <= Math.max(...slots))
    throw new Error('The harbour slots go round past the end of the coast');
  return coast
    .map((_, offset) => slots.map((slot) => coast[(slot + offset) % coast.length]!))
    .filter((edges) => edges.every((e, i) => edges.slice(i + 1).every((f) => apart(e, f))));
}

/** How many hexes of each terrain a preset deals. Gold and sea are Open Sea's; others leave them out. */
export type TerrainCounts = Readonly<
  Record<Resource | 'desert', number> & Partial<Record<'gold' | 'sea', number>>
>;
/** The order a preset's terrain counts are laid out in before they are shuffled. */
const TERRAINS: readonly (Resource | 'desert')[] = ['desert', ...RESOURCES];
/**
 * One way to deal a board: its shape, the tiles, numbers and harbours dealt onto it, and the rules a deal must
 * pass. Every board records the id of the preset that dealt it, since a seed reproduces a board only under the
 * same preset.
 */
export type BoardPreset = {
  id: Board['preset'];
  shape: BoardShape;
  /** How many hexes of each terrain; together, every hex in the shape. Only an Open Sea shape has sea. */
  terrain: TerrainCounts;
  /** The number tokens, one for each land hex that is not desert. */
  numbers: readonly number[];
  harbours: {
    /** Where the harbours go, as coastal edges counted round from wherever the dealer starts. */
    slots: readonly number[];
    /** What each harbour trades, shuffled onto the slots: 'any' at 3:1, or one resource at 2:1. */
    trades: readonly (Resource | 'any')[];
  };
  /**
   * How the deal is searched for; each generator deals only boards with no fairnessIssues under `fairness`.
   * 'balanced' shuffles the terrain until it keeps the terrain rules, then deals numbers onto it (Classic).
   * 'numbers-first' picks the deserts, deals the numbers, then shuffles the terrain onto them (Big Table).
   */
  generator: 'balanced' | 'numbers-first';
  fairness: FairnessRules;
};
/** The Classic island as Catanova deals it by default: see docs/MAP_GENERATION.md. */
export const BALANCED_V2: BoardPreset = {
  id: 'balanced-v2',
  shape: CLASSIC_SHAPE,
  terrain: { desert: 1, wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3 },
  numbers: NUMBER_SPIRAL,
  // Nine harbours round the 30 coastal edges, spaced 3, 3 and 4 edges apart.
  harbours: { slots: [0, 3, 6, 10, 13, 16, 20, 23, 26], trades: ['any', 'any', 'any', 'any', ...RESOURCES] },
  generator: 'balanced',
  fairness: BALANCED_FAIRNESS,
};

/** The five-and-six-player island: rows of 3, 4, 5, 6, 5, 4 and 3 hexes, each centred under the last. */
export const BIG_TABLE_SHAPE: BoardShape = [3, 4, 5, 6, 5, 4, 3].flatMap((length, row) =>
  Array.from({ length }, (_, k) => ({ q: Math.max(-3, -row) + k, r: row - 3 })),
);
/** Big Table's island, Catanova's balanced rules adapted to 30 hexes: see docs/MAP_GENERATION.md. */
export const BIG_TABLE_BALANCED_V1: BoardPreset = {
  id: 'big-table-balanced-v1',
  shape: BIG_TABLE_SHAPE,
  terrain: { desert: 2, wood: 6, brick: 5, sheep: 6, wheat: 6, ore: 5 },
  // Two each of 2 and 12, and three of every other number.
  numbers: [2, 2, 12, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap((n) => [n, n, n])],
  // Eleven harbours round the 38 coastal edges, spaced 3, 3, 4, 3, 4, 3, 4, 3, 4, 3 and 4 edges apart, two of
  // them for Sheep.
  harbours: {
    slots: [0, 3, 6, 10, 13, 17, 20, 24, 27, 31, 34],
    trades: ['any', 'any', 'any', 'any', 'any', 'sheep', ...RESOURCES],
  },
  generator: 'numbers-first',
  fairness: { ...BALANCED_FAIRNESS, spread: 4, desertsApart: true },
};

/**
 * The presets that deal new boards, the default first: Classic's, then Big Table's. balanced-v1 deals no more
 * boards; the ones it dealt live on in saved games, which keep the board JSON they were dealt.
 */
export const BOARD_PRESETS: readonly [BoardPreset, ...BoardPreset[]] = [BALANCED_V2, BIG_TABLE_BALANCED_V1];
/** Deals a board from `preset`, Classic's by default. A seed reproduces a board only under its preset. */
export function generateBoard(seed: number, preset: BoardPreset = BOARD_PRESETS[0]): Board {
  if (preset.generator === 'numbers-first') return dealNumbersFirst(seed, preset);
  const random = seededRandom(seed),
    graph = topology(preset.shape),
    land = graph.hexes.filter(isLand),
    harbours = harbourLayouts(graph, preset.harbours.slots);
  const terrain = TERRAINS.flatMap((t) => Array<Terrain>(preset.terrain[t]).fill(t));
  // A preset that cannot be dealt says so before any search, rather than failing somewhere inside one.
  if (terrain.length !== land.length)
    throw new Error(`${preset.id} deals ${terrain.length} tiles onto ${land.length} hexes`);
  if (preset.numbers.length !== land.length - preset.terrain.desert)
    throw new Error(
      `${preset.id} has ${preset.numbers.length} numbers for ${land.length - preset.terrain.desert} hexes`,
    );
  if (preset.harbours.trades.length !== preset.harbours.slots.length)
    throw new Error(
      `${preset.id} has ${preset.harbours.trades.length} trades for ${preset.harbours.slots.length} harbours`,
    );
  if (!harbours.length) throw new Error(`${preset.id} has no way to lay out its harbours`);
  // Hard limits make an impossible future constraint fail visibly rather than hang or silently relax.
  for (let layout = 0; layout < 10000; layout++) {
    const shuffled = shuffle(terrain, random);
    for (const [i, h] of land.entries()) h.terrain = shuffled[i]!;
    for (const h of graph.hexes) h.number = 0;
    if (
      fairnessIssues(graph, preset.fairness).some(
        (issue) => issue.includes('cluster') || issue.includes('spread'),
      )
    )
      continue;
    const numbered = land.filter((h) => h.terrain !== 'desert');
    for (let attempt = 0; attempt < 20000; attempt++) {
      if (
        !dealNumbers(graph.hexes, numbered, preset.numbers, random) ||
        fairnessIssues(graph, preset.fairness).length
      )
        continue;
      const trades = shuffle(preset.harbours.trades, random);
      const ports = harbours[Math.floor(random() * harbours.length)]!.map((edge, n) => ({
        edge: edge.id,
        resource: trades[n]!,
      }));
      return { seed: seed >>> 0, preset: preset.id, ...graph, ports };
    }
  }
  throw new Error('Could not generate a balanced island within the search limit');
}

/**
 * Big Table's search, numbers first, as docs/MAP_GENERATION.md describes: on 30 hexes the number rules are
 * the hard part, and they depend only on where the deserts are. It picks the deserts, deals numbers onto the
 * other hexes until they keep the number rules, then shuffles the resource tiles on until the terrain rules
 * hold.
 */
function dealNumbersFirst(seed: number, preset: BoardPreset): Board {
  const random = seededRandom(seed),
    graph = topology(preset.shape),
    harbours = harbourLayouts(graph, preset.harbours.slots),
    rules = preset.fairness;
  const resources = RESOURCES.flatMap((t) => Array<Terrain>(preset.terrain[t]).fill(t));
  const tiles = resources.length + preset.terrain.desert;
  if (tiles !== graph.hexes.length)
    throw new Error(`${preset.id} deals ${tiles} tiles onto ${graph.hexes.length} hexes`);
  if (preset.numbers.length !== resources.length)
    throw new Error(`${preset.id} has ${preset.numbers.length} numbers for ${resources.length} hexes`);
  if (preset.harbours.trades.length !== preset.harbours.slots.length)
    throw new Error(
      `${preset.id} has ${preset.harbours.trades.length} trades for ${preset.harbours.slots.length} harbours`,
    );
  if (!harbours.length) throw new Error(`${preset.id} has no way to lay out its harbours`);
  // Every set of hexes the deserts may take, in hex id order: on the Big Table island, 364 of the 435 pairs.
  const places = hexSets(graph.hexes, preset.terrain.desert, !!rules.desertsApart);
  if (!places.length) throw new Error(`${preset.id} has nowhere to put its deserts`);
  // Hard limits make an impossible future constraint fail visibly rather than hang or silently relax.
  for (let pick = 0; pick < 10; pick++) {
    const place = places[Math.floor(random() * places.length)]!,
      deserts = graph.hexes.filter((h) => place & (1 << h.id)).map((h) => h.id);
    for (const h of graph.hexes) {
      h.terrain = 'desert';
      h.number = 0;
    }
    const land = graph.hexes.filter((h) => !deserts.includes(h.id));
    const deal = numberDealer(graph, land, preset.numbers, rules.cornerPips, random, true);
    // Each deal of the numbers and each terrain shuffle is one try against the same limit.
    let tries = 0;
    while (tries < 1_000_000) {
      tries++;
      if (!deal()) continue;
      for (let layout = 0; layout < 10000 && tries < 1_000_000; layout++, tries++) {
        const shuffled = shuffle(resources, random);
        for (const [i, h] of land.entries()) h.terrain = shuffled[i]!;
        if (
          !clustersWithin(graph, land, rules.largestCluster) ||
          !spreadAtLeast(land, rules.spread) ||
          !productionWithin(land, rules.pipsPerHex)
        )
          continue;
        const layoutEdges = harbours[Math.floor(random() * harbours.length)]!;
        const trades = shuffle(preset.harbours.trades, random);
        const ports = layoutEdges.map((edge, n) => ({ edge: edge.id, resource: trades[n]! }));
        const robberStart = deserts[Math.floor(random() * deserts.length)]!;
        return checked({ seed: seed >>> 0, preset: preset.id, ...graph, ports, robberStart }, rules);
      }
    }
  }
  throw new Error('Could not generate a balanced island within the search limit');
}

/**
 * Deals `numbers` onto `hexes`, one uniformly random deal per call, and says whether the deal keeps the
 * number rules: BORDER_RULES between neighbours and at most `cap` pips on a corner. A deal stops at the first
 * token that breaks one; the full check would reject it anyway, so every valid numbering stays equally
 * likely, as in dealNumbers. Tokens go down strongest first, each on a random
 * free hex, so most failing deals fail within a few tokens. A deal that keeps the rules is written onto the
 * hexes.
 *
 * With `redsApart`, the red numbers go down first on one of the sets of hexes where no two of them border
 * each other, drawn uniformly from every such set, in a random order; the other tokens are then dealt round
 * them. Only a red number can clash with a red number, and every red number has five pips, so this is exactly
 * the deal a uniform shuffle makes once its red numbers are apart, without the deals that put two of them
 * side by side. On the Big Table island only 3 to 4 uniform deals in 100 keep the six red numbers apart.
 */
function numberDealer(
  graph: Pick<Board, 'hexes' | 'vertices'>,
  hexes: readonly Hex[],
  numbers: readonly number[],
  cap: number,
  random: () => number,
  redsApart = false,
): () => boolean {
  const ids = hexes.map((h) => h.id),
    dealt = new Set(ids);
  // Only a neighbour in this deal can clash: every other hex carries no number yet, or never will.
  const neighbours = graph.hexes.map((h) => (dealt.has(h.id) ? h.neighbors.filter((n) => dealt.has(n)) : []));
  const corners = graph.hexes.map((h) => h.vertices);
  const reds = redsApart ? numbers.filter(red) : [];
  const tokens = numbers.filter((n) => !redsApart || !red(n)).sort((a, b) => pips(b) - pips(a) || a - b);
  const tokenPips = tokens.map(pips),
    redPips = pips(6);
  const sets = reds.length ? hexSets(hexes, reds.length, true) : new Int32Array();
  const num = new Int32Array(graph.hexes.length),
    sum = new Int32Array(graph.vertices.length),
    redHexes = new Int32Array(reds.length);
  return () => {
    num.fill(0);
    sum.fill(0);
    if (reds.length) {
      if (!sets.length || redPips > cap) return false;
      // Numbered in set order for now; the red numbers are shuffled onto these hexes once the deal holds.
      let set = sets[Math.floor(random() * sets.length)]!;
      for (let i = 0; set; i++, set &= set - 1) {
        const h = hexes[31 - Math.clz32(set & -set)]!.id,
          at = corners[h]!;
        redHexes[i] = h;
        num[h] = reds[i]!;
        for (let k = 0; k < at.length; k++) sum[at[k]!]! += redPips;
      }
    }
    for (let t = 0; t < tokens.length; t++) {
      // A uniformly random hex without a number yet: draw again while the draw lands on a numbered one.
      let h = ids[Math.floor(random() * ids.length)]!;
      while (num[h]) h = ids[Math.floor(random() * ids.length)]!;
      const clash = CLASHES[tokens[t]!]!,
        near = neighbours[h]!,
        at = corners[h]!,
        p = tokenPips[t]!;
      for (let k = 0; k < near.length; k++) if (clash[num[near[k]!]!]) return false;
      for (let k = 0; k < at.length; k++) if (sum[at[k]!]! + p > cap) return false;
      for (let k = 0; k < at.length; k++) sum[at[k]!]! += p;
      num[h] = tokens[t]!;
    }
    shuffle(reds, random).forEach((n, i) => (num[redHexes[i]!] = n));
    for (const h of ids) graph.hexes[h]!.number = num[h]!;
    return true;
  };
}

/**
 * Every set of `size` hexes out of `hexes`, each as a bitmask of their places in `hexes`, in order. With
 * `apart`, only the sets where no two hexes border each other. A bitmask holds 31 hexes, as many as it needs.
 */
function hexSets(hexes: readonly Hex[], size: number, apart: boolean): Int32Array {
  if (hexes.length > 31) throw new Error(`Sets of ${hexes.length} hexes do not fit a bitmask`);
  const place = new Map(hexes.map((h, i) => [h.id, i]));
  const near = hexes.map((h) =>
    h.neighbors.reduce((mask, n) => (place.has(n) ? mask | (1 << place.get(n)!) : mask), 0),
  );
  const sets: number[] = [];
  const choose = (chosen: number, from: number, set: number, blocked: number) => {
    if (chosen === size) return void sets.push(set);
    for (let i = from; i <= hexes.length - size + chosen; i++)
      if (!(blocked & (1 << i))) choose(chosen + 1, i + 1, set | (1 << i), apart ? blocked | near[i]! : 0);
  };
  choose(0, 0, 0, 0);
  return Int32Array.from(sets);
}

const isResource = (terrain: Terrain): terrain is Resource =>
  (RESOURCES as readonly Terrain[]).includes(terrain);
/** Rule 1 on `hexes`: no group of touching tiles of one resource there is larger than `largest`. */
function clustersWithin(graph: Pick<Board, 'hexes'>, hexes: readonly Hex[], largest: number): boolean {
  const seen = new Uint8Array(graph.hexes.length);
  for (const start of hexes) {
    if (seen[start.id] || !isResource(start.terrain)) continue;
    const group = [start.id];
    seen[start.id] = 1;
    for (let i = 0; i < group.length; i++)
      for (const n of graph.hexes[group[i]!]!.neighbors)
        if (!seen[n] && graph.hexes[n]!.terrain === start.terrain) {
          seen[n] = 1;
          group.push(n);
        }
    if (group.length > largest) return false;
  }
  return true;
}
/** Rule 2 on `hexes`: some two tiles of each resource there are at least `steps` apart. */
function spreadAtLeast(hexes: readonly Hex[], steps: number): boolean {
  return RESOURCES.every((resource) => {
    const tiles = hexes.filter((h) => h.terrain === resource);
    return tiles.some((a) => tiles.some((b) => hexDistance(a, b) >= steps));
  });
}
/** Rule 3 on `hexes`: each resource's tiles there carry pips within `range` per tile. */
function productionWithin(hexes: readonly Hex[], range: readonly [number, number]): boolean {
  return RESOURCES.every((resource) =>
    pipsWithin(
      hexes.filter((h) => h.terrain === resource),
      range,
    ),
  );
}
/** Whether `tiles` carry between `low` and `high` pips per tile, the lower bound rounded up. */
function pipsWithin(tiles: readonly Hex[], [low, high]: readonly [number, number]): boolean {
  const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
  return production >= Math.ceil(tiles.length * low) && production <= tiles.length * high;
}
/**
 * A dealt board, once fairnessIssues agrees that it keeps its preset's rules. The searches test the rules
 * piece by piece as they deal; this is the whole check, once per board, so that the two can never disagree
 * unseen.
 */
function checked(board: Board, rules: FairnessRules): Board {
  const issues = fairnessIssues(board, rules);
  if (issues.length)
    throw new Error(`${board.preset} dealt a board that breaks its rules: ${issues.join(', ')}`);
  return board;
}
