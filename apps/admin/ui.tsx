/** Shared pieces of the admin console. Every style lives in admin.css; nothing here sets one inline. */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
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

/** The width a chart may use, measured from its frame. */
function useWidth(fallback: number) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [frame, width || fallback] as const;
}

export type LineSeries = { name: string; slot: 1 | 2 | 3 | 4; values: (number | null)[] };

/** Short axis numbers: 950, 1.2k, 3.4M. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${Math.round(value / 1e5) / 10}M`;
  if (abs >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (abs >= 1e3) return `${Math.round(value / 100) / 10}k`;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** The index in ascending `xs` nearest to `x`. */
function nearest(xs: number[], x: number): number {
  let low = 0,
    high = xs.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (xs[middle]! < x) low = middle;
    else high = middle;
  }
  return Math.abs(xs[high]! - x) < Math.abs(xs[low]! - x) ? high : low;
}

/**
 * Lines over a numeric x, such as time or turns: thin lines with a dot at
 * each end, a recessive grid, labelled axes, and a crosshair whose tooltip
 * lists every series at the nearest point, following the pointer or the arrow
 * keys. Two or more series get a legend, and end labels where they do not
 * collide; one series gets neither, as the title names it. Every value is also
 * in a table underneath. Lines break where points are further apart than
 * `gapAfter`, or where a value is missing. Nothing is styled inline: positions
 * are SVG attributes and colours come from classes.
 */
export function LineChart({
  label,
  x,
  series,
  domain,
  ticks,
  tickLabel,
  pointLabel,
  format,
  xTitle,
  axisTitle,
  yTitle,
  height = 150,
  gapAfter,
  area = false,
  markers = [],
  yMin = 1,
  integer = false,
  table = true,
}: {
  /** What the chart shows: its accessible name and the table's caption. */
  label: string;
  x: number[];
  series: LineSeries[];
  domain?: [number, number];
  ticks: number[];
  tickLabel: (x: number) => string;
  pointLabel: (x: number) => string;
  format: (value: number) => string;
  /** The x column's name in the table. */
  xTitle: string;
  /** The x axis's title under its end, where the ticks do not say it already. */
  axisTitle?: string;
  /** The value axis's unit, above it. */
  yTitle: string;
  height?: number;
  gapAfter?: number;
  /** A soft wash under a single series. */
  area?: boolean;
  markers?: { x: number; label: string }[];
  /** The smallest top the value axis may have, so a flat line of zeros is not drawn at the top. */
  yMin?: number;
  /** Counts: every tick a whole number. */
  integer?: boolean;
  table?: boolean;
}) {
  const [frame, width] = useWidth(480);
  const [active, setActive] = useState<number | null>(null);
  const legend = series.length > 1;
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const nice = niceMax(Math.max(yMin, ...values));
  const max = integer && nice % 2 ? nice + 1 : nice;
  const [x0, x1] = domain ?? [x[0] ?? 0, x.at(-1) ?? 1];
  const top = 22,
    bottom = axisTitle ? 32 : 22,
    left = 40;
  // Each series ends in a dot; with two to four series, and room, it is labelled there too.
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && (s.values[i] === null || x[i] === undefined)) i--;
      return { s, i };
    })
    .filter(({ i }) => i >= 0);
  const labelled = legend && series.length <= 4 && width >= 360;
  const right = labelled ? Math.min(96, 16 + Math.max(...series.map((s) => s.name.length)) * 6.6) : 12;
  const plot = { width: Math.max(40, width - left - right), height: height - top - bottom };
  const sx = (value: number) => left + (x1 === x0 ? 0 : ((value - x0) / (x1 - x0)) * plot.width);
  const sy = (value: number) => top + plot.height - (value / max) * plot.height;
  const paths = series.map((s) => {
    let d = '';
    let open = false;
    s.values.forEach((value, i) => {
      if (value === null || x[i] === undefined) {
        open = false;
        return;
      }
      const broken = open && gapAfter !== undefined && x[i]! - x[i - 1]! > gapAfter;
      d += `${open && !broken ? 'L' : 'M'}${sx(x[i]!).toFixed(1)},${sy(value).toFixed(1)}`;
      open = true;
    });
    return d;
  });
  const wash =
    area && series.length === 1 && paths[0]
      ? paths[0]
          .split('M')
          .filter(Boolean)
          .map((run) => {
            const points = run.split('L');
            const first = points[0]!.split(',')[0];
            const last = points.at(-1)!.split(',')[0];
            const base = (top + plot.height).toFixed(1);
            return `M${first},${base}L${run}L${last},${base}Z`;
          })
          .join('')
      : '';
  // End labels only where they stay apart; the legend and tooltip carry the rest.
  const placed = ends
    .map(({ s, i }) => ({ s, y: sy(s.values[i]!), xEnd: sx(x[i]!) }))
    .sort((a, b) => a.y - b.y);
  const showLabels = labelled && !placed.some((label, i) => i > 0 && label.y - placed[i - 1]!.y < 12);
  const move = (index: number | null) =>
    setActive(index === null || !x.length ? null : Math.max(0, Math.min(x.length - 1, index)));
  const pointer = (event: PointerEvent<SVGRectElement>) => {
    if (!x.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = x0 + ((event.clientX - box.left) / Math.max(1, box.width)) * (x1 - x0);
    move(nearest(x, at));
  };
  const keys = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step !== undefined) move((active ?? x.length) + step);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(x.length - 1);
    else if (event.key === 'Escape') move(null);
    else return;
    event.preventDefault();
  };
  const tip =
    active !== null && x[active] !== undefined
      ? {
          x: sx(x[active]!),
          title: pointLabel(x[active]!),
          rows: series.map((s) => ({ s, value: s.values[active] ?? null })),
        }
      : null;
  const tipWidth = tip
    ? 24 +
      Math.max(
        tip.title.length * 6.2,
        ...tip.rows.map(
          (row) => (row.value === null ? 1 : format(row.value).length + 1 + row.s.name.length) * 6.2 + 14,
        ),
      )
    : 0;
  const tipHeight = tip ? 26 + tip.rows.length * 16 : 0;
  const tipX = tip
    ? tip.x + 12 + tipWidth > left + plot.width + right
      ? tip.x - 12 - tipWidth
      : tip.x + 12
    : 0;
  return (
    <figure className="chart line-chart">
      <div className="chart-frame" ref={frame}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={keys}
          onFocus={() => active === null && move(x.length - 1)}
          onBlur={() => move(null)}
        >
          <text className="chart-axis-title" x={0} y={10}>
            {yTitle}
          </text>
          {[0, max / 2, max].map((tick) => (
            <g key={tick} className="chart-grid">
              <line x1={left} x2={left + plot.width} y1={sy(tick)} y2={sy(tick)} />
              <text x={left - 6} y={sy(tick) + 3} textAnchor="end">
                {compact(tick)}
              </text>
            </g>
          ))}
          {ticks.map((tick) => (
            <text
              key={tick}
              className="chart-axis"
              x={sx(tick)}
              y={top + plot.height + 14}
              textAnchor={
                sx(tick) < left + 20 ? 'start' : sx(tick) > left + plot.width - 20 ? 'end' : 'middle'
              }
            >
              {tickLabel(tick)}
            </text>
          ))}
          {axisTitle && (
            <text className="chart-axis-title" x={left + plot.width} y={height - 2} textAnchor="end">
              {axisTitle}
            </text>
          )}
          <line
            className="chart-baseline"
            x1={left}
            x2={left + plot.width}
            y1={top + plot.height}
            y2={top + plot.height}
          />
          {markers
            .filter((marker) => marker.x >= x0 && marker.x <= x1)
            .map((marker) => (
              <g key={`${marker.x}-${marker.label}`} className="chart-marker">
                <line x1={sx(marker.x)} x2={sx(marker.x)} y1={top} y2={top + plot.height} />
                <text x={sx(marker.x) + 4} y={top + 9}>
                  {marker.label}
                </text>
              </g>
            ))}
          {wash && <path className={`chart-area area-${series[0]!.slot}`} d={wash} />}
          {series.map((s, i) => (
            <path key={s.name} className={`chart-line line-${s.slot}`} d={paths[i]} />
          ))}
          {ends.map(({ s, i }) => (
            <circle
              key={s.name}
              className={`chart-dot dot-${s.slot}`}
              cx={sx(x[i]!)}
              cy={sy(s.values[i]!)}
              r={4}
            />
          ))}
          {showLabels &&
            placed.map((label) => (
              <text key={label.s.name} className="chart-end-label" x={label.xEnd + 8} y={label.y + 4}>
                {label.s.name}
              </text>
            ))}
          {tip && (
            <g className="chart-tip" aria-hidden="true">
              <line className="chart-crosshair" x1={tip.x} x2={tip.x} y1={top} y2={top + plot.height} />
              {tip.rows.map((row) =>
                row.value === null ? null : (
                  <circle
                    key={row.s.name}
                    className={`chart-dot dot-${row.s.slot}`}
                    cx={tip.x}
                    cy={sy(row.value)}
                    r={4}
                  />
                ),
              )}
              <g transform={`translate(${tipX.toFixed(1)},${top})`}>
                <rect className="chart-tip-box" width={tipWidth} height={tipHeight} rx={6} />
                <text className="chart-tip-title" x={10} y={16}>
                  {tip.title}
                </text>
                {tip.rows.map((row, n) => (
                  <g key={row.s.name} transform={`translate(10,${32 + n * 16})`}>
                    <line className={`chart-key line-${row.s.slot}`} x1={0} x2={10} y1={-4} y2={-4} />
                    <text className="chart-tip-value" x={16} y={0}>
                      {row.value === null ? '—' : format(row.value)}
                      <tspan className="chart-tip-name"> {row.s.name}</tspan>
                    </text>
                  </g>
                ))}
              </g>
            </g>
          )}
          <rect
            className="chart-hit"
            x={left}
            y={top}
            width={plot.width}
            height={plot.height}
            onPointerMove={pointer}
            onPointerDown={pointer}
            onPointerLeave={() => move(null)}
          />
        </svg>
      </div>
      {legend && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={`swatch swatch-line line-bg-${s.slot}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}
      {table && x.length > 0 && (
        <details className="chart-table">
          <summary>Show the numbers</summary>
          <div className="chart-table-scroll">
            <table className="compact">
              <caption className="sr-only">{label}</caption>
              <thead>
                <tr>
                  <th>{xTitle}</th>
                  {series.map((s) => (
                    <th key={s.name} className="num">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {x.map((value, i) => (
                  <tr key={value}>
                    <td className="nowrap">{pointLabel(value)}</td>
                    {series.map((s) => (
                      <td key={s.name} className="num">
                        {s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i]!)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
