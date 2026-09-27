/**
 * Open Sea's rules, ruleset open-sea-v1: the sea and the edges that take roads or ships, placing and moving ships,
 * the pirate, Longest Route and the island bonus. Section numbers are those of docs/RULEBOOK-OPEN-SEA.md. Gold
 * fields are in gold.ts.
 *
 * Every function is pure. Each reads the parts of a game it names, from the fields Game has today and the Open Sea
 * fields SeaState proposes for it, and returns what changes rather than changing it. None of it is wired into
 * applyAction yet, and Classic never reaches it.
 */
import { isLand } from './board.js';
import type { Edge, Vertex } from './board.js';
import { COSTS, RESOURCES, SUPPLY } from './index.js';
import type { Resource } from './index.js';
import type { Building, Hand } from './game.js';

export const OPEN_SEA_RULESET = 'open-sea-v1';
/** Each player's pieces: Classic's, and 15 ships (section 3). */
export const SEA_SUPPLY = { ...SUPPLY, ships: 15 } as const;
/**
 * Classic's costs and the ship's, 1 Timber and 1 Sheep (section 3). A table of its own, so that nothing reading
 * Classic's COSTS, the bots included, is ever offered a ship.
 */
export const SEA_COSTS = {
  ...COSTS,
  ship: { wood: 1, brick: 0, sheep: 1, wheat: 0, ore: 0 },
} as const satisfies Record<string, Hand>;

/** What the sea rules read of a hex. The board's Hex fits it, before and after Open Sea adds its terrains. */
export type SeaHex = {
  id: number;
  /** A resource, 'desert', 'gold' or 'sea'. Everything but the sea is land (section 2.1). */
  terrain: string;
  number: number;
  vertices: readonly number[];
  /** 'main' for the main island and 'a', 'b', … for the small islands; the sea has none (section 2.2). */
  island?: string;
};
export type SeaBoard = { hexes: readonly SeaHex[]; vertices: readonly Vertex[]; edges: readonly Edge[] };
export const MAIN_ISLAND = 'main';

/**
 * The parts of a game the sea rules read: the fields Game has today, and the Open Sea fields proposed for it,
 * optional here as they will be there.
 */
export type SeaState = {
  board: SeaBoard;
  buildings: Record<number, Building>;
  roads: Record<number, string>;
  /** Edge id to the player whose ship is on it. */
  ships?: Record<number, string>;
  /** The sea hex the pirate is on. */
  pirate?: number;
  /** The edges of the ships built this turn, bought or free, which may not move until the next (section 8.4). */
  shipsBuiltThisTurn?: number[];
  /** Whether the player on turn has made this turn's ship move (section 8.4). */
  shipMovedThisTurn?: boolean;
  /**
   * L(p) of section 8.7, for every player at once: ships of a closed line that another player's settlement has
   * since broken. They stay closed for good, and a closed ship never moves, so each edge keeps its owner.
   */
  lockedShips?: number[];
  /**
   * E(p) of section 8.7, for every player at once: by a ship's edge, the intersections where that ship's end was
   * recorded as closed, because another player settled where it met another ship of its owner's. An entry lasts
   * while that ship stays on its edge.
   */
  closedShipEnds?: Record<number, number[]>;
  /** By player, the small islands on which they have earned the island bonus (section 12.2). */
  islandBonuses?: Record<string, string[]>;
};

/** The four kinds of edge of section 2.4, by what lies on either side. */
export type EdgeKind = 'land' | 'coastal' | 'sea' | 'rim';
/**
 * Which kind of edge this is (section 2.4). An edge on the outline of the board is rim, whatever hex it borders: an
 * Open Sea board is sea all round, so the rim is a sea hex's, and nothing ever goes there.
 */
export function edgeKind(board: SeaBoard, edge: number): EdgeKind {
  const hexes = board.edges[edge]!.hexes;
  if (hexes.length < 2) return 'rim';
  const land = hexes.filter((h) => isLand(board.hexes[h]!)).length;
  return land === 2 ? 'land' : land === 1 ? 'coastal' : 'sea';
}
/** Roads go on land and coastal edges, ships on coastal and sea edges, and nothing on the rim (section 2.4). */
export const takesRoad = (kind: EdgeKind) => kind === 'land' || kind === 'coastal';
export const takesShip = (kind: EdgeKind) => kind === 'coastal' || kind === 'sea';
/** A land intersection touches a land hex; only these take settlements and cities (section 2.3). */
export const isLandIntersection = (board: SeaBoard, vertex: number) =>
  board.vertices[vertex]!.hexes.some((h) => isLand(board.hexes[h]!));
/** A coastal intersection is a land intersection that also touches the sea (section 2.3). */
export const isCoastalIntersection = (board: SeaBoard, vertex: number) =>
  isLandIntersection(board, vertex) && board.vertices[vertex]!.hexes.some((h) => !isLand(board.hexes[h]!));
/** The island of an intersection's land hexes. Islands never touch, so there is only one (section 2.2). */
export function vertexIsland(board: SeaBoard, vertex: number): string | undefined {
  for (const h of board.vertices[vertex]!.hexes) {
    const hex = board.hexes[h]!;
    if (isLand(hex) && hex.island) return hex.island;
  }
  return undefined;
}
/** The resource a hex yields when its number is rolled: none from a desert, a gold field (section 9) or the sea. */
export function producedResource(hex: { terrain: string }): Resource | null {
  return (RESOURCES as readonly string[]).includes(hex.terrain) ? (hex.terrain as Resource) : null;
}

const shipsOf = (g: Pick<SeaState, 'ships'>) => g.ships ?? {};
const count = (pieces: Record<number, string>, player: string) =>
  Object.values(pieces).filter((id) => id === player).length;
/** Whether another player's settlement or city stands at an intersection, so `player`'s pieces do not join there. */
const blocked = (g: Pick<SeaState, 'buildings'>, player: string, vertex: number) =>
  !!g.buildings[vertex] && g.buildings[vertex]!.player !== player;
/** The player's ships at an intersection, other than the one on `except`. */
const shipsAt = (g: SeaState, ships: Record<number, string>, player: string, vertex: number, except = -1) =>
  g.board.vertices[vertex]!.edges.filter((e) => e !== except && ships[e] === player);
const otherEnd = (edge: Edge, vertex: number) => (edge.a === vertex ? edge.b : edge.a);
/**
 * Whether the player's ship on `edge` is attached (sections 8.5 and 8.7): one of its ends is at their settlement or
 * city, or meets another of their ships where no other player has built. The same test says whether a new ship
 * there would be connected (7.1). `ships` is the fleet to judge by, so a ship can be judged with another lifted.
 */
function attached(g: SeaState, ships: Record<number, string>, player: string, edge: number) {
  const { a, b } = g.board.edges[edge]!;
  return [a, b].some(
    (v) =>
      g.buildings[v]?.player === player ||
      (!blocked(g, player, v) && shipsAt(g, ships, player, v, edge).length > 0),
  );
}

/** Whether an edge is one of the six of the pirate's hex, where no ship is built, moved to or moved from (10.6). */
export const pirateBlocksEdge = (g: Pick<SeaState, 'board' | 'pirate'>, edge: number) =>
  g.pirate !== undefined && g.board.edges[edge]!.hexes.includes(g.pirate);

function roadSite(g: SeaState, player: string, edge: number, setupVertex: number | null) {
  const e = g.board.edges[edge]!;
  return (
    takesRoad(edgeKind(g.board, edge)) &&
    !g.roads[edge] &&
    !shipsOf(g)[edge] &&
    (setupVertex !== null
      ? (e.a === setupVertex || e.b === setupVertex) && g.buildings[setupVertex]?.player === player
      : [e.a, e.b].some((v) =>
          g.buildings[v]
            ? g.buildings[v]!.player === player
            : g.board.vertices[v]!.edges.some((other) => g.roads[other] === player),
        ))
  );
}
/**
 * Where the player may build a road (sections 2.4, 5.4, 7.2 and 7.3): an empty land or coastal edge, holding no
 * ship either, that touches their own settlement or city, or meets one of their roads where no other player has
 * built. A ship never serves. In setup, `setupVertex` is the settlement they just placed, and the road must touch
 * it. Nothing is legal once all their roads are on the board.
 */
export function roadSitesOpenSea(g: SeaState, player: string, setupVertex: number | null = null): number[] {
  if (count(g.roads, player) >= SEA_SUPPLY.roads) return [];
  return g.board.edges.filter((e) => roadSite(g, player, e.id, setupVertex)).map((e) => e.id);
}
export const canPlaceRoadOpenSea = (
  g: SeaState,
  player: string,
  edge: number,
  setupVertex: number | null = null,
) => count(g.roads, player) < SEA_SUPPLY.roads && roadSite(g, player, edge, setupVertex);

/** Why a ship is placed: after a starting settlement (section 5.4), bought (7.1) or free by Road Building (13.2). */
export type ShipPlacement = 'build' | 'roadBuilding' | { setup: number };
/** An edge a ship could go on, the fleet on the board being `ships`: the placement rule, without the supply. */
function shipSite(g: SeaState, ships: Record<number, string>, player: string, edge: number, setup?: number) {
  const e = g.board.edges[edge]!;
  return (
    takesShip(edgeKind(g.board, edge)) &&
    !ships[edge] &&
    !g.roads[edge] &&
    !pirateBlocksEdge(g, edge) &&
    (setup === undefined
      ? attached(g, ships, player, edge)
      : (e.a === setup || e.b === setup) && g.buildings[setup]?.player === player)
  );
}
/**
 * Where the player may put a ship (sections 5.4, 7.1, 7.2 and 10.6): an empty coastal or sea edge, never one of
 * the pirate's. After a starting settlement it must touch that settlement. Otherwise, bought or free, it must
 * touch the player's settlement or city, or meet one of their ships where no other player has built; a road never
 * serves. Nothing is legal once all 15 of their ships are on the board.
 */
export function shipSites(g: SeaState, player: string, placement: ShipPlacement): number[] {
  return g.board.edges.filter((e) => canPlaceShip(g, player, e.id, placement)).map((e) => e.id);
}
export function canPlaceShip(g: SeaState, player: string, edge: number, placement: ShipPlacement): boolean {
  const ships = shipsOf(g);
  return (
    count(ships, player) < SEA_SUPPLY.ships &&
    shipSite(g, ships, player, edge, typeof placement === 'object' ? placement.setup : undefined)
  );
}
/**
 * Puts a ship on the board and returns the fields that change. A ship bought or placed free counts as built this
 * turn, so it cannot move until the next (sections 8.4 and 13.2). Setup is not a turn: a starting ship may move on
 * its owner's first (5.6).
 */
export function placeShip(
  g: SeaState,
  player: string,
  edge: number,
  placement: ShipPlacement,
): Pick<Required<SeaState>, 'ships' | 'shipsBuiltThisTurn'> {
  if (!canPlaceShip(g, player, edge, placement)) throw new Error('Choose a legal edge for the ship');
  const built = g.shipsBuiltThisTurn ?? [];
  return {
    ships: { ...shipsOf(g), [edge]: player },
    shipsBuiltThisTurn: typeof placement === 'object' ? [...built] : [...built, edge],
  };
}
/**
 * Where Road Building may place a piece (section 13.2): roads and ships, each by its own rule. The card needs one
 * legal placement to be played, and its second piece is placed whenever either list still has a site.
 */
export const roadBuildingSites = (g: SeaState, player: string) => ({
  roads: roadSitesOpenSea(g, player),
  ships: shipSites(g, player, 'roadBuilding'),
});

/**
 * Where the player may put a settlement (sections 2.3, 5.3 and 7.4): an empty land intersection whose neighbours,
 * across every kind of edge, hold no building. In setup it must be on the main island; afterwards it must touch one
 * of their roads or ships. Nothing is legal once all their settlements are on the board.
 */
export function settlementSitesOpenSea(g: SeaState, player: string, setup = false): number[] {
  const placed = Object.values(g.buildings).filter((b) => b.player === player && b.kind === 'settlement');
  if (placed.length >= SEA_SUPPLY.settlements) return [];
  const ships = shipsOf(g);
  return g.board.vertices
    .filter(
      (v) =>
        isLandIntersection(g.board, v.id) &&
        !g.buildings[v.id] &&
        v.neighbors.every((n) => !g.buildings[n]) &&
        (setup
          ? vertexIsland(g.board, v.id) === MAIN_ISLAND
          : v.edges.some((e) => g.roads[e] === player || ships[e] === player)),
    )
    .map((v) => v.id);
}
/** Points for each island bonus (section 12.1). */
export const ISLAND_BONUS = 2;
/**
 * The small island a new settlement earns its owner the bonus on, if any (section 12.2): their first settlement
 * there, whoever else has settled it. Never the main island, and never in setup.
 */
export function islandBonusForSettlement(
  g: Pick<SeaState, 'board' | 'islandBonuses'>,
  player: string,
  vertex: number,
  setup: boolean,
): string | null {
  const island = vertexIsland(g.board, vertex);
  if (setup || !island || island === MAIN_ISLAND || g.islandBonuses?.[player]?.includes(island)) return null;
  return island;
}
/** A player's points from island bonuses. Every bonus earned is paid, with no limit (section 3). */
export const islandBonusPoints = (g: Pick<SeaState, 'islandBonuses'>, player: string) =>
  ISLAND_BONUS * (g.islandBonuses?.[player]?.length ?? 0);

/**
 * Step 0 of section 8.7, for a settlement another player places at `vertex`: what each other player's ships
 * record. A ship that was closed before the settlement and is not after is locked for good (L). Where two or more
 * of a player's ships met at `vertex`, every one of their ends there is recorded as closed (E), so the ships beside
 * the new settlement do not become open. A lone ship's end there stays open. Nothing else can break a closing path
 * or split two ships, so nothing else changes these records; a city upgrade does not call this.
 */
export function recordClosedEndsOnSettle(
  g: SeaState,
  settler: string,
  vertex: number,
): Pick<Required<SeaState>, 'lockedShips' | 'closedShipEnds'> {
  const ships = shipsOf(g);
  const before: SeaState = { ...g, buildings: { ...g.buildings } };
  delete before.buildings[vertex];
  const after: SeaState = {
    ...g,
    buildings: { ...g.buildings, [vertex]: { player: settler, kind: 'settlement' } },
  };
  const locked = new Set(g.lockedShips ?? []);
  const closedShipEnds = { ...g.closedShipEnds };
  for (const player of new Set(Object.values(ships))) {
    if (player === settler) continue;
    const stillClosed = closedShips(after, player);
    for (const e of closedShips(before, player)) if (!stillClosed.has(e)) locked.add(e);
    const meeting = shipsAt(before, ships, player, vertex);
    if (meeting.length > 1)
      for (const e of meeting)
        closedShipEnds[e] = [...new Set([...(closedShipEnds[e] ?? []), vertex])].sort((x, y) => x - y);
  }
  return { lockedShips: [...locked].sort((x, y) => x - y), closedShipEnds };
}
/**
 * Places a settlement and returns the fields that change: the building, the ship records of section 8.7's step 0
 * and any island bonus it earns (section 12.2). islandBonusForSettlement, asked first, names the island for the log.
 */
export function placeSettlement(
  g: SeaState,
  player: string,
  vertex: number,
  setup = false,
): Pick<Required<SeaState>, 'buildings' | 'lockedShips' | 'closedShipEnds' | 'islandBonuses'> {
  if (!settlementSitesOpenSea(g, player, setup).includes(vertex))
    throw new Error('Choose a legal settlement site');
  const island = islandBonusForSettlement(g, player, vertex, setup);
  const bonuses = { ...g.islandBonuses };
  if (island) bonuses[player] = [...(bonuses[player] ?? []), island];
  return {
    ...recordClosedEndsOnSettle(g, player, vertex),
    buildings: { ...g.buildings, [vertex]: { player, kind: 'settlement' } },
    islandBonuses: bonuses,
  };
}

/**
 * Rule 3 of section 8.7: the player's closed ships, which never move. That is every ship locked by history (L), and
 * every ship on a line of their ships from one of their buildings to another that passes no intersection twice and
 * no building on the way. An opponent's building ends such a line without closing it.
 */
export function closedShips(g: SeaState, player: string): Set<number> {
  const ships = shipsOf(g);
  const closed = new Set((g.lockedShips ?? []).filter((e) => ships[e] === player));
  // Every simple path from each building. A player has 15 ships, so there are few.
  const visited = new Set<number>(),
    path: number[] = [];
  const walk = (v: number) => {
    for (const e of shipsAt(g, ships, player, v)) {
      const next = otherEnd(g.board.edges[e]!, v);
      if (visited.has(next)) continue;
      if (g.buildings[next]) {
        if (g.buildings[next]!.player === player) for (const s of [...path, e]) closed.add(s);
        continue;
      }
      visited.add(next);
      path.push(e);
      walk(next);
      path.pop();
      visited.delete(next);
    }
  };
  for (const [v, building] of Object.entries(g.buildings))
    if (building.player === player) {
      visited.add(Number(v));
      walk(Number(v));
      visited.delete(Number(v));
    }
  return closed;
}
/**
 * Rule 4.1 of section 8.7: the intersections where the player's ship on `edge` has an open end. There they have no
 * building, no other ship of theirs connects to it, and the end has not been recorded as closed. Their own road
 * there does not close it, and nothing of another player's ever does (8.2).
 */
export function openEnds(g: SeaState, player: string, edge: number): number[] {
  const ships = shipsOf(g),
    { a, b } = g.board.edges[edge]!;
  const recorded = g.closedShipEnds?.[edge] ?? [];
  return [a, b].filter(
    (v) =>
      g.buildings[v]?.player !== player &&
      (blocked(g, player, v) || !shipsAt(g, ships, player, v, edge).length) &&
      !recorded.includes(v),
  );
}
/**
 * Rules 4.2 and 4.3 of section 8.7: whether the player's ship on `edge` is freed by a cycle of their ships that
 * passes no intersection twice. A loop runs through one building of theirs and frees the two ships touching it; a
 * ring has no building at all and frees every ship on it. A cycle through another player's building is neither,
 * because their ships do not connect there (8.3).
 */
export function freedByCycle(g: SeaState, player: string, edge: number): 'loop' | 'ring' | null {
  const ships = shipsOf(g),
    { a, b } = g.board.edges[edge]!;
  // The cycle is this ship and a way back round from one end to the other through no building, except that a
  // loop ends at the building this ship touches.
  const [from, to] = g.buildings[a]?.player === player ? [b, a] : [a, b];
  if (g.buildings[from] || blocked(g, player, to)) return null;
  const seen = new Set([from]),
    queue = [from];
  while (queue.length) {
    const v = queue.pop()!;
    for (const s of shipsAt(g, ships, player, v, edge)) {
      const w = otherEnd(g.board.edges[s]!, v);
      if (w === to) return g.buildings[to] ? 'loop' : 'ring';
      if (seen.has(w) || g.buildings[w]) continue;
      seen.add(w);
      queue.push(w);
    }
  }
  return null;
}
/**
 * The edges the player's ship on `edge` could move to (sections 8.1 and 8.5), whether or not it may move at all:
 * any other edge where they could build a ship now, judged with this one lifted, so that it cannot connect through
 * its own old place. There is no limit on distance. The move must also leave attached every other ship of theirs
 * that was attached before it; a ship already cut off, as by another player's settlement, never stops a move.
 */
export function legalShipDestinations(g: SeaState, player: string, edge: number): number[] {
  const ships = shipsOf(g);
  if (ships[edge] !== player) return [];
  const lifted = { ...ships };
  delete lifted[edge];
  const stranded = Object.keys(lifted)
    .map(Number)
    .filter((e) => lifted[e] === player && attached(g, ships, player, e) && !attached(g, lifted, player, e));
  // A stranded ship is attached again only by the moved ship meeting it where no other player has built.
  const meets = (to: Edge, e: number) => {
    const { a, b } = g.board.edges[e]!;
    return [a, b].some((v) => (v === to.a || v === to.b) && !blocked(g, player, v));
  };
  return g.board.edges
    .filter(
      (to) => to.id !== edge && shipSite(g, lifted, player, to.id) && stranded.every((e) => meets(to, e)),
    )
    .map((to) => to.id);
}

/** Why a ship cannot move now, most basic reason first. */
export type ShipMoveBlock =
  'not-yours' | 'move-used' | 'built-this-turn' | 'pirate' | 'closed' | 'no-open-end' | 'no-destination';
/** What the interface may say about a ship that cannot move (section 14). */
export const SHIP_MOVE_BLOCKS: Record<ShipMoveBlock, string> = {
  'not-yours': 'That is not your ship',
  'move-used': 'You have already moved a ship this turn',
  'built-this-turn': 'A ship cannot move on the turn it was built',
  pirate: 'The pirate holds ships on the edges of its hex',
  closed: 'This ship is part of a closed line between your buildings',
  'no-open-end': 'This ship has no open end',
  'no-destination': 'There is no edge this ship could move to',
};
function moveBlock(g: SeaState, player: string, edge: number, closed: Set<number>): ShipMoveBlock | null {
  if (shipsOf(g)[edge] !== player) return 'not-yours';
  if (g.shipMovedThisTurn) return 'move-used';
  if (g.shipsBuiltThisTurn?.includes(edge)) return 'built-this-turn';
  if (pirateBlocksEdge(g, edge)) return 'pirate';
  if (closed.has(edge)) return 'closed';
  if (!openEnds(g, player, edge).length && !freedByCycle(g, player, edge)) return 'no-open-end';
  if (!legalShipDestinations(g, player, edge).length) return 'no-destination';
  return null;
}
/**
 * Why the player's ship on `edge` cannot move now, or null if it can: the four rules of section 8.7, one move a
 * turn, and somewhere to go. That it is the player's action phase is for the reducer to check (8.4).
 */
export const shipMoveBlock = (g: SeaState, player: string, edge: number) =>
  moveBlock(g, player, edge, closedShips(g, player));
/** The player's ships that may move now, which the interface may mark (section 14). */
export function movableShips(g: SeaState, player: string): number[] {
  if (g.shipMovedThisTurn) return [];
  const ships = shipsOf(g),
    closed = closedShips(g, player);
  return Object.keys(ships)
    .map(Number)
    .filter((e) => ships[e] === player && !moveBlock(g, player, e, closed))
    .sort((x, y) => x - y);
}
/**
 * Moves the player's ship from one edge to another and returns the fields that change. The move costs nothing and
 * is not a build. The ship leaves any end recorded as closed behind with its old edge, and the turn's move is used.
 * Longest Route is recalculated once, afterwards (8.6).
 */
export function moveShip(
  g: SeaState,
  player: string,
  from: number,
  to: number,
): Pick<Required<SeaState>, 'ships' | 'closedShipEnds' | 'shipMovedThisTurn'> {
  const block = shipMoveBlock(g, player, from);
  if (block) throw new Error(SHIP_MOVE_BLOCKS[block]);
  if (!legalShipDestinations(g, player, from).includes(to))
    throw new Error('The ship cannot move to that edge');
  const ships = { ...shipsOf(g), [to]: player };
  delete ships[from];
  const closedShipEnds = { ...g.closedShipEnds };
  delete closedShipEnds[from];
  return { ships, closedShipEnds, shipMovedThisTurn: true };
}

/** Open Sea's route award (section 11.1): Classic's Longest Road, named for the ships it counts. */
export const LONGEST_ROUTE = { name: 'Longest Route', minimum: 5, points: 2 } as const;
/** A player's longest continuous route: its length, and its edges in the order it runs. */
export type Route = { length: number; edges: number[] };
/**
 * The player's longest route of roads and ships (section 11.2). Each piece counts once, a loop can count, and an
 * opponent's settlement or city ends a route. Two roads, or two ships, continue through any other intersection; a
 * road and a ship continue only through the player's own settlement or city. The pirate has no effect (11.3).
 */
export function longestRoute(g: SeaState, player: string): Route {
  const ships = shipsOf(g);
  const kind = (e: number) => (g.roads[e] === player ? 'road' : ships[e] === player ? 'ship' : null);
  let best: number[] = [];
  const used = new Set<number>(),
    path: number[] = [];
  const walk = (v: number, arrivedBy: 'road' | 'ship' | null) => {
    if (path.length > best.length) best = [...path];
    const building = g.buildings[v];
    if (arrivedBy && building && building.player !== player) return;
    for (const e of g.board.vertices[v]!.edges) {
      const next = kind(e);
      if (!next || used.has(e) || (arrivedBy && next !== arrivedBy && building?.player !== player)) continue;
      used.add(e);
      path.push(e);
      walk(otherEnd(g.board.edges[e]!, v), next);
      path.pop();
      used.delete(e);
    }
  };
  for (const v of g.board.vertices) if (v.edges.some((e) => kind(e))) walk(v.id, null);
  return { length: best.length, edges: best };
}
/**
 * Who holds Longest Route after a change, by Classic section 10: at least 5 to qualify, the holder keeps it while
 * tied for the longest, and otherwise only a single longest player takes it. Resigned players do not qualify. After
 * a ship move this keeps the award for a holder whose route is no shorter, as section 8.6 asks, because a move
 * changes only the mover's length.
 */
export function longestRouteHolder(
  g: SeaState & { players: readonly { id: string; resigned?: boolean }[] },
  holder: string | null,
): string | null {
  const lengths = g.players.map((p) => (p.resigned ? 0 : longestRoute(g, p.id).length));
  const max = Math.max(0, ...lengths);
  const leaders = g.players.filter((_, i) => lengths[i] === max);
  if (max < LONGEST_ROUTE.minimum) return null;
  if (leaders.some((p) => p.id === holder)) return holder;
  return leaders.length === 1 ? leaders[0]!.id : null;
}

/** The six edges of a hex, in id order. */
export function hexEdges(board: SeaBoard, hex: number): number[] {
  const edges = new Set<number>();
  for (const v of board.hexes[hex]!.vertices)
    for (const e of board.vertices[v]!.edges) if (board.edges[e]!.hexes.includes(hex)) edges.add(e);
  return [...edges].sort((x, y) => x - y);
}
/** Where the robber may move: any other land hex, on any island, deserts and gold fields included (10.1, 10.4). */
export const robberHexes = (board: SeaBoard, robber: number) =>
  board.hexes.filter((h) => isLand(h) && h.id !== robber).map((h) => h.id);
/** Where the pirate may move: any other sea hex, the outer ring included (10.1, 10.5). */
export const pirateHexes = (board: SeaBoard, pirate?: number) =>
  board.hexes.filter((h) => !isLand(h) && h.id !== pirate).map((h) => h.id);
/**
 * The choice after a rolled seven, once discards are done, or a Knight: move the robber or the pirate, exactly one
 * of them (sections 10.2, 10.3 and 13.1). Either list may be chosen from.
 */
export const knightTargets = (g: Pick<SeaState, 'board' | 'pirate'> & { robber: number }) => ({
  robber: robberHexes(g.board, g.robber),
  pirate: pirateHexes(g.board, g.pirate),
});
/**
 * Whom the pirate may rob on a hex (section 10.5): each other player with a ship on one of its edges, however many,
 * never a resigned one. A building on its coast makes nobody a target. The theft is compulsory when anyone is.
 */
export function pirateVictims(
  g: SeaState & { players?: readonly { id: string; resigned?: boolean }[] },
  player: string,
  hex: number,
): string[] {
  const ships = shipsOf(g);
  return [
    ...new Set(
      hexEdges(g.board, hex)
        .map((e) => ships[e])
        .filter(
          (p): p is string => !!p && p !== player && !g.players?.find((other) => other.id === p)?.resigned,
        ),
    ),
  ];
}
/** Why a pirate move is not allowed, or null: a different sea hex, and a victim exactly when there is one (10.5). */
export function pirateMoveIssue(
  g: SeaState & { players?: readonly { id: string; resigned?: boolean }[] },
  player: string,
  hex: number,
  victim?: string,
): string | null {
  if (!pirateHexes(g.board, g.pirate).includes(hex)) return 'Move the pirate to a different sea hex';
  const victims = pirateVictims(g, player, hex);
  if (victims.length ? !victim || !victims.includes(victim) : victim !== undefined)
    return 'Choose one player with a ship on this hex';
  return null;
}

/**
 * The move history's lines for Open Sea's public events (section 14), in the voice of game.ts's log. A ship move
 * says where the ship came from and where it went. A card the pirate steals stays as private as the robber's.
 */
export const SEA_LOG = {
  startingShip: (name: string, edge: number) => `${name} placed a starting ship on edge ${edge + 1}.`,
  ship: (name: string, edge: number) => `${name} built a ship on edge ${edge + 1}.`,
  freeShip: (name: string, edge: number) => `${name} built a free ship on edge ${edge + 1}.`,
  shipMove: (name: string, from: number, to: number) =>
    `${name} moved a ship from edge ${from + 1} to edge ${to + 1}.`,
  pirate: (name: string, victim?: { name: string; hadCards: boolean }) =>
    !victim
      ? `${name} moved the pirate.`
      : victim.hadCards
        ? `${name} moved the pirate and stole a card from ${victim.name}.`
        : `${name} moved the pirate. ${victim.name} had no resource cards.`,
  islandBonus: (name: string) => `${name} settled a new island (+${ISLAND_BONUS} points).`,
  longestRoute: (name: string) => `${name} claimed ${LONGEST_ROUTE.name} (+${LONGEST_ROUTE.points} points).`,
};
