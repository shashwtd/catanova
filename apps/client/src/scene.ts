import type { Board, Terrain } from '../../../packages/rules/src/board.js';

export const HEX_SIZE = 64;
export const WORLD = { x: -392, y: -368, width: 784, height: 736 };
export const WATER_BAND = 90;
export const WATER_FEATHER = 48;
/** The square sprite rotates so its long axis follows its coastal edge. */
export const SHIP_SIZE = 80;
export const SHIP_BOUNDS = { x: -SHIP_SIZE / 2, y: -SHIP_SIZE / 2, width: SHIP_SIZE, height: SHIP_SIZE };
export const PORT_BADGE_BOUNDS = { x: -24, y: -11, width: 48, height: 22 };
export const WATER_EDGE_WAVES = [
  { frequency: 5, phase: 0.35, amplitude: 1.7 },
  { frequency: 9, phase: 1.7, amplitude: 0.65 },
] as const;
/** Keep neighboring atlas cells out of the sample, including linear-filter footprints. */
export const MATERIAL_GUTTER = 4;
/** Reflect the same cropped tile across both axes so all four repeat boundaries meet. */
export const MATERIAL_QUADRANTS = [
  { x: 0, y: 0, sx: 1, sy: 1 },
  { x: 2, y: 0, sx: -1, sy: 1 },
  { x: 0, y: 2, sx: 1, sy: -1 },
  { x: 2, y: 2, sx: -1, sy: -1 },
] as const;
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
/** Broad, low-amplitude curves keep the existing coast-following band calm. */
export function waterWidth(angle: number) {
  return WATER_EDGE_WAVES.reduce(
    (width, wave) => width + Math.sin(angle * wave.frequency + wave.phase) * wave.amplitude,
    WATER_BAND,
  );
}
/** One continuous offset coast, not an extra ring of board-game hexagons. */
export function waterOutline(board: Board, inset = 0): ShorePoint[] {
  const coast = coastPoints(board);
  return Array.from({ length: 240 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 240,
      nx = Math.cos(angle),
      ny = Math.sin(angle);
    let low = 0,
      high = 440;
    for (let step = 0; step < 22; step++) {
      const radius = (low + high) / 2;
      if (coastDistance(coast, radius * nx, radius * ny) < waterWidth(angle) - inset) low = radius;
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
  const boatX = x + nx * 38,
    boatY = y + ny * 38;
  // The sprite's long axis is vertical: rotate it tangent to this coast edge.
  // Its exposed left gunwale faces shore; the sail and cargo badge face open water.
  const angle = (Math.atan2(ny, nx) * 180) / Math.PI;
  const tx = -ny,
    ty = nx;
  const badgeDistance = 24 * Math.abs(nx) + 11 * Math.abs(ny) + 24;

  return {
    x,
    y,
    nx,
    ny,
    angle,
    bridges: [a, b].map((v) => ({
      from: { x: v.x * HEX_SIZE, y: v.y * HEX_SIZE },
      to: {
        x: boatX - nx * 14 + tx * (Math.sign((v.x * HEX_SIZE - x) * tx + (v.y * HEX_SIZE - y) * ty) * 13),
        y: boatY - ny * 14 + ty * (Math.sign((v.x * HEX_SIZE - x) * tx + (v.y * HEX_SIZE - y) * ty) * 13),
      },
    })),
    boatX,
    boatY,
    markerX: boatX + nx * badgeDistance,
    markerY: boatY + ny * badgeDistance,
  };
}
