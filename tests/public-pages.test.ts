import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { renderPublicPages } from '../scripts/render-public-pages.js';

test('the production entry is readable before JavaScript and only public pages enter discovery files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-public-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const template = await readFile('apps/client/index.html', 'utf8');
  await writeFile(join(directory, 'index.html'), template);
  await renderPublicPages(directory);
  const home = await readFile(join(directory, 'index.html'), 'utf8');
  const guide = await readFile(join(directory, 'guide', 'index.html'), 'utf8');
  const shell = await readFile(join(directory, 'app.html'), 'utf8');
  assert.equal((home.match(/<title>/g) ?? []).length, 1);
  assert.ok(home.includes('<title>Catanova — Catan Alternative for Friends</title>'));
  assert.ok(home.includes('property="og:title" content="Catanova — Catan Alternative for Friends"'));
  assert.ok(home.includes('name="twitter:title" content="Catanova — Catan Alternative for Friends"'));
  assert.ok(home.includes('Create room') && home.includes('Join room'));
  assert.ok(home.includes('<a href="/guide/">How to play</a>'));
  assert.ok(home.includes('Open on GitHub') && home.includes('<noscript>'));
  assert.ok(!home.includes('Catanova is open source.'));
  assert.ok(home.includes('<script type="module" src="/src/main.tsx"></script>'));
  assert.ok(shell.includes('<div id="root"></div>'));
  assert.ok(!shell.includes('Create room') && !shell.includes('Connecting…'));
  assert.ok(guide.includes('How to Play Catanova') && guide.includes('City upgrade'));
  assert.ok(guide.includes('3 Rock') && guide.includes('2 Hay'));
  assert.ok(guide.includes('cannot add friends while still guests'));
  assert.ok(!guide.includes('<script') && !guide.includes('/src/main.tsx'));
  for (const html of [home, guide]) {
    assert.equal((html.match(/name="description"/g) ?? []).length, 1);
    assert.ok(html.includes('property="og:image" content="https://catanova.io/branding/social-card.jpg"'));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.ok(html.includes('sizes="48x48"') && html.includes('rel="apple-touch-icon"'));
    assert.ok(!html.includes('sb_publishable_') && !html.includes('supabase.co'));
  }
  assert.ok(home.includes('rel="canonical" href="https://catanova.io/"'));
  assert.ok(guide.includes('rel="canonical" href="https://catanova.io/guide/"'));
  const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
    ['https://catanova.io/', 'https://catanova.io/guide/'],
  );
  assert.equal(
    await readFile(join(directory, 'robots.txt'), 'utf8'),
    'User-agent: *\nAllow: /\n\nSitemap: https://catanova.io/sitemap.xml\n',
  );
  // Anchor navigation should never strand readers at a nonexistent section.
  for (const match of guide.matchAll(/href="#([^"]+)"/g)) assert.ok(guide.includes(`id="${match[1]}"`));
});

test('discovery assets are real files with declared icon and social dimensions', async () => {
  const root = resolve('apps/client/public');
  const manifest = JSON.parse(await readFile(join(root, 'site.webmanifest'), 'utf8')) as {
    start_url: string;
    icons: { src: string; sizes: string }[];
  };
  assert.equal(manifest.start_url, '/');
  const sizes = [
    ['/branding/favicon-48.png', '48x48'],
    ['/branding/favicon-96.png', '96x96'],
    ['/branding/apple-touch-icon.png', '180x180'],
    ...manifest.icons.map((icon) => [icon.src, icon.sizes]),
  ];
  for (const [src, declared] of sizes) {
    const png = await readFile(join(root, src!));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, declared);
  }
  const ico = await readFile(join(root, 'branding/favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1);
  const jpeg = await readFile(join(root, 'branding/social-card.jpg'));
  assert.equal(jpeg.readUInt16BE(0), 0xffd8);
  let offset = 2,
    dimensions: number[] | undefined;
  while (offset < jpeg.length) {
    assert.equal(jpeg[offset], 0xff);
    const marker = jpeg[offset + 1]!;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      dimensions = [jpeg.readUInt16BE(offset + 7), jpeg.readUInt16BE(offset + 5)];
      break;
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  assert.deepEqual(dimensions, [1200, 630]);
});
