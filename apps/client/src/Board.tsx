import { useMemo, useState } from 'react';
import { pips } from '../../../packages/rules/src/board.js';
import type { Board as Island } from '../../../packages/rules/src/board.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import type { GameAction, GameView } from '../../../packages/rules/src/game.js';
import { Terrain } from './Terrain.js';
import { DICE_READABLE_MS } from './DiceThrow.js';
import type { BuildAction } from './placement.js';
import {
  coastline,
  HEX_SIZE as SIZE,
  MATERIAL_GUTTER,
  MATERIAL_QUADRANTS,
  hexPoints,
  waterOutline,
  portPlacement,
  SPRITE_INDEX,
  SHIP_HULL_PATH,
  TERRAIN_INDEX,
  WATER_FEATHER,
  WORLD,
} from './scene.js';

export const PLAYER_COLORS = ['#ef7756', '#54b3dc', '#b08be4', '#e2bd4c'] as const;
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
      <rect className="road-foundation" x={-length / 2 + 3} y="-4" width={length - 6} height="15" rx="4" />
      <rect
        className="road-body"
        fill={color}
        x={-length / 2 + 5}
        y="-7"
        width={length - 10}
        height="13"
        rx="2"
      />
      <path className="road-sheen" d={`M${-length / 2 + 9} -4H${length / 2 - 9}`} />
    </>
  );
}
function BuildingShape({ city, color }: { city: boolean; color: string }) {
  return (
    <>
      <ellipse className="building-plinth" rx={city ? 27 : 21} ry="8" cy="12" />
      <ellipse className="building-contact" rx={city ? 23 : 17} ry="4.5" cy="12" />
      <path
        className="building"
        fill={color}
        d={city ? 'M-21 11V-12L-11-22L-1-12V-3L10-14L21-3V11Z' : 'M-14 11V-8L0-21L14-8V11Z'}
      />
      <path
        className="building-roof"
        style={{ color }}
        d={city ? 'M-25-10L-11-25L3-10ZM-4-2L10-17L24-2Z' : 'M-18-6L0-24L18-6Z'}
      />
      <path
        className="roof-highlight"
        d={city ? 'M-21-11L-11-21L-2-11M1-3L10-13L19-3' : 'M-12-7L0-19L12-7'}
      />
      <path className="house-door" d="M-3 11V2H3V11" />
      <path className="house-window" d={city ? 'M-15-3H-10V2H-15ZM10 2H15V7H10Z' : 'M-10-1H-6V3H-10Z'} />
      {city && (
        <>
          <path className="city-wing" d="M-1-1V10" />
        </>
      )}
    </>
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
      <image href="/art/sprites-fantasy.png" width="2048" height="1024" />
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
export function Board({
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
}) {
  const [gpuReady, setGpuReady] = useState(false);
  const coast = useMemo(() => coastline(board), [board.seed]);
  const water = useMemo(
    () =>
      waterOutline(board, WATER_FEATHER / 2)
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    [board.seed],
  );
  const color = (id: string) =>
    PLAYER_COLORS[game?.players.findIndex((p) => p.id === id) ?? 0] ?? PLAYER_COLORS[0];
  const ownTurn = !!game && game.players[game.active]?.id === me && !game.winner;
  const interactive = ownTurn && !disabled;
  const setupSettlement = game?.phase === 'setupSettlement',
    setupRoad = game?.phase === 'setupRoad',
    actions = game?.phase === 'actions';
  const robberMode = interactive && game?.phase === 'robber';
  // The server's legal lists already include affordability, supply, and connection rules.
  // A toolbar choice filters the sites; no choice still permits direct placement.
  const roadSites =
    interactive && (setupRoad || game?.phase === 'freeRoads' || (actions && (!mode || mode === 'road')))
      ? game!.legal.roads
      : [];
  const settlementSites =
    interactive && (setupSettlement || (actions && (!mode || mode === 'settlement')))
      ? game!.legal.settlements
      : [];
  const citySites = interactive && actions && (!mode || mode === 'city') ? game!.legal.cities : [];
  const vertices = [
    ...settlementSites.map((vertex) => ({ kind: 'settlement' as const, vertex })),
    ...citySites.map((vertex) => ({ kind: 'city' as const, vertex })),
  ];
  const pending =
    ownTurn &&
    pendingBuild &&
    (pendingBuild.kind === 'road'
      ? (setupRoad || game?.phase === 'freeRoads' || actions) && game!.legal.roads.includes(pendingBuild.edge)
      : pendingBuild.kind === 'city'
        ? actions && game!.legal.cities.includes(pendingBuild.vertex)
        : (setupSettlement || actions) && game!.legal.settlements.includes(pendingBuild.vertex))
      ? pendingBuild
      : null;
  const keyActivate = (e: React.KeyboardEvent, run: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  };
  return (
    <div
      className={`island-stage ${gpuReady ? 'gpu-ready' : ''}`}
      style={{ aspectRatio: `${WORLD.width}/${WORLD.height}` }}
    >
      <Terrain board={board} onReady={setGpuReady} />
      <svg
        className="island"
        viewBox={`${WORLD.x} ${WORLD.y} ${WORLD.width} ${WORLD.height}`}
        role="group"
        aria-label="Island board"
      >
        <defs>
          <filter
            id="water-feather"
            filterUnits="userSpaceOnUse"
            x={WORLD.x}
            y={WORLD.y}
            width={WORLD.width}
            height={WORLD.height}
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
            x={WORLD.x}
            y={WORLD.y}
            width={WORLD.width}
            height={WORLD.height}
            style={{ maskType: 'alpha' }}
          >
            <polygon points={water} fill="white" filter="url(#water-feather)" />
          </mask>
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
                    <image href="/art/environment-painted.png" width="1024" height="1024" />
                  </svg>
                </g>
              ))}
            </pattern>
          ))}
          {board.hexes.map((h) => (
            <mask
              key={h.id}
              id={`terrain-${h.id}`}
              maskUnits="userSpaceOnUse"
              x={h.x * SIZE - SIZE - 8}
              y={h.y * SIZE - SIZE - 8}
              width={SIZE * 2 + 16}
              height={SIZE * 2 + 16}
            >
              <polygon
                points={hexPoints(h.x * SIZE, h.y * SIZE, 59)}
                fill="white"
                filter="url(#ground-edge)"
              />
            </mask>
          ))}
        </defs>
        <g className="terrain-fallback" aria-hidden="true">
          <rect
            className="water-band"
            x={WORLD.x}
            y={WORLD.y}
            width={WORLD.width}
            height={WORLD.height}
            fill="url(#ocean-material)"
            mask="url(#water-fade-mask)"
          />
          <polygon
            points={coast}
            fill="#52bebf"
            stroke="#73dcd2"
            strokeWidth="27"
            strokeLinejoin="round"
            filter="url(#ground-edge)"
          />
          <polygon
            points={coast}
            fill="url(#sand-material)"
            stroke="#a68d53"
            strokeWidth="8"
            strokeLinejoin="round"
            filter="url(#ground-edge)"
          />
          {board.hexes.map((h) => {
            const n = TERRAIN_INDEX[h.terrain];
            return (
              <g key={h.id} mask={`url(#terrain-${h.id})`}>
                <svg
                  x={h.x * SIZE - SIZE}
                  y={h.y * SIZE - SIZE}
                  width={SIZE * 2}
                  height={SIZE * 2}
                  viewBox={`${(n % 3) * 512} ${Math.floor(n / 3) * 512} 512 512`}
                >
                  <image href="/art/terrain-fantasy.png" width="1536" height="1024" />
                </svg>
              </g>
            );
          })}
        </g>
        {board.hexes.map((h) => {
          const x = h.x * SIZE,
            y = h.y * SIZE;
          const canMoveRobber = robberMode && h.id !== game?.robber && !disabled;
          const name = h.terrain === 'desert' ? 'Desert' : RESOURCE_NAMES[h.terrain];
          return (
            <g
              key={h.id}
              className={`terrain-hit ${canMoveRobber ? 'robber-target' : ''}`}
              role={canMoveRobber ? 'button' : undefined}
              tabIndex={canMoveRobber ? 0 : undefined}
              aria-label={`${name}${h.number ? `, ${h.number}, ${pips(h.number)} production pips` : ''}${canMoveRobber ? '. Move robber here' : ''}`}
              onClick={() => canMoveRobber && onRobber(h.id)}
              onKeyDown={(e) =>
                keyActivate(e, () => {
                  if (canMoveRobber) onRobber(h.id);
                })
              }
            >
              <polygon className="hex-hit" points={hexPoints(x, y, 60)} />
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
                  className={`number-token ${[6, 8].includes(h.number) ? 'red-number' : ''}`}
                  transform={`translate(${x},${y + 14})`}
                >
                  <circle r="20" />
                  <text textAnchor="middle" y="5">
                    {h.number}
                  </text>
                  <text className="pips" textAnchor="middle" y="14">
                    {'•'.repeat(pips(h.number))}
                  </text>
                </g>
              )}
              {h.id === (game?.robber ?? board.hexes.find((h) => h.terrain === 'desert')!.id) && (
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
        {board.ports.map((port) => {
          const p = portPlacement(board, port.edge),
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
                    <rect className="pier-shadow" x="0" y="-5" width={length} height="12" rx="2" />
                    <rect className="pier-deck" x="0" y="-6" width={length} height="10" />
                    {Array.from({ length: Math.ceil(length / 5) }, (_, j) => (
                      <path key={j} className="pier-plank" d={`M${j * 5} -5V4`} />
                    ))}
                    <path className="pier-rail" d={`M2 -7H${length}M2 5H${length}`} />
                    {[3, length / 2, length - 3].map((j) => (
                      <g key={j}>
                        <circle className="pier-post" cx={j} cy="-7" r="2" />
                        <circle className="pier-post" cx={j} cy="5" r="2" />
                      </g>
                    ))}
                  </g>
                );
              })}
              <g className="port-boat" transform={`translate(${p.boatX},${p.boatY}) rotate(${p.angle})`}>
                <path className="ship-shadow" transform="translate(0 3)" d={SHIP_HULL_PATH} />
                <path className="ship-hull" d={SHIP_HULL_PATH} />
                <path
                  className="ship-deck"
                  d="M0-36C22-25 35-10 35 8C35 27 25 40 17 43Q0 49-17 43C-25 40-35 27-35 8C-35-10-22-25 0-36Z"
                />
                <path
                  className="ship-planks"
                  d="M-17-18H17M-29-7H29M-34 5H34M-32 17H32M-27 29H27M-17 41H17"
                />
                <path
                  className="ship-gunwale"
                  d="M-3-40C-26-26-38-7-37 13Q-35 32-23 44M3-40C26-26 38-7 37 13Q35 32 23 44"
                />
                <path className="ship-mast" d="M-6-38V-13" />
                <path className="ship-sail" d="M-4-36Q12-29 18-16L-4-18Z" />
                <path className="ship-sail-seam" d="M-2-31L12-19" />
                <path className="ship-pennant" d="M-6-40L5-36L-6-32Z" />
                <path className="ship-stern" d="M-17 46Q0 51 17 46" />
              </g>
              <g className="port-cargo" transform={`translate(${p.markerX},${p.markerY})`}>
                <path className="ship-cargo-cloth" d="M-21-17Q0-24 21-17L20 16Q0 21-20 16Z" />
                <svg
                  x="-22"
                  y="-27"
                  width="44"
                  height="44"
                  viewBox={`${(n % 4) * 512} ${Math.floor(n / 4) * 512} 512 512`}
                >
                  <image href="/art/sprites-fantasy.png" width="2048" height="1024" />
                </svg>
                <rect className="port-rate-plaque" x="-16" y="14" width="32" height="17" rx="3" />
                <text className="port-rate" textAnchor="middle" y="27">
                  {port.resource === 'any' ? '3:1' : '2:1'}
                </text>
              </g>
            </g>
          );
        })}
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
        {roadSites.map((id) => {
          const { length, transform } = roadGeometry(board, id);
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`Build road on edge ${id + 1}`}
              className="legal-road"
              data-build-site="road"
              data-pending={pending?.kind === 'road' && pending.edge === id}
              transform={transform}
              onClick={() => onAction({ kind: 'road', edge: id })}
              onKeyDown={(e) => keyActivate(e, () => onAction({ kind: 'road', edge: id }))}
            >
              <line className="road-hit" x1={-length / 2} y1="0" x2={length / 2} y2="0" />
              <g className="build-site-preview" aria-hidden="true">
                <RoadShape length={length} color={color(me!)} />
              </g>
            </g>
          );
        })}
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
              data-pending={pending?.kind === kind && pending.vertex === id}
              onClick={() => onAction({ kind, vertex: id })}
              onKeyDown={(e) => keyActivate(e, () => onAction({ kind, vertex: id }))}
            >
              <circle className="vertex-hit" r="21" />
              <g className="build-site-preview" aria-hidden="true">
                <BuildingShape city={kind === 'city'} color={color(me!)} />
              </g>
            </g>
          );
        })}
        {pending &&
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
    </div>
  );
}
