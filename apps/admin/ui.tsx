/** Shared pieces of the admin console. Every style lives in admin.css; nothing here sets one inline. */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import type { ApiError } from './api.js';
import { count, relative, time } from './format.js';
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

/* ---------------------------------------------------------------------------
 * Charts. Thin marks on a recessive grid, one tooltip per chart that reads
 * every series at the point under the pointer, the arrow keys or a tap, and the
 * numbers in a table underneath. Positions are SVG attributes; colours come
 * from classes.
 * ------------------------------------------------------------------------- */

/** A chart colour: one of the four series slots, or ink for a trend or reference drawn over them. */
export type Slot = 1 | 2 | 3 | 4;
export type Paint = Slot | 'ink';

export const niceMax = (value: number) => {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
};

/** A top for a count axis whose middle tick is a whole number too. */
const countMax = (value: number) => {
  const nice = niceMax(value);
  return nice % 2 ? nice + 1 : nice;
};

/** A bar with a 4px rounded data-end and a square base. */
function bar(x: number, y: number, width: number, height: number, round: boolean) {
  const r = round ? Math.min(4, width / 2, height) : 0;
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

/** Short axis numbers: 950, 1.2k, 3.4M. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${Math.round(value / 1e5) / 10}M`;
  if (abs >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (abs >= 1e3) return `${Math.round(value / 100) / 10}k`;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** One line of a tooltip: the value first, then what it is, keyed by the mark it reads. */
export type TipRow = {
  mark: 'bar' | 'line' | 'tick' | 'band' | 'none';
  paint: Paint;
  value: string;
  name: string;
};
/** What a tooltip says about one point: its full name, then each series there. */
export type Tip = { title: string; rows: TipRow[] };

/** A tooltip as one sentence, for screen readers following the arrow keys. */
export const tipText = (tip: Tip) =>
  `${tip.title}: ${tip.rows.map((row) => `${row.name} ${row.value}`.trim()).join(', ')}`;

const TIP_CHAR = 6.3;

/** How big a tooltip is drawn: wide enough for its longest line. */
export function tipSize(tip: Tip) {
  const width =
    22 +
    Math.max(
      tip.title.length * 6,
      ...tip.rows.map(
        (row) => (row.value.length + 1 + row.name.length) * TIP_CHAR + (row.mark === 'none' ? 0 : 16),
      ),
    );
  return { width: Math.ceil(width), height: 26 + tip.rows.length * 16 };
}

function TipKey({ row }: { row: TipRow }) {
  if (row.mark === 'none') return null;
  if (row.mark === 'bar')
    return <rect className={`series-${row.paint}`} x={0} y={-9} width={10} height={10} rx={2} />;
  if (row.mark === 'band')
    return <rect className={`chart-tip-band area-${row.paint}`} x={0} y={-8} width={10} height={8} rx={2} />;
  if (row.mark === 'tick') return <line className="chart-reference" x1={0} x2={10} y1={-4} y2={-4} />;
  return <line className={`chart-key line-${row.paint}`} x1={0} x2={10} y1={-4} y2={-4} />;
}

/**
 * A tooltip drawn in the chart's own SVG, beside `x` and kept between `min`
 * and `max`: to the right of the point, or to its left near the end.
 */
function TipBox({
  tip,
  x,
  y,
  min,
  max,
  offset = 12,
}: {
  tip: Tip;
  x: number;
  y: number;
  min: number;
  max: number;
  /** How far from `x` the box keeps, on either side. */
  offset?: number;
}) {
  const { width, height } = tipSize(tip);
  let left = x + offset;
  if (left + width > max) left = x - offset - width;
  if (left < min) left = Math.max(min, Math.min(max - width, x - width / 2));
  return (
    <g className="chart-tip" aria-hidden="true" transform={`translate(${left.toFixed(1)},${y})`}>
      <rect className="chart-tip-box" width={width} height={height} rx={6} />
      <text className="chart-tip-title" x={10} y={16}>
        {tip.title}
      </text>
      {tip.rows.map((row, n) => (
        <g key={`${row.name}-${n}`} transform={`translate(10,${33 + n * 16})`}>
          <TipKey row={row} />
          <text className="chart-tip-value" x={row.mark === 'none' ? 0 : 16} y={0}>
            {row.value}
            <tspan className="chart-tip-name"> {row.name}</tspan>
          </text>
        </g>
      ))}
    </g>
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

/** Which point is being read, and how: a hovering pointer, a tap, or the arrow keys. */
type Reading = { index: number; by: 'pointer' | 'touch' | 'keys' } | null;

/**
 * The point a chart is showing in its tooltip. A mouse shows it while
 * hovering; a tap keeps it until the next tap outside the chart; with the
 * chart focused, the arrow keys move it and Escape puts it away.
 */
function useReading(figure: RefObject<HTMLElement | null>) {
  const [reading, setReading] = useState<Reading>(null);
  const tapped = reading?.by === 'touch';
  useEffect(() => {
    if (!tapped) return;
    const away = (event: Event) => {
      if (!figure.current?.contains(event.target as Node)) setReading(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [tapped, figure]);
  return [reading, setReading] as const;
}

const pointerKind = (event: ReactPointerEvent) => (event.pointerType === 'touch' ? 'touch' : 'pointer');

/** Arrow keys, Home, End and Escape over `count` points, in a row or a grid `columns` wide. */
function readingKeys(
  event: KeyboardEvent,
  current: number | null,
  count: number,
  move: (index: number | null) => void,
  columns = count,
) {
  const last = count - 1;
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
  if (columns < count) Object.assign(step, { ArrowUp: -columns, ArrowDown: columns });
  if (event.key in step)
    move(current === null ? last : Math.max(0, Math.min(last, current + step[event.key]!)));
  else if (event.key === 'Home') move(0);
  else if (event.key === 'End') move(last);
  else if (event.key === 'Escape') move(null);
  else return;
  event.preventDefault();
}

/** The numbers behind a chart, one row per point: its table view. */
function ChartTable({
  label,
  head,
  columns,
  rows,
}: {
  label: string;
  head: string;
  columns: string[];
  rows: { key: string; label: string; cells: string[] }[];
}) {
  return (
    <details className="chart-table">
      <summary>Show the numbers</summary>
      <div className="chart-table-scroll">
        <table className="compact">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th>{head}</th>
              {columns.map((column) => (
                <th key={column} className="num">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="nowrap">{row.label}</td>
                {row.cells.map((cell, i) => (
                  <td key={columns[i]} className="num">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export type ColumnSeries = { name: string; slot: Slot; values: number[] };
export type ColumnLine = { name: string; paint: Paint; values: (number | null)[] };

/** The tooltip for one column: every series (stacked from the base up), line and reference there. */
export function columnTip(
  index: number,
  {
    title,
    series,
    lines = [],
    reference,
    format,
    extra = [],
  }: {
    title: string;
    series: ColumnSeries[];
    lines?: ColumnLine[];
    reference?: { name: string; values: number[] };
    format: (value: number) => string;
    extra?: TipRow[];
  },
): Tip {
  const value = (v: number | null | undefined) => (v === null || v === undefined ? '—' : format(v));
  return {
    title,
    rows: [
      ...[...series]
        .reverse()
        .map((s): TipRow => ({ mark: 'bar', paint: s.slot, value: value(s.values[index]), name: s.name })),
      ...lines.map((line): TipRow => ({
        mark: 'line',
        paint: line.paint,
        value: value(line.values[index]),
        name: line.name,
      })),
      ...(reference
        ? [
            {
              mark: 'tick',
              paint: 'ink',
              value: value(reference.values[index]),
              name: reference.name,
            } as TipRow,
          ]
        : []),
      ...extra,
    ],
  };
}

/**
 * Columns over categories: one series, or stacked series with a 2px surface
 * gap between segments, and optionally lines drawn through them (a trend) and
 * a thin tick across each (the fair-dice expectation). Hovering, tapping or
 * arrowing to a column shows a tooltip with its full name (`pointLabel`, such
 * as a whole date) and every value there, so the axis only needs short labels
 * on a few columns (`axis`). The numbers are in a table underneath.
 */
export function Columns({
  label,
  categories,
  series,
  lines = [],
  reference,
  axis,
  pointLabel = (index) => categories[index]!,
  format = count,
  extra,
  max: fixedMax,
  height = 150,
  table,
  below,
  soft = false,
}: {
  /** What the chart shows: its accessible name and the table's caption. */
  label: string;
  categories: string[];
  series: ColumnSeries[];
  lines?: ColumnLine[];
  reference?: { name: string; values: number[] };
  /**
   * Given the width each column has, which columns to label on the axis and
   * how: a function returning a column's label, or null to leave it bare.
   * Without it, every column that fits is labelled with its category.
   */
  axis?: (band: number) => (index: number) => string | null;
  /** A column's full name, for its tooltip and its row in the table. */
  pointLabel?: (index: number) => string;
  format?: (value: number) => string;
  /** More lines for a column's tooltip, such as a total. */
  extra?: (index: number) => TipRow[];
  /** A shared top for the value axis, so side-by-side charts compare. */
  max?: number;
  /** The plot and its axis, without anything drawn `below`. */
  height?: number;
  /** The first column's heading in the table of numbers; no table without it. */
  table?: string;
  /** Something drawn under each column's axis label, such as the dice that make a total. */
  below?: { height: number; draw: (index: number, center: number, band: number) => ReactNode };
  /** The columns recede so that the lines over them lead. */
  soft?: boolean;
}) {
  const [frame, available] = useWidth(0);
  const figure = useRef<HTMLElement>(null);
  const [reading, setReading] = useReading(figure);
  const n = Math.max(1, categories.length);
  const top = 12,
    left = 36,
    axisHeight = 22,
    extraHeight = below?.height ?? 0;
  const plot = height - top - axisHeight;
  // Columns share the width available, between a thin minimum (the frame scrolls below it) and a readable maximum.
  const band = Math.max(4, Math.min(56, available ? (available - left - 6) / n : 22));
  const gap = Math.min(12, Math.max(2, Math.round(band * 0.3)));
  const width = Math.max(2, Math.min(24, Math.floor(band - gap)));
  const chartWidth = Math.ceil(left + n * band + 6);
  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const lineValues = lines.flatMap((line) => line.values.filter((v): v is number => v !== null));
  const max = fixedMax ?? countMax(Math.max(1, ...totals, ...lineValues, ...(reference?.values ?? [])));
  const scale = (value: number) => (value / max) * plot;
  const baseline = top + plot;
  const center = (i: number) => left + i * band + band / 2;
  const labelOf = axis?.(band);
  const every = Math.max(1, Math.ceil((Math.max(0, ...categories.map((c) => c.length)) * 6.2 + 10) / band));
  const labels = categories.map((category, i) => (labelOf ? labelOf(i) : i % every === 0 ? category : null));
  const active = reading && reading.index < categories.length ? reading.index : null;
  const tip =
    active === null
      ? null
      : columnTip(active, {
          title: pointLabel(active),
          series,
          lines,
          reference,
          format,
          extra: extra?.(active),
        });
  const at = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(categories.length - 1, Math.floor(((event.clientX - box.left) / box.width) * n)),
    );
  };
  const move = (index: number | null) => setReading(index === null ? null : { index, by: 'keys' });
  const legend = series.length > 1 || lines.length > 0 || !!reference;
  return (
    <figure className="chart columns-chart" ref={figure}>
      <div className="chart-scroll" ref={frame}>
        <svg
          viewBox={`0 0 ${chartWidth} ${height + extraHeight}`}
          width={chartWidth}
          height={height + extraHeight}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={(event) => readingKeys(event, active, categories.length, move)}
          onFocus={() => active === null && categories.length > 0 && move(categories.length - 1)}
          onBlur={() => setReading(null)}
        >
          {[0, max / 2, max].map((tick) => (
            <g key={tick} className="chart-grid">
              <line x1={left} x2={chartWidth} y1={baseline - scale(tick)} y2={baseline - scale(tick)} />
              <text x={left - 6} y={baseline - scale(tick) + 3} textAnchor="end">
                {compact(tick)}
              </text>
            </g>
          ))}
          {categories.map((category, i) => {
            const x = Math.round(center(i) - width / 2);
            let base = baseline;
            const segments = series
              .map((s) => ({ s, value: s.values[i] ?? 0 }))
              .filter((segment) => segment.value > 0);
            return (
              <g
                key={category}
                className={`chart-column${i === active ? ' is-active' : ''}${soft ? ' soft' : ''}`}
              >
                <rect className="chart-slot" x={left + i * band} y={top} width={band} height={plot} />
                {segments.map((segment, k) => {
                  const h = Math.max(0, scale(segment.value) - (k > 0 ? 2 : 0));
                  const y = base - (k > 0 ? 2 : 0) - h;
                  const path = bar(x, y, width, h, k === segments.length - 1);
                  base = y;
                  return <path key={segment.s.name} className={`series-${segment.s.slot}`} d={path} />;
                })}
                {reference && (
                  <line
                    className="chart-reference"
                    x1={x - 2}
                    x2={x + width + 2}
                    y1={baseline - scale(reference.values[i] ?? 0)}
                    y2={baseline - scale(reference.values[i] ?? 0)}
                  />
                )}
                {labels[i] !== null && (
                  <text
                    className="chart-axis"
                    x={center(i)}
                    y={height - 6}
                    textAnchor={
                      center(i) - labels[i]!.length * 3.1 < left - 30
                        ? 'start'
                        : center(i) + labels[i]!.length * 3.1 > chartWidth
                          ? 'end'
                          : 'middle'
                    }
                  >
                    {labels[i]}
                  </text>
                )}
                {below && <g className="chart-below">{below.draw(i, center(i), band)}</g>}
              </g>
            );
          })}
          <line className="chart-baseline" x1={left} x2={chartWidth} y1={baseline} y2={baseline} />
          {lines.map((line) => {
            let d = '',
              open = false;
            line.values.forEach((value, i) => {
              if (value === null) {
                open = false;
                return;
              }
              d += `${open ? 'L' : 'M'}${center(i).toFixed(1)},${(baseline - scale(value)).toFixed(1)}`;
              open = true;
            });
            return <path key={line.name} className={`chart-line line-${line.paint}`} d={d} />;
          })}
          {active !== null &&
            lines.map((line) =>
              line.values[active] === null || line.values[active] === undefined ? null : (
                <circle
                  key={line.name}
                  className={`chart-dot dot-${line.paint}`}
                  cx={center(active)}
                  cy={baseline - scale(line.values[active]!)}
                  r={4}
                />
              ),
            )}
          {tip && active !== null && <TipBox tip={tip} x={center(active)} y={top} min={0} max={chartWidth} />}
          <rect
            className="chart-hit"
            x={left}
            y={top}
            width={n * band}
            height={plot + axisHeight}
            onPointerMove={(event) => setReading({ index: at(event), by: pointerKind(event) })}
            onPointerDown={(event) => setReading({ index: at(event), by: pointerKind(event) })}
            onPointerLeave={(event) => event.pointerType === 'mouse' && setReading(null)}
          />
        </svg>
      </div>
      <p className="sr-only" aria-live="polite">
        {reading?.by === 'keys' && tip ? tipText(tip) : ''}
      </p>
      {legend && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={`swatch series-${s.slot}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
          {lines.map((line) => (
            <span key={line.name}>
              <i className={`swatch swatch-line line-bg-${line.paint}`} aria-hidden="true" />
              {line.name}
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
      {table && categories.length > 0 && (
        <ChartTable
          label={label}
          head={table}
          columns={[
            ...series.map((s) => s.name),
            ...lines.map((line) => line.name),
            ...(reference ? [reference.name] : []),
          ]}
          rows={categories.map((category, i) => ({
            key: category,
            label: pointLabel(i),
            cells: [
              ...series.map((s) => format(s.values[i] ?? 0)),
              ...lines.map((line) =>
                line.values[i] === null || line.values[i] === undefined ? '—' : format(line.values[i]!),
              ),
              ...(reference ? [format(reference.values[i] ?? 0)] : []),
            ],
          }))}
        />
      )}
    </figure>
  );
}

export type LineSeries = { name: string; slot: Slot; values: (number | null)[] };

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

/** SVG path runs through the points that have values, breaking at gaps and missing values. */
function runs(
  x: number[],
  values: (number | null)[],
  sx: (value: number) => number,
  sy: (value: number) => number,
  gapAfter: number | undefined,
  step: boolean,
): string {
  let d = '';
  let open = false;
  values.forEach((value, i) => {
    if (value === null || x[i] === undefined) {
      open = false;
      return;
    }
    const broken = open && gapAfter !== undefined && x[i]! - x[i - 1]! > gapAfter;
    const px = sx(x[i]!).toFixed(1),
      py = sy(value).toFixed(1);
    // A step holds the last value across, then rises or falls at the new point.
    d += open && !broken ? (step ? `H${px}V${py}` : `L${px},${py}`) : `M${px},${py}`;
    open = true;
  });
  return d;
}

/**
 * Lines over a numeric x, such as time or turns: thin lines with a dot at
 * each end, a recessive grid, labelled axes, and a crosshair whose tooltip
 * lists every series at the nearest point, following the pointer, a tap or
 * the arrow keys. Two or more series get a legend, and end labels where they
 * do not collide; one series gets neither, as the title names it. Every value
 * is also in a table underneath. Lines break where points are further apart
 * than `gapAfter`, or where a value is missing. An optional band shades the
 * range between two bounds, such as the middle half of game lengths. Nothing
 * is styled inline: positions are SVG attributes and colours come from classes.
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
  step = false,
  table = true,
  band,
  max: fixedMax,
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
  /** Values that hold until the next point, such as a score, drawn as steps rather than slopes. */
  step?: boolean;
  table?: boolean;
  /** A shaded range between two bounds at each point, drawn under the lines. */
  band?: { name: string; slot: Slot; lower: (number | null)[]; upper: (number | null)[] };
  /** A fixed top for the value axis, such as 100 for a share. */
  max?: number;
}) {
  const [frame, width] = useWidth(480);
  const figure = useRef<HTMLElement>(null);
  const [reading, setReading] = useReading(figure);
  const active = reading && reading.index < x.length ? reading.index : null;
  const legend = series.length > 1 || !!band;
  const values = [
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
    ...(band?.upper.filter((v): v is number => v !== null) ?? []),
  ];
  const nice = fixedMax ?? niceMax(Math.max(yMin, ...values));
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
  const labelled = series.length > 1 && series.length <= 4 && width >= 360;
  const right = labelled ? Math.min(96, 16 + Math.max(...series.map((s) => s.name.length)) * 6.6) : 12;
  const plot = { width: Math.max(40, width - left - right), height: height - top - bottom };
  const sx = (value: number) => left + (x1 === x0 ? 0 : ((value - x0) / (x1 - x0)) * plot.width);
  const sy = (value: number) => top + plot.height - (value / max) * plot.height;
  const paths = series.map((s) => runs(x, s.values, sx, sy, gapAfter, step));
  const wash =
    area && !step && series.length === 1 && paths[0]
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
  // The band: a closed shape along the upper bound and back along the lower, in each run where both exist.
  let shade = '';
  if (band) {
    let run: number[] = [];
    const close = () => {
      if (run.length > 1) {
        const upper = run.map((i) => `${sx(x[i]!).toFixed(1)},${sy(band.upper[i]!).toFixed(1)}`);
        const lower = [...run]
          .reverse()
          .map((i) => `${sx(x[i]!).toFixed(1)},${sy(band.lower[i]!).toFixed(1)}`);
        shade += `M${upper.join('L')}L${lower.join('L')}Z`;
      }
      run = [];
    };
    x.forEach((_, i) => {
      const inside = band.lower[i] !== null && band.upper[i] !== null && band.lower[i] !== undefined;
      const broken = run.length > 0 && gapAfter !== undefined && x[i]! - x[run.at(-1)!]! > gapAfter;
      if (!inside || broken) close();
      if (inside) run.push(i);
    });
    close();
  }
  // End labels only where they stay apart; the legend and tooltip carry the rest.
  const placed = ends
    .map(({ s, i }) => ({ s, y: sy(s.values[i]!), xEnd: sx(x[i]!) }))
    .sort((a, b) => a.y - b.y);
  const showLabels = labelled && !placed.some((label, i) => i > 0 && label.y - placed[i - 1]!.y < 12);
  const move = (index: number | null) =>
    setReading(
      index === null || !x.length ? null : { index: Math.max(0, Math.min(x.length - 1, index)), by: 'keys' },
    );
  const pointed = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!x.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = x0 + ((event.clientX - box.left) / Math.max(1, box.width)) * (x1 - x0);
    setReading({ index: nearest(x, at), by: pointerKind(event) });
  };
  const tip: Tip | null =
    active !== null && x[active] !== undefined
      ? {
          title: pointLabel(x[active]!),
          rows: [
            ...series.map((s): TipRow => ({
              mark: 'line',
              paint: s.slot,
              value:
                s.values[active] === null || s.values[active] === undefined ? '—' : format(s.values[active]!),
              name: s.name,
            })),
            ...(band &&
            band.lower[active] !== null &&
            band.upper[active] !== null &&
            band.lower[active] !== undefined
              ? [
                  {
                    mark: 'band',
                    paint: band.slot,
                    value: `${format(band.lower[active]!)}–${format(band.upper[active]!)}`,
                    name: band.name,
                  } as TipRow,
                ]
              : []),
          ],
        }
      : null;
  return (
    <figure className="chart line-chart" ref={figure}>
      <div className="chart-frame" ref={frame}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={(event) => readingKeys(event, active, x.length, move)}
          onFocus={() => active === null && move(x.length - 1)}
          onBlur={() => setReading(null)}
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
            .map((marker) => {
              const at = sx(marker.x);
              // Read away from the nearer edge, so a marker near the end is never cut off.
              const before = at > left + plot.width / 2;
              return (
                <g key={`${marker.x}-${marker.label}`} className="chart-marker">
                  <line x1={at} x2={at} y1={top} y2={top + plot.height} />
                  <text x={before ? at - 4 : at + 4} y={top + 9} textAnchor={before ? 'end' : undefined}>
                    {marker.label}
                  </text>
                </g>
              );
            })}
          {band && shade && <path className={`chart-band-area area-${band.slot}`} d={shade} />}
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
          {tip && active !== null && (
            <g className="chart-tip" aria-hidden="true">
              <line
                className="chart-crosshair"
                x1={sx(x[active]!)}
                x2={sx(x[active]!)}
                y1={top}
                y2={top + plot.height}
              />
              {series.map((s) =>
                s.values[active] === null || s.values[active] === undefined ? null : (
                  <circle
                    key={s.name}
                    className={`chart-dot dot-${s.slot}`}
                    cx={sx(x[active]!)}
                    cy={sy(s.values[active]!)}
                    r={4}
                  />
                ),
              )}
              <TipBox tip={tip} x={sx(x[active]!)} y={top} min={0} max={left + plot.width + right} />
            </g>
          )}
          <rect
            className="chart-hit"
            x={left}
            y={top}
            width={plot.width}
            height={plot.height}
            onPointerMove={pointed}
            onPointerDown={pointed}
            onPointerLeave={(event) => event.pointerType === 'mouse' && setReading(null)}
          />
        </svg>
      </div>
      <p className="sr-only" aria-live="polite">
        {reading?.by === 'keys' && tip ? tipText(tip) : ''}
      </p>
      {legend && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={`swatch swatch-line line-bg-${s.slot}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
          {band && (
            <span>
              <i className={`swatch swatch-band area-bg-${band.slot}`} aria-hidden="true" />
              {band.name}
            </span>
          )}
        </figcaption>
      )}
      {table && x.length > 0 && (
        <ChartTable
          label={label}
          head={xTitle}
          columns={[...series.map((s) => s.name), ...(band ? [band.name] : [])]}
          rows={x.map((value, i) => ({
            key: String(value),
            label: pointLabel(value),
            cells: [
              ...series.map((s) =>
                s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i]!),
              ),
              ...(band
                ? [
                    band.lower[i] === null || band.upper[i] === null || band.lower[i] === undefined
                      ? '—'
                      : `${format(band.lower[i]!)}–${format(band.upper[i]!)}`,
                  ]
                : []),
            ],
          }))}
        />
      )}
    </figure>
  );
}
