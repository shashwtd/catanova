import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderPublicPages } from '../scripts/render-public-pages.js';
import {
  TitleScenery,
  TITLE_SLIDES,
  SLIDE_HOLD_SECONDS,
  SLIDE_FADE_SECONDS,
  sceneryKeyframes,
} from '../apps/client/src/TitleScenery.js';
import { HOME_TITLE } from '../apps/client/src/game-attention.js';
import {
  GUIDE_FAQ,
  GUIDE_SECTIONS,
  PUBLIC_PAGES,
  SOCIAL_CARD_ALT,
  subId,
} from '../apps/client/src/PublicPages.js';
import {
  COSTS,
  DEVELOPMENT_DECK,
  RESOURCES,
  RESOURCE_NAMES,
  RULESET,
  SUPPLY,
} from '../packages/rules/src/index.js';

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
  assert.ok(home.includes(`<title>${PUBLIC_PAGES[0].title}</title>`));
  assert.ok(home.includes(`<title>${HOME_TITLE}</title>`), 'hydration must retain the public brand title');
  assert.ok(home.includes(`property="og:title" content="${PUBLIC_PAGES[0].title}"`));
  assert.ok(home.includes(`name="twitter:title" content="${PUBLIC_PAGES[0].title}"`));
  // A search result is a sentence somebody wrote, not a keyword list with an
  // em dash in the middle of it.
  for (const page of PUBLIC_PAGES) {
    assert.ok(!page.title.includes('\u2014'), page.title);
    assert.ok(!page.description.includes('\u2014'), page.description);
    assert.ok(page.title.length <= 60, `${page.title} is ${page.title.length} characters`);
    assert.ok(
      page.description.length >= 110 && page.description.length <= 160,
      `${page.description.length} characters`,
    );
  }
  assert.match(home, /itemscope="" itemType="https:\/\/schema.org\/WebSite"/i);
  assert.ok(home.includes('itemProp="name" content="Catanova"'));
  assert.ok(home.includes('itemProp="url" href="https://catanova.io/"'));
  assert.ok(home.includes('A Catan alternative for 2–4 friends.'));
  assert.doesNotMatch(home, /(?:#1|Number One)\s+(?:Catan|alternative)/i);
  assert.ok(home.includes('Create room') && home.includes('Join room'));
  assert.ok(home.includes('<a href="/guide/">How to play</a>'));
  assert.ok(home.includes('Open on GitHub') && home.includes('<noscript>'));
  assert.ok(!home.includes('Catanova is open source.'));
  assert.ok(home.includes('<script type="module" src="/src/main.tsx"></script>'));
  assert.ok(shell.includes('<div id="root"></div>'));
  assert.match(home, /rel="preload" as="image" type="image\/webp"/);
  assert.match(guide, /rel="preload" as="image" type="image\/webp"/);
  assert.ok(!shell.includes('as="image"'), 'private game routes must not prefetch the welcome scenery');
  assert.ok(!shell.includes('Create room') && !shell.includes('Connecting…'));
  assert.ok(guide.includes('How to play') && guide.includes('City upgrade'));
  assert.ok(guide.includes('3 Rock') && guide.includes('2 Hay'));
  assert.ok(guide.includes('cannot add friends while still guests'));
  // A dropped connection is covered, not punished, and the guide says so twice
  // over on purpose: once as the marks a player will actually see on the card,
  // and once as the plain answer in the questions. Neither repeats the other.
  assert.ok(guide.includes('What an empty chair looks like'));
  assert.ok(guide.includes('Bot playing') && guide.includes('Resigned'));
  assert.ok(guide.includes('half a minute'));
  assert.ok(!guide.includes('auto-resign'), 'a dropped connection is covered, not punished');
  // Every feature the game has should be findable here. These are the ones
  // that shipped without a word on this page until they were added.
  for (const [anchor, phrase] of [
    ['id="bots"', 'They are not cheating'],
    ['id="setup"', 'Natural or balanced dice'],
    ['id="table"', 'Reactions'],
    ['id="glossary"', 'Largest Army'],
  ] as const)
    assert.ok(guide.includes(anchor) && guide.includes(phrase), anchor);
  // A reference page is only useful if its own contents list works.
  const navigable = [...guide.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(navigable.length >= 12, `only ${navigable.length} anchors`);
  // The contents exist twice on purpose: a rail beside a wide window, and a
  // disclosure after the opening on a phone. Every section and every subsection
  // is linked from both, and every one of those links lands somewhere.
  assert.equal((guide.match(/class="guide-nav-links"/g) ?? []).length, 2);
  assert.ok(GUIDE_SECTIONS.length >= 12);
  for (const [id, , subs] of GUIDE_SECTIONS) {
    // Twice in the contents, once on the heading's own section link, and more
    // wherever the prose cross-references it.
    const links = (guide.match(new RegExp(`href="#${id}"`, 'g')) ?? []).length;
    assert.ok(links >= 3, `${id} is linked ${links} times, expected both lists and its heading`);
    assert.ok(guide.includes(`id="${id}"`), id);
    for (const sub of subs) {
      const anchor = subId(id, sub);
      const subLinks = (guide.match(new RegExp(`href="#${anchor}"`, 'g')) ?? []).length;
      assert.ok(subLinks >= 3, `${anchor} is linked ${subLinks} times`);
      assert.ok(guide.includes(`id="${anchor}"`), anchor);
    }
  }
  // Notes are linked both ways, so a reader can always get back to the sentence.
  for (let n = 1; n <= 5; n += 1) {
    assert.ok(guide.includes(`id="ref-${n}"`) && guide.includes(`href="#note-${n}"`), `note ${n} marker`);
    assert.ok(guide.includes(`id="note-${n}"`) && guide.includes(`href="#ref-${n}"`), `note ${n} return`);
  }
  // Numbers a reader came here to look up are generated from the rules rather
  // than typed out, so the page cannot quietly disagree with the game. If a
  // cost or the deck changes, this page changes with it.
  for (const [kind, name] of [
    ['road', 'Road'],
    ['settlement', 'Settlement'],
    ['city', 'City upgrade'],
    ['developmentCard', 'Development card'],
  ] as const) {
    assert.ok(guide.includes(`>${name}</th>`) || guide.includes(`${name}</th>`), name);
    for (const resource of RESOURCES) {
      const amount = COSTS[kind][resource];
      if (amount) assert.ok(guide.includes(`${amount} ${RESOURCE_NAMES[resource]}`), `${name} ${resource}`);
    }
  }
  const deck = Object.values(DEVELOPMENT_DECK).reduce((sum, count) => sum + count, 0);
  assert.ok(guide.includes(`shuffled deck of ${deck}`), 'the deck size is stated');
  assert.ok(
    guide.includes(`${SUPPLY.roads} roads, ${SUPPLY.settlements} settlements, ${SUPPLY.cities} cities`),
    'the infobox lists the real piece counts',
  );
  assert.ok(guide.includes(RULESET), 'the infobox names the ruleset the server runs');
  assert.ok(guide.includes('id="questions"') && guide.includes('Can phones and computers play together?'));
  assert.ok(guide.includes('not an official CATAN game'));
  assert.ok(guide.includes('There is no public matchmaking'));
  // The guide still ships no executable code; the only script on it is data.
  assert.deepEqual(
    [...guide.matchAll(/<script([^>]*)>/g)].map((m) => m[1]!.trim()),
    ['type="application/ld+json"'],
  );
  assert.ok(!guide.includes('/src/main.tsx'));
  for (const html of [home, guide]) {
    assert.equal((html.match(/name="description"/g) ?? []).length, 1);
    assert.ok(html.includes('property="og:image" content="https://catanova.io/branding/social-card-v3.jpg"'));
    assert.ok(
      html.includes('name="twitter:image" content="https://catanova.io/branding/social-card-v3.jpg"'),
    );
    assert.ok(html.includes(`property="og:image:alt" content="${SOCIAL_CARD_ALT}"`));
    assert.ok(html.includes(`name="twitter:image:alt" content="${SOCIAL_CARD_ALT}"`));
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
  const robots = await readFile(join(directory, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, /Sitemap: https:\/\/catanova\.io\/sitemap\.xml\n$/);
  // Named, not merely covered by the wildcard: several of these are refused by
  // default elsewhere, and a site that wants to be quotable should say so.
  for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'])
    assert.match(robots, new RegExp(`User-agent: ${agent}\\nAllow: /`), agent);
  assert.ok(!/Disallow:/.test(robots));

  // The structured data says what the page says, and never more than it says.
  const data = (html: string) =>
    JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!) as {
      '@graph': Record<string, any>[];
    };
  const homeGraph = data(home)['@graph'];
  assert.deepEqual(
    homeGraph.map((node) => node['@type']),
    ['VideoGame'],
  );
  assert.equal(homeGraph[0]!.isAccessibleForFree, true);
  assert.equal(homeGraph[0]!.offers.price, '0');
  assert.deepEqual(homeGraph[0]!.numberOfPlayers, {
    '@type': 'QuantitativeValue',
    minValue: 2,
    maxValue: 4,
  });
  assert.match(homeGraph[0]!.disambiguatingDescription, /[Nn]ot affiliated with/);
  const guideGraph = data(guide)['@graph'];
  assert.deepEqual(
    guideGraph.map((node) => node['@type']),
    ['HowTo', 'FAQPage', 'VideoGame'],
  );
  // Every answer offered to a search engine is on the page a reader gets.
  const faq = guideGraph[1]!.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  assert.equal(faq.length, GUIDE_FAQ.length);
  for (const entry of faq) {
    assert.ok(guide.includes(entry.name), entry.name);
    assert.ok(guide.includes(entry.acceptedAnswer.text.replaceAll("'", '&#x27;')), entry.name);
  }

  const llms = await readFile(join(directory, 'llms.txt'), 'utf8');
  assert.match(llms, /^# Catanova\n/);
  assert.match(llms, /not a CATAN product/);
  assert.match(llms, /https:\/\/catanova\.io\/guide\//);
  for (const entry of GUIDE_FAQ) assert.ok(llms.includes(entry.answer), entry.question);
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
  const jpeg = await readFile(join(root, 'branding/social-card-v3.jpg'));
  assert.ok(jpeg.length < 220_000, 'the social preview must stay below 220,000 bytes');
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

test('every slide is a real, content-hashed file the art manifest knows about', async () => {
  // A background that 404s shows nothing and reports nothing: the layer simply
  // stays empty and the crossfade goes to blank. These URLs carry a hash of the
  // file, so a re-export moves them, and nothing else would catch that.
  const manifest = JSON.parse(await readFile('docs/art/runtime-art.json', 'utf8')) as {
    images: { url: string; bytes: number }[];
  };
  const byUrl = new Map(manifest.images.map((image) => [image.url, image]));
  let total = 0;
  for (const slide of TITLE_SLIDES) {
    const image = byUrl.get(slide.src);
    assert.ok(image, `${slide.src} is not in the art manifest`);
    const file = await readFile(join('apps/client/public', slide.src));
    assert.equal(file.length, image!.bytes, slide.src);
    assert.equal(file.subarray(8, 12).toString(), 'WEBP', slide.src);
    assert.ok(slide.alt.length > 20, `${slide.src} needs a real description`);
    total += file.length;
  }
  // The entry screen is the first thing anybody loads. Slides after the first
  // are fetched at low priority, but they are still bytes on somebody's phone.
  assert.ok(total < 1_200_000, `the slideshow weighs ${Math.round(total / 1024)}KB`);
});

test('the entry scenery crossfades every slide it is given, and rests on one', () => {
  // With a single picture there is nothing to fade between, so no layers and no
  // animation: the stylesheet's own background is the whole of it.
  const one = renderToStaticMarkup(createElement(TitleScenery));
  assert.ok(one.includes('class="title-scenery"'));
  if (TITLE_SLIDES.length < 2) {
    assert.ok(!one.includes('<style>'), 'one slide needs no keyframes');
    assert.ok(!one.includes('<i'), 'one slide needs no layers');
  }

  // Each slide holds for its turn and no longer. The window a layer is opaque
  // for is one nth of the cycle, which is why the keyframes are generated here
  // rather than written out in CSS: a slide added to the list would otherwise
  // leave every percentage in the stylesheet quietly wrong.
  for (const count of [2, 3, 4, 7]) {
    const cycle = count * SLIDE_HOLD_SECONDS;
    const frames = sceneryKeyframes(count);
    const stops = [...frames.matchAll(/([\d.]+)%\{opacity:(\d)\}/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    const opaque = stops.filter(([, value]) => value === 1).map(([at]) => at);
    assert.equal(opaque.length, 2, `${count} slides: expected one opaque window`);
    const held = ((opaque[1]! - opaque[0]!) / 100) * cycle;
    assert.ok(
      Math.abs(held - (SLIDE_HOLD_SECONDS - SLIDE_FADE_SECONDS)) < 0.01,
      `${count} slides: held opaque for ${held}s`,
    );
    // It starts and ends transparent, so layers stack without a seam.
    assert.ok(frames.startsWith('@keyframes title-scenery-slide{0%{opacity:0}'));
    assert.ok(frames.endsWith('100%{opacity:0}}'));
  }
});
