import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { loadAdminAssets } from '../apps/server/src/admin/assets.js';
import {
  Columns,
  Empty,
  Heatmap,
  LineChart,
  PlayerColour,
  TrendStat,
  columnTip,
  heatStep,
  tipText,
} from '../apps/admin/ui.js';
import type { Delta } from '../apps/admin/ui.js';
import { movingAverage, rangeView } from '../apps/admin/pages/Growth.js';
import { DicePair, PairGrid, pairFor, totalDice } from '../apps/admin/dice.js';
import {
  CpuChip,
  Database,
  DiskTank,
  Meeples,
  MemoryStick,
  Plug,
  Settlement,
  Stopwatch,
} from '../apps/admin/art.js';
import type { GrowthReport, GrowthSeries } from '../apps/server/src/admin/types.js';
import { parseRoute } from '../apps/admin/route.js';
import {
  accountLabel,
  change,
  clock,
  count,
  dateAxis,
  dayLabel,
  dayMonth,
  diceLabel,
  isoDay,
  localWindows,
  minutes,
  points,
  timeTicks,
  utcDay,
  weekLabel,
} from '../apps/admin/format.js';
import { fairness } from '../apps/admin/pages/Stats.js';
import { detailPairs } from '../apps/admin/pages/Audit.js';
import { diceSummary, FAIR_DICE } from '../apps/server/src/admin/analysis.js';
import { PLAYER_COLORS } from '../packages/protocol/src/colors.js';

test('npm run build produces dist/admin, beside and separate from the game client', async () => {
  const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts as Record<string, string>;
  assert.match(scripts.build!, /vite build apps\/client --outDir \.\.\/\.\.\/dist\/client/);
  assert.match(scripts.build!, /vite build apps\/admin --outDir \.\.\/\.\.\/dist\/admin --emptyOutDir/);
});

test('the admin build runs under its CSP: external same-origin script and style only, nothing inline', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'catanova-admin-build-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await build({
    root: 'apps/admin',
    configFile: 'apps/admin/vite.config.ts',
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  });
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0]![1]!, /type="module"/);
  assert.match(scripts[0]![1]!, /src="\/assets\/[\w-]+\.js"/);
  assert.equal(scripts[0]![2]!.trim(), '', 'no inline script');
  assert.doesNotMatch(html, /<style\b|\sstyle=|\son[a-z]+=/i, 'no inline style or handler');
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, 'nothing from another origin');
  assert.match(html, /<link rel="stylesheet"[^>]*href="\/assets\/[\w-]+\.css"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  const assets = await readdir(join(out, 'assets'));
  assert.ok(assets.some((name) => name.endsWith('.js')) && assets.some((name) => name.endsWith('.css')));
  assert.ok(!assets.some((name) => name.endsWith('.map')), 'no source maps are published');
  for (const name of assets.filter((file) => file.endsWith('.js'))) {
    const code = await readFile(join(out, 'assets', name), 'utf8');
    assert.doesNotMatch(code, /\beval\(|new Function\(/, `${name} needs no unsafe-eval`);
  }
  for (const name of assets.filter((file) => file.endsWith('.css')))
    assert.doesNotMatch(
      await readFile(join(out, 'assets', name), 'utf8'),
      /@import|url\(\s*['"]?(?:https?:)?\/\//,
    );
  // The listener serves exactly these files, by exact path.
  const served = loadAdminAssets(out)!;
  assert.ok(served.has('/') && !served.has('/index.html'));
  for (const reference of html.matchAll(/(?:src|href)="(\/[^"]+)"/g))
    assert.ok(served.has(reference[1]!), `${reference[1]} is served`);
});

test('admin charts and routes are plain markup: no inline styles, and ids never leave the hash', () => {
  const chart = renderToStaticMarkup(
    createElement(Columns, {
      label: 'Rolls',
      categories: ['2', '3', '4'],
      series: [
        { name: 'Finished', slot: 3, values: [1, 0, 4] },
        { name: 'Abandoned', slot: 2, values: [2, 1, 0] },
      ],
      reference: { name: 'Expected', values: [1, 2, 3] },
    }),
  );
  assert.doesNotMatch(chart, /style=/);
  assert.match(chart, /role="img" aria-label="Rolls"/);
  assert.match(chart, /tabindex="0"/, 'reachable by keyboard for its tooltip');
  assert.equal((chart.match(/class="chart-column/g) ?? []).length, 3);
  assert.match(chart, /class="chart-hit"/, 'one pointer layer reads whichever column is nearest');
  assert.doesNotMatch(chart, /<title>/, 'no native tooltip doubling the drawn one');
  assert.match(chart, /aria-live="polite"/, 'the keyboard reading is announced');
  assert.match(chart, /Finished<\/span>.*Abandoned<\/span>.*Expected<\/span>/s, 'a legend for two series');
  assert.deepEqual(parseRoute('#/games/AB2C?status=live'), {
    page: 'games',
    id: 'AB2C',
    params: new URLSearchParams('status=live'),
  });
  assert.equal(parseRoute('#/unknown').page, 'overview');
  assert.equal(parseRoute('#/games/%E0%A4%A').id, undefined, 'a malformed id is ignored');
});

test('every column says exactly what it is: its whole date and each value there, in its tooltip and its table', () => {
  const now = Date.UTC(2026, 8, 24, 15);
  const days = ['2026-09-20', '2026-09-21', '2026-09-22'];
  const series = [
    { name: 'Finished', slot: 3 as const, values: [2, 0, 5] },
    { name: 'Abandoned', slot: 2 as const, values: [1, 1, 0] },
  ];
  const lines = [{ name: '7-day average', paint: 'ink' as const, values: [null, 1.5, 2.8] }];
  // Read from the top of the stack down, then the lines over it.
  const tip = columnTip(1, { title: dayLabel(days[1]!, now), series, lines, format: count });
  assert.deepEqual(tip, {
    title: 'Mon 21 Sep',
    rows: [
      { mark: 'bar', paint: 2, value: '1', name: 'Abandoned' },
      { mark: 'bar', paint: 3, value: '0', name: 'Finished' },
      { mark: 'line', paint: 'ink', value: '1.5', name: '7-day average' },
    ],
  });
  assert.equal(tipText(tip), 'Mon 21 Sep: Abandoned 1, Finished 0, 7-day average 1.5');
  assert.equal(
    columnTip(0, { title: 'Sun 20 Sep', series: [], lines, format: count }).rows[0]!.value,
    '—',
    'a missing value reads as missing',
  );
  const chart = renderToStaticMarkup(
    createElement(Columns, {
      label: 'Games ended per day',
      categories: days,
      axis: (band: number) => dateAxis(days, band),
      pointLabel: (i: number) => dayLabel(days[i]!, now),
      series,
      lines,
      table: 'Day (UTC)',
    }),
  );
  assert.doesNotMatch(chart, /style=/);
  assert.match(chart, /<summary>Show the numbers<\/summary>/);
  assert.match(
    chart,
    /<td class="nowrap">Mon 21 Sep<\/td><td class="num">0<\/td><td class="num">1<\/td><td class="num">1.5<\/td>/,
  );
  assert.match(chart, /<td class="nowrap">Sun 20 Sep<\/td>.*?<td class="num">—<\/td>/);
  assert.match(
    chart,
    /class="chart-line line-ink" d="M[\d.]+,[\d.]+L[\d.]+,[\d.]+"/,
    'the line starts at its first value',
  );
});

test('date axes label what fits: every day, Mondays, months or quarters, and the year where it changes', () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const run = (last: string, n: number, stepDays: number) =>
    Array.from({ length: n }, (_, i) => isoDay(utcDay(last) - (n - 1 - i) * stepDays * 86_400_000));
  const labels = (days: string[], band: number, unit: 'day' | 'week' = 'day') => {
    const pick = dateAxis(days, band, unit);
    return days.map((_, i) => pick(i)).filter((label): label is string => label !== null);
  };
  const month = run('2026-09-24', 30, 1);
  assert.deepEqual(labels(month, 18), ['31 Aug', '7 Sep', '14 Sep', '21 Sep'], 'Mondays at 18px a day');
  assert.equal(labels(month, 60).length, 30, 'every day when there is room');
  assert.deepEqual(
    labels(month, 30).slice(-2),
    ['22 Sep', '24 Sep'],
    'every other day, ending on the latest',
  );
  assert.deepEqual(
    labels(run('2026-09-24', 90, 1), 5).slice(-3),
    ['24 Aug', '7 Sep', '21 Sep'],
    'every other Monday across a quarter, ending on the latest',
  );
  assert.deepEqual(
    labels(run('2026-09-24', 180, 1), 2.5),
    ['Apr 2026', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
    'months across half a year, the first with its year',
  );
  const year = run('2026-09-21', 53, 7);
  assert.deepEqual(
    labels(year, 10, 'week'),
    ['Oct 2025', 'Jan 2026', 'Apr', 'Jul'],
    'quarters over a year of weeks',
  );
  assert.deepEqual(labels(run('2026-09-21', 8, 7), 60, 'week').slice(0, 2), ['3 Aug', '10 Aug']);
  assert.equal(dayLabel('2026-09-16', now), 'Wed 16 Sep');
  assert.equal(dayLabel('2025-12-31', now), 'Wed 31 Dec 2025', 'another year says so');
  assert.equal(weekLabel('2026-09-14', now), 'Week of 14 Sep');
  assert.equal(dayMonth('2026-01-05', now), '5 Jan');
});

test('changes against the period before are signed, and say nothing when there is nothing to compare', () => {
  assert.equal(change(112, 100), '+12%');
  assert.equal(change(95, 100), '−5%');
  assert.equal(change(100.4, 100), '+0.4%');
  assert.equal(change(100, 100), '±0%');
  assert.equal(change(9450, 236), '+3,904%', 'large rises keep their thousands separator');
  assert.equal(change(5, 0), null, 'no earlier activity is not an infinite rise');
  assert.equal(change(5, null), null);
  assert.equal(points(31.5, 29), '+2.5 pts');
  assert.equal(points(29, 30), '−1 pt');
  assert.equal(minutes(38.4), '38 min');
  assert.equal(minutes(72), '1 h 12 min');
  assert.equal(minutes(120), '2 h');
  assert.equal(minutes(null), '—');
});

/** A growth report shaped like the server's, for `days`, `weeks` and `months` ending at `now`. */
function growthReport(now: number, firstGameAt: number | null, weeks = 60, months = 14): GrowthReport {
  const DAY = 86_400_000;
  const series = (starts: string[]): GrowthSeries => {
    const counts = starts.map((_, i) => i + 1);
    return {
      start: starts,
      started: counts,
      finished: counts,
      abandoned: counts.map(() => 0),
      active: counts,
      trailing: counts,
      newPlayers: counts,
      accounts: counts,
      seats: counts,
      botSeats: counts.map(() => 0),
      withBots: counts.map(() => 0),
      lengths: { games: counts, median: counts, low: counts, high: counts },
    };
  };
  const today = Math.floor(now / DAY);
  const monday = today - ((new Date(now).getUTCDay() + 6) % 7);
  const period = {
    from: 0,
    to: now,
    started: 0,
    finished: 0,
    abandoned: 0,
    active: 0,
    newPlayers: 0,
    accountsBefore: 0,
    accountsAfter: 0,
    seats: 0,
    botSeats: 0,
    withBots: 0,
    lengthGames: 0,
    medianMinutes: null,
    nextWeek: { players: 0, returned: 0 },
  };
  return {
    generatedAt: now,
    firstGameAt,
    days: series(Array.from({ length: 90 }, (_, i) => isoDay((today - 89 + i) * DAY))),
    weeks: series(Array.from({ length: weeks }, (_, i) => isoDay((monday - 7 * (weeks - 1 - i)) * DAY))),
    months: series(
      Array.from({ length: months }, (_, i) => {
        const date = new Date(now);
        return isoDay(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (months - 1 - i), 1));
      }),
    ),
    periods: {
      '30d': { current: period, previous: null },
      '90d': { current: period, previous: null },
      '1y': { current: period, previous: null },
      all: { current: period, previous: null },
    },
    cohorts: [],
  };
}

test('growth ranges are drawn by day, week or month, and a bucket still under way is never a trend’s last word', () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const young = growthReport(now, now - 20 * 7 * 86_400_000);
  const month = rangeView(young, '30d');
  assert.equal(month.unit, 'day');
  assert.equal(month.series.start.length, 30);
  assert.equal(month.series.start.at(-1), '2026-09-24');
  assert.equal(month.label(29), 'Thu 24 Sep, so far', 'today is not over');
  assert.equal(month.label(28), 'Wed 23 Sep');
  assert.equal(month.partial, 29);
  // Averages are worked out over the whole series, so the range's first day has one, and leave today out.
  assert.equal(month.average.started.length, 30);
  assert.equal(month.average.started[0], 58, 'days 55 to 61 of the 90, averaged');
  assert.equal(month.average.started.at(-1), null);
  assert.deepEqual(month.complete([1, 2, 3]), [1, 2]);
  const year = rangeView(young, '1y');
  assert.deepEqual([year.unit, year.series.start.length], ['week', 52]);
  assert.equal(year.averageName, '4-week average');
  const all = rangeView(young, 'all');
  assert.equal(all.unit, 'week');
  assert.equal(all.series.start.length, 21, 'from the week of the first game');
  const old = rangeView(growthReport(now, now - 3 * 365 * 86_400_000, 160, 40), 'all');
  assert.deepEqual([old.unit, old.averageName], ['month', '3-month average']);
  assert.match(old.label(old.partial), /^September 2026, so far$/);
  assert.deepEqual(movingAverage([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});

test('a headline number says which way it moved in words and an arrow, never by colour alone', () => {
  const tile = (delta: Delta) =>
    renderToStaticMarkup(
      createElement(TrendStat, { label: 'New players', value: '1,940', delta, spark: [1, 3, 2, 5] }),
    );
  const up = tile({ text: '+26%', against: 'vs the 30 days before', good: true });
  assert.doesNotMatch(up, /style=/);
  assert.match(up, /class="delta delta-good"/);
  assert.match(up, /↑<\/span>26%/);
  assert.match(up, /<span class="sr-only"> up vs the 30 days before<\/span>/);
  assert.match(up, /class="spark-line" d="M[\d.]+,[\d.]+L/, 'a sparkline of the period');
  assert.match(up, /class="spark-dot"/, 'the latest point marked');
  assert.match(tile({ text: '−1.4 pts', against: 'vs the 30 days before', good: true }), /delta-bad.*↓/);
  assert.match(tile({ text: '+2.2%', against: 'vs the 30 days before', good: null }), /delta-neutral/);
  const flat = tile({ text: '±0%', against: 'vs the 30 days before', good: null });
  assert.doesNotMatch(flat, /[↑↓]/, 'no arrow when nothing moved');
  assert.match(flat, /unchanged vs the 30 days before/);
});

test('a heatmap shades each cell by its value on one hue, marks a week under way, and has its numbers in a table', () => {
  const markup = renderToStaticMarkup(
    createElement(Heatmap, {
      label: 'Weekly retention',
      rows: [
        { key: 'a', label: '7 Sep', aside: '449' },
        { key: 'b', label: '14 Sep', aside: '452' },
      ],
      columns: [
        { key: '1', label: '1' },
        { key: '2', label: '2' },
      ],
      cells: [
        [
          { value: 38, text: '38' },
          { value: 24, text: '24', partial: true },
        ],
        [{ value: 0, text: '0', partial: true }, null],
      ],
      max: 40,
      tip: () => ({ title: 'Week of 7 Sep', rows: [] }),
      scale: { low: '0%', high: '40%' },
      table: {
        head: 'First week',
        row: (r: number) => ['Week of 7 Sep', 'Week of 14 Sep'][r]!,
        value: () => 'x',
      },
    }),
  );
  assert.doesNotMatch(markup, /style=/);
  assert.equal(heatStep(38, 40), 6);
  assert.equal(heatStep(24, 40), 4);
  assert.equal(heatStep(0, 40), 0, 'nothing is the surface’s own step');
  assert.match(markup, /class="heat heat-6"/);
  assert.match(markup, /class="heat heat-4 heat-partial"/);
  assert.equal((markup.match(/class="heat /g) ?? []).length, 3, 'a week yet to come has no cell');
  assert.match(
    markup,
    /<td class="nowrap">Week of 14 Sep<\/td><td class="num">x<\/td><td class="num">—<\/td>/,
  );
  assert.match(markup, /0%<\/span><span class="heat-scale"/);
});

test('dice are drawn with pips, the first ivory and the second teal, and the grid of pairs reads each one', () => {
  const pair = renderToStaticMarkup(createElement(DicePair, { dice: [3, 4] }));
  assert.doesNotMatch(pair, /style=/);
  assert.match(pair, /role="img" aria-label="rolled 3 and 4"/);
  assert.match(pair, /class="die die-first".*class="die die-second"/s);
  assert.equal((pair.match(/class="die-pip"/g) ?? []).length, 7, 'three pips and four');
  assert.deepEqual(
    [pairFor(2), pairFor(7), pairFor(12)],
    [
      [1, 1],
      [3, 4],
      [6, 6],
    ],
  );
  const pairs = Array.from({ length: 36 }, (_, i) => (i === 2 * 6 + 3 ? 9 : 2));
  const summary = {
    ...diceSummary(
      FAIR_DICE.map((p) => p * 79),
      'classic',
      { pairs, unpaired: 0 },
    ),
  };
  const grid = renderToStaticMarkup(createElement(PairGrid, { dice: summary, label: 'Pairs' }));
  assert.doesNotMatch(grid, /style=/);
  assert.equal((grid.match(/class="heat heat-/g) ?? []).length, 36, 'a cell for every ordered pair');
  assert.equal((grid.match(/class="die die-first"/g) ?? []).length, 6, 'the first die down the side');
  assert.equal((grid.match(/class="die die-second"/g) ?? []).length, 6, 'the second die across');
  assert.match(
    grid,
    /class="heat heat-6"[^>]*><\/rect><text[^>]*>9<\/text>/,
    'the most rolled pair is the brightest',
  );
  assert.match(grid, /Doubles 12 of 79 \(15\.2%\); two fair dice roll one in six\./);
  // Under a totals chart, each total's most even pair.
  const below = renderToStaticMarkup(
    createElement('svg', null, totalDice((i) => i + 2).draw(5, 100, 40) as never),
  );
  assert.equal((below.match(/class="die-pip"/g) ?? []).length, 7, 'a total of 7 is drawn as 3 and 4');
});

test('the machine is drawn from its readings, as decoration beside the number, and moves only when motion is welcome', async () => {
  const draw = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);
  const drawings = [
    draw(createElement(CpuChip, { percent: 12 })),
    draw(createElement(MemoryStick, { used: 50, limit: 100 })),
    draw(createElement(Stopwatch, { ms: 3 })),
    draw(createElement(Plug, { sockets: 3 })),
    draw(createElement(DiskTank, { used: 40, total: 100 })),
    draw(createElement(Database)),
    draw(createElement(Meeples, { online: 9, playing: 2 })),
    draw(createElement(Settlement, { live: 1 })),
  ];
  for (const drawing of drawings) {
    assert.doesNotMatch(drawing, /style=/);
    assert.match(
      drawing,
      /^<svg class="art art-[a-z]+[^"]*"[^>]*aria-hidden="true"/,
      'the number beside it says it',
    );
  }
  // Each reading's level: calm, busy or hot.
  assert.match(drawings[0]!, /art-cpu art-calm/);
  assert.match(draw(createElement(CpuChip, { percent: 55 })), /art-cpu art-busy/);
  assert.match(draw(createElement(CpuChip, { percent: 92 })), /art-cpu art-hot/);
  assert.match(draw(createElement(Stopwatch, { ms: 30 })), /art-loop art-busy/);
  assert.match(draw(createElement(Stopwatch, { ms: 300 })), /art-loop art-hot/);
  assert.match(
    draw(createElement(DiskTank, { used: 85, total: 100 })),
    /art-disk art-busy/,
    'under a fifth free',
  );
  assert.match(
    draw(createElement(DiskTank, { used: 95, total: 100 })),
    /art-disk art-hot/,
    'under a tenth free',
  );
  // Memory chips fill from the left with the share in use: half is two of four.
  assert.equal((drawings[1]!.match(/class="art-chip-fill"/g) ?? []).length, 2);
  assert.equal(
    (draw(createElement(MemoryStick, { used: 0, limit: 100 })).match(/art-chip-fill/g) ?? []).length,
    0,
  );
  // The plug is home with its light on while anything is connected, pulled out when nothing is.
  assert.match(drawings[3]!, /art-plug art-calm/);
  assert.match(
    draw(createElement(Plug, { sockets: 0 })),
    /^<svg class="art art-plug"[^>]*>.*translate\(-8,0\)/s,
  );
  // Up to five meeples, those playing in the players' colours.
  assert.equal((drawings[6]!.match(/class="art-meeple(?: art-meeple-idle)?"/g) ?? []).length, 5);
  assert.equal((drawings[6]!.match(/class="art-meeple art-meeple-idle"/g) ?? []).length, 3);
  assert.match(drawings[6]!, new RegExp(`fill="${PLAYER_COLORS.coral}"`));
  // Windows are lit while a game is being played.
  assert.match(drawings[7]!, /art-window-lit/);
  assert.doesNotMatch(draw(createElement(Settlement, { live: 0 })), /art-window-lit/);
  // An empty state can show what is missing above its words; without a drawing it is the plain line.
  const empty = draw(
    createElement(Empty, {
      art: createElement(Meeples, { online: 0, playing: 0 }),
      children: 'Nobody is online.',
    }),
  );
  assert.match(empty, /^<div class="empty with-art"><svg class="art art-people"[^>]*aria-hidden="true"/);
  assert.match(empty, /<\/svg><p>Nobody is online\.<\/p><\/div>$/);
  assert.match(empty, /class="art-meeple-empty"/, 'an outline where a player would stand');
  assert.equal(
    draw(createElement(Empty, { children: 'No rolls yet.' })),
    '<p class="empty">No rolls yet.</p>',
  );
  // Every animation in the stylesheet sits inside a block that only applies when motion is welcome.
  const css = await readFile('apps/admin/admin.css', 'utf8');
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(start > 0);
  let depth = 0,
    end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  for (const match of css.matchAll(/animation(?:-[a-z]+)?\s*:/g))
    assert.ok(
      match.index! > start && match.index! < end,
      `animation at ${match.index} is outside the motion block`,
    );
});

test('a seat colour is the game’s own swatch and name, with no inline style', () => {
  const given = renderToStaticMarkup(createElement(PlayerColour, { color: 'jade', chosen: false }));
  assert.doesNotMatch(given, /style=/);
  assert.match(given, new RegExp(`fill="${PLAYER_COLORS.jade}"`));
  assert.match(given, />Jade<span class="muted">default<\/span>/);
  const picked = renderToStaticMarkup(createElement(PlayerColour, { color: 'coral', chosen: true }));
  assert.match(picked, />Coral<\/span>$/);
  assert.equal(
    renderToStaticMarkup(createElement(PlayerColour, { color: null, chosen: false })),
    '<span class="muted">—</span>',
  );
  assert.equal(accountLabel('permanent'), 'Google');
  assert.equal(accountLabel('guest'), 'Guest');
  assert.equal(accountLabel(null), null);
});

test('dice are only called fair or not where a test can say so', () => {
  const counts = FAIR_DICE.map((p) => p * 360);
  assert.match(
    fairness(diceSummary(counts, 'classic')),
    /^χ² 0 over 10 degrees of freedom, p = 1\. Consistent with fair, independent dice\.$/,
  );
  assert.match(fairness(diceSummary(counts, 'balanced')), /deck of all 36 pairs.*does not apply/);
  assert.doesNotMatch(fairness(diceSummary(counts, 'balanced')), /Consistent|Unlikely/);
  assert.match(fairness(diceSummary(counts, { classic: 180, balanced: 180 })), /no single test applies/);
  assert.match(fairness(diceSummary(Array(11).fill(0))), /No rolls yet/);
  assert.equal(diceLabel('classic'), 'Natural');
  assert.equal(diceLabel('balanced'), 'Balanced');
});

test('line charts are labelled SVG with a legend and a table of every value, and no inline style', () => {
  const chart = renderToStaticMarkup(
    createElement(LineChart, {
      label: 'People online and playing',
      x: [0, 60_000, 120_000, 600_000],
      series: [
        { name: 'Online', slot: 1, values: [2, 3, null, 4] },
        { name: 'Playing', slot: 2, values: [1, 1, 2, 2] },
      ],
      domain: [0, 600_000],
      ticks: [0, 300_000, 600_000],
      tickLabel: (at: number) => `${at / 60_000} min`,
      pointLabel: (at: number) => `minute ${at / 60_000}`,
      format: (value: number) => `${value} people`,
      xTitle: 'Time',
      yTitle: 'people',
      gapAfter: 150_000,
      integer: true,
    }),
  );
  assert.doesNotMatch(chart, /style=/);
  assert.match(chart, /role="img" aria-label="People online and playing"/);
  assert.match(chart, /tabindex="0"/, 'reachable by keyboard for the tooltip');
  assert.match(chart, />people<\/text>/, 'the value axis says its unit');
  assert.match(chart, />5 min<\/text>/, 'and the time axis its ticks');
  // A missing value and a gap longer than `gapAfter` both break the line.
  const online = chart.match(/class="chart-line line-1" d="([^"]+)"/)![1]!;
  assert.equal(online.match(/M/g)!.length, 2);
  const playing = chart.match(/class="chart-line line-2" d="([^"]+)"/)![1]!;
  assert.equal(playing.match(/M/g)!.length, 2, 'the last point is ten minutes after the one before');
  assert.match(chart, /<figcaption class="legend">.*Online.*Playing.*<\/figcaption>/s);
  assert.match(chart, /<summary>Show the numbers<\/summary>/);
  assert.match(chart, /<td class="nowrap">minute 10<\/td><td class="num">4 people<\/td>/);
  assert.match(chart, /<td class="num">—<\/td>/, 'a missing value is shown as missing');
  // Counts get whole-number ticks: a top of three becomes four, halved at two.
  assert.match(chart, />2<\/text>.*>4<\/text>/s);
  // A score holds until it changes: drawn as steps, never as a slope between turns.
  const steps = renderToStaticMarkup(
    createElement(LineChart, {
      label: 'Points by turn',
      x: [0, 1, 2],
      series: [{ name: 'Ann', slot: 1, values: [2, 2, 5] }],
      ticks: [0, 1, 2],
      tickLabel: String,
      pointLabel: (turn: number) => `Turn ${turn}`,
      format: String,
      xTitle: 'Turn',
      yTitle: 'points',
      step: true,
    }),
  );
  const path = steps.match(/class="chart-line line-1" d="([^"]+)"/)![1]!;
  assert.match(path, /^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+$/);
  // A marker's label reads away from the nearer edge, so one near the end is not cut off.
  const marked = (at: number) =>
    renderToStaticMarkup(
      createElement(LineChart, {
        label: 'Sockets',
        x: [],
        series: [{ name: 'Sockets', slot: 1, values: [] }],
        domain: [0, 600_000],
        ticks: [0, 600_000],
        tickLabel: String,
        pointLabel: String,
        format: String,
        xTitle: 'Time',
        yTitle: 'sockets',
        markers: [{ x: at, label: 'server started' }],
      }),
    ).match(/<g class="chart-marker">.*?<\/g>/)![0];
  assert.match(marked(590_000), /<text[^>]*text-anchor="end"[^>]*>server started<\/text>/);
  assert.doesNotMatch(marked(10_000), /text-anchor/);
});

test('time axes tick on round local times, and the day and week start at local midnight and Monday', () => {
  const from = new Date(2026, 8, 24, 9, 7).getTime();
  assert.deepEqual(
    timeTicks(from, from + 3_600_000).map((at) => clock(at)),
    ['09:15', '09:30', '09:45', '10:00'],
  );
  assert.deepEqual(
    timeTicks(from, from + 6 * 3_600_000).map((at) => clock(at)),
    ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  );
  assert.deepEqual(
    timeTicks(from, from + 24 * 3_600_000).map((at) => clock(at)),
    ['12:00', '18:00', '00:00', '06:00'],
  );
  const { day, week } = localWindows(new Date(2026, 8, 24, 15, 30).getTime());
  assert.equal(day, new Date(2026, 8, 24).getTime());
  assert.equal(week, new Date(2026, 8, 21).getTime(), '24 September 2026 is a Thursday');
});

test('an audit entry names its game by room code and each detail in words, not as JSON', () => {
  const entry = {
    id: 1,
    at: 0,
    actor: 'owner@example.com',
    action: 'game.end',
    target: '8303bc14-a54a-41d1-89d1-020afa8050a8',
    detail: { roomCode: '5WMC', revision: 51, previousPhase: 'roll', players: ['Ann', 'Bo'], from: null },
    ip: null,
    requestId: 'r',
  };
  assert.deepEqual(detailPairs(entry), [
    ['revision', '51'],
    ['previous phase', 'roll'],
    ['players', 'Ann, Bo'],
    ['from', '—'],
  ]);
  // Only a room target is shown by its code; anywhere else the code stays among the details.
  assert.deepEqual(detailPairs({ ...entry, target: null })[0], ['room code', '5WMC']);
  assert.deepEqual(detailPairs({ ...entry, detail: { nested: { a: 1 } } }), [['nested', '{"a":1}']]);
});
