import type { CSSProperties } from 'react';

/** A small island that briefly lights its tiles while a real request is pending. */
export function GameLoader({
  label = 'Connecting…',
  compact = false,
  className = '',
}: {
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={`game-loader ${className}`} role="status" aria-label={label} aria-atomic="true">
      <span className="t-matrix game-loader-island" data-variant="scan" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <i
            key={index}
            className={[0, 3, 12, 15].includes(index) ? 'is-gap' : undefined}
            style={{ '--column': index % 4 } as CSSProperties}
          />
        ))}
      </span>
      {!compact && <span aria-hidden="true">{label}</span>}
    </span>
  );
}
