import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { loadAdminAssets } from '../apps/server/src/admin/assets.js';
import { Columns, LineChart, PlayerColour, columnTip, tipText } from '../apps/admin/ui.js';
import { parseRoute } from '../apps/admin/route.js';
import {
  accountLabel,
  clock,
  count,
  dateAxis,
  dayLabel,
  dayMonth,
  diceLabel,
  isoDay,
  localWindows,
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
