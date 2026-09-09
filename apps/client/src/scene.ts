import type { Board, Terrain } from '../../../packages/rules/src/board.js';

export const HEX_SIZE = 64;
export const WORLD = { x: -392, y: -368, width: 784, height: 736 };
export const WATER_BAND = 90;
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
export function hexPoints(x: number, y: number, radius = HEX_SIZE) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((i * 60 - 90) * Math.PI) / 180;
    return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
  }).join(' ');
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
export type ShorePoint = { x: number; y: number };
export function coastPoints(board: Board): ShorePoint[] {
  return coastline(board)
    .split(' ')
    .map((point) => {
      const [x, y] = point.split(',').map(Number);
      return { x: x!, y: y! };
    });
}
/** Exact distance to the shared coastline; negative within land. */
export function coastDistance(points: readonly ShorePoint[], x: number, y: number) {
  let nearest = Infinity,
    inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? -nearest : nearest;
}
/** The same four gentle irregularities are used by the shader's outer water edge. */
export function waterWidth(angle: number) {
  return (
    WATER_BAND +
    Math.sin(angle * 11 + 0.35) * 3.8 +
    Math.sin(angle * 23 + 1.7) * 2.6 +
    Math.sin(angle * 41 + 0.6) * 1.8 +
    Math.sin(angle * 73) * 0.8
  );
}
/** One continuous offset coast, not an extra ring of board-game hexagons. */
export function waterOutline(board: Board): ShorePoint[] {
  const coast = coastPoints(board);
  return Array.from({ length: 240 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 240,
      nx = Math.cos(angle),
      ny = Math.sin(angle);
    let low = 0,
      high = 440;
    for (let step = 0; step < 22; step++) {
      const radius = (low + high) / 2;
      if (coastDistance(coast, radius * nx, radius * ny) < waterWidth(angle)) low = radius;
      else high = radius;
    }
    return { x: ((low + high) / 2) * nx, y: ((low + high) / 2) * ny };
  });
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
    bridges: [a, b].map((v) => ({
      from: { x: v.x * HEX_SIZE, y: v.y * HEX_SIZE },
      to: { x: x + nx * 32, y: y + ny * 32 },
    })),
    boatX: x + nx * 49,
    boatY: y + ny * 49,
    markerX: x + nx * 52 + ny * 35,
    markerY: y + ny * 52 - nx * 35,
  };
}
