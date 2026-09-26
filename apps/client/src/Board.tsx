import { memo, useMemo, useState } from 'react';
import { isLand, pips } from '../../../packages/rules/src/board.js';
import type { Board as Island } from '../../../packages/rules/src/board.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import type { GameAction, GameView } from '../../../packages/rules/src/game.js';
import { SHIP_MOVE_BLOCKS } from '../../../packages/rules/src/sea.js';
import { Terrain, type TerrainArt } from './Terrain.js';
import { DEFAULT_SEAT_HEX } from './player-colors.js';
import { ShipMoveTooltip } from './ShipMove.js';
import type { ShipMove } from './ShipMove.js';

/** One shared empty map, so an unsupplied `colors` is not a new object. */
const EMPTY_COLORS: Record<string, string> = {};
import { DICE_READABLE_MS } from './DiceThrow.js';
import type { BuildAction } from './placement.js';
import {
  boardKey,
  coastline,
  edgeCentre,
  GOLD_TILE,
  hasSea,
  HEX_SIZE as SIZE,
  ISLAND_SHADOW,
  MATERIAL_GUTTER,
  MATERIAL_QUADRANTS,
  hexPoints,
  seaBadge,
  seaOutline,
  waterOutline,
  portPlacement,
  SPRITE_INDEX,
  SHIP_SIZE,
  PORT_BADGE_BOUNDS,
  TERRAIN_INDEX,
  WATER_FEATHER,
  worldBox,
} from './scene.js';
import type { SceneTerrain, WorldBox } from './scene.js';
import { GOLD_ART } from './game-assets.js';

/** The seat colours a board falls back to when nothing tells it otherwise —
 *  a preview, or the first frame before the room arrives. A real table passes
 *  its own through `colors`, because seats can choose. */
export { DEFAULT_SEAT_HEX as PLAYER_COLORS } from './player-colors.js';
// Visible immediately, underneath the artwork, even when a texture is still downloading.
const TERRAIN_BASE: Record<SceneTerrain, string> = {
  wood: '#57815a',
  brick: '#c57d59',
  sheep: '#a0b767',
  wheat: '#dcb95f',
  ore: '#8998a5',
  desert: '#e3c589',
  gold: '#8f7f5a',
  sea: '#2f7f86',
};
/** The short label under a tile's art, and a hex's accessible name. */
const TERRAIN_LABEL: Record<SceneTerrain, string> = {
  ...RESOURCE_NAMES,
  desert: 'Desert',
  gold: 'Gold',
  sea: 'Sea',
};
const TERRAIN_NAME: Record<SceneTerrain, string> = { ...TERRAIN_LABEL, gold: 'Gold field' };
/**
 * What a game adds to the board in Open Sea: its ships, edge id to player id, and the pirate's sea hex. Read off
 * the game where it has them, without the Board depending on the rules' types for them.
 */
type OpenSea = { ships?: Record<number, string>; pirate?: number };
/** The fields an Open Sea board carries besides its hexes: where the robber and the pirate start. */
type OpenSeaBoard = { robberStart?: number; pirateStart?: number };
export type BuildMode = 'road' | 'settlement' | 'city' | null;
function roadGeometry(board: Island, id: number) {
  const edge = board.edges[id]!,
    a = board.vertices[edge.a]!,
    b = board.vertices[edge.b]!;
  return {
    length: Math.hypot(b.x - a.x, b.y - a.y) * SIZE,
    transform: `translate(${((a.x + b.x) * SIZE) / 2},${((a.y + b.y) * SIZE) / 2}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`,
  };
}
function RoadShape({ length, color }: { length: number; color: string }) {
  return (
    <>
      <rect className="road-foundation" x={-length / 2 + 4} y="-4" width={length - 8} height="12" rx="4" />
      <rect
        className="road-body"
        fill={color}
        x={-length / 2 + 6}
        y="-6"
        width={length - 12}
        height="12"
        rx="2"
      />
      <path className="road-sheen" d={`M${-length / 2 + 8} -3H${length / 2 - 8}`} />
    </>
  );
}
function BuildingShape({ city, color }: { city: boolean; color: string }) {
  return (
    <>
      <ellipse className="building-plinth" rx={city ? 23 : 18} ry="8" cy="10" />
      <path
        className="building"
        fill={color}
        d={city ? 'M-19 9V-10L-9-20L2-10V-2L11-12L21-2V9Z' : 'M-14 9V-6L0-20L14-6V9Z'}
      />
      <path className="roof-highlight" d={city ? 'M-19-10L-9-20L2-10M2-2L11-12L21-2' : 'M-14-6L0-20L14-6'} />
      <path className="house-door" d="M-3 8V0H3V8" />
      {city && (
        <>
          <path className="house-window" d="M-12-4H-8V0H-12ZM8 1H12V5H8Z" />
          <path className="city-wing" d="M1-1V8" />
        </>
      )}
    </>
  );
}
/** A ship's outline, standing upright on its edge like a house on its corner, about a house's size. */
const SHIP_SAILS = ['M2-21Q12-13 13.5-1H2Z', 'M-2-16Q-9.5-10-10.5-1H-2Z'];
const SHIP_HULL = 'M-18 0H18Q15.5 9 10 9.5H-10Q-15.5 9-18 0Z';
/** A ship: an upright boat in the seat colour with cream sails, standing on the edge it holds. */
export function ShipShape({ color }: { color: string }) {
  return (
    <>
      <ellipse className="ship-plinth" rx="17" ry="4.5" cy="10.5" />
      {SHIP_SAILS.map((d) => (
        <path key={d} className="ship-sail" d={d} />
      ))}
      <path className="ship-mast" d="M0 1V-23" />
      <path className="ship-hull" fill={color} d={SHIP_HULL} />
      <path className="ship-sheen" d="M-14 3.5H14" />
    </>
  );
}
/**
 * An edge a ship may go to, bought, free or moved there (docs/RULEBOOK-OPEN-SEA.md, sections 7 and 8): the road
 * site's dashed guide along the edge, and on approach the ship itself, upright at its middle, as a road site shows
 * its road.
 */
function ShipSite({
  board,
  edge,
  kind,
  label,
  color,
  guided,
  pending,
  onChoose,
}: {
  board: Island;
  edge: number;
  kind: 'ship' | 'moveShip';
  label: string;
  color: string;
  guided: boolean;
  pending: boolean;
  onChoose: () => void;
}) {
  const { length, transform } = roadGeometry(board, edge),
    at = edgeCentre(board, edge);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      className="legal-road"
      data-build-site={kind}
      data-site-id={edge}
      data-guided={guided}
      data-pending={pending}
      onClick={onChoose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChoose();
        }
      }}
    >
      <g transform={transform}>
        <line className="road-hit" x1={-length / 2} y1="0" x2={length / 2} y2="0" />
        <line
          className="site-guide site-guide-back road-site-guide"
          x1={-length / 2 + 4}
          y1="0"
          x2={length / 2 - 4}
          y2="0"
          aria-hidden="true"
        />
        <line
          className="site-guide road-site-guide"
          x1={-length / 2 + 4}
          y1="0"
          x2={length / 2 - 4}
          y2="0"
          aria-hidden="true"
        />
      </g>
      <g className="build-site-preview" aria-hidden="true" transform={`translate(${at.x},${at.y})`}>
        <ShipShape color={color} />
      </g>
    </g>
  );
}
/** The pirate: a ship in the robber's colours, about a tenth larger than a player's ship. */
export function PirateShape() {
  return (
    <g transform="scale(1.1)">
      {SHIP_SAILS.map((d) => (
        <path key={d} d={d} />
      ))}
      <path className="pirate-mast" d="M0 1V-23" />
      <path d={SHIP_HULL} />
      <path className="pirate-pennant" d="M1.5-22.5H8" />
    </g>
  );
}
export function Sprite({
  kind,
  className = '',
  label,
}: {
  kind: keyof typeof SPRITE_INDEX;
  className?: string;
  label?: string;
}) {
  const n = SPRITE_INDEX[kind];
  return (
    <svg
      className={`sprite ${className}`}
      viewBox={`${(n % 4) * 512} ${Math.floor(n / 4) * 512} 512 512`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <image href="/art/optimized/sprites-fantasy.3aaf69915ec6.webp" width="2048" height="1024" />
    </svg>
  );
}
export function ResourceIcon({
  resource,
  className = '',
}: {
  resource: Resource | 'any';
  className?: string;
}) {
  return (
    <Sprite
      kind={resource}
      className={className}
      label={resource === 'any' ? 'Any resource' : RESOURCE_NAMES[resource]}
    />
  );
}
/**
 * Everything on the board that the game cannot change: the filters, the
 * material patterns, the per-hex masks, the coastline and the painted ground.
 *
 * It was being rebuilt and re-diffed on every state message — a couple of
 * hundred SVG elements that only depend on which board was dealt. Split out
 * and memoised, a turn's worth of state changes no longer touches any of it.
 */
const BoardScenery = memo(function BoardScenery({
  board,
  art,
  coast,
  water,
  world,
  sea,
}: {
  board: Island;
  art?: TerrainArt;
  coast: readonly string[];
  /** The water's outline, feathered into the table: one polygon round the island, or round an Open Sea frame. */
  water: readonly string[];
  world: WorldBox;
  sea: boolean;
}) {
  return (
    <>
      <defs>
        <filter
          id="water-feather"
          filterUnits="userSpaceOnUse"
          x={world.x}
          y={world.y}
          width={world.width}
          height={world.height}
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation={WATER_FEATHER / 6} />
          <feComponentTransfer>
            <feFuncA type="linear" slope="1.006" intercept="-0.003" />
          </feComponentTransfer>
        </filter>
        <mask
          id="water-fade-mask"
          maskUnits="userSpaceOnUse"
          x={world.x}
          y={world.y}
          width={world.width}
          height={world.height}
          style={{ maskType: 'alpha' }}
        >
          {water.map((points, i) => (
            <polygon key={i} points={points} fill="white" filter="url(#water-feather)" />
          ))}
        </mask>
        {sea && (
          <filter
            id="island-shadow"
            filterUnits="userSpaceOnUse"
            x={world.x}
            y={world.y}
            width={world.width}
            height={world.height}
          >
            <feOffset dy={ISLAND_SHADOW.offset} />
            <feGaussianBlur stdDeviation={ISLAND_SHADOW.blur / 2} />
          </filter>
        )}
        <filter id="piece-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="1" dy="3" stdDeviation="1.5" floodColor="#0b1519" floodOpacity=".7" />
        </filter>
        <filter id="ground-edge" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feGaussianBlur stdDeviation=".65" />
        </filter>
        {[
          { id: 'ocean-material', size: 240, row: 0 },
          { id: 'sand-material', size: 150, row: 1 },
        ].map(({ id, size, row }) => (
          <pattern key={id} id={id} width={size * 2} height={size * 2} patternUnits="userSpaceOnUse">
            {MATERIAL_QUADRANTS.map(({ x, y, sx, sy }, index) => (
              <g key={index} transform={`translate(${x * size} ${y * size}) scale(${sx} ${sy})`}>
                <svg
                  width={size}
                  height={size}
                  viewBox={`${MATERIAL_GUTTER} ${row * 512 + MATERIAL_GUTTER} ${512 - MATERIAL_GUTTER * 2} ${512 - MATERIAL_GUTTER * 2}`}
                >
                  <image
                    href={art?.environment ?? '/art/optimized/environment-painted.00c506c983c0.webp'}
                    width="1024"
                    height="1024"
                  />
                </svg>
              </g>
            ))}
          </pattern>
        ))}
        {board.hexes.filter(isLand).map((h) => (
          <mask
            key={h.id}
            id={`terrain-${h.id}`}
            maskUnits="userSpaceOnUse"
            x={h.x * SIZE - SIZE - 8}
            y={h.y * SIZE - SIZE - 8}
            width={SIZE * 2 + 16}
            height={SIZE * 2 + 16}
          >
            <polygon points={hexPoints(h.x * SIZE, h.y * SIZE, 59)} fill="white" filter="url(#ground-edge)" />
          </mask>
        ))}
      </defs>
      <g className="terrain-fallback" aria-hidden="true">
        {sea && (
          <rect
            className="sea-base"
            x={world.x}
            y={world.y}
            width={world.width}
            height={world.height}
            fill={TERRAIN_BASE.sea}
            mask="url(#water-fade-mask)"
          />
        )}
        <rect
          className="water-band"
          x={world.x}
          y={world.y}
          width={world.width}
          height={world.height}
          fill="url(#ocean-material)"
          mask="url(#water-fade-mask)"
        />
        {sea && (
          <g
            className="island-shadow"
            fill={`rgb(${ISLAND_SHADOW.color.join(' ')})`}
            stroke={`rgb(${ISLAND_SHADOW.color.join(' ')})`}
            strokeWidth={ISLAND_SHADOW.edge * 2}
            strokeLinejoin="round"
            opacity={ISLAND_SHADOW.opacity}
            filter="url(#island-shadow)"
          >
            {coast.map((points, i) => (
              <polygon key={i} points={points} />
            ))}
          </g>
        )}
        {/* Every island's shallows go down before any island's sand, so no shallows lie over a beach. */}
        {coast.map((points, i) => (
          <polygon
            key={i}
            points={points}
            fill="#52bebf"
            stroke="#73dcd2"
            strokeWidth="27"
            strokeLinejoin="round"
            filter="url(#ground-edge)"
          />
        ))}
        {coast.map((points, i) => (
          <polygon
            key={i}
            points={points}
            fill="url(#sand-material)"
            stroke="#a68d53"
            strokeWidth="8"
            strokeLinejoin="round"
            filter="url(#ground-edge)"
          />
        ))}
        {board.hexes.filter(isLand).map((h) => {
          const n = TERRAIN_INDEX[h.terrain],
            gold = n === GOLD_TILE;
          return (
            <g key={h.id} mask={`url(#terrain-${h.id})`}>
              <polygon
                className="terrain-base"
                points={hexPoints(h.x * SIZE, h.y * SIZE, 63)}
                fill={TERRAIN_BASE[h.terrain]}
              />
              <text
                className="terrain-base-label"
                x={h.x * SIZE}
                y={h.y * SIZE + 34}
                textAnchor="middle"
                fontFamily="Barlow, sans-serif"
                fontSize="12"
                fontWeight="600"
                fill="#172d25"
              >
                {TERRAIN_LABEL[h.terrain]}
              </text>
              <svg
                x={h.x * SIZE - SIZE}
                y={h.y * SIZE - SIZE}
                width={SIZE * 2}
                height={SIZE * 2}
                viewBox={gold ? '0 0 512 512' : `${(n % 3) * 512} ${Math.floor(n / 3) * 512} 512 512`}
              >
                {gold ? (
                  <image href={art?.gold ?? GOLD_ART} width="512" height="512" />
                ) : (
                  <image
                    href={art?.terrain ?? '/art/optimized/terrain-fantasy.777e0ac07117.webp'}
                    width="1536"
                    height="1024"
                  />
                )}
              </svg>
            </g>
          );
        })}
      </g>
    </>
  );
});

/**
 * The harbours never change during a game either, but they draw above the tiles
 * and below the pieces, so they cannot join the scenery layer. Memoised on the
 * board, their 374 SVG nodes are built once instead of on every board update.
 * On a board with sea they have no boat, so a harbour is never taken for a
 * ship, and their badges sit nearer the shore (see seaBadge).
 */
const BoardHarbors = memo(function BoardHarbors({ board, sea }: { board: Island; sea: boolean }) {
  return board.ports.map((port) => {
    const pose = portPlacement(board, port.edge),
      p = sea ? { ...pose, ...seaBadge(pose) } : pose,
      n = SPRITE_INDEX[port.resource];
    return (
      <g
        key={port.edge}
        className="harbor"
        aria-label={
          port.resource === 'any'
            ? 'General harbor. Three of any one resource for one other resource.'
            : RESOURCE_NAMES[port.resource] + ' harbor. Two for one.'
        }
      >
        <title>{`${
          port.resource === 'any' ? 'General 3:1 harbor' : RESOURCE_NAMES[port.resource] + ' 2:1 harbor'
        } · Build at either bridge entrance`}</title>
        {p.bridges.map((bridge, i) => {
          const dx = bridge.to.x - bridge.from.x,
            dy = bridge.to.y - bridge.from.y,
            length = Math.hypot(dx, dy);
          return (
            <g
              key={i}
              data-port-entrance={i}
              transform={`translate(${bridge.from.x},${bridge.from.y}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`}
            >
              <rect className="pier-shadow" x="0" y="-2.5" width={length} height="7" rx="1" />
              <rect className="pier-deck" x="0" y="-3" width={length} height="6" />
              {Array.from({ length: Math.ceil(length / 5) }, (_, j) => (
                <path key={j} className="pier-plank" d={`M${j * 5} -3V3`} />
              ))}
              <path className="pier-rail" d={`M2 -3.5H${length}M2 3.5H${length}`} />
              {[2, length - 2].map((j) => (
                <g key={j}>
                  <circle className="pier-post" cx={j} cy="-3.5" r="1.3" />
                  <circle className="pier-post" cx={j} cy="3.5" r="1.3" />
                </g>
              ))}
            </g>
          );
        })}
        {!sea && (
          <g className="port-boat" transform={`translate(${p.boatX},${p.boatY}) rotate(${p.angle})`}>
            <svg
              x={-SHIP_SIZE / 2}
              y={-SHIP_SIZE / 2}
              width={SHIP_SIZE}
              height={SHIP_SIZE}
              viewBox="1536 512 512 512"
            >
              <image href="/art/optimized/sprites-fantasy.3aaf69915ec6.webp" width="2048" height="1024" />
            </svg>
          </g>
        )}
        <g
          className="port-cargo"
          data-resource={port.resource}
          transform={`translate(${p.markerX},${p.markerY})`}
        >
          <rect className="port-badge" {...PORT_BADGE_BOUNDS} rx="4" />
          {port.resource === 'any' ? (
            <text className="port-any" textAnchor="middle" x="-12" y="5">
              ?
            </text>
          ) : (
            <svg
              x="-20"
              y="-8"
              width="16"
              height="16"
              viewBox={`${(n % 4) * 512} ${Math.floor(n / 4) * 512} 512 512`}
            >
              <image href="/art/optimized/sprites-fantasy.3aaf69915ec6.webp" width="2048" height="1024" />
            </svg>
          )}
          <text className="port-rate" textAnchor="middle" x="8" y="4">
            {port.resource === 'any' ? '3:1' : '2:1'}
          </text>
        </g>
      </g>
    );
  });
});

/**
 * Memoised because it is the most expensive thing on the screen — roughly
 * 18ms a commit, measured — and it was being re-rendered by every unrelated
 * state change in the app: a panel opening, a timer ticking, a reaction
 * arriving. Now it only runs when something it draws has actually changed.
 */
export const Board = memo(function Board({
  board,
  game,
  me,
  mode,
  disabled,
  onAction,
  onRobber,
  glowHexes = [],
  effectId,
  pendingBuild = null,
  selectedRobberHex = null,
  colors = EMPTY_COLORS,
  art,
  ships,
  pirate,
  shipMove = null,
  onShip,
  reducedMotion = false,
}: {
  board: Island;
  game?: GameView;
  me?: string;
  mode: BuildMode;
  disabled: boolean;
  onAction: (action: GameAction) => void;
  onRobber: (hex: number) => void;
  glowHexes?: readonly number[];
  effectId?: string;
  pendingBuild?: BuildAction | null;
  selectedRobberHex?: number | null;
  /** Every player's colour, keyed by player id. Never by index: the game
   *  shuffles the seats at the start, so the two orders differ. */
  colors?: Record<string, string>;
  art?: TerrainArt;
  /** Open Sea's ships, edge id to player id. Without it the board reads `ships` off the game, if it has them. */
  ships?: Record<number, string>;
  /** The pirate's sea hex. Without it the board reads `pirate` off the game, or before a game its board's start. */
  pirate?: number;
  /** Open Sea: a ship move under way, which hides the build sites and marks the ships that may move. */
  shipMove?: ShipMove | null;
  /** Open Sea: the player chose one of their ships to move. */
  onShip?: (edge: number) => void;
  reducedMotion?: boolean;
}) {
  const [gpuReady, setGpuReady] = useState(false);
  /** The ship whose reason for staying put is showing, and the mark it hangs from. */
  const [explained, setExplained] = useState<{ edge: number; anchor: Element } | null>(null);
  const key = boardKey(board);
  const world = useMemo(() => worldBox(board), [key]);
  const coast = useMemo(() => coastline(board), [key]);
  const sea = useMemo(() => hasSea(board), [key]);
  // The water's feathered outline: round the Classic island, or round the whole frame of an Open Sea board.
  const water = useMemo(
    () =>
      (sea ? seaOutline(board, WATER_FEATHER / 2) : [waterOutline(board, WATER_FEATHER / 2)]).map((outline) =>
        outline.map((p) => `${p.x},${p.y}`).join(' '),
      ),
    [key],
  );
  const openSea = game as (GameView & OpenSea) | undefined,
    seaBoard = board as Island & OpenSeaBoard;
  const shipsShown = ships ?? openSea?.ships ?? {};
  const pirateHex = pirate ?? (game ? openSea?.pirate : seaBoard.pirateStart);
  // A board with no room to ask — a preview, a test — falls back to the four
  // the game has always started with, in whatever order it has.
  const color = (id: string) =>
    colors[id] ?? DEFAULT_SEAT_HEX[game?.players.findIndex((p) => p.id === id) ?? 0] ?? DEFAULT_SEAT_HEX[0]!;
  const ownTurn = !!game && game.players[game.active]?.id === me && !game.winner;
  const interactive = ownTurn && !disabled;
  const setupSettlement = game?.phase === 'setupSettlement',
    setupRoad = game?.phase === 'setupRoad',
    actions = game?.phase === 'actions';
  const robberMode = interactive && game?.phase === 'robber';
  // While a ship is being moved, nothing is built.
  const building = interactive && !shipMove;
  // The server's legal lists already include affordability, supply, and connection rules.
  // A toolbar choice filters the sites; no choice still permits direct placement.
  const roadSites =
    building && (setupRoad || game?.phase === 'freeRoads' || (actions && (!mode || mode === 'road')))
      ? game!.legal.roads
      : [];
  // Open Sea's ships go where its roads do (section 7). An edge that takes either is one site, a road's, and its
  // confirmation offers the choice.
  const shipSites =
    building && game!.legal.ships && (setupRoad || game!.phase === 'freeRoads' || (actions && !mode))
      ? game!.legal.ships
      : [];
  const settlementSites =
    building && (setupSettlement || (actions && (!mode || mode === 'settlement')))
      ? game!.legal.settlements
      : [];
  const citySites = building && actions && (!mode || mode === 'city') ? game!.legal.cities : [];
  const vertices = [
    ...settlementSites.map((vertex) => ({ kind: 'settlement' as const, vertex })),
    ...citySites.map((vertex) => ({ kind: 'city' as const, vertex })),
  ];
  // Open Sea: the player's own ships in their action phase, those that may move and why the others may not
  // (section 8). A chosen ship shows where it may go.
  const shipMoves = interactive && actions && !mode ? game!.legal.shipMoves : undefined,
    shipBlocks = (shipMoves && game!.legal.shipMoveBlocks) ?? {};
  const destinations = shipMove?.from != null ? (shipMoves?.[shipMove.from] ?? []) : [];
  const pending =
    ownTurn &&
    pendingBuild &&
    (pendingBuild.kind === 'road'
      ? (setupRoad || game?.phase === 'freeRoads' || actions) && game!.legal.roads.includes(pendingBuild.edge)
      : pendingBuild.kind === 'ship'
        ? (setupRoad || game?.phase === 'freeRoads' || actions) &&
          !!game!.legal.ships?.includes(pendingBuild.edge)
        : pendingBuild.kind === 'moveShip'
          ? actions && !!game!.legal.shipMoves?.[pendingBuild.from]?.includes(pendingBuild.to)
          : pendingBuild.kind === 'city'
            ? actions && game!.legal.cities.includes(pendingBuild.vertex)
            : (setupSettlement || actions) && game!.legal.settlements.includes(pendingBuild.vertex))
      ? pendingBuild
      : null;
  const explain = (edge: number, anchor: Element) => setExplained({ edge, anchor });
  const explainedBlock = explained ? shipBlocks[explained.edge] : undefined;
  const keyActivate = (e: React.KeyboardEvent, run: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  };
  return (
    <div
      className={`island-stage ${gpuReady ? 'gpu-ready' : ''}${sea ? ' sea-stage' : ''}`}
      style={{ aspectRatio: `${world.width}/${world.height}` }}
    >
      <Terrain board={board} onReady={setGpuReady} art={art} />
      <svg
        className="island"
        viewBox={`${world.x} ${world.y} ${world.width} ${world.height}`}
        role="group"
        aria-label="Island board"
      >
        <BoardScenery board={board} art={art} coast={coast} water={water} world={world} sea={sea} />
        {board.hexes.map((h) => {
          const x = h.x * SIZE,
            y = h.y * SIZE;
          // The robber never goes to sea. Sea hexes keep their targets for the pirate's moves.
          const canMoveRobber = robberMode && h.id !== game?.robber && !disabled && isLand(h);
          const name = TERRAIN_NAME[h.terrain];
          return (
            <g
              key={h.id}
              className={`terrain-hit ${canMoveRobber ? 'robber-target' : ''}`}
              data-robber-selected={canMoveRobber && h.id === selectedRobberHex}
              aria-pressed={canMoveRobber ? h.id === selectedRobberHex : undefined}
              role={canMoveRobber ? 'button' : undefined}
              tabIndex={canMoveRobber ? 0 : undefined}
              aria-label={`${name}${h.number ? `, ${h.number}${game?.diceMode === 'flat' ? ', one chance in eleven' : `, ${pips(h.number)} production pips`}` : ''}${canMoveRobber ? '. Move robber here' : ''}`}
              onClick={() => canMoveRobber && onRobber(h.id)}
              onKeyDown={(e) =>
                keyActivate(e, () => {
                  if (canMoveRobber) onRobber(h.id);
                })
              }
            >
              <polygon className="hex-hit" points={hexPoints(x, y, 60)} />
              {canMoveRobber && h.id === selectedRobberHex && (
                <g className="robber-selection" pointerEvents="none" aria-hidden="true">
                  <polygon className="robber-selection-base" points={hexPoints(x, y, 58)} />
                  <polygon className="robber-selection-orbit" points={hexPoints(x, y, 58)} pathLength={100} />
                </g>
              )}
              <circle
                data-effect-hex={h.id}
                cx={x}
                cy={y}
                r="2"
                fill="transparent"
                pointerEvents="none"
                aria-hidden="true"
              />
              {effectId && glowHexes.includes(h.id) && (
                <polygon
                  key={`${effectId}-${h.id}`}
                  className="production-bloom"
                  points={hexPoints(x, y, 57)}
                  style={{ animationDelay: `${DICE_READABLE_MS}ms` }}
                  aria-hidden="true"
                />
              )}
              {h.id === game?.robber && (
                <polygon points={hexPoints(x, y, 57)} fill="#101b26" opacity=".28" pointerEvents="none" />
              )}
              {h.number > 0 && (
                <g
                  className={`number-token ${game?.diceMode !== 'flat' && [6, 8].includes(h.number) ? 'red-number' : ''}`}
                  transform={`translate(${x},${y + 14})`}
                >
                  <circle r="20" />
                  <text textAnchor="middle" y="5">
                    {h.number}
                  </text>
                  {game?.diceMode !== 'flat' && (
                    <text className="pips" textAnchor="middle" y="14">
                      {'•'.repeat(pips(h.number))}
                    </text>
                  )}
                </g>
              )}
              {h.id ===
                (game?.robber ??
                  seaBoard.robberStart ??
                  board.hexes.find((h) => h.terrain === 'desert')?.id) && (
                <g
                  className="robber-piece"
                  transform={`translate(${x + (h.number ? 29 : 0)},${y + 6})`}
                  filter="url(#piece-shadow)"
                  aria-label="Robber"
                >
                  <path d="M-10 17 L-7-4 Q-12-18 0-19 Q12-18 7-4 L10 17 Z" />
                  <path d="M-4-8h8" className="robber-eye" />
                </g>
              )}
            </g>
          );
        })}
        <BoardHarbors board={board} sea={sea} />
        {pirateHex !== undefined && board.hexes[pirateHex] && (
          <g
            className="pirate-piece"
            transform={`translate(${board.hexes[pirateHex].x * SIZE},${board.hexes[pirateHex].y * SIZE + 6})`}
            filter="url(#piece-shadow)"
            role="img"
            aria-label="Pirate"
          >
            <title>Pirate</title>
            <PirateShape />
          </g>
        )}
        {game &&
          Object.entries(game.roads).map(([id, owner]) => {
            const { length, transform } = roadGeometry(board, Number(id));
            return (
              <g
                key={id}
                data-road-id={id}
                role="img"
                aria-label={`${game.players.find((p) => p.id === owner)?.name} · Road ${Number(id) + 1}`}
                className={`built-piece road-piece ${owner === me ? 'own-piece' : ''}`}
                transform={transform}
              >
                <title>{`${game.players.find((p) => p.id === owner)?.name} · Road ${Number(id) + 1}`}</title>
                <RoadShape length={length} color={color(owner)} />
              </g>
            );
          })}
        {Object.entries(shipsShown).map(([id, owner]) => {
          const at = edgeCentre(board, Number(id)),
            label = `${game?.players.find((p) => p.id === owner)?.name ?? 'Player'} · Ship ${Number(id) + 1}`;
          return (
            <g
              key={id}
              data-ship-id={id}
              role="img"
              aria-label={label}
              className={`built-piece ship-piece ${owner === me ? 'own-piece' : ''}`}
              // Lifted while its move waits to be confirmed.
              data-moving={pending?.kind === 'moveShip' && pending.from === Number(id) ? true : undefined}
              transform={`translate(${at.x},${at.y})`}
            >
              <title>{label}</title>
              <ShipShape color={color(owner)} />
            </g>
          );
        })}
        {game &&
          Object.entries(game.buildings).map(([id, b]) => {
            const v = board.vertices[Number(id)]!,
              city = b.kind === 'city';
            return (
              <g
                key={`${id}-${b.kind}`}
                data-building-id={id}
                role="img"
                aria-label={`${game.players.find((p) => p.id === b.player)?.name} · ${b.kind}`}
                className={`built-piece house-piece ${b.player === me ? 'own-piece' : ''}`}
                transform={`translate(${v.x * SIZE},${v.y * SIZE})`}
              >
                <title>{`${game.players.find((p) => p.id === b.player)?.name} · ${b.kind}`}</title>
                <BuildingShape city={city} color={color(b.player)} />
              </g>
            );
          })}
        {Object.keys({ ...shipMoves, ...shipBlocks }).map((id) => {
          // The player's own ships, as the city upgrade marks a settlement: a movable one takes the orbit, and
          // any other says why it stays.
          const edge = Number(id),
            at = edgeCentre(board, edge),
            block = shipBlocks[edge],
            chosen = shipMove?.from === edge;
          const activate = (target: Element) =>
            block
              ? setExplained((open) => (open?.edge === edge ? null : { edge, anchor: target }))
              : onShip?.(edge);
          return (
            <g
              key={`move-${id}`}
              role="button"
              tabIndex={0}
              className="ship-move-site"
              data-build-site={block ? undefined : 'movable'}
              data-guided={!block && (chosen || shipMove?.from === null)}
              aria-pressed={block ? undefined : chosen}
              aria-disabled={block ? true : undefined}
              aria-describedby={explained?.edge === edge ? 'ship-move-reason' : undefined}
              aria-label={
                block
                  ? `Your ship on edge ${edge + 1}. It cannot move: ${SHIP_MOVE_BLOCKS[block]}`
                  : `Your ship on edge ${edge + 1}. ${chosen ? 'Chosen to move' : 'Move this ship'}`
              }
              // Round the ship itself, which stands on its edge: half a mast above the middle.
              transform={`translate(${at.x},${at.y - 6})`}
              onClick={(e) => activate(e.currentTarget)}
              onKeyDown={(e) => keyActivate(e, () => activate(e.currentTarget))}
              onPointerEnter={(e) => {
                if (block && e.pointerType === 'mouse') explain(edge, e.currentTarget);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setExplained(null);
              }}
              onFocus={(e) => {
                if (block) explain(edge, e.currentTarget);
              }}
              onBlur={() => setExplained(null)}
            >
              <circle className="vertex-hit" r="24" />
              {!block && (
                <circle className="site-guide vertex-site-guide" r="27" pathLength={100} aria-hidden="true" />
              )}
            </g>
          );
        })}
        {roadSites.map((id) => {
          const { length, transform } = roadGeometry(board, id);
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`Build ${shipSites.includes(id) ? 'road or ship' : 'road'} on edge ${id + 1}`}
              className="legal-road"
              data-build-site="road"
              data-ship-site={shipSites.includes(id) || undefined}
              data-site-id={id}
              data-guided={setupRoad || game?.phase === 'freeRoads' || mode === 'road'}
              data-pending={(pending?.kind === 'road' || pending?.kind === 'ship') && pending.edge === id}
              transform={transform}
              onClick={() => onAction({ kind: 'road', edge: id })}
              onKeyDown={(e) => keyActivate(e, () => onAction({ kind: 'road', edge: id }))}
            >
              <line className="road-hit" x1={-length / 2} y1="0" x2={length / 2} y2="0" />
              <line
                className="site-guide site-guide-back road-site-guide"
                x1={-length / 2 + 4}
                y1="0"
                x2={length / 2 - 4}
                y2="0"
                aria-hidden="true"
              />
              <line
                className="site-guide road-site-guide"
                x1={-length / 2 + 4}
                y1="0"
                x2={length / 2 - 4}
                y2="0"
                aria-hidden="true"
              />
              <g className="build-site-preview" aria-hidden="true">
                <RoadShape length={length} color={color(me!)} />
              </g>
            </g>
          );
        })}
        {shipSites
          .filter((id) => !roadSites.includes(id))
          .map((id) => (
            <ShipSite
              key={`ship-${id}`}
              board={board}
              edge={id}
              kind="ship"
              label={`Build ship on edge ${id + 1}`}
              color={color(me!)}
              guided={setupRoad || game?.phase === 'freeRoads'}
              pending={pending?.kind === 'ship' && pending.edge === id}
              onChoose={() => onAction({ kind: 'ship', edge: id })}
            />
          ))}
        {destinations.map((id) => (
          <ShipSite
            key={`to-${id}`}
            board={board}
            edge={id}
            kind="moveShip"
            label={`Move the ship to edge ${id + 1}`}
            color={color(me!)}
            guided
            pending={pending?.kind === 'moveShip' && pending.to === id}
            onChoose={() => onAction({ kind: 'moveShip', from: shipMove!.from!, to: id })}
          />
        ))}
        {vertices.map(({ vertex: id, kind }) => {
          const v = board.vertices[id]!;
          return (
            <g
              key={id}
              transform={`translate(${v.x * SIZE},${v.y * SIZE})`}
              role="button"
              tabIndex={0}
              aria-label={`Build ${kind} at corner ${id + 1}`}
              className="legal-vertex"
              data-build-site={kind}
              data-site-id={id}
              data-guided={setupSettlement || mode === kind}
              data-pending={pending?.kind === kind && pending.vertex === id}
              onClick={() => onAction({ kind, vertex: id })}
              onKeyDown={(e) => keyActivate(e, () => onAction({ kind, vertex: id }))}
            >
              <circle className="vertex-hit" r="21" />
              <circle
                className="site-guide vertex-site-guide"
                r={kind === 'city' ? 25 : 12}
                pathLength={100}
                aria-hidden="true"
              />
              {kind === 'city' && (
                <g className="site-guide city-upgrade-mark" aria-hidden="true">
                  <circle cx="20" cy="-20" r="7" />
                  <path d="M20-24v8 M16-20h8" />
                </g>
              )}
              <g className="build-site-preview" aria-hidden="true">
                <BuildingShape city={kind === 'city'} color={color(me!)} />
              </g>
            </g>
          );
        })}
        {(pending?.kind === 'ship' || pending?.kind === 'moveShip') &&
          (() => {
            const at = edgeCentre(board, pending.kind === 'ship' ? pending.edge : pending.to);
            return (
              <g
                className="build-ghost ship-piece"
                data-pending-build={pending.kind}
                role="img"
                aria-label={pending.kind === 'ship' ? 'Ship placement preview' : 'Ship move preview'}
                pointerEvents="none"
                transform={`translate(${at.x},${at.y})`}
              >
                <ShipShape color={color(me!)} />
              </g>
            );
          })()}
        {pending &&
          pending.kind !== 'ship' &&
          pending.kind !== 'moveShip' &&
          (() => {
            const road = pending.kind === 'road' ? roadGeometry(board, pending.edge) : null;
            const vertex = pending.kind !== 'road' ? board.vertices[pending.vertex]! : null;
            return (
              <g
                className={`build-ghost ${road ? 'road-piece' : 'house-piece'}`}
                data-pending-build={pending.kind}
                role="img"
                aria-label={`${pending.kind === 'road' ? 'Road' : pending.kind === 'city' ? 'City' : 'Settlement'} placement preview`}
                pointerEvents="none"
                transform={road ? road.transform : `translate(${vertex!.x * SIZE},${vertex!.y * SIZE})`}
              >
                {road ? (
                  <RoadShape length={road.length} color={color(me!)} />
                ) : (
                  <BuildingShape city={pending.kind === 'city'} color={color(me!)} />
                )}
              </g>
            );
          })()}
        <circle
          data-effect-bank
          cx="0"
          cy="0"
          r="2"
          fill="transparent"
          pointerEvents="none"
          aria-hidden="true"
        />
      </svg>
      {explained && explainedBlock && (
        <ShipMoveTooltip
          id="ship-move-reason"
          anchor={explained.anchor}
          reason={SHIP_MOVE_BLOCKS[explainedBlock]}
          reducedMotion={reducedMotion}
          onClose={() => setExplained(null)}
        />
      )}
    </div>
  );
});
