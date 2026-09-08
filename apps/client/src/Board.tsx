import { pips } from '../../../packages/rules/src/board.js';
import type { Board as Island, Terrain } from '../../../packages/rules/src/board.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { GameAction, GameView } from '../../../packages/rules/src/game.js';

export const PLAYER_COLORS = ['#e97843', '#367eaa', '#9161bd', '#ccaa32'];
const TERRAIN_CELL: Record<Terrain, [number, number]> = {
  wood: [0, 0],
  brick: [1, 0],
  sheep: [2, 0],
  wheat: [0, 1],
  ore: [1, 1],
  desert: [2, 1],
};
export type BuildMode = 'road' | 'settlement' | 'city' | null;
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
  const size = 64;
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
    <svg
      className="island"
      viewBox="-365 -342 730 684"
      role="group"
      aria-label="Island board. Highlighted corners and edges are legal placements."
    >
      <defs>
        <filter id="piece-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="3" stdDeviation="1.4" floodColor="#153a40" floodOpacity=".32" />
        </filter>
        {board.hexes.map((h) => (
          <clipPath key={h.id} id={`hex-${h.id}`}>
            <polygon
              points={h.vertices
                .map((v) => `${board.vertices[v]!.x * size},${board.vertices[v]!.y * size}`)
                .join(' ')}
            />
          </clipPath>
        ))}
      </defs>
      <g className="shore-shadow" transform="translate(0 8)">
        {board.hexes.map((h) => (
          <polygon
            key={h.id}
            points={h.vertices
              .map((v) => `${board.vertices[v]!.x * size},${board.vertices[v]!.y * size}`)
              .join(' ')}
          />
        ))}
      </g>
      {board.hexes.map((h) => {
        const x = h.x * size,
          y = h.y * size,
          [col, row] = TERRAIN_CELL[h.terrain];
        const producing = !!game?.dice && game.dice[0] + game.dice[1] === h.number && h.id !== game.robber;
        const canMoveRobber = robberMode && h.id !== game?.robber && !disabled;
        const name = h.terrain === 'desert' ? 'Desert' : RESOURCE_NAMES[h.terrain];
        return (
          <g
            key={`${h.id}-${producing ? game?.turn : 'idle'}`}
            className={`terrain ${producing ? 'producing' : ''} ${canMoveRobber ? 'robber-target' : ''}`}
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
            <title>
              {name}
              {h.number ? ` · ${h.number} · ${pips(h.number)}/36 chance` : ''}
            </title>
            <g clipPath={`url(#hex-${h.id})`}>
              <svg
                x={x - size}
                y={y - size}
                width={size * 2}
                height={size * 2}
                viewBox={`${col * 512} ${row * 512} 512 512`}
              >
                <image href="/art/terrain-simple.png" width="1536" height="1024" />
              </svg>
              {h.id === game?.robber && (
                <rect
                  x={x - size}
                  y={y - size}
                  width={size * 2}
                  height={size * 2}
                  fill="#12252b"
                  opacity=".35"
                />
              )}
            </g>
            <polygon
              className="hex-border"
              points={h.vertices
                .map((v) => `${board.vertices[v]!.x * size},${board.vertices[v]!.y * size}`)
                .join(' ')}
            />
            <g className="tile-label" transform={`translate(${x},${y - 36})`}>
              <rect x="-24" y="-8" width="48" height="16" rx="8" />
              <text textAnchor="middle" y="3">
                {name}
              </text>
            </g>
            {h.number > 0 && (
              <g
                className={`number-token ${[6, 8].includes(h.number) ? 'red-number' : ''}`}
                transform={`translate(${x},${y + 13})`}
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
                transform={`translate(${x + (h.number ? 30 : 0)},${y + 7})`}
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
        const edge = board.edges[port.edge]!,
          a = board.vertices[edge.a]!,
          b = board.vertices[edge.b]!;
        const x = ((a.x + b.x) * size) / 2,
          y = ((a.y + b.y) * size) / 2;
        const distance = Math.hypot(x, y);
        const px = x + (x / distance) * 41,
          py = y + (y / distance) * 41;
        return (
          <g key={port.edge} className="port">
            <line x1={a.x * size} y1={a.y * size} x2={px} y2={py} />
            <line x1={b.x * size} y1={b.y * size} x2={px} y2={py} />
            <rect x={px - 29} y={py - 16} width="58" height="32" rx="10" />
            <text textAnchor="middle" x={px} y={py - 2}>
              {port.resource === 'any' ? 'Any' : RESOURCE_NAMES[port.resource]}
            </text>
            <text className="port-rate" textAnchor="middle" x={px} y={py + 10}>
              {port.resource === 'any' ? '3:1' : '2:1'}
            </text>
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
                x1={a.x * size}
                y1={a.y * size}
                x2={b.x * size}
                y2={b.y * size}
              />
              <line
                className="built-road"
                stroke={color(player)}
                x1={a.x * size}
                y1={a.y * size}
                x2={b.x * size}
                y2={b.y * size}
              />
            </g>
          );
        })}
      {game &&
        Object.entries(game.buildings).map(([id, building]) => {
          const v = board.vertices[Number(id)]!;
          return (
            <g
              key={`${id}-${building.kind}`}
              className="built-piece"
              transform={`translate(${v.x * size},${v.y * size})`}
              filter="url(#piece-shadow)"
            >
              <title>
                {game.players.find((p) => p.id === building.player)?.name} · {building.kind}
              </title>
              <path
                className="building"
                fill={color(building.player)}
                d={
                  building.kind === 'city'
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
              <line className="road-hit" x1={a.x * size} y1={a.y * size} x2={b.x * size} y2={b.y * size} />
              <line className="road-guide" x1={a.x * size} y1={a.y * size} x2={b.x * size} y2={b.y * size} />
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
              transform={`translate(${v.x * size},${v.y * size})`}
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
  );
}
