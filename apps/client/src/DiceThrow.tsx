import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export const DICE_ROLL_MS = 1120;
export const DICE_PRESENTATION_MS = 1760;
export const DICE_REDUCED_MS = 360;
export const DICE_IMPACT_MS = [260, 580, 830, 1030] as const;
type DiceStyle = CSSProperties & Record<`--${string}`, string | number>;

export const DIE_FACES = [
  { value: 1, x: 0, y: 0, normal: [0, 0, 1] },
  { value: 6, x: 0, y: 180, normal: [0, 0, -1] },
  { value: 2, x: 90, y: 0, normal: [0, -1, 0] },
  { value: 5, x: -90, y: 0, normal: [0, 1, 0] },
  { value: 3, x: 0, y: 90, normal: [1, 0, 0] },
  { value: 4, x: 0, y: -90, normal: [-1, 0, 0] },
] as const;

/** The received server value determines the final orientation, never the animation. */
export function diceLanding(value: number) {
  const face = DIE_FACES.find((face) => face.value === value);
  if (!face) throw new RangeError('Dice values must be integers from 1 to 6');
  return { x: -face.x || 0, y: -face.y || 0 };
}

/** Seeded visual variation is reproducible for an event and independent of its dice values. */
export function diceTrajectory(id: string, index: number) {
  let seed = (2166136261 ^ index) >>> 0;
  for (let n = 0; n < id.length; n++) seed = Math.imul(seed ^ id.charCodeAt(n), 16777619) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const direction = index === 0 ? -1 : 1;
  return {
    startX: direction * (75 + random() * 70),
    startY: -100 - random() * 40,
    angle: direction * (7 + random() * 13),
    spinX: (2 + Math.floor(random() * 2)) * 360,
    spinY: direction * (2 + Math.floor(random() * 2)) * 360,
  };
}

const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ id, value, index }: { id: string; value: number; index: number }) {
  const trajectory = useMemo(() => diceTrajectory(id, index), [id, index]);
  const landing = diceLanding(value);
  const style: DiceStyle = {
    '--throw-x': `${trajectory.startX}px`,
    '--throw-y': `${trajectory.startY}px`,
    '--rest-z': `${trajectory.angle}deg`,
    '--land-x': `${landing.x}deg`,
    '--land-y': `${landing.y}deg`,
    '--spin-x': `${trajectory.spinX}deg`,
    '--spin-y': `${trajectory.spinY}deg`,
  };
  return (
    <span className={`dice-flight dice-flight-${index}`} style={style} data-result={value}>
      <span className="dice-floor-shadow" />
      <span className="dice-flight-path">
        <span className="dice-view-angle">
          <span className="dice-cube">
            {DIE_FACES.map((face) => (
              <span
                key={face.value}
                className="dice-cube-face"
                data-face={face.value}
                style={{
                  transform: `rotateX(${face.x}deg) rotateY(${face.y}deg) translateZ(calc(var(--die-size) / 2))`,
                }}
              >
                {PIPS[face.value]!.map((pip) => (
                  <i
                    key={pip}
                    className="dice-pip"
                    style={{ gridColumn: (pip % 3) + 1, gridRow: Math.floor(pip / 3) + 1 }}
                  />
                ))}
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

/** Mount for an accepted roll ID only; changes in callback identity cannot replay it. */
export function DiceThrow({
  id,
  dice,
  onComplete,
  reducedMotion,
}: {
  id: string;
  dice: readonly [number, number];
  onComplete?: () => void;
  reducedMotion?: boolean;
}) {
  const [systemReduced, setSystemReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const quiet = reducedMotion ?? systemReduced;
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    const timer = window.setTimeout(
      () => complete.current?.(),
      quiet ? DICE_REDUCED_MS : DICE_PRESENTATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, quiet]);
  return (
    <div
      key={id}
      className={`dice-throw ${quiet ? 'dice-throw-reduced' : ''}`}
      style={
        { '--dice-roll-ms': `${DICE_ROLL_MS}ms`, '--dice-total-ms': `${DICE_PRESENTATION_MS}ms` } as DiceStyle
      }
      aria-hidden="true"
      data-roll-id={id}
    >
      <div className="dice-throw-tray">
        <Die id={id} value={dice[0]} index={0} />
        <Die id={id} value={dice[1]} index={1} />
      </div>
      <span className="dice-throw-result">
        {dice[0]} + {dice[1]} <b>{dice[0] + dice[1]}</b>
      </span>
    </div>
  );
}
