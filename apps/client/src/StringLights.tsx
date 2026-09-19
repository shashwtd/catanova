/**
 * Five bulbs on a wire, strung above the table.
 *
 * The table was a tiled wood photograph under a flat grey wash: evenly lit
 * everywhere, which is the one thing a real table never is, and the island sat
 * on it like a sticker. What was missing was a light source. This is it, and
 * the warm pool and vignette it justifies are what actually make the wood read
 * as a surface rather than a texture.
 *
 * Five, not twenty. A garland of small bulbs reads as bunting and competes
 * with the board; a few good ones read as a room. Each one is drawn rather
 * than sprited — glass, filament, cap and halo — so it stays crisp at any size
 * and costs no download.
 *
 * It is the wire that gets stretched, not the bulbs: the SVG holds only the
 * cord, so scaling it across any width leaves the glass round. Nothing here
 * takes pointer events, and the only movement is a slow breath on two bulbs,
 * which stops entirely under reduced motion.
 */

/** Where each bulb hangs, as a fraction of the width, and the sag of the wire
 *  at that point in the cord's own coordinates. */
const SAG_TOP = 10,
  SAG_DEPTH = 48;
const BULBS = [0.14, 0.32, 0.5, 0.68, 0.86].map((t, index) => ({
  t,
  /** The same parabola the cord is drawn from, so a bulb never floats off it. */
  y: SAG_TOP + SAG_DEPTH * (1 - (2 * t - 1) ** 2),
  /** Only the outer two breathe, and out of step, so the row never pulses
   *  together the way a string of fairy lights on a timer does. */
  breathing: index === 0 || index === 4,
  delay: index === 0 ? 0 : 3.4,
}));

export function StringLights() {
  return (
    <div className="string-lights" aria-hidden="true">
      <svg className="string-cord" viewBox="0 0 1200 110" preserveAspectRatio="none" focusable="false">
        <path
          d={`M0 ${SAG_TOP} Q600 ${SAG_TOP + SAG_DEPTH * 2} 1200 ${SAG_TOP}`}
          fill="none"
          stroke="#2a211b"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {BULBS.map((bulb) => (
        <span
          key={bulb.t}
          className="string-bulb"
          data-breathing={bulb.breathing}
          style={{ left: `${bulb.t * 100}%`, top: `${bulb.y}px`, animationDelay: `${bulb.delay}s` }}
        >
          <svg viewBox="0 0 28 46" focusable="false">
            {/* The cap: a short brass collar the glass hangs from. */}
            <path d="M14 0v7" stroke="#2a211b" strokeWidth="2.5" />
            <rect x="9.5" y="6" width="9" height="6.5" rx="1.6" fill="#9c8055" />
            <rect x="9.5" y="6" width="9" height="2.2" rx="1" fill="#c8a870" />
            {/* The glass, warm through and brightest just off centre. */}
            <path
              className="bulb-glass"
              d="M9.5 12.5h9c2.9 2.4 4.6 5.9 4.6 9.9 0 5.5-4.1 9.9-9.1 9.9s-9.1-4.4-9.1-9.9c0-4 1.7-7.5 4.6-9.9Z"
            />
            <ellipse cx="10.6" cy="19.4" rx="2.5" ry="3.4" fill="#fff4d2" opacity="0.5" />
            {/* The filament, which is the only part that is actually bright. */}
            <path
              className="bulb-filament"
              d="M11.6 19.5c0 2.6 1 3.4 1.2 5.1.2-1.7 1.2-2.5 1.2-5.1"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      ))}
    </div>
  );
}
