/**
 * Dice, drawn the way the table draws them: the first die ivory with slate
 * pips and the second teal with cream ones, each a rounded square lit from
 * the top left, with its thickness showing below and to the right. Inline
 * SVG coloured by classes, so nothing is styled inline.
 */
import type { ReactNode } from 'react';
import type { DiceSummary } from '../server/src/admin/types.js';
import { count, percent } from './format.js';
import { Heatmap } from './ui.js';
import type { HeatCell, TipRow } from './ui.js';

/** Pip centres on a 24-unit face, by value. */
const PIPS: Record<number, [number, number][]> = {
  1: [[12, 12]],
  2: [
    [7.5, 7.5],
    [16.5, 16.5],
  ],
  3: [
    [7, 7],
    [12, 12],
    [17, 17],
  ],
  4: [
    [7.5, 7.5],
    [16.5, 7.5],
    [7.5, 16.5],
    [16.5, 16.5],
  ],
  5: [
    [7, 7],
    [17, 7],
    [12, 12],
    [7, 17],
    [17, 17],
  ],
  6: [
    [7.5, 6.5],
    [16.5, 6.5],
    [7.5, 12],
    [16.5, 12],
    [7.5, 17.5],
    [16.5, 17.5],
  ],
};

export type Die = 'first' | 'second';

/** One die face, centred on (x, y) and `size` across, for drawing inside another SVG. */
export function DieGlyph({
  value,
  x,
  y,
  size,
  die = 'first',
}: {
  value: number;
  x: number;
  y: number;
  size: number;
  die?: Die;
}) {
  return (
    <g
      className={`die die-${die}`}
      transform={`translate(${(x - size / 2).toFixed(1)},${(y - size / 2).toFixed(1)}) scale(${(size / 24).toFixed(3)})`}
    >
      <rect className="die-edge" x={1.5} y={2.6} width={21.5} height={21} rx={5.5} />
      <rect className="die-face" x={0.5} y={0.5} width={21.5} height={21} rx={5.5} />
      <path className="die-shine" d="M5 2.4H15.5" />
      {(PIPS[value] ?? []).map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="die-pip" cx={cx - 0.75} cy={cy - 1} r={2.25} />
      ))}
    </g>
  );
}

/** One die face on its own. Decorative: whatever it shows is also said in words beside it. */
export function DieFace({ value, size = 16, die = 'first' }: { value: number; size?: number; die?: Die }) {
  return (
    <svg className="die-svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <DieGlyph value={value} x={12} y={12} size={24} die={die} />
    </svg>
  );
}

/** A roll: the first die and the second, named for screen readers. */
export function DicePair({ dice, size = 16 }: { dice: [number, number]; size?: number }) {
  return (
    <span className="dice-pair" role="img" aria-label={`rolled ${dice[0]} and ${dice[1]}`}>
      <DieFace value={dice[0]} size={size} die="first" />
      <DieFace value={dice[1]} size={size} die="second" />
    </span>
  );
}

/** The most even pair that makes a total, first die the smaller: 7 is 3 and 4, 12 is 6 and 6. */
export const pairFor = (total: number): [number, number] => [Math.floor(total / 2), Math.ceil(total / 2)];

/**
 * The pair that makes each total, drawn under a dice chart's column: two
 * small dice side by side, when the column has room for them.
 */
export function totalDice(total: (index: number) => number) {
  return {
    height: 18,
    draw: (index: number, center: number, band: number): ReactNode => {
      const size = Math.min(12, Math.floor((band - 6) / 2));
      if (size < 8) return null;
      const [first, second] = pairFor(total(index));
      return (
        <>
          <DieGlyph value={first} x={center - size / 2 - 1} y={size / 2 + 2} size={size} die="first" />
          <DieGlyph value={second} x={center + size / 2 + 1} y={size / 2 + 2} size={size} die="second" />
        </>
      );
    },
  };
}

/**
 * Which pairs came up: a 6 × 6 grid, the first die down the side and the
 * second across, each cell shaded by how often that pair was rolled. Each
 * total runs along a diagonal from bottom left to top right, so the grid also
 * shows why 7 comes up most: six pairs make it. A cell's tooltip names the
 * pair, its count and share, and what it should be where the dice mode says
 * exactly; no test is run on pairs.
 */
export function PairGrid({ dice, label }: { dice: DiceSummary; label: string }) {
  const pairs = dice.pairs;
  if (!pairs) return null;
  const read = pairs.reduce((sum, n) => sum + n, 0);
  const max = Math.max(1, ...pairs);
  const values = [1, 2, 3, 4, 5, 6];
  const cells: HeatCell[][] = values.map((first) =>
    values.map((second) => {
      const n = pairs[(first - 1) * 6 + (second - 1)]!;
      return { value: n, text: count(n) };
    }),
  );
  const expected = dice.pairExpected;
  const doubles = values.reduce((sum, value) => sum + pairs[(value - 1) * 7]!, 0);
  return (
    <>
      <Heatmap
        label={label}
        rows={values.map((first) => ({
          key: String(first),
          label: (x, y, size) => <DieGlyph value={first} x={x} y={y} size={size} die="first" />,
        }))}
        columns={values.map((second) => ({
          key: String(second),
          label: (x, y, size) => <DieGlyph value={second} x={x} y={y} size={size} die="second" />,
        }))}
        cells={cells}
        max={max}
        rowTitle="first die"
        columnTitle="second die"
        labelWidth={40}
        maxCell={44}
        scale={{ low: '0', high: `${count(max)} rolls` }}
        tip={(r, c) => {
          const index = r * 6 + c;
          const n = pairs[index]!;
          const rows: TipRow[] = [
            { mark: 'none', paint: 'ink', value: count(n), name: n === 1 ? 'roll' : 'rolls' },
            { mark: 'none', paint: 'ink', value: percent(n, read), name: 'of the rolls read' },
          ];
          if (expected)
            rows.push({
              mark: 'none',
              paint: 'ink',
              value: expected[index]!.toFixed(1),
              name: dice.model === 'flat' ? 'expected from equal totals' : 'expected from two fair dice',
            });
          return { title: `${r + 1} then ${c + 1}, making ${r + c + 2}`, rows };
        }}
        table={{
          head: 'First die',
          row: (r) => String(r + 1),
          value: (r, c) => count(pairs[r * 6 + c]!),
        }}
      />
      <p className="footnote">
        Doubles {count(doubles)} of {count(read)} ({percent(doubles, read)})
        {dice.model === 'two-dice' ? '; two fair dice roll one in six' : ''}.
        {dice.unpaired
          ? ` ${count(dice.unpaired)} roll${dice.unpaired === 1 ? '' : 's'} named no pair and ${dice.unpaired === 1 ? 'is' : 'are'} left out.`
          : ''}
      </p>
    </>
  );
}
