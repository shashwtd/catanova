import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderPublicPages } from '../scripts/render-public-pages.js';
import { LandingFeatures } from '../apps/client/src/LandingFeatures.js';
import { HOME_TITLE } from '../apps/client/src/game-attention.js';
import { REACTIONS, REACTION_LIST } from '../packages/protocol/src/reactions.js';
import { publicPath } from '../apps/client/src/analytics.js';
import { DEFAULT_ROOM_SETTINGS, DEFAULT_TURN_TIMER_SECONDS } from '../packages/protocol/src/settings.js';
import {
  GUIDE_FAQ,
  GUIDE_SECTIONS,
  PRIVACY_CONTACT,
  PRIVACY_UPDATED,
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
  const privacy = await readFile(join(directory, 'privacy', 'index.html'), 'utf8');
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
  // Measurement belongs on the pages the public arrives at. A room address and
  // the sign-in callback are served app.html, so opening an invitation loads
  // no tag at all, and a room code cannot reach a third party that way.
  for (const marker of ['analytics.js']) {
    assert.ok(!shell.includes(marker), `app.html must stay clear of ${marker}`);
    for (const page of [home, guide, privacy]) assert.ok(page.includes(marker), marker);
  }
  const loader = await readFile(join(directory, 'analytics.js'), 'utf8');
  assert.ok(loader.includes('G-NGHVNKN7FZ'), 'the loader names its GA4 property');
  assert.ok(!loader.includes('gtm.js') && !home.includes('ns.html'), 'the old GTM container is removed');
  assert.ok(loader.includes('page_path'), 'and redacts before the container loads');
  // Every private prefix collapses to one page name, so a report can say how
  // many people reached a room without saying which room.
  assert.equal(publicPath('/room/D53W'), '/room');
  assert.equal(publicPath('/room/D53W?invite=ABCD'), '/room');
  assert.equal(publicPath('/join/9XYZ'), '/join');
  assert.equal(publicPath('/auth/callback#access_token=secret'), '/auth');
  assert.equal(publicPath('/guide/'), '/guide/');
  assert.equal(publicPath('/'), '/');
  // A prefix must match a whole segment: /rooms is not /room.
  assert.equal(publicPath('/rooms-we-like'), '/rooms-we-like');
  assert.match(home, /rel="preload" as="image" type="image\/webp"/);
  assert.match(guide, /rel="preload" as="image" type="image\/webp"/);
  // A preload for a URL that does not exist is worse than no preload: it costs
  // a request, warms nothing, and fails where nobody is looking. These URLs
  // carry a content hash, so a re-export moves the file and leaves the page
  // pointing at the old one, which is exactly how the logo preload broke.
  for (const page of [home, guide, privacy])
    for (const match of page.matchAll(/(?:href|src)="(\/art\/[^"]+)"/g))
      await readFile(join('apps/client/public', match[1]!)).catch(() => {
        throw new Error(`${match[1]} is referenced but not on disk`);
      });
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
  // The room settings table states the defaults a new room is actually created with.
  const dice = DEFAULT_ROOM_SETTINGS.diceMode === 'classic' ? 'Natural' : 'Balanced';
  assert.ok(guide.includes(`Natural or balanced dice</th><td>${dice}</td>`), `dice default is ${dice}`);
  // New rooms start with the slider's own default from 23 September 2026 (the
  // change to settings.ts itself lands separately); existing rooms keep theirs.
  assert.equal(DEFAULT_TURN_TIMER_SECONDS, 90);
  assert.ok(guide.includes(`Turn timer</th><td>${DEFAULT_TURN_TIMER_SECONDS} seconds</td>`));
  assert.ok(!guide.includes('leave it off'), 'the timer is no longer off by default');
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
  // The guide draws every reaction with the same code the game draws them with,
  // so a set that grows cannot leave the page showing a face nobody can send,
  // or a name for one that no longer exists.
  assert.equal((guide.match(/class="guide-reaction-face"/g) ?? []).length, REACTION_LIST.length);
  for (const name of REACTION_LIST) assert.ok(guide.includes(REACTIONS[name].label), name);
  assert.ok(!/\p{Extended_Pictographic}/u.test(guide), 'the guide draws its faces, it does not borrow them');

  // A link that leaves the site opens beside the page, never over it: somebody
  // halfway down a rules page should not lose their place to read the rulebook.
  for (const match of guide.matchAll(/<a ([^>]*href="https?:[^"]*"[^>]*)>/g)) {
    const attributes = match[1]!;
    assert.match(attributes, /target="_blank"/, attributes);
    assert.match(attributes, /rel="[^"]*noopener/, attributes);
  }
  // And a link that stays on the site does not, because that would strand the
  // reader in a second tab of the same site.
  for (const match of guide.matchAll(/<a ([^>]*href="[/#][^"]*"[^>]*)>/g))
    assert.doesNotMatch(match[1]!, /target="_blank"/, match[1]!);

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
  // The guide ships no code of its own: one script of data, and the loader that
  // starts measurement, which is a file on this origin rather than inline.
  assert.deepEqual(
    [...guide.matchAll(/<script([^>]*)>/g)].map((m) => m[1]!.trim()),
    ['src="/analytics.js" async', 'type="application/ld+json"'],
  );
  assert.ok(!guide.includes('/src/main.tsx'));
  for (const html of [home, guide, privacy]) {
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
  assert.ok(privacy.includes('rel="canonical" href="https://catanova.io/privacy/"'));
  const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]),
    ['https://catanova.io/', 'https://catanova.io/guide/', 'https://catanova.io/privacy/'],
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

test('the privacy page is linked from the public pages and says what is kept without listing the stack', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-privacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), await readFile('apps/client/index.html', 'utf8'));
  await renderPublicPages(directory);
  const home = await readFile(join(directory, 'index.html'), 'utf8');
  const guide = await readFile(join(directory, 'guide', 'index.html'), 'utf8');
  const privacy = await readFile(join(directory, 'privacy', 'index.html'), 'utf8');
  // The landing footer and the guide link here; the banner's link is covered with the loader.
  assert.ok(home.includes('<a href="/privacy/">Privacy</a>'));
  assert.ok(guide.includes('<a href="/privacy/">Privacy</a>'));
  assert.ok(privacy.includes(`<title>${PUBLIC_PAGES[2].title}</title>`));
  assert.equal(PRIVACY_UPDATED.text, '23 September 2026');
  assert.ok(privacy.includes(`Last updated: ${PRIVACY_UPDATED.text}`));
  assert.ok(privacy.includes('<link rel="stylesheet" href="/guide/guide.css">'));
  // Like the guide it ships no code of its own; the measurement loader wires the control up.
  assert.deepEqual(
    [...privacy.matchAll(/<script([^>]*)>/g)].map((m) => m[1]!.trim()),
    ['src="/analytics.js" async', 'type="application/ld+json"'],
  );
  // Without that loader the buttons would do nothing, so they start hidden.
  assert.match(privacy, /<div class="privacy-choice" data-consent-control="" hidden="">/);
  for (const state of ['unset', 'granted', 'denied'])
    assert.ok(privacy.includes(`data-consent-state="${state}"`), state);
  for (const choice of ['granted', 'denied']) assert.ok(privacy.includes(`data-consent-choice="${choice}"`));
  // Services are described by what they do; only Google, which visitors meet directly, is named.
  for (const name of ['Supabase', 'Azure', 'Central India', 'Turnstile', 'TypeSafe', 'SQLite', 'Cloudflare'])
    assert.ok(!privacy.includes(name), `the privacy page names ${name}`);
  for (const role of ['Hosting', 'Sign-in and accounts', 'Guest check', 'Bot moves', 'Google Analytics'])
    assert.ok(privacy.includes(role), role);
  assert.ok(privacy.includes('not your name or email'));
  // Claims that name something elsewhere in the repository must still match it.
  assert.ok(privacy.includes('seven days without activity'));
  assert.match(
    await readFile('supabase/schema.sql', 'utf8'),
    /last_active_at <= now\(\) - interval '7 days'/,
  );
  assert.ok(privacy.includes('Show when you were last online'));
  assert.ok(
    (await readFile('apps/client/src/GameSettings.tsx', 'utf8')).includes('Show when you were last online'),
    'the page names the switch Settings actually shows',
  );
  // The owner's general address, forwarded to their inbox, so no personal address is published.
  assert.ok(privacy.includes(`<a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>`));
  for (const match of privacy.matchAll(/<a ([^>]*href="https?:[^"]*"[^>]*)>/g)) {
    assert.match(match[1]!, /target="_blank"/, match[1]!);
    assert.match(match[1]!, /rel="[^"]*noopener/, match[1]!);
  }
  for (const match of privacy.matchAll(/href="#([^"]+)"/g)) assert.ok(privacy.includes(`id="${match[1]}"`));
  const graph = JSON.parse(privacy.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)[
    '@graph'
  ] as Record<string, string>[];
  assert.deepEqual(
    graph.map((node) => node['@type']),
    ['WebPage'],
  );
  assert.equal(graph[0]!.dateModified, PRIVACY_UPDATED.iso);
});

/** Width and height from a WebP header: the extended (VP8X) or simple lossy (VP8) layout. */
function webpSize(data: Buffer): [number, number] {
  assert.equal(data.subarray(0, 4).toString(), 'RIFF');
  assert.equal(data.subarray(8, 12).toString(), 'WEBP');
  const chunk = data.subarray(12, 16).toString();
  if (chunk === 'VP8X') return [data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1];
  assert.equal(chunk, 'VP8 ', `unexpected WebP chunk ${chunk}`);
  return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
}

test('the landing shows its six small pictures from small lazy files, never the full atlases', async () => {
  const html = renderToStaticMarkup(createElement(LandingFeatures, { onPlay: () => {} }));
  // An inline SVG <image> downloads eagerly and these atlases are 860 KB
  // between them; four faces and two resources are not worth that on a first visit.
  assert.ok(!html.includes('avatars-fantasy') && !html.includes('sprites-fantasy'));
  const thumbnails = [...html.matchAll(/<img ([^>]*src="\/art\/optimized\/landing-[^"]+"[^>]*)\/>/g)].map(
    (match) => match[1]!,
  );
  assert.equal(thumbnails.length, 6, 'four avatars and two resources');
  for (const attributes of thumbnails) {
    const attribute = (name: string) => new RegExp(` ?${name}="([^"]*)"`).exec(attributes)?.[1];
    const src = attribute('src')!;
    assert.equal(attribute('loading'), 'lazy', src);
    assert.equal(attribute('decoding'), 'async', src);
    assert.ok(attribute('alt'), `${src} is described`);
    const match = /^\/art\/optimized\/[a-z0-9-]+\.([a-f0-9]{12})\.webp$/.exec(src);
    assert.ok(match, `${src} is content-hashed like the other optimized art`);
    const data = await readFile(join('apps/client/public', src));
    assert.equal(createHash('sha256').update(data).digest('hex').slice(0, 12), match[1], src);
    assert.deepEqual(webpSize(data), [Number(attribute('width')), Number(attribute('height'))], src);
    assert.ok(data.length < 12_000, `${src} is ${data.length} bytes`);
  }
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
