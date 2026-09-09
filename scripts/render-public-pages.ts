import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PublicGuide,
  PublicLanding,
  PublicMetadata,
  PUBLIC_PAGES,
  SITE_URL,
} from '../apps/client/src/PublicPages.js';

export async function renderPublicPages(directory: string) {
  const template = await readFile(join(directory, 'index.html'), 'utf8');
  if (!template.includes('<!-- public-metadata -->') || !template.includes('<div id="root"></div>'))
    throw new Error('Expected the fresh Vite entry template before rendering public pages');
  const metadata = (index: 0 | 1) =>
    renderToStaticMarkup(createElement(PublicMetadata, { page: PUBLIC_PAGES[index] }));
  const app = template
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace('<!-- public-metadata -->', metadata(0));
  // Keep room entry and OAuth callback free of the public home-menu prerender.
  await writeFile(join(directory, 'app.html'), app);
  await writeFile(
    join(directory, 'index.html'),
    app.replace(
      '<div id="root"></div>',
      `<div id="root">${renderToStaticMarkup(createElement(PublicLanding))}</div>`,
    ),
  );
  await mkdir(join(directory, 'guide'), { recursive: true });
  await writeFile(
    join(directory, 'guide', 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#123d43">${metadata(1)}<link rel="stylesheet" href="/guide/guide.css"></head>
<body>${renderToStaticMarkup(createElement(PublicGuide))}</body></html>\n`,
  );
  await writeFile(
    join(directory, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
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
