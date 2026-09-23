/** Shared pieces of the admin console. Every style lives in admin.css; nothing here sets one inline. */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiError } from './api.js';
import { relative, time } from './format.js';
import { PLAYER_COLORS, PLAYER_COLOR_LABEL } from '../../packages/protocol/src/colors.js';
import type { PlayerColor } from '../../packages/protocol/src/colors.js';

export function Section({
  title,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint !== undefined && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warning' | 'serious' | 'critical';

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Failure({ error, retry }: { error: ApiError | undefined; retry?: () => void }) {
  if (!error) return null;
  return (
    <Notice tone="critical">
      <span>{error.message}</span>
      {retry && error.code !== 'SESSION' && (
        <button type="button" className="link-button" onClick={retry}>
          Retry
        </button>
      )}
    </Notice>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted loading" role="status">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A time with its absolute value one hover away. */
export function When({ at, now }: { at: number | null | undefined; now?: number }) {
  if (at === null || at === undefined) return <span className="muted">—</span>;
  return (
    <time dateTime={new Date(at).toISOString()} title={time(at)}>
      {relative(at, now)}
    </time>
  );
}

/**
 * A seat's colour as the table sees it: the game's own swatch and name, drawn
 * as an SVG fill so no style attribute is needed. `chosen` is false for a seat
 * that was given its colour automatically.
 */
export function PlayerColour({ color, chosen }: { color: PlayerColor | null; chosen: boolean }) {
  if (!color) return <span className="muted">—</span>;
  return (
    <span className="player-colour">
      <svg className="player-colour-dot" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="5" fill={PLAYER_COLORS[color]} />
      </svg>
      {PLAYER_COLOR_LABEL[color]}
      {!chosen && <span className="muted">default</span>}
    </span>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="table-wrap">
      <table className={className}>{children}</table>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type Series = { name: string; slot: 1 | 2 | 3; values: number[] };

const niceMax = (value: number) => {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
};

/** A bar with a 4px rounded data-end and a square base. */
function bar(x: number, y: number, width: number, height: number, round: boolean) {
  const r = round ? Math.min(4, width / 2, height) : 0;
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

/**
 * Columns over categories: one series, or stacked series with a 2px surface
 * gap between segments. An optional reference (the fair-dice expectation) is
 * drawn as a thin tick across each column. Each column has a native tooltip,
 * and the numbers are always in a table beside the chart.
 */
export function Columns({
  categories,
  series,
  reference,
  label,
  every = 1,
}: {
  categories: string[];
  series: Series[];
  reference?: { name: string; values: number[] };
  label: string;
  /** Label every nth category on the axis. */
  every?: number;
}) {
  // Columns share the width available, between a readable minimum and a thin maximum.
  const frame = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 150,
    top = 12,
    left = 34,
    bottom = 22;
  const band = Math.max(
    18,
    Math.min(56, available ? Math.floor((available - left - 4) / categories.length) : 22),
  );
  const width = Math.min(24, band - 6);
  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals, ...(reference?.values ?? [])));
  const plot = height - top - bottom;
  const scale = (value: number) => (value / max) * plot;
  const chartWidth = left + categories.length * band + 4;
  return (
    <figure className="chart">
      <div className="chart-scroll" ref={frame}>
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          width={chartWidth}
          height={height}
          role="img"
          aria-label={label}
        >
          {[0, max / 2, max].map((tick) => (
            <g key={tick} className="chart-grid">
              <line x1={left} x2={chartWidth} y1={top + plot - scale(tick)} y2={top + plot - scale(tick)} />
              <text x={left - 6} y={top + plot - scale(tick) + 3} textAnchor="end">
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </text>
            </g>
          ))}
          {categories.map((category, i) => {
            const x = left + i * band + (band - width) / 2;
            let base = top + plot;
            const segments = series
              .map((s, index) => ({ s, index, value: s.values[i] ?? 0 }))
              .filter((segment) => segment.value > 0);
            const tip = [
              category,
              ...series.map((s) => `${s.name}: ${s.values[i] ?? 0}`),
              ...(reference ? [`${reference.name}: ${reference.values[i]}`] : []),
            ].join('\n');
            return (
              <g key={category} className="chart-column">
                <title>{tip}</title>
                {/* The whole band is the hover target, not just the bar. */}
                <rect className="chart-hit" x={left + i * band} y={top} width={band} height={plot} />
                {segments.map((segment, n) => {
                  const h = Math.max(0, scale(segment.value) - (n > 0 ? 2 : 0));
                  const y = base - (n > 0 ? 2 : 0) - h;
                  const path = bar(x, y, width, h, n === segments.length - 1);
                  base = y;
                  return <path key={segment.s.name} className={`series-${segment.s.slot}`} d={path} />;
                })}
                {reference && (
                  <line
                    className="chart-reference"
                    x1={x - 2}
                    x2={x + width + 2}
                    y1={top + plot - scale(reference.values[i] ?? 0)}
                    y2={top + plot - scale(reference.values[i] ?? 0)}
                  />
                )}
                {i % every === 0 && (
                  <text className="chart-axis" x={x + width / 2} y={height - 6} textAnchor="middle">
                    {category}
                  </text>
                )}
              </g>
            );
          })}
          <line className="chart-baseline" x1={left} x2={chartWidth} y1={top + plot} y2={top + plot} />
        </svg>
      </div>
      {(series.length > 1 || reference) && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={`swatch series-${s.slot}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
          {reference && (
            <span>
              <i className="swatch swatch-reference" aria-hidden="true" />
              {reference.name}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
