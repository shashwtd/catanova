/**
 * A string of small lanterns along the very top of the table.
 *
 * It exists to give the warm pool below it a source: the wood was evenly lit
 * everywhere, which is the one thing a real table never is. So it stays out of
 * the way — a shallow ripple in the top few pixels, well above the island —
 * and it is one warm colour, because a row of six different ones was reading
 * as bunting rather than as a light.
 *
 * The cord is the only thing that gets stretched; the lanterns are placed by
 * the same function that draws it, so one can never drift off the wire.
 */

const CORD_TOP = 3,
  CORD_DEPTH = 14,
  CORD_WAVES = 3,
  CORD_WIDTH = 1200;
export const CORD_HEIGHT = 20;

/** Where the cord is at a given fraction of the way across. */
export const cordY = (t: number) =>
  CORD_TOP + CORD_DEPTH * 0.5 * (1 - Math.cos(2 * Math.PI * CORD_WAVES * t));

function cordPath(samples = 96) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    return `${i ? 'L' : 'M'}${(t * CORD_WIDTH) | 0 || 0} ${cordY(t).toFixed(2)}`;
  }).join(' ');
}

const LANTERNS = Array.from({ length: 11 }, (_, index) => {
  const t = (index + 0.5) / 11;
  /** Two of them breathe, out of step, so the string never pulses together. */
  return { t, y: cordY(t), breathing: index === 1 || index === 8, delay: index === 1 ? 0 : 3.7 };
});

export function StringLights() {
  return (
    <div className="string-lights" aria-hidden="true">
      <svg
        className="string-cord"
        viewBox={`0 0 ${CORD_WIDTH} ${CORD_HEIGHT}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          d={cordPath()}
          fill="none"
          stroke="#2a211b"
          strokeWidth="1.6"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {LANTERNS.map((lantern) => (
        <span
          key={lantern.t}
          className="string-lantern"
          data-breathing={lantern.breathing}
          style={{
            left: `${lantern.t * 100}%`,
            top: `${lantern.y}px`,
            animationDelay: `${lantern.delay}s`,
          }}
        >
          <svg viewBox="0 0 30 40" focusable="false">
            <path d="M15 0v6" stroke="#2a211b" strokeWidth="1.8" />
            <rect x="11.3" y="4.6" width="7.4" height="4.6" rx="1.5" fill="#9c8055" />
            <path
              className="lantern-glass"
              d="M15 9.2c8.6 0 13 4.6 13 11s-5.8 11.2-13 11.2S2 26.6 2 20.2s4.4-11 13-11Z"
            />
            <g className="lantern-ribs" fill="none" strokeLinecap="round">
              <path d="M15 9.4c-6.8 4-6.8 17.8 0 21.8" />
              <path d="M15 9.4c-3.6 4-3.6 17.8 0 21.8" />
              <path d="M15 9.4c3.6 4 3.6 17.8 0 21.8" />
              <path d="M15 9.4c6.8 4 6.8 17.8 0 21.8" />
            </g>
            <ellipse cx="10.4" cy="15.8" rx="3.3" ry="4.4" fill="#fff" opacity="0.38" />
          </svg>
        </span>
      ))}
    </div>
  );
}
