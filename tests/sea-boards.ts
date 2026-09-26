/**
 * Small Open Sea boards for the sea rules' tests, drawn as sketches like those in docs/MAP_GENERATION.md: one
 * string per row of hexes, top row first, each row set half a hex from the one above, one character a hex.
 *
 *   ~ .          sea
 *   P            sea, with the pirate on it
 *   1–9          sea hexes the test names
 *   T C S H R    Timber, Clay, Sheep, Hay and Rock on the main island; D a desert and G a gold field there
 *   t c s h r    the same on small islands, which are named 'a', 'b', … in the order their first hex appears
 *   d g
 */
import { topology } from '../packages/rules/src/board.js';
import type { Axial } from '../packages/rules/src/board.js';
import type { Building } from '../packages/rules/src/game.js';
import {
  MAIN_ISLAND,
  legalShipDestinations,
  movableShips,
  moveShip,
  pirateHexes,
  placeSettlement,
  placeShip,
  roadSitesOpenSea,
  settlementSitesOpenSea,
  shipSites,
} from '../packages/rules/src/sea.js';
import type { SeaBoard, SeaHex, SeaState } from '../packages/rules/src/sea.js';

const TERRAIN: Record<string, string> = {
  t: 'wood',
  c: 'brick',
  s: 'sheep',
  h: 'wheat',
  r: 'ore',
  d: 'desert',
  g: 'gold',
};
export type Sketch = {
  board: SeaBoard & { hexes: SeaHex[] };
  pirate?: number;
  hex: (name: string) => number;
};

export function sketch(...rows: string[]): Sketch {
  const shape: Axial[] = [],
    marks: string[] = [];
  const first = rows[0]!.search(/\S/);
  for (const [r, row] of rows.entries())
    for (const [i, mark] of [...row].entries()) {
      if (mark === ' ') continue;
      // Columns count half hexes, and a hex's column is 2q + r.
      if ((i - first - r) % 2) throw new Error(`Row ${r} is not offset half a hex from the one above`);
      shape.push({ q: (i - first - r) / 2, r });
      marks.push(mark);
    }
  const graph = topology(shape);
  const board: Sketch['board'] = graph;
  const named: Record<string, number> = {};
  let pirate: number | undefined;
  for (const [id, mark] of marks.entries()) {
    const hex = board.hexes[id]!;
    const terrain = TERRAIN[mark.toLowerCase()];
    if (!terrain) {
      if (!'~.P123456789'.includes(mark)) throw new Error(`No terrain is drawn as ${mark}`);
      hex.terrain = 'sea';
      if (mark === 'P') pirate = id;
      else if (mark !== '~' && mark !== '.') named[mark] = id;
      continue;
    }
    hex.terrain = terrain;
    if (mark === mark.toUpperCase()) hex.island = MAIN_ISLAND;
  }
  // Small islands: the lower-case land joined by shared edges, named in order.
  let next = 'a';
  for (const [id, mark] of marks.entries()) {
    if (!TERRAIN[mark] || board.hexes[id]!.island) continue;
    const island = next;
    next = String.fromCharCode(next.charCodeAt(0) + 1);
    const stack = [id];
    while (stack.length) {
      const hex = board.hexes[stack.pop()!]!;
      if (hex.island) continue;
      hex.island = island;
      for (const n of graph.hexes[hex.id]!.neighbors)
        if (TERRAIN[marks[n]!] && !board.hexes[n]!.island) stack.push(n);
    }
  }
  return {
    board,
    ...(pirate === undefined ? {} : { pirate }),
    hex: (name) => {
      const id = named[name];
      if (id === undefined) throw new Error(`No hex is named ${name}`);
      return id;
    },
  };
}

/** A hex's corners: 'n' is its top, then round it clockwise. */
const CORNERS = ['n', 'ne', 'se', 's', 'sw', 'nw'] as const;
export type Corner = (typeof CORNERS)[number];
export const corner = (board: SeaBoard, hex: number, which: Corner) =>
  board.hexes[hex]!.vertices[CORNERS.indexOf(which)]!;
/** The way an edge leaves an intersection: straight up or down, or up or down to the right or left. */
export type Step = 'n' | 's' | 'ne' | 'se' | 'nw' | 'sw';
/** The intersections met walking from `start`, one edge a step. */
export function walk(board: SeaBoard, start: number, ...steps: Step[]): number[] {
  const route = [start];
  for (const step of steps) {
    const from = board.vertices[route.at(-1)!]!;
    const to = from.neighbors.find((n) => {
      const dx = board.vertices[n]!.x - from.x,
        dy = board.vertices[n]!.y - from.y;
      const across = Math.abs(dx) < 1e-9 ? '' : dx > 0 ? 'e' : 'w';
      return step === (dy < 0 ? 'n' : 's') + across;
    });
    if (to === undefined) throw new Error(`No edge leads ${step} from ${from.id}`);
    route.push(to);
  }
  return route;
}
/** The edge joining two neighbouring intersections. */
export function edgeBetween(board: SeaBoard, a: number, b: number): number {
  const edge = board.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (!edge) throw new Error(`Intersections ${a} and ${b} are not neighbours`);
  return edge.id;
}
/** The edges along a walk, in order. */
export const edgesAlong = (board: SeaBoard, route: number[]) =>
  route.slice(1).map((v, i) => edgeBetween(board, route[i]!, v));

/** Pieces by player: roads and ships by edge, settlements and cities by intersection. */
export type Pieces = {
  roads?: Record<string, number[]>;
  ships?: Record<string, number[]>;
  settlements?: Record<string, number[]>;
  cities?: Record<string, number[]>;
};
/** A game's board, with its pieces laid out and the pirate where the sketch put it. */
export function state({ board, pirate }: Sketch, pieces: Pieces = {}): SeaState {
  const own = (by: Record<string, number[]> = {}) =>
    Object.fromEntries(Object.entries(by).flatMap(([player, ids]) => ids.map((id) => [id, player])));
  const buildings: Record<number, Building> = {};
  for (const kind of ['settlement', 'city'] as const)
    for (const [player, ids] of Object.entries((kind === 'city' ? pieces.cities : pieces.settlements) ?? {}))
      for (const id of ids) buildings[id] = { player, kind };
  return {
    board,
    buildings,
    roads: own(pieces.roads),
    ships: own(pieces.ships),
    ...(pirate === undefined ? {} : { pirate }),
  };
}

/**
 * The main island, and a one-hex island east of it across a strait. 1 is the bay east of the Clay and 4 the strait
 * south-east of the bay; 2 and 3 are neighbouring hexes of open sea, clear of the rim and of every coast.
 */
export const strait = () =>
  sketch(
    ' . . . . . . .',
    '. . . . . . . .',
    ' . . T C 1 . .',
    '. . S H R 4 t .',
    ' . . T S . . .',
    '. . . . . 2 3 .',
    ' . . . . . . .',
  );
/** Two islands whose nearest corners are joined by a single sea edge: a narrow strait. */
export const narrows = () => sketch(' . . . . .', '. . T . . .', ' . . . h .', '. . . . . .');
/**
 * The first, rectangular shape of Outer Isles for three players, with terrain of the tests' choosing: a test board
 * for the rules, which do not depend on the board's outline. The real boards, the islands with two rings of ocean
 * round them, come from the outer-isles-v1 preset. The small islands are a (north), b (south-west) and c
 * (south-east), and the pirate starts in the template's place.
 */
export const outerIslesThree = () =>
  sketch(
    ' ~ ~ ~ ~ ~ ~ ~ ~',
    '~ . . h g r . ~',
    ' ~ . . . . . P ~',
    '~ T C S H R . ~',
    ' ~ . S T D C H ~',
    '~ t . R S T . ~',
    ' ~ r . C H . g ~',
    '~ . h . S . c ~',
    ' ~ ~ ~ ~ ~ ~ ~ ~',
  );
/** The first, rectangular shape of Outer Isles for four players, in the same way. */
export const outerIslesFour = () =>
  sketch(
    '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ h . . . h r ~',
    '~ r . S H . . h ~',
    ' ~ . T C R S . ~',
    '~ S H T D C R T ~',
    ' ~ . S C T S . ~',
    '~ g . . R H . g ~',
    ' ~ t r . C . c ~',
    '~ ~ ~ ~ ~ ~ ~ ~ P',
  );

/** A table for the random games: the board state and who sits at it. */
export type Table = SeaState & { players: { id: string; resigned?: boolean }[] };
const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
  items[Math.floor(random() * items.length)];
/**
 * Plays random legal placements and ship moves on a board, ignoring resources, and calls `check` before and after
 * each: the snake draft of setup, each settlement with a road or a ship, then `turns` turns of four random actions
 * each. A player builds ships only while they have fewer than `ships`.
 */
export function playRandomly(
  sk: Sketch,
  players: string[],
  random: () => number,
  { turns, ships = 15 }: { turns: number; ships?: number },
  check: (before: Table, after: Table, player: string, action: string) => void,
): Table {
  let g: Table = {
    ...state(sk),
    players: players.map((id) => ({ id })),
    lockedShips: [],
    closedShipEnds: {},
  };
  const act = (player: string, action: string, next: Partial<Table>) => {
    const before = g;
    g = { ...g, ...next };
    check(before, g, player, action);
  };
  for (const player of [...players, ...[...players].reverse()]) {
    const vertex = pick(settlementSitesOpenSea(g, player, true), random);
    if (vertex === undefined) continue;
    act(player, 'settle', placeSettlement(g, player, vertex, true));
    const roads = roadSitesOpenSea(g, player, vertex),
      ships = shipSites(g, player, { setup: vertex });
    if (ships.length && (random() < 0.5 || !roads.length))
      act(player, 'ship', placeShip(g, player, pick(ships, random)!, { setup: vertex }));
    else if (roads.length) act(player, 'road', { roads: { ...g.roads, [pick(roads, random)!]: player } });
  }
  for (let turn = 0; turn < turns; turn++) {
    const player = players[turn % players.length]!;
    g = { ...g, shipsBuiltThisTurn: [], shipMovedThisTurn: false };
    for (let step = 0; step < 4; step++) {
      const roll = random();
      const fleet = Object.values(g.ships ?? {}).filter((p) => p === player).length;
      if (roll < 0.3) {
        // Often a ship that closes a cycle or reaches a building, which the plain line never does.
        const sites = fleet < ships ? shipSites(g, player, 'build') : [];
        const joins = sites.filter((e) =>
          [g.board.edges[e]!.a, g.board.edges[e]!.b].every(
            (v) => g.buildings[v] || g.board.vertices[v]!.edges.some((other) => g.ships?.[other] === player),
          ),
        );
        const edge = pick(joins.length && random() < 0.5 ? joins : sites, random);
        if (edge !== undefined) act(player, 'ship', placeShip(g, player, edge, 'build'));
      } else if (roll < 0.45) {
        const edge = pick(roadSitesOpenSea(g, player), random);
        if (edge !== undefined) act(player, 'road', { roads: { ...g.roads, [edge]: player } });
      } else if (roll < 0.6) {
        // Mostly where another player's ships meet, which is where the records of section 8.7 change.
        const sites = settlementSitesOpenSea(g, player);
        const meeting = sites.filter((v) =>
          players.some(
            (other) =>
              other !== player && g.board.vertices[v]!.edges.filter((e) => g.ships?.[e] === other).length > 1,
          ),
        );
        const vertex = pick(meeting.length && random() < 0.7 ? meeting : sites, random);
        if (vertex !== undefined) act(player, 'settle', placeSettlement(g, player, vertex));
      } else if (roll < 0.85) {
        const from = pick(movableShips(g, player), random);
        if (from !== undefined)
          act(
            player,
            'move',
            moveShip(g, player, from, pick(legalShipDestinations(g, player, from), random)!),
          );
      } else if (roll < 0.9) {
        const mine = Object.keys(g.buildings)
          .map(Number)
          .filter((v) => g.buildings[v]!.player === player);
        const vertex = pick(
          mine.filter((v) => g.buildings[v]!.kind === 'settlement'),
          random,
        );
        if (vertex !== undefined && mine.filter((v) => g.buildings[v]!.kind === 'city').length < 4)
          act(player, 'city', { buildings: { ...g.buildings, [vertex]: { player, kind: 'city' } } });
      } else {
        const hex = pick(pirateHexes(g.board, g.pirate), random);
        if (hex !== undefined) act(player, 'pirate', { pirate: hex });
      }
    }
  }
  return g;
}
