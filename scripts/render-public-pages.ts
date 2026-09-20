import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ANALYTICS_LOADER_PATH,
  GTM_CONTAINER,
  analyticsHead,
  analyticsLoader,
  analyticsNoscript,
} from '../apps/client/src/analytics.js';
import {
  PublicGuide,
  PublicLanding,
  PublicMetadata,
  PublicArtPreloads,
  GUIDE_FAQ,
  PUBLIC_PAGES,
  REPOSITORY_URL,
  SITE_URL,
} from '../apps/client/src/PublicPages.js';

/**
 * Crawlers, named rather than assumed.
 *
 * `User-agent: *` already lets everything in, so nothing here changes what is
 * allowed. It is written out because several of these crawlers are refused by
 * default on a lot of sites, and a site that wants to be quotable is better
 * off saying so plainly than leaving it to be inferred from a wildcard.
 */
const CRAWLERS = [
  'Googlebot',
  'Bingbot',
  'DuckDuckBot',
  'Google-Extended',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Applebot',
  'Applebot-Extended',
];

/**
 * A plain-text summary for the assistants people ask instead of searching.
 *
 * Written to be quoted: short sentences, the facts a person would want before
 * they click, and the one thing we would hate to be got wrong repeated where
 * it cannot be missed — that this is not an official CATAN game.
 */
function llmsText() {
  return `# Catanova

> ${PUBLIC_PAGES[0].description}

Catanova is a free, open-source, browser-based island trading and building game
for two to four friends. It is independent and unofficial: it is inspired by
Catan, it is not a CATAN product, and it is not affiliated with or endorsed by
the owners of that trademark.

## The short version

- Free to play, with nothing to buy and nothing held back.
- Two to four players, in a private room you share by code or link.
- Runs in any modern browser on a phone, tablet or computer. Nothing to install.
- You can start as a guest; an account is only needed to add friends.
- Bots can fill an empty seat, and cover a seat if somebody loses connection.
- Source code and rulebook: ${REPOSITORY_URL}

## How a game goes

Each player places two settlements and two roads, then turns begin. Roll two
dice, collect what your settlements and cities produce on that number, then
build roads, settlements and cities, buy development cards, or trade with
another player or the bank. Rolling a seven moves the robber and makes anyone
holding more than seven cards discard half. Ten victory points on your own turn
wins: one for a settlement, two for a city, two for the longest road, two for
the largest army, and one for each victory point card in hand.

## Questions people ask

${GUIDE_FAQ.map((entry) => `### ${entry.question}\n\n${entry.answer}`).join('\n\n')}

## Pages

${PUBLIC_PAGES.map((page) => `- [${page.title}](${SITE_URL}${page.path}): ${page.description}`).join('\n')}
- [Rulebook](${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md): the complete rules, as the code enforces them.
`;
}

export async function renderPublicPages(directory: string) {
  const template = await readFile(join(directory, 'index.html'), 'utf8');
  if (
    !template.includes('<!-- public-metadata -->') ||
    !template.includes('<div id="root"></div>') ||
    !template.includes('<!-- analytics -->')
  )
    throw new Error('Expected the fresh Vite entry template before rendering public pages');
  const metadata = (index: 0 | 1) =>
    renderToStaticMarkup(createElement(PublicMetadata, { page: PUBLIC_PAGES[index] }));
  /**
   * Measurement goes on the pages the public arrives at, and nowhere else.
   *
   * `app.html` is what a room address and the sign-in callback are served,
   * so somebody opening an invite link never loads a tag at all. Somebody who
   * starts at the front door and creates a room has already loaded it, which
   * is why the snippet redacts the address rather than relying on this.
   */
  const container = process.env.GTM_ID ?? GTM_CONTAINER;
  const measuring = container !== 'off';
  const measured = measuring ? { head: analyticsHead(), body: analyticsNoscript(container) } : { head: '', body: '' };
  if (measuring)
    await writeFile(join(directory, ANALYTICS_LOADER_PATH.slice(1)), analyticsLoader(container));
  const app = template
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace('<!-- public-metadata -->', metadata(0))
    .replace('<!-- analytics -->', '')
    .replace('<!-- analytics-noscript -->', '');
  const artPreloads = renderToStaticMarkup(createElement(PublicArtPreloads));
  // Keep room entry and OAuth callback free of the public home-menu prerender.
  await writeFile(join(directory, 'app.html'), app);
  await writeFile(
    join(directory, 'index.html'),
    app
      .replace('</head>', `${artPreloads}</head>`)
      .replace('</head>', `${measured.head}</head>`)
      .replace('<body>', `<body>${measured.body}`)
      .replace(
        '<div id="root"></div>',
        `<div id="root">${renderToStaticMarkup(createElement(PublicLanding))}</div>`,
      ),
  );
  await mkdir(join(directory, 'guide'), { recursive: true });
  await writeFile(
    join(directory, 'guide', 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#123d43">${measured.head}${metadata(1)}${artPreloads}<link rel="stylesheet" href="/guide/guide.css"></head>
<body>${measured.body}${renderToStaticMarkup(createElement(PublicGuide))}</body></html>\n`,
  );
  await writeFile(
    join(directory, 'robots.txt'),
    `${['*', ...CRAWLERS].map((agent) => `User-agent: ${agent}\nAllow: /\n`).join('\n')}\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
  await writeFile(join(directory, 'llms.txt'), llmsText());
  await writeFile(
    join(directory, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PUBLIC_PAGES.map((page) => `<url><loc>${SITE_URL}${page.path}</loc></url>`).join('')}</urlset>\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await renderPublicPages(resolve('dist/client'));
  console.info('Rendered public landing, guide and search discovery files.');
}
