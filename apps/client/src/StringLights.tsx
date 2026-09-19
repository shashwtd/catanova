/**
 * A string of little frosted lanterns, strung along the top of the table.
 *
 * The table was a tiled wood photograph under a flat grey wash: evenly lit
 * everywhere, which is the one thing a real table never is, and the island sat
 * on it like a sticker. What was missing was a light source. This is it, and
 * the warm pool it justifies is what actually makes the wood read as a
 * surface rather than a texture.
 *
 * Each lamp is a squat ribbed lantern rather than a bulb: frosted plastic, a
 * brass collar, petals running top to bottom, and its own colour — the string
 * cycles through six so no two neighbours match. All of it is drawn rather
 * than sprited, so it stays crisp at any size and costs no download.
 *
 * The cord waves rather than sagging once, and it stays near the top, where
 * there is room for it above the island. It is the cord that gets stretched,
 * not the lanterns: the SVG holds only the wire, so scaling it across any
 * width leaves the glass round. The wire and the lanterns are placed by the
 * same function, so a lantern can never drift off it.
 *
 * Nothing here takes pointer events, and the only movement is a slow breath on
 * two of them, which stops entirely under reduced motion.
 */

/** The cord's shape, in its own coordinates: three dips, high on the wall. */
const CORD_TOP = 6,
  CORD_DEPTH = 30,
  CORD_WAVES = 3,
  CORD_WIDTH = 1200;
export const CORD_HEIGHT = 40;

/** Where the cord is at a given fraction of the way across. */
export const cordY = (t: number) =>
  CORD_TOP + CORD_DEPTH * 0.5 * (1 - Math.cos(2 * Math.PI * CORD_WAVES * t));

/** Sampled rather than expressed as bezier handles, so the lanterns and the
 *  wire are placed by one function and cannot disagree about where it is. */
function cordPath(samples = 96) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    return `${i ? 'L' : 'M'}${(t * CORD_WIDTH) | 0 || 0} ${cordY(t).toFixed(2)}`;
  }).join(' ');
}

/** Frosted plastic in six colours, the way a real string of them comes. */
const SHADES = ['#95e3b8', '#85dcd8', '#b6a9ee', '#f0a3c2', '#f4ab80', '#f7dfa4'] as const;

const LANTERNS = Array.from({ length: 11 }, (_, index) => {
  const t = (index + 0.5) / 11;
  return {
    t,
    y: cordY(t),
    shade: SHADES[index % SHADES.length]!,
    /** Two of them breathe, out of step, so the string never pulses together
     *  the way a set of fairy lights on a timer does. */
    breathing: index === 1 || index === 8,
    delay: index === 1 ? 0 : 3.7,
  };
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
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {LANTERNS.map((lantern) => (
        <span
          key={lantern.t}
          className="string-lantern"
          data-breathing={lantern.breathing}
          style={
            {
              left: `${lantern.t * 100}%`,
              top: `${lantern.y}px`,
              animationDelay: `${lantern.delay}s`,
              '--bulb': lantern.shade,
            } as React.CSSProperties
          }
        >
          <svg viewBox="0 0 30 40" focusable="false">
            {/* The drop from the cord, and the brass collar it hangs on. */}
            <path d="M15 0v6" stroke="#2a211b" strokeWidth="1.8" />
            <rect x="11.3" y="4.6" width="7.4" height="4.6" rx="1.5" fill="#9c8055" />
            <rect x="11.3" y="4.6" width="7.4" height="1.7" rx="0.8" fill="#c8a870" />
            {/* The lantern itself: squat, and wider than it is tall. */}
            <path
              className="lantern-glass"
              d="M15 9.2c8.6 0 13 4.6 13 11s-5.8 11.2-13 11.2S2 26.6 2 20.2s4.4-11 13-11Z"
            />
            <ellipse cx="15" cy="27.4" rx="11" ry="4" fill="#000" opacity="0.07" />
            {/* Petals, which is what makes it read as moulded plastic rather
                than as a ball of colour. */}
            <g className="lantern-ribs" fill="none" strokeLinecap="round">
              <path d="M15 9.4c-6.8 4-6.8 17.8 0 21.8" />
              <path d="M15 9.4c-3.6 4-3.6 17.8 0 21.8" />
              <path d="M15 9.4c3.6 4 3.6 17.8 0 21.8" />
              <path d="M15 9.4c6.8 4 6.8 17.8 0 21.8" />
            </g>
            <ellipse cx="10.4" cy="15.8" rx="3.3" ry="4.4" fill="#fff" opacity="0.4" />
            <ellipse className="lantern-glass" cx="15" cy="32.6" rx="2.4" ry="1.7" />
          </svg>
        </span>
      ))}
    </div>
  );
}
