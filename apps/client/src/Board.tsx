import { useMemo, useState } from 'react';
import { pips } from '../../../packages/rules/src/board.js';
import type { Board as Island } from '../../../packages/rules/src/board.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import type { GameAction, GameView } from '../../../packages/rules/src/game.js';
import { Terrain } from './Terrain.js';
import {
  coastline,
  HEX_SIZE as SIZE,
  hexPoints,
  oceanRing,
  portPlacement,
  SPRITE_INDEX,
  TERRAIN_INDEX,
  WORLD,
} from './scene.js';

export const PLAYER_COLORS = ['#ef8849', '#54b8e2', '#c285ed', '#e5c04b'];
export type BuildMode = 'road' | 'settlement' | 'city' | null;
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
      <image href="/art/sprites.png" width="2048" height="1024" />
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
}: {
  board: Island;
  game?: GameView;
  me?: string;
  mode: BuildMode;
  disabled: boolean;
  onAction: (action: GameAction) => void;
  onRobber: (hex: number) => void;
}) {
  const [gpuReady, setGpuReady] = useState(false);
  const coast = useMemo(() => coastline(board), [board.seed]);
  const water = useMemo(oceanRing, []);
  const color = (id: string) =>
    PLAYER_COLORS[game?.players.findIndex((p) => p.id === id) ?? 0] ?? PLAYER_COLORS[0];
  const setupSettlement = game?.phase === 'setupSettlement',
    setupRoad = game?.phase === 'setupRoad';
  const robberMode = game?.phase === 'robber' && game.players[game.active]?.id === me;
  const roadMode = setupRoad || game?.phase === 'freeRoads' || mode === 'road';
  const vertexMode = setupSettlement || mode === 'settlement' || mode === 'city';
  const vertices =
    mode === 'city' && !setupSettlement ? (game?.legal.cities ?? []) : (game?.legal.settlements ?? []);
  const keyActivate = (e: React.KeyboardEvent, run: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  };
  return (
    <div className={`island-stage ${gpuReady ? 'gpu-ready' : ''}`}>
      <Terrain board={board} onReady={setGpuReady} />
      <svg
        className="island"
        viewBox={`${WORLD.x} ${WORLD.y} ${WORLD.width} ${WORLD.height}`}
        role="group"
        aria-label="Island board"
      >
        <defs>
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
          <pattern id="ocean-material" width="240" height="240" patternUnits="userSpaceOnUse">
            <svg width="240" height="240" viewBox="0 0 512 512">
              <image href="/art/environment.png" width="1024" height="1024" />
            </svg>
          </pattern>
          <pattern id="sand-material" width="150" height="150" patternUnits="userSpaceOnUse">
            <svg width="150" height="150" viewBox="0 512 512 512">
              <image href="/art/environment.png" width="1024" height="1024" />
            </svg>
          </pattern>
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
          {water.map((h) => (
            <polygon
              key={`${h.q},${h.r}`}
              points={hexPoints(h.x, h.y)}
              fill="url(#ocean-material)"
              stroke="#518d99"
              strokeWidth="1.3"
            />
          ))}
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
                  <image href="/art/terrain-vibrant.png" width="1536" height="1024" />
                </svg>
              </g>
            );
          })}
        </g>
        {board.hexes.map((h) => {
          const x = h.x * SIZE,
            y = h.y * SIZE,
            producing = !!game?.dice && game.dice[0] + game.dice[1] === h.number && h.id !== game.robber;
          const canMoveRobber = robberMode && h.id !== game?.robber && !disabled;
          const name = h.terrain === 'desert' ? 'Desert' : RESOURCE_NAMES[h.terrain];
          return (
            <g
              key={`${h.id}-${producing ? game?.turn : 'idle'}`}
              className={`terrain-hit ${producing ? 'producing' : ''} ${canMoveRobber ? 'robber-target' : ''}`}
              role={canMoveRobber ? 'button' : undefined}
              tabIndex={canMoveRobber ? 0 : undefined}
              aria-label={`${name}${h.number ? `, ${h.number}` : ''}${canMoveRobber ? '. Move robber here' : ''}`}
              onClick={() => canMoveRobber && onRobber(h.id)}
              onKeyDown={(e) =>
                keyActivate(e, () => {
                  if (canMoveRobber) onRobber(h.id);
                })
              }
            >
              <title>
                {name}
                {h.number ? ` · ${h.number} · ${pips(h.number)} production pips` : ''}
              </title>
              <polygon className="hex-hit" points={hexPoints(x, y, 60)} />
              {h.id === game?.robber && (
                <polygon points={hexPoints(x, y, 57)} fill="#101b26" opacity=".28" pointerEvents="none" />
              )}
              {h.number > 0 && (
                <g
                  className={`number-token ${[6, 8].includes(h.number) ? 'red-number' : ''}`}
                  transform={`translate(${x},${y + 14})`}
                >
                  <circle r="19" />
                  <text textAnchor="middle" y="4">
                    {h.number}
                  </text>
                  <text className="pips" textAnchor="middle" y="13">
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
              className="port"
              aria-label={`${port.resource === 'any' ? 'Any resource' : RESOURCE_NAMES[port.resource]} port ${port.resource === 'any' ? '3 to 1' : '2 to 1'}`}
            >
              <title>
                {port.resource === 'any' ? 'Any resource' : RESOURCE_NAMES[port.resource]} ·{' '}
                {port.resource === 'any' ? '3:1' : '2:1'}
              </title>
              <g transform={`translate(${p.x},${p.y}) rotate(${p.angle})`} filter="url(#piece-shadow)">
                <svg x="-42" y="-71" width="84" height="84" viewBox="1024 512 512 512">
                  <image href="/art/sprites.png" width="2048" height="1024" />
                </svg>
              </g>
              <g transform={`translate(${p.markerX},${p.markerY})`}>
                <circle className="port-medallion" r="18" />
                <svg
                  x="-16"
                  y="-20"
                  width="32"
                  height="32"
                  viewBox={`${(n % 4) * 512} ${Math.floor(n / 4) * 512} 512 512`}
                >
                  <image href="/art/sprites.png" width="2048" height="1024" />
                </svg>
                <rect className="port-rate-bg" x="-14" y="10" width="28" height="15" rx="5" />
                <text className="port-rate" textAnchor="middle" y="21">
                  {port.resource === 'any' ? '3:1' : '2:1'}
                </text>
              </g>
            </g>
          );
        })}
        {game &&
          Object.entries(game.roads).map(([id, player]) => {
            const e = board.edges[Number(id)]!,
              a = board.vertices[e.a]!,
              b = board.vertices[e.b]!;
            return (
              <g key={id} className="built-piece" filter="url(#piece-shadow)">
                <line
                  className="built-road-outline"
                  x1={a.x * SIZE}
                  y1={a.y * SIZE}
                  x2={b.x * SIZE}
                  y2={b.y * SIZE}
                />
                <line
                  className="built-road"
                  stroke={color(player)}
                  x1={a.x * SIZE}
                  y1={a.y * SIZE}
                  x2={b.x * SIZE}
                  y2={b.y * SIZE}
                />
              </g>
            );
          })}
        {game &&
          Object.entries(game.buildings).map(([id, b]) => {
            const v = board.vertices[Number(id)]!;
            return (
              <g
                key={`${id}-${b.kind}`}
                className="built-piece"
                transform={`translate(${v.x * SIZE},${v.y * SIZE})`}
                filter="url(#piece-shadow)"
              >
                <title>
                  {game.players.find((p) => p.id === b.player)?.name} · {b.kind}
                </title>
                <path
                  className="building"
                  fill={color(b.player)}
                  d={
                    b.kind === 'city'
                      ? 'M-13 8V-7L-5-14L3-7V-1H12V8ZM-5-3V2'
                      : 'M-10 8V-4L0-12L10-4V8ZM-2 8V1H2V8'
                  }
                />
              </g>
            );
          })}
        {roadMode &&
          !disabled &&
          (game?.legal.roads ?? []).map((id) => {
            const e = board.edges[id]!,
              a = board.vertices[e.a]!,
              b = board.vertices[e.b]!;
            return (
              <g
                key={id}
                role="button"
                tabIndex={0}
                aria-label={`Build road on edge ${id + 1}`}
                className="legal-road"
                onClick={() => onAction({ kind: 'road', edge: id })}
                onKeyDown={(e) => keyActivate(e, () => onAction({ kind: 'road', edge: id }))}
              >
                <line className="road-hit" x1={a.x * SIZE} y1={a.y * SIZE} x2={b.x * SIZE} y2={b.y * SIZE} />
                <line
                  className="road-guide"
                  x1={a.x * SIZE}
                  y1={a.y * SIZE}
                  x2={b.x * SIZE}
                  y2={b.y * SIZE}
                />
              </g>
            );
          })}
        {vertexMode &&
          !disabled &&
          vertices.map((id) => {
            const v = board.vertices[id]!,
              kind = mode === 'city' && !setupSettlement ? 'city' : 'settlement';
            return (
              <g
                key={id}
                transform={`translate(${v.x * SIZE},${v.y * SIZE})`}
                role="button"
                tabIndex={0}
                aria-label={`Build ${kind} at corner ${id + 1}`}
                className="legal-vertex"
                onClick={() => onAction({ kind, vertex: id })}
                onKeyDown={(e) => keyActivate(e, () => onAction({ kind, vertex: id }))}
              >
                <circle className="vertex-hit" r="15" />
                <circle className="vertex-guide" r="8" />
                <path d="M-3 0h6M0-3v6" />
              </g>
            );
          })}
      </svg>
    </div>
  );
}
