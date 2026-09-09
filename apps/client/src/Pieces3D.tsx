import { memo, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Board } from '../../../packages/rules/src/board.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import { HEX_SIZE, WORLD } from './scene.js';

const DEFAULT_COLORS = ['#cf6345', '#3787b5', '#9867b5', '#c5a335'];
type PieceStyle = CSSProperties & { '--piece-color'?: string };
const em = (n: number) => `${n}em`;

/** Board coordinates and CSS percentages share the SVG's exact viewport. */
export function piecePosition(x: number, y: number): CSSProperties {
  return {
    left: `${((x * HEX_SIZE - WORLD.x) / WORLD.width) * 100}%`,
    top: `${((y * HEX_SIZE - WORLD.y) / WORLD.height) * 100}%`,
  };
}

/** Five planes; the invisible underside needs no DOM or compositor surface. */
function Block({
  width: w,
  depth: d,
  height: h,
  className = '',
}: {
  width: number;
  depth: number;
  height: number;
  className?: string;
}) {
  return (
    <span className={`piece3d-block ${className}`}>
      <i
        className="piece3d-face piece3d-top"
        style={{
          left: em(-w / 2),
          top: em(-d / 2),
          width: em(w),
          height: em(d),
          transform: `translateZ(${em(h)})`,
        }}
      />
      <i
        className="piece3d-face piece3d-south"
        style={{
          left: em(-w / 2),
          top: em(d / 2 - h / 2),
          width: em(w),
          height: em(h),
          transform: `translateZ(${em(h / 2)}) rotateX(-90deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-north"
        style={{
          left: em(-w / 2),
          top: em(-d / 2 - h / 2),
          width: em(w),
          height: em(h),
          transform: `translateZ(${em(h / 2)}) rotateX(90deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-east"
        style={{
          left: em(w / 2 - h / 2),
          top: em(-d / 2),
          width: em(h),
          height: em(d),
          transform: `translateZ(${em(h / 2)}) rotateY(90deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-west"
        style={{
          left: em(-w / 2 - h / 2),
          top: em(-d / 2),
          width: em(h),
          height: em(d),
          transform: `translateZ(${em(h / 2)}) rotateY(-90deg)`,
        }}
      />
    </span>
  );
}

/** A solid triangular prism: two pitched roof planes and two triangular gables. */
function Roof({
  width: w,
  depth: d,
  base: h,
  rise: r,
}: {
  width: number;
  depth: number;
  base: number;
  rise: number;
}) {
  const slope = Math.hypot(d / 2, r),
    angle = (Math.atan2(r, d / 2) * 180) / Math.PI;
  return (
    <span className="piece3d-roof">
      <i
        className="piece3d-face piece3d-roof-north"
        style={{
          left: em(-w / 2),
          top: em(-d / 4 - slope / 2),
          width: em(w),
          height: em(slope),
          transform: `translateZ(${em(h + r / 2)}) rotateX(${angle}deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-roof-south"
        style={{
          left: em(-w / 2),
          top: em(d / 4 - slope / 2),
          width: em(w),
          height: em(slope),
          transform: `translateZ(${em(h + r / 2)}) rotateX(${-angle}deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-gable piece3d-west"
        style={{
          left: em(-w / 2 - d / 2),
          top: em(-r / 2),
          width: em(d),
          height: em(r),
          transform: `translateZ(${em(h + r / 2)}) rotateZ(90deg) rotateX(-90deg)`,
        }}
      />
      <i
        className="piece3d-face piece3d-gable piece3d-east"
        style={{
          left: em(w / 2 - d / 2),
          top: em(-r / 2),
          width: em(d),
          height: em(r),
          transform: `translateZ(${em(h + r / 2)}) rotateZ(-90deg) rotateX(-90deg)`,
        }}
      />
    </span>
  );
}

function House({ city }: { city: boolean }) {
  return (
    <>
      <span
        className="piece3d-foundation"
        style={{
          width: em(city ? 39 : 29),
          height: em(city ? 30 : 26),
          left: em(city ? -19.5 : -14.5),
          top: em(city ? -15 : -13),
        }}
      />
      <span
        className="piece3d-building-part"
        style={{ transform: city ? 'translate3d(-7em, -2em, 2em)' : 'translateZ(2em)' }}
      >
        <Block
          width={city ? 17 : 23}
          depth={city ? 20 : 18}
          height={city ? 24 : 15}
          className="piece3d-walls"
        />
        <Roof width={city ? 20 : 27} depth={city ? 24 : 22} base={city ? 24 : 15} rise={city ? 11 : 10} />
      </span>
      {city && (
        <span className="piece3d-building-part" style={{ transform: 'translate3d(8em, 4em, 2em)' }}>
          <Block width={17} depth={16} height={13} className="piece3d-walls" />
          <Roof width={20} depth={20} base={13} rise={8} />
        </span>
      )}
    </>
  );
}

/** Static, genuinely dimensional pieces. ResizeObserver only updates one shared scale. */
export const Pieces3D = memo(function Pieces3D({
  board,
  game,
  me,
  colors = DEFAULT_COLORS,
}: {
  board: Board;
  game: GameView;
  me?: string;
  colors?: readonly string[];
}) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = layer.current;
    if (!node) return;
    const size = (width: number) => {
      if (width > 0) node.style.fontSize = `${width / WORLD.width}px`;
    };
    size(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) size(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const color = (owner: string) =>
    colors[game.players.findIndex((p) => p.id === owner)] ?? colors[0] ?? DEFAULT_COLORS[0];
  return (
    <div ref={layer} className="pieces3d" aria-hidden="true">
      {Object.entries(game.roads).map(([id, owner]) => {
        const edge = board.edges[Number(id)];
        if (!edge) return null;
        const a = board.vertices[edge.a]!,
          b = board.vertices[edge.b]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y) * HEX_SIZE - 13;
        const style: PieceStyle = {
          ...piecePosition((a.x + b.x) / 2, (a.y + b.y) / 2),
          '--piece-color': color(owner),
          transform: `rotateZ(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI}deg)`,
        };
        return (
          <span
            key={id}
            data-piece-road={id}
            className={`piece3d piece3d-road ${owner === me ? 'piece3d-own' : ''}`}
            style={style}
          >
            <span
              className="piece3d-foundation"
              style={{ width: em(length + 6), height: '14em', left: em(-(length + 6) / 2), top: '-7em' }}
            />
            <Block width={length} depth={9} height={7} className="piece3d-road-block" />
          </span>
        );
      })}
      {Object.entries(game.buildings).map(([id, building]) => {
        const vertex = board.vertices[Number(id)];
        if (!vertex) return null;
        const style: PieceStyle = {
          ...piecePosition(vertex.x, vertex.y),
          '--piece-color': color(building.player),
        };
        return (
          <span
            key={`${id}-${building.kind}`}
            data-piece-building={id}
            data-piece-kind={building.kind}
            className={`piece3d piece3d-house ${building.player === me ? 'piece3d-own' : ''}`}
            style={style}
          >
            <House city={building.kind === 'city'} />
          </span>
        );
      })}
    </div>
  );
});
