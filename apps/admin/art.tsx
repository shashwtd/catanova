/**
 * Small drawings of the machine the numbers describe: a processor that
 * glows with its load, a memory stick whose chips fill as it is used, a
 * stopwatch for the event loop's delay, a plug for the sockets, a tank for
 * the disk, a database, and meeples for the people. One way of drawing
 * throughout: flat shapes with a lighter top and a darker side, the light
 * from the top left, a soft shadow underneath, and the dashboard's own
 * colours (the `art-*` classes in admin.css). Each takes the live value it
 * stands for. They are decorative, since the number is always written beside
 * them, and any motion stops under prefers-reduced-motion.
 */
import type { ReactNode } from 'react';
import { PLAYER_COLORS } from '../../packages/protocol/src/colors.js';
import type { PlayerColor } from '../../packages/protocol/src/colors.js';

/** How a reading stands: fine, getting busy, or needing a look. */
export type Level = 'calm' | 'busy' | 'hot';

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

function Art({
  name,
  width = 64,
  height = 64,
  level,
  children,
}: {
  name: string;
  width?: number;
  height?: number;
  level?: Level;
  children: ReactNode;
}) {
  return (
    <svg
      className={`art art-${name}${level ? ` art-${level}` : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** The soft shadow every drawing stands on. */
const Ground = ({ cx = 32, cy = 57, rx = 22 }: { cx?: number; cy?: number; rx?: number }) => (
  <ellipse className="art-ground" cx={cx} cy={cy} rx={rx} ry={3.2} />
);

/** CPU load as a share of one core: calm below half, busy to 80%, hot beyond. */
export const cpuLevel = (percent: number): Level => (percent >= 80 ? 'hot' : percent >= 50 ? 'busy' : 'calm');

/**
 * A processor seen from above: its package and pins, and the die in the
 * middle glowing brighter and warmer as the load rises.
 */
export function CpuChip({ percent }: { percent: number }) {
  const load = clamp(percent / 100);
  const level = cpuLevel(percent);
  const pins = [0, 1, 2, 3, 4].map((i) => 17.5 + i * 7);
  return (
    <Art name="cpu" level={level}>
      <Ground />
      {/* Pins on all four sides, the lit side of each towards the top left. */}
      {pins.map((at) => (
        <g key={at} className="art-metal">
          <rect x={at - 1.3} y={6.5} width={2.6} height={6} rx={0.8} />
          <rect x={at - 1.3} y={45} width={2.6} height={6.5} rx={0.8} />
          <rect x={6.5} y={at - 3.3} width={6} height={2.6} rx={0.8} />
          <rect x={51.5} y={at - 3.3} width={6} height={2.6} rx={0.8} />
        </g>
      ))}
      <rect className="art-side" x={11.5} y={11.5} width={41} height={39} rx={5} />
      <rect className="art-top" x={11} y={10} width={41} height={38} rx={5} />
      <rect className="art-top-light" x={13} y={11.5} width={37} height={1.4} rx={0.7} />
      {/* The die and its glow: brighter with more load. */}
      <g className="art-cpu-glow" opacity={(0.35 + 0.65 * load).toFixed(2)}>
        <rect className="art-glow art-glow-3" x={14.5} y={13.5} width={34} height={31} rx={8} />
        <rect className="art-glow art-glow-2" x={18} y={17} width={27} height={24} rx={6} />
        <rect className="art-glow art-glow-1" x={21} y={20} width={21} height={18} rx={4.5} />
      </g>
      <rect className="art-die" x={23} y={21.5} width={17} height={15} rx={2.5} />
      <g className="art-die-cores">
        <rect x={25.5} y={24} width={5} height={4} rx={0.8} />
        <rect x={32.5} y={24} width={5} height={4} rx={0.8} />
        <rect x={25.5} y={30} width={5} height={4} rx={0.8} />
        <rect x={32.5} y={30} width={5} height={4} rx={0.8} />
      </g>
      <circle className="art-dot" cx={15.5} cy={43.5} r={1.4} />
    </Art>
  );
}

/** Memory in use: calm below three quarters of what the process may have, busy to 90%, hot beyond. */
export const memoryLevel = (share: number): Level => (share >= 0.9 ? 'hot' : share >= 0.75 ? 'busy' : 'calm');

/**
 * A memory stick: its board, gold contacts and four chips, which fill from
 * the left, bottom to top, with the share of memory in use.
 */
export function MemoryStick({ used, limit }: { used: number; limit: number | null }) {
  const share = limit ? clamp(used / limit) : 0;
  const chips = [9.5, 20.5, 35.5, 46.5];
  return (
    <Art name="memory" level={memoryLevel(share)}>
      <Ground cy={55} rx={25} />
      <rect className="art-board-side" x={5} y={17.5} width={54} height={30} rx={2.5} />
      <rect className="art-board" x={4.5} y={15.5} width={54} height={30} rx={2.5} />
      <rect className="art-board-light" x={6.5} y={17} width={50} height={1.2} rx={0.6} />
      {/* Contacts along the bottom edge, and the notch that keys the stick. */}
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          className="art-gold"
          x={7 + i * 4.2 + (i >= 6 ? 1.6 : 0)}
          y={39.5}
          width={2.6}
          height={6}
          rx={0.6}
        />
      ))}
      <rect className="art-notch" x={30.1} y={40} width={3.2} height={7.5} rx={1.2} />
      {chips.map((x, i) => {
        const fill = clamp(share * chips.length - i);
        const height = 14 * fill;
        return (
          <g key={x}>
            <rect className="art-chip" x={x} y={21} width={8.5} height={15} rx={1.4} />
            {height > 0 && (
              <rect
                className="art-chip-fill"
                x={x + 1.2}
                y={35 - height}
                width={6.1}
                height={height}
                rx={1}
              />
            )}
            <rect className="art-chip-light" x={x + 1} y={21.8} width={6.5} height={1.1} rx={0.5} />
          </g>
        );
      })}
      <rect className="art-sweep" x={4.5} y={15.5} width={6} height={30} rx={1} />
    </Art>
  );
}

/** Event-loop delay (p99, ms): what players feel as lag. Calm under 10 ms, busy to 50, hot beyond. */
export const delayLevel = (ms: number): Level => (ms >= 50 ? 'hot' : ms >= 10 ? 'busy' : 'calm');

/**
 * A stopwatch for the event loop: the hand and the arc swept behind it show
 * the delay on a scale that doubles its reach every few steps (5 ms a
 * quarter of the way round, 100 ms most of it), and a dot circles the rim as
 * the loop keeps turning.
 */
export function Stopwatch({ ms }: { ms: number }) {
  const reach = clamp(Math.log10(1 + Math.max(0, ms)) / Math.log10(101));
  const angle = reach * 300;
  const cx = 32,
    cy = 35,
    r = 15;
  const point = (degrees: number, radius: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)] as const;
  };
  const [ex, ey] = point(angle, r - 2.5);
  const [hx, hy] = point(angle, r - 3);
  const arc =
    angle > 0.5
      ? `M${cx},${cy - (r - 2.5)}A${r - 2.5},${r - 2.5} 0 ${angle > 180 ? 1 : 0} 1 ${ex.toFixed(2)},${ey.toFixed(2)}`
      : '';
  return (
    <Art name="loop" level={delayLevel(ms)}>
      <Ground />
      {/* Crown and side button. */}
      <rect className="art-metal" x={28.5} y={8} width={7} height={5} rx={1.5} />
      <rect className="art-side" x={30} y={12} width={4} height={4} />
      <rect
        className="art-metal"
        x={46}
        y={13}
        width={5}
        height={4}
        rx={1.2}
        transform="rotate(40 48.5 15)"
      />
      <circle className="art-side" cx={32.6} cy={36} r={20.5} />
      <circle className="art-top" cx={32} cy={35} r={20.5} />
      <circle className="art-rim" cx={32} cy={35} r={17.5} />
      <circle className="art-face" cx={32} cy={35} r={16} />
      {Array.from({ length: 12 }, (_, i) => {
        const [x1, y1] = point(i * 30, 15);
        const [x2, y2] = point(i * 30, i % 3 ? 13.4 : 12.2);
        return <line key={i} className="art-tick" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {arc && <path className="art-arc" d={arc} />}
      <line className="art-hand" x1={cx} y1={cy} x2={hx} y2={hy} />
      <circle className="art-hand-cap" cx={cx} cy={cy} r={2.2} />
      <g className="art-orbit">
        <circle className="art-orbit-dot" cx={32} cy={16.5} r={1.5} />
      </g>
    </Art>
  );
}

/**
 * A plug in its wall socket, its cable trailing away: pushed home with the
 * socket's light on while there are open connections, pulled out with the
 * light off when there are none.
 */
export function Plug({ sockets }: { sockets: number }) {
  const on = sockets > 0;
  const shift = on ? 0 : -8;
  return (
    <Art name="plug" level={on ? 'calm' : undefined}>
      <Ground cy={56} rx={25} />
      {/* The wall plate, its two slots and its light. */}
      <rect className="art-side" x={38.5} y={11.5} width={21} height={36} rx={5.5} />
      <rect className="art-top" x={38} y={10} width={21} height={36} rx={5.5} />
      <rect className="art-top-light" x={40} y={11.3} width={17} height={1.2} rx={0.6} />
      <rect className="art-slot" x={43.6} y={20} width={2.4} height={8} rx={1.1} />
      <rect className="art-slot" x={50.4} y={20} width={2.4} height={8} rx={1.1} />
      <circle className="art-led" cx={48.5} cy={38} r={2.1} />
      <g transform={`translate(${shift},0)`}>
        {/* The cable, the prongs, then the plug's body, lit from the top left. */}
        <path className="art-cable" d="M15 26 C6 26 5 36 10 43 S19 53 5 57" />
        <rect className="art-metal" x={33} y={21.4} width={12} height={2.4} rx={1.1} />
        <rect className="art-metal" x={33} y={25.6} width={19} height={2.4} rx={1.1} />
        <rect className="art-plug-body-side" x={14.8} y={15.8} width={21} height={22} rx={5.5} />
        <rect className="art-plug-body" x={14} y={14} width={21} height={22} rx={5.5} />
        <rect className="art-top-light" x={16.5} y={15.4} width={16} height={1.3} rx={0.65} />
        <rect className="art-grip" x={19} y={20.5} width={1.8} height={10} rx={0.9} />
        <rect className="art-grip" x={23.2} y={20.5} width={1.8} height={10} rx={0.9} />
      </g>
    </Art>
  );
}

/** Disk space: calm with a fifth or more free, busy with less, hot under a tenth. The thresholds are System's meter's. */
export const diskLevel = (free: number): Level => (free < 0.1 ? 'hot' : free < 0.2 ? 'busy' : 'calm');

/** A tank for the disk, filled to the share in use: blue, then amber and red as the free space runs out. */
export function DiskTank({ used, total }: { used: number; total: number }) {
  const share = total > 0 ? clamp(used / total) : 0;
  const top = 15,
    bottom = 47;
  const level = bottom - (bottom - top) * share;
  return (
    <Art name="disk" level={diskLevel(1 - share)}>
      <Ground cy={55} rx={20} />
      <path className="art-side" d={`M13 ${top}V${bottom}A19 6 0 0 0 51 ${bottom}V${top}Z`} />
      {/* The contents, and their surface. */}
      {share > 0 && (
        <>
          <path className="art-fill" d={`M13 ${level}V${bottom}A19 6 0 0 0 51 ${bottom}V${level}Z`} />
          <ellipse className="art-fill-top" cx={32} cy={level} rx={19} ry={6} />
        </>
      )}
      <path className="art-glass" d={`M13 ${top}V${bottom}A19 6 0 0 0 51 ${bottom}V${top}`} />
      <rect className="art-glass-light" x={16} y={top + 5} width={2.4} height={bottom - top - 4} rx={1.2} />
      <ellipse className="art-top" cx={32} cy={top} rx={19} ry={6} />
      <ellipse className="art-lid" cx={32} cy={top} rx={15} ry={4.2} />
      {[0.25, 0.5, 0.75].map((mark) => (
        <line
          key={mark}
          className="art-tick"
          x1={47}
          x2={50}
          y1={bottom - (bottom - top) * mark}
          y2={bottom - (bottom - top) * mark}
        />
      ))}
    </Art>
  );
}

/**
 * The database: three stacked platters lit from above, with a light that
 * blinks as the game writes.
 */
export function Database() {
  const tiers = [15, 26, 37];
  return (
    <Art name="database">
      <Ground cy={56} rx={20} />
      {[...tiers].reverse().map((y) => (
        <g key={y}>
          <path className="art-db-side" d={`M13 ${y}V${y + 9}A19 5.5 0 0 0 51 ${y + 9}V${y}Z`} />
          <path
            className="art-db-shade"
            d={`M40 ${y + 4.9}A19 5.5 0 0 0 51 ${y}V${y + 9}A19 5.5 0 0 1 40 ${y + 13.9}Z`}
          />
          <ellipse className="art-db-top" cx={32} cy={y} rx={19} ry={5.5} />
        </g>
      ))}
      <ellipse className="art-db-light" cx={27} cy={13.8} rx={9} ry={2} />
      <circle className="art-led" cx={44} cy={46.8} r={1.6} />
      <circle className="art-led art-led-2" cx={44} cy={35.8} r={1.6} />
    </Art>
  );
}

/**
 * The rooms: a settlement and a city on a hex of the island, in two players'
 * colours, their windows lit while any game is being played.
 */
export function Settlement({ live }: { live: number }) {
  const lit = live > 0;
  const pane = `art-window${lit ? ' art-window-lit' : ''}`;
  return (
    <Art name="rooms">
      <Ground cy={57} rx={25} />
      {/* The hex: its top and the edge below it. */}
      <path className="art-hex-side" d="M7 45 L18 38 H46 L57 45 V48 L46 55 H18 L7 48 Z" />
      <path className="art-hex-top" d="M7 45 L18 38 H46 L57 45 L46 52 H18 Z" />
      {/* The settlement: front, lit side, dark side, then the roof's two planes. */}
      <g>
        <path className="art-coral-side" d="M24 47 L28 44.5 V36 L24 38.5 Z" />
        <path className="art-coral" d="M13 47 H24 V38.5 H13 Z" />
        <path className="art-coral-roof-back" d="M13 38.5 L18.5 31 L28 36 L24 38.5 Z" />
        <path className="art-coral-roof" d="M13 38.5 L18.5 31 L24 38.5 Z" />
        <rect className={pane} x={16.8} y={40.5} width={3.4} height={3.4} rx={0.6} />
      </g>
      {/* The city: its tower first, then the hall in front. */}
      <g>
        <path className="art-sky-side" d="M47 45 L50.5 42.8 V24 L47 26.2 Z" />
        <path className="art-sky" d="M40 45 H47 V26.2 H40 Z" />
        <path className="art-sky-roof-back" d="M40 26.2 L43.5 20.5 L50.5 24 L47 26.2 Z" />
        <path className="art-sky-roof" d="M40 26.2 L43.5 20.5 L47 26.2 Z" />
        <rect className={pane} x={42} y={29.5} width={3} height={3.6} rx={0.6} />
        <path className="art-sky-side" d="M40 48 L43 46 V38.5 L40 40.5 Z" />
        <path className="art-sky" d="M29 48 H40 V40.5 H29 Z" />
        <path className="art-sky-roof-back" d="M29 40.5 L34.5 34 L43 38.5 L40 40.5 Z" />
        <path className="art-sky-roof" d="M29 40.5 L34.5 34 L40 40.5 Z" />
        <rect className={pane} x={32.8} y={42.4} width={3.4} height={3.4} rx={0.6} />
      </g>
    </Art>
  );
}

/** The meeple outline, standing with its feet at (0, 0) and 16 wide. */
const MEEPLE =
  'M0 0 L-2.2 0 Q-3.3 0 -3 -1.1 L-1.6 -6.4 Q-1.4 -7.1 -2.2 -7.4 L-6.2 -8.6 Q-7.6 -9.1 -7.2 -10.5 Q-6.8 -11.8 -5.3 -11.6 L-2.8 -11.2 Q-3.7 -12.6 -3.7 -14.3 Q-3.7 -17.9 0 -17.9 Q3.7 -17.9 3.7 -14.3 Q3.7 -12.6 2.8 -11.2 L5.3 -11.6 Q6.8 -11.8 7.2 -10.5 Q7.6 -9.1 6.2 -8.6 L2.2 -7.4 Q1.4 -7.1 1.6 -6.4 L3 -1.1 Q3.3 0 2.2 0 Z';

/**
 * Meeples for the people online: up to five, those playing in the players'
 * colours on a hex of the island, the rest standing by in grey.
 */
export function Meeples({ online, playing }: { online: number; playing: number }) {
  const shown = Math.min(5, Math.max(0, online));
  const players = Math.min(shown, Math.max(0, playing));
  const colors: PlayerColor[] = ['coral', 'sky', 'amber', 'jade', 'violet'];
  const spacing = 13,
    scale = 1.7,
    width = 88;
  const start = width / 2 - ((shown - 1) * spacing) / 2;
  // The hex the players stand on, stretched to hold them all.
  const left = start - 11,
    right = start + (players - 1) * spacing + 11;
  return (
    <Art name="people" width={width}>
      <Ground cx={width / 2} cy={57} rx={shown ? 12 + shown * 7 : 14} />
      {players > 0 && (
        <g>
          <path
            className="art-hex-side"
            d={`M${left} 51 L${left + 6} 56.5 H${right - 6} L${right} 51 V53.5 L${right - 6} 59 H${left + 6} L${left} 53.5 Z`}
          />
          <path
            className="art-hex-top"
            d={`M${left} 51 L${left + 6} 45.5 H${right - 6} L${right} 51 L${right - 6} 56.5 H${left + 6} Z`}
          />
        </g>
      )}
      {shown === 0 && (
        <path
          className="art-meeple-empty"
          d={MEEPLE}
          transform={`translate(${width / 2} 53) scale(${scale})`}
        />
      )}
      {Array.from({ length: shown }, (_, i) => {
        const x = start + i * spacing;
        const playingNow = i < players;
        return (
          <g key={i} className={playingNow ? 'art-meeple-playing' : undefined}>
            <g transform={`translate(${x.toFixed(1)} ${playingNow ? 52 : 54}) scale(${scale})`}>
              <path className="art-meeple-shade" d={MEEPLE} transform="translate(0.6 0.5)" />
              <path
                className={`art-meeple${playingNow ? '' : ' art-meeple-idle'}`}
                d={MEEPLE}
                fill={playingNow ? PLAYER_COLORS[colors[i % colors.length]!] : undefined}
              />
              <path className="art-meeple-light" d="M-2.3 -15.4 Q-1.7 -16.8 0 -16.9" />
            </g>
          </g>
        );
      })}
    </Art>
  );
}
