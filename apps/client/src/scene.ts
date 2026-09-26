import { isCoastalEdge, shoreHex, topology } from '../../../packages/rules/src/board.js';
import type { Board, Terrain } from '../../../packages/rules/src/board.js';

export const HEX_SIZE = 64;
export const WATER_BAND = 90;
export const WATER_FEATHER = 48;
/** Room round the island for the water band, WATER_BAND and its waves, and some 20 units of table past its fade. */
export const WORLD_MARGIN = 112;
export type WorldBox = { x: number; y: number; width: number; height: number };
/**
 * The part of the world a board's scene covers: the board's extent and WORLD_MARGIN round it, rounded out to
 * whole steps of 8 units. The SVG's viewBox, the terrain shader and the camera all frame this box.
 */
export function worldBox(board: Pick<Board, 'vertices'>): WorldBox {
  const xs = board.vertices.map((v) => v.x * HEX_SIZE),
    ys = board.vertices.map((v) => v.y * HEX_SIZE);
  // The tolerance keeps floating-point dust on a side that lands on a step from pushing it out a whole step.
  const down = (n: number) => Math.floor((n - WORLD_MARGIN) / 8 + 1e-9) * 8,
    up = (n: number) => Math.ceil((n + WORLD_MARGIN) / 8 - 1e-9) * 8;
  const x = down(Math.min(...xs)),
    y = down(Math.min(...ys));
  return { x, y, width: up(Math.max(...xs)) - x, height: up(Math.max(...ys)) - y };
}
/** The Classic island's box, x -392, y -368, 784 by 736, which every Classic board has. */
export const WORLD = worldBox(topology());
/** What memoised layers are keyed on: a board never changes in a game, and a seed deals one board per preset. */
export const boardKey = (board: Pick<Board, 'seed' | 'preset'>) => `${board.preset}/${board.seed}`;
/** The square sprite rotates so its long axis follows its coastal edge. */
export const SHIP_SIZE = 60;
export const SHIP_COAST_DISTANCE = 36;
export const SHIP_BOUNDS = { x: -SHIP_SIZE / 2, y: -SHIP_SIZE / 2, width: SHIP_SIZE, height: SHIP_SIZE };
export const PORT_BADGE_BOUNDS = { x: -21, y: -10, width: 42, height: 20 };
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
export const TERRAIN_INDEX = {
  wood: 0,
  brick: 1,
  sheep: 2,
  wheat: 3,
  ore: 4,
  desert: 5,
} as Record<Terrain, number>;
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
/**
 * Every coast on the board, one closed loop of corner ids for each island. A loop starts at the lowest-numbered
 * coastal edge not yet walked and follows the coast until it is back. Every corner has none or two coastal edges,
 * so the walk never has a choice to make and the loops never touch.
 */
function coastLoops(board: Board): number[][] {
  const coast = board.edges.filter((e) => isCoastalEdge(board, e)),
    walked = new Set<number>(),
    loops: number[][] = [];
  for (const first of coast) {
    if (walked.has(first.id)) continue;
    walked.add(first.id);
    const loop = [first.a];
    let current = first.b;
    while (current !== first.a) {
      loop.push(current);
      const edge = coast.find((e) => !walked.has(e.id) && (e.a === current || e.b === current));
      if (!edge) throw new Error('A coast does not close');
      walked.add(edge.id);
      current = edge.a === current ? edge.b : edge.a;
    }
    loops.push(loop);
  }
  return loops;
}
export type ShorePoint = { x: number; y: number };
/** Every coast as scene points, one closed polygon per island. */
export function coastPoints(board: Board): ShorePoint[][] {
  return coastLoops(board).map((loop) =>
    loop.map((id) => ({ x: board.vertices[id]!.x * HEX_SIZE, y: board.vertices[id]!.y * HEX_SIZE })),
  );
}
/** Every coast as the points of an SVG polygon, one per island: the Classic island has one. */
export function coastline(board: Board): string[] {
  return coastPoints(board).map((loop) => loop.map(({ x, y }) => `${x},${y}`).join(' '));
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
/** Exact distance to the nearest of several coasts that neither overlap nor hold lakes; negative on land. */
export function shoreDistance(coasts: readonly (readonly ShorePoint[])[], x: number, y: number) {
  let nearest = Infinity;
  for (const coast of coasts) {
    const distance = coastDistance(coast, x, y);
    // Inside one island is outside every other, so that island's coast is the nearest.
    if (distance < 0) return distance;
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}
/** Broad, low-amplitude curves keep the existing coast-following band calm. */
export function waterWidth(angle: number) {
  return WATER_EDGE_WAVES.reduce(
    (width, wave) => width + Math.sin(angle * wave.frequency + wave.phase) * wave.amplitude,
    WATER_BAND,
  );
}
/**
 * One continuous offset coast, not an extra ring of board-game hexagons. It is found by marching out from the
 * origin at 240 angles to at most 440 units, so it can describe only one island, round the origin and within
 * that reach. On a board of several islands it still returns 240 finite points, but they follow only the coast
 * each ray meets, and between islands they can fall back to the origin; the band for Open Sea is Phase 2's
 * (docs/BIGGER-MAPS-AND-MODES.md).
 */
export function waterOutline(board: Board, inset = 0): ShorePoint[] {
  const coasts = coastPoints(board);
  return Array.from({ length: 240 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 240,
      nx = Math.cos(angle),
      ny = Math.sin(angle);
    let low = 0,
      high = 440;
    for (let step = 0; step < 22; step++) {
      const radius = (low + high) / 2;
      if (shoreDistance(coasts, radius * nx, radius * ny) < waterWidth(angle) - inset) low = radius;
      else high = radius;
    }
    return { x: ((low + high) / 2) * nx, y: ((low + high) / 2) * ny };
  });
}
/** The normal is perpendicular to this exact coast edge, not a ray from the island center. */
export function portPlacement(board: Board, edgeId: number) {
  const e = board.edges[edgeId]!;
  if (!isCoastalEdge(board, e)) throw new Error('Ports require a coastal edge');
  const a = board.vertices[e.a]!,
    b = board.vertices[e.b]!,
    h = shoreHex(board, e);
  const x = ((a.x + b.x) * HEX_SIZE) / 2,
    y = ((a.y + b.y) * HEX_SIZE) / 2;
  const dx = x - h.x * HEX_SIZE,
    dy = y - h.y * HEX_SIZE,
    length = Math.hypot(dx, dy);
  const nx = dx / length,
    ny = dy / length;
  const boatX = x + nx * SHIP_COAST_DISTANCE,
    boatY = y + ny * SHIP_COAST_DISTANCE;
  // The sprite's long axis is vertical: rotate it tangent to this coast edge.
  // Its exposed left gunwale faces shore; the sail and cargo badge face open water.
  const angle = (Math.atan2(ny, nx) * 180) / Math.PI;
  const tx = -ny,
    ty = nx;
  // Keep ratios horizontal, with enough seaward clearance at every coast angle.
  const badgeDistance =
    16 + (PORT_BADGE_BOUNDS.width / 2) * Math.abs(nx) + (PORT_BADGE_BOUNDS.height / 2) * Math.abs(ny);

  return {
    x,
    y,
    nx,
    ny,
    angle,
    bridges: [a, b].map((v) => ({
      from: { x: v.x * HEX_SIZE, y: v.y * HEX_SIZE },
      to: {
        x: boatX - nx * 10 + tx * (Math.sign((v.x * HEX_SIZE - x) * tx + (v.y * HEX_SIZE - y) * ty) * 18),
        y: boatY - ny * 10 + ty * (Math.sign((v.x * HEX_SIZE - x) * tx + (v.y * HEX_SIZE - y) * ty) * 18),
      },
    })),
    boatX,
    boatY,
    markerX: boatX + nx * badgeDistance,
    markerY: boatY + ny * badgeDistance,
  };
}
