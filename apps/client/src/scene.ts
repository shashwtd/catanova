import type { Board, Terrain } from '../../../packages/rules/src/board.js';

export const HEX_SIZE = 64;
export const WORLD = { x: -440, y: -402, width: 880, height: 804 };
export const TERRAIN_INDEX: Record<Terrain, number> = {
  wood: 0,
  brick: 1,
  sheep: 2,
  wheat: 3,
  ore: 4,
  desert: 5,
};
export const SPRITE_INDEX = {
  wood: 0,
  brick: 1,
  sheep: 2,
  wheat: 3,
  ore: 4,
  any: 5,
  dock: 6,
  boat: 7,
} as const;
export function oceanRing() {
  const cells: { q: number; r: number; x: number; y: number }[] = [];
  for (let r = -3; r <= 3; r++)
    for (let q = -3; q <= 3; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) !== 3) continue;
      cells.push({ q, r, x: Math.sqrt(3) * (q + r / 2) * HEX_SIZE, y: r * 1.5 * HEX_SIZE });
    }
  return cells;
}
export function hexPoints(x: number, y: number, radius = HEX_SIZE) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((i * 60 - 90) * Math.PI) / 180;
    return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
  }).join(' ');
}
/** Only exposed sea edges; internal tile seams must never receive the wooden outer rim. */
export function oceanBoundary() {
  const neighbors = [
    [1, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
  ];
  return oceanRing().flatMap((cell) =>
    neighbors.flatMap(([dq, dr], i) => {
      const q = cell.q + dq!,
        r = cell.r + dr!;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3) return [];
      const a = ((i * 60 - 90) * Math.PI) / 180,
        b = a + Math.PI / 3;
      return [
        [
          cell.x + Math.cos(a) * HEX_SIZE,
          cell.y + Math.sin(a) * HEX_SIZE,
          cell.x + Math.cos(b) * HEX_SIZE,
          cell.y + Math.sin(b) * HEX_SIZE,
        ],
      ];
    }),
  );
}
export function coastline(board: Board): string {
  const edges = board.edges.filter((e) => e.hexes.length === 1);
  const first = edges[0]!;
  const points = [first.a];
  let current = first.b,
    previous = first.a;
  while (current !== first.a) {
    points.push(current);
    const edge = edges.find(
      (e) => (e.a === current && e.b !== previous) || (e.b === current && e.a !== previous),
    )!;
    const next = edge.a === current ? edge.b : edge.a;
    previous = current;
    current = next;
  }
  return points
    .map((id) => `${board.vertices[id]!.x * HEX_SIZE},${board.vertices[id]!.y * HEX_SIZE}`)
    .join(' ');
}
/** The normal is perpendicular to this exact coast edge, not a ray from the island center. */
export function portPlacement(board: Board, edgeId: number) {
  const e = board.edges[edgeId]!;
  if (e.hexes.length !== 1) throw new Error('Ports require a coastal edge');
  const a = board.vertices[e.a]!,
    b = board.vertices[e.b]!,
    h = board.hexes[e.hexes[0]!]!;
  const x = ((a.x + b.x) * HEX_SIZE) / 2,
    y = ((a.y + b.y) * HEX_SIZE) / 2;
  const dx = x - h.x * HEX_SIZE,
    dy = y - h.y * HEX_SIZE,
    length = Math.hypot(dx, dy);
  const nx = dx / length,
    ny = dy / length;
  return {
    x,
    y,
    nx,
    ny,
    angle: (Math.atan2(nx, -ny) * 180) / Math.PI,
    markerX: x + nx * 70,
    markerY: y + ny * 70,
  };
}
