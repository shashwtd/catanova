import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { loadAdminAssets } from '../apps/server/src/admin/assets.js';
import { Columns, PlayerColour } from '../apps/admin/ui.js';
import { parseRoute } from '../apps/admin/route.js';
import { accountLabel, diceLabel } from '../apps/admin/format.js';
import { fairness } from '../apps/admin/pages/Stats.js';
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
  assert.equal((chart.match(/<title>/g) ?? []).length, 3, 'every column has a tooltip');
  assert.match(chart, /Finished<\/span>.*Abandoned<\/span>.*Expected<\/span>/s, 'a legend for two series');
  assert.deepEqual(parseRoute('#/games/AB2C?status=live'), {
    page: 'games',
    id: 'AB2C',
    params: new URLSearchParams('status=live'),
  });
  assert.equal(parseRoute('#/unknown').page, 'overview');
  assert.equal(parseRoute('#/games/%E0%A4%A').id, undefined, 'a malformed id is ignored');
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
