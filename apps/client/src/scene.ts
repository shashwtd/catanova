import { isCoastalEdge, isLand, shoreHex, topology } from '../../../packages/rules/src/board.js';
import type { Board, Edge, Terrain } from '../../../packages/rules/src/board.js';

export const HEX_SIZE = 64;
export const WATER_BAND = 90;
export const WATER_FEATHER = 48;
/** Room round the island for the water band, WATER_BAND and its waves, and some 20 units of table past its fade. */
export const WORLD_MARGIN = 112;
/**
 * Every terrain the board draws: the rules' own, and the sea and gold fields of Open Sea
 * (docs/BIGGER-MAPS-AND-MODES.md, Phase 2). The client knows the two new names before the rules deal them, so
 * a board that carries them draws the same whether or not the rules' Terrain lists them yet.
 */
export type SceneTerrain = Terrain | 'gold' | 'sea';
/** Whether a board has sea hexes: an Open Sea board, drawn as one sea with islands in it. */
export const hasSea = (board: Pick<Board, 'hexes'>) => board.hexes.some((h) => !isLand(h));
/**
 * Room round an Open Sea board. Its outer ring is already water, so it needs only the fade past the rim, which
 * ends some 67 units beyond the rim's outermost corners, where Classic's island needs its whole water band.
 */
export const SEA_WORLD_MARGIN = 72;
export type WorldBox = { x: number; y: number; width: number; height: number };
/**
 * The part of the world a board's scene covers: the board's extent and its margin round it, rounded out to
 * whole steps of 8 units. The SVG's viewBox, the terrain shader and the camera all frame this box.
 */
export function worldBox(board: Pick<Board, 'vertices' | 'hexes'>): WorldBox {
  const margin = hasSea(board) ? SEA_WORLD_MARGIN : WORLD_MARGIN;
  const xs = board.vertices.map((v) => v.x * HEX_SIZE),
    ys = board.vertices.map((v) => v.y * HEX_SIZE);
  // The tolerance keeps floating-point dust on a side that lands on a step from pushing it out a whole step.
  const down = (n: number) => Math.floor((n - margin) / 8 + 1e-9) * 8,
    up = (n: number) => Math.ceil((n + margin) / 8 - 1e-9) * 8;
  const x = down(Math.min(...xs)),
    y = down(Math.min(...ys));
  return { x, y, width: up(Math.max(...xs)) - x, height: up(Math.max(...ys)) - y };
}
/**
 * Where a board with sea has its islands: the box round every land hex, with a hex of water on each side for the
 * shallows, the harbours and the ships at the coast. None for a board without sea, which is all island.
 */
export function islandsBox(board: Pick<Board, 'vertices' | 'hexes'>): WorldBox | undefined {
  if (!hasSea(board)) return undefined;
  const corners = board.vertices.filter((v) => v.hexes.some((h) => isLand(board.hexes[h]!)));
  const xs = corners.map((v) => v.x * HEX_SIZE),
    ys = corners.map((v) => v.y * HEX_SIZE);
  const x = Math.min(...xs) - HEX_SIZE,
    y = Math.min(...ys) - HEX_SIZE;
  return { x, y, width: Math.max(...xs) + HEX_SIZE - x, height: Math.max(...ys) + HEX_SIZE - y };
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
/** The tile a gold field shows: its own texture, past the six cells of the terrain atlas. */
export const GOLD_TILE = 6;
/**
 * Where each terrain's picture is: a cell of the 3 × 2 terrain atlas, GOLD_TILE for the gold field, and none
 * for the sea, which is painted water rather than a tile.
 */
export const TERRAIN_INDEX: Record<SceneTerrain, number> = {
  wood: 0,
  brick: 1,
  sheep: 2,
  wheat: 3,
  ore: 4,
  desert: 5,
  gold: GOLD_TILE,
  sea: -1,
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
/**
 * Closed loops of corner ids along a line of edges, such as a coast. A loop starts at the lowest-numbered edge not
 * yet walked and follows the line until it is back. Every corner has none or two of the edges, so the walk never
 * has a choice to make and the loops never touch.
 */
function edgeLoops(line: readonly Edge[]): number[][] {
  const walked = new Set<number>(),
    loops: number[][] = [];
  for (const first of line) {
    if (walked.has(first.id)) continue;
    walked.add(first.id);
    const loop = [first.a];
    let current = first.b;
    while (current !== first.a) {
      loop.push(current);
      const edge = line.find((e) => !walked.has(e.id) && (e.a === current || e.b === current));
      if (!edge) throw new Error('A coast does not close');
      walked.add(edge.id);
      current = edge.a === current ? edge.b : edge.a;
    }
    loops.push(loop);
  }
  return loops;
}
export type ShorePoint = { x: number; y: number };
const scenePoints = (board: Board, loops: number[][]) =>
  loops.map((loop) =>
    loop.map((id) => ({ x: board.vertices[id]!.x * HEX_SIZE, y: board.vertices[id]!.y * HEX_SIZE })),
  );
/** Every coast as scene points, one closed polygon per island. */
export function coastPoints(board: Board): ShorePoint[][] {
  return scenePoints(board, edgeLoops(board.edges.filter((e) => isCoastalEdge(board, e))));
}
/**
 * The outline of the whole board, where its outermost hexes border nothing: on an Open Sea board, the outer edge of
 * its ring of sea. One closed polygon for a board in one piece.
 */
export function rimPoints(board: Board): ShorePoint[][] {
  return scenePoints(board, edgeLoops(board.edges.filter((e) => e.hexes.length === 1)));
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
 * each ray meets, and between islands they can fall back to the origin. A board with sea is drawn with
 * seaOutline instead.
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
/**
 * Signed distance from a point to a pointy-top hex whose corners are `radius` from its centre, negative inside:
 * the terrain shader's hex(), for the scene code that has to agree with it.
 */
export function hexSdf(x: number, y: number, radius = HEX_SIZE) {
  const r = radius * 0.8660254,
    kx = -0.8660254,
    ky = 0.5,
    kz = 0.57735027;
  // Fold the point into one twelfth of the hex, then measure to its side.
  let px = Math.abs(y),
    py = Math.abs(x);
  const fold = 2 * Math.min(kx * px + ky * py, 0);
  px -= fold * kx;
  py -= fold * ky;
  px -= Math.max(-kz * r, Math.min(kz * r, px));
  py -= r;
  return Math.hypot(px, py) * Math.sign(py);
}
/**
 * How far the sea frame's outline is smoothed. Its distance is a smooth union of the board's hexes, so the rim's
 * zigzag of hex corners, and the half-hex step between rows, round off into broad curves.
 */
export const SEA_SMOOTHING = 24;
/**
 * Distance from a point to the sea frame, the smooth union of every hex on the board, negative inside. The
 * shader sums the same exponentials.
 */
export function frameDistance(centres: readonly ShorePoint[], x: number, y: number) {
  const distances = centres.map((c) => hexSdf(x - c.x, y - c.y)),
    nearest = Math.min(...distances);
  return (
    nearest -
    SEA_SMOOTHING * Math.log(distances.reduce((sum, d) => sum + Math.exp((nearest - d) / SEA_SMOOTHING), 0))
  );
}
/**
 * The size of the patches a sea board's water is painted in. The water material is one mirrored tile, and over a
 * whole Open Sea frame its mirror lines would line up into a kaleidoscope, so each patch starts from its own place
 * in the tile and blends into its neighbours.
 */
export const OPEN_WATER_PATCH = 300;
/**
 * How far the depth of the water round land is smoothed where two coasts face each other. Where one sea hex parts
 * two islands, the nearest coast changes sides halfway across, and the water deepens to a dark seam there. Blending
 * the two distances where they come within this much of each other rounds that seam off, and leaves an open coast,
 * with one shore in reach, shading exactly as the Classic island's does.
 */
export const SHOAL_SMOOTHING = 40;
/**
 * Where the sea's fade into the table ends, measured out from the frame's smooth outline before its waves. The
 * fade is WATER_FEATHER wide, as round the Classic island, so it starts a little outside the rim's corners:
 * the whole ring stays opaque water.
 */
export const SEA_BAND = 56;
/**
 * Broad, low curves along the sea's edge. Each is keyed on the position along one direction of the world, not on
 * an angle about the centre, so a wave keeps its length however big the frame: the first runs along the top and
 * bottom, the second down the sides.
 */
export const SEA_EDGE_WAVES = [
  { x: 1, y: 0, wavelength: 330, phase: 0.35, amplitude: 1.8 },
  { x: 0, y: 1, wavelength: 270, phase: 1.7, amplitude: 1.8 },
  { x: 0.6, y: 0.8, wavelength: 170, phase: 2.9, amplitude: 0.7 },
] as const;
/**
 * The shadow each island casts on the sea: the stage's own drop shadow (table-light.css: 10 pixels down, 13 of
 * blur, rgb(14 19 14 / 45%)) in world units, falling from the outer edge of the island's beach. A board with sea
 * takes it off the stage, where it would trace the sea's edge on the table, and gives it to the islands.
 */
export const ISLAND_SHADOW = { offset: 10, blur: 13, opacity: 0.45, colour: [14, 19, 14], edge: 6 } as const;
/** How far out from the frame's smooth outline the sea reaches at a point, with its waves. */
export function seaWidth(x: number, y: number) {
  return SEA_EDGE_WAVES.reduce(
    (width, wave) =>
      width +
      Math.sin(((x * wave.x + y * wave.y) * 2 * Math.PI) / wave.wavelength + wave.phase) * wave.amplitude,
    SEA_BAND,
  );
}
/**
 * The sea's outer edge on a board with sea hexes, `inset` inside the end of its fade: where the frame's smooth
 * distance reaches seaWidth less `inset`. It is traced round the frame on a grid of 8 units, from a cell just
 * outside the rim, square by square as marching squares does, so it follows the whole frame however far the board
 * reaches and whatever its shape, and it reads the distance only near the edge. Each point is then settled onto
 * the edge exactly. One closed polygon for each piece of the board: one for any board planned.
 */
export function seaOutline(board: Board, inset = 0): ShorePoint[][] {
  const centres = board.hexes.map((h) => ({ x: h.x * HEX_SIZE, y: h.y * HEX_SIZE }));
  const beyond = (x: number, y: number) => frameDistance(centres, x, y) - seaWidth(x, y) + inset;
  const step = 8,
    known = new Map<string, number>();
  // The grid's corner (i, j) is at (i, j) steps from the origin.
  const at = (i: number, j: number) => {
    const key = `${i},${j}`;
    let value = known.get(key);
    if (value === undefined) known.set(key, (value = beyond(i * step, j * step)));
    return value;
  };
  // Where the edge crosses the grid line from corner (i, j) to (k, l), one in the sea and one past it: a false
  // position search, halving the weight of an end that stays put (the Illinois method).
  const cross = (i: number, j: number, k: number, l: number): ShorePoint => {
    const ends = [
      { x: i * step, y: j * step, v: at(i, j) },
      { x: k * step, y: l * step, v: at(k, l) },
    ].sort((m, n) => m.v - n.v);
    // `a` in the sea, `b` past its edge.
    let [a, b] = ends as [(typeof ends)[0], (typeof ends)[0]],
      side = 0,
      point = { x: a.x, y: a.y };
    for (let n = 0; n < 12; n++) {
      const t = a.v / (a.v - b.v);
      point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const v = beyond(point.x, point.y);
      if (Math.abs(v) < 1e-6) break;
      if (v < 0) {
        a = { ...point, v };
        if (side === -1) b.v /= 2;
        side = -1;
      } else {
        b = { ...point, v };
        if (side === 1) a.v /= 2;
        side = 1;
      }
    }
    return point;
  };
  return rimPoints(board).map((rim) => {
    // Start on the grid row through the rim's westmost corner, and head west until past the sea's edge.
    const west = rim.reduce((a, b) => (b.x < a.x ? b : a));
    const j = Math.round(west.y / step);
    let i = Math.floor(west.x / step);
    while (at(i, j) < 0 || at(i, j + 1) < 0) i--;
    // Cell (i, j) spans corners (i, j) to (i + 1, j + 1); the edge enters it by one side and leaves by another.
    type Side = 'n' | 'e' | 's' | 'w';
    const crossings = (ci: number, cj: number) => {
      const inside = {
        nw: at(ci, cj) < 0,
        ne: at(ci + 1, cj) < 0,
        se: at(ci + 1, cj + 1) < 0,
        sw: at(ci, cj + 1) < 0,
      };
      const ends = { n: ['nw', 'ne'], e: ['ne', 'se'], s: ['se', 'sw'], w: ['sw', 'nw'] } as const;
      return {
        inside,
        sides: (['n', 'e', 's', 'w'] as const).filter(
          (side) => inside[ends[side][0]] !== inside[ends[side][1]],
        ),
      };
    };
    const outline: ShorePoint[] = [];
    let cell = { i, j },
      entry: Side = crossings(i, j).sides[0]!;
    const first = { ...cell, entry };
    do {
      if (outline.length > 1e5) throw new Error('The sea’s edge does not close');
      const { i: ci, j: cj } = cell,
        { inside, sides } = crossings(ci, cj);
      let exit: Side;
      if (sides.length === 2) exit = sides.find((side) => side !== entry)!;
      else {
        // Two opposite corners in the sea: the middle of the cell says whether they join across it.
        const joined = beyond((ci + 0.5) * step, (cj + 0.5) * step) < 0;
        const pairs: Record<Side, Side> =
          inside.nw === joined ? { n: 'e', e: 'n', s: 'w', w: 's' } : { n: 'w', w: 'n', s: 'e', e: 's' };
        exit = pairs[entry];
      }
      outline.push(
        exit === 'n'
          ? cross(ci, cj, ci + 1, cj)
          : exit === 'e'
            ? cross(ci + 1, cj, ci + 1, cj + 1)
            : exit === 's'
              ? cross(ci, cj + 1, ci + 1, cj + 1)
              : cross(ci, cj, ci, cj + 1),
      );
      cell = {
        i: ci + (exit === 'e' ? 1 : exit === 'w' ? -1 : 0),
        j: cj + (exit === 's' ? 1 : exit === 'n' ? -1 : 0),
      };
      entry = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[exit];
    } while (cell.i !== first.i || cell.j !== first.j || entry !== first.entry);
    // Where the edge passes close by a corner of the grid it crosses two lines at almost one point: keep one.
    return outline.filter((p, n) => Math.hypot(p.x - outline.at(n - 1)!.x, p.y - outline.at(n - 1)!.y) > 1);
  });
}
/** The middle of an edge in scene units: where a ship sits. */
export function edgeCentre(board: Board, edgeId: number): ShorePoint {
  const edge = board.edges[edgeId]!,
    a = board.vertices[edge.a]!,
    b = board.vertices[edge.b]!;
  return { x: ((a.x + b.x) * HEX_SIZE) / 2, y: ((a.y + b.y) * HEX_SIZE) / 2 };
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
/**
 * An Open Sea harbour keeps its piers and badge but has no boat, so a harbour is never taken for a ship. Its badge
 * comes in from where Classic's sits, beyond the boat, to between the piers' ends: the sea hex off the harbour is
 * where the pirate sits, and it is drawn above the badge like every ship.
 */
export const SEA_BADGE_DISTANCE = 30;
/** Where an Open Sea harbour's badge sits, SEA_BADGE_DISTANCE out from the middle of its edge. */
export function seaBadge(pose: Pick<ReturnType<typeof portPlacement>, 'x' | 'y' | 'nx' | 'ny'>) {
  return { markerX: pose.x + pose.nx * SEA_BADGE_DISTANCE, markerY: pose.y + pose.ny * SEA_BADGE_DISTANCE };
}
