import { useId } from 'react';
import { MATERIAL_GUTTER, MATERIAL_QUADRANTS } from './scene.js';

/** The same cached tabletop as play, without a camera or any animation work. */
export function LoungeBackdrop() {
  const patternId = useId();
  return (
    <div className="lounge-tabletop" aria-hidden="true">
      <svg width="100%" height="100%">
        <defs>
          <pattern id={patternId} width="720" height="720" patternUnits="userSpaceOnUse">
            {MATERIAL_QUADRANTS.map(({ x, y, sx, sy }, index) => (
              <g key={index} transform={`translate(${x * 360} ${y * 360}) scale(${sx} ${sy})`}>
                <svg
                  width="360"
                  height="360"
                  viewBox={`${512 + MATERIAL_GUTTER} ${512 + MATERIAL_GUTTER} ${512 - MATERIAL_GUTTER * 2} ${512 - MATERIAL_GUTTER * 2}`}
                >
                  <image
                    href="/art/optimized/environment-dark.c55c6de597e4.webp"
                    width="1024"
                    height="1024"
                  />
                </svg>
              </g>
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
