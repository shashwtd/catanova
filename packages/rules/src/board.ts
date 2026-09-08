import { NUMBER_SPIRAL, RESOURCES } from './index.js';
import type { Resource } from './index.js';

export type Terrain = Resource | 'desert';
export type Hex = { id: number; q: number; r: number; x: number; y: number; terrain: Terrain; number: number; vertices: number[]; neighbors: number[] };
export type Vertex = { id: number; x: number; y: number; hexes: number[]; neighbors: number[]; edges: number[] };
export type Edge = { id: number; a: number; b: number; hexes: number[] };
export type Port = { edge: number; resource: Resource | 'any' };
export type Board = { seed: number; preset: 'balanced-v1'; hexes: Hex[]; vertices: Vertex[]; edges: Edge[]; ports: Port[] };
export const pips = (n: number) => n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0;
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle<T>(input: readonly T[], random: () => number): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
export const hexDistance = (a: Hex, b: Hex) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

export function topology(): Omit<Board, 'seed' | 'preset' | 'ports'> {
  const hexes: Hex[] = [], vertices: Vertex[] = [], edges: Edge[] = [];
  const pointIds = new Map<string, number>(), edgeIds = new Map<string, number>();
  for (let r = -2; r <= 2; r++) for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
    const h: Hex = { id: hexes.length, q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r, terrain: 'desert', number: 0, vertices: [], neighbors: [] };
    for (let k = 0; k < 6; k++) {
      const angle = Math.PI / 180 * (60 * k - 90);
      const x = h.x + Math.cos(angle), y = h.y + Math.sin(angle);
      const key = `${Math.round(x * 10000)},${Math.round(y * 10000)}`;
      let id = pointIds.get(key);
      if (id === undefined) { id = vertices.length; pointIds.set(key, id); vertices.push({ id, x, y, hexes: [], neighbors: [], edges: [] }); }
      vertices[id]!.hexes.push(h.id); h.vertices.push(id);
    }
    for (let k = 0; k < 6; k++) {
      const a = h.vertices[k]!, b = h.vertices[(k + 1) % 6]!;
      const key = [a, b].sort((a, b) => a - b).join(',');
      let id = edgeIds.get(key);
      if (id === undefined) {
        id = edges.length; edgeIds.set(key, id); edges.push({ id, a, b, hexes: [] });
        vertices[a]!.neighbors.push(b); vertices[b]!.neighbors.push(a);
        vertices[a]!.edges.push(id); vertices[b]!.edges.push(id);
      }
      edges[id]!.hexes.push(h.id);
    }
    hexes.push(h);
  }
  for (const h of hexes) h.neighbors = hexes.filter(other => hexDistance(h, other) === 1).map(other => other.id);
  return { hexes, vertices, edges };
}

/** Inspectable constraints: fairness means bounded extremes, not identical starting spots. */
export function fairnessIssues(board: Pick<Board, 'hexes' | 'vertices'>): string[] {
  const issues: string[] = [];
  for (const resource of RESOURCES) {
    const tiles = board.hexes.filter(h => h.terrain === resource);
    const visited = new Set<number>();
    for (const tile of tiles) {
      if (visited.has(tile.id)) continue;
      const stack = [tile.id]; let size = 0;
      while (stack.length) {
        const id = stack.pop()!; if (visited.has(id)) continue; visited.add(id); size++;
        stack.push(...board.hexes[id]!.neighbors.filter(n => board.hexes[n]!.terrain === resource && !visited.has(n)));
      }
      if (size > 2) issues.push(`${resource}: cluster larger than two`);
    }
    if (!tiles.some(a => tiles.some(b => hexDistance(a, b) >= 3))) issues.push(`${resource}: insufficient spread`);
    const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
    if (production < Math.ceil(tiles.length * 2.5) || production > tiles.length * 4) issues.push(`${resource}: production outside range`);
  }
  for (const h of board.hexes) if ((h.number === 6 || h.number === 8) && h.neighbors.some(n => [6, 8].includes(board.hexes[n]!.number))) issues.push('Adjacent red numbers');
  for (const v of board.vertices) if (v.hexes.reduce((sum, h) => sum + pips(board.hexes[h]!.number), 0) > 11) issues.push('Intersection above 11 pips');
  return issues;
}

export function generateBoard(seed: number): Board {
  const random = seededRandom(seed), graph = topology();
  const terrain: Terrain[] = ['desert', ...RESOURCES.flatMap(r => Array<Terrain>(r === 'brick' || r === 'ore' ? 3 : 4).fill(r))];
  // Hard limits make an impossible future constraint fail visibly rather than hang or silently relax.
  for (let layout = 0; layout < 10000; layout++) {
    const shuffled = shuffle(terrain, random);
    for (const h of graph.hexes) { h.terrain = shuffled[h.id]!; h.number = 0; }
    if (fairnessIssues(graph).some(issue => issue.includes('cluster') || issue.includes('spread'))) continue;
    for (let attempt = 0; attempt < 20000; attempt++) {
      const numbers = shuffle(NUMBER_SPIRAL, random); let n = 0;
      for (const h of graph.hexes) h.number = h.terrain === 'desert' ? 0 : numbers[n++]!;
      if (fairnessIssues(graph).length) continue;
      const coast = graph.edges.filter(e => e.hexes.length === 1).sort((a, b) => {
        const mid = (e: Edge) => Math.atan2(graph.vertices[e.a]!.y + graph.vertices[e.b]!.y, graph.vertices[e.a]!.x + graph.vertices[e.b]!.x);
        return mid(a) - mid(b);
      });
      const resources = shuffle<Resource | 'any'>(['any', 'any', 'any', 'any', ...RESOURCES], random);
      const offset = Math.floor(random() * coast.length);
      const ports = [0, 3, 6, 10, 13, 16, 20, 23, 26].map((i, n) => ({ edge: coast[(i + offset) % coast.length]!.id, resource: resources[n]! }));
      return { seed: seed >>> 0, preset: 'balanced-v1', ...graph, ports };
    }
  }
  throw new Error('Could not generate a balanced island within the search limit');
}
