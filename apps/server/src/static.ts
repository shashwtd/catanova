import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ART_REDIRECTS } from './art-redirects.js';
import { isRoomReference, normalizeRoomReference } from '../../../packages/protocol/src/room-reference.js';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

type Encoding = 'br' | 'gzip' | 'identity';
const textAsset = /\.(?:html|js|css|svg|json|xml|txt|webmanifest)$/i;
const immutableArt = /^\/art\/optimized\/[a-z0-9][a-z0-9_-]*\.[a-f0-9]{12}\.webp$/;
const immutableAudio = /^\/audio\/(?:sfx|music)\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.[a-f0-9]{12}\.(?:wav|m4a)$/;

/** Prefer prebuilt encodings by client quality; implicit identity is a fallback. */
function encodings(header: string | undefined): Encoding[] {
  if (!header?.trim()) return ['identity'];
  const qualities = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [name = '', ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters
      .find((parameter) => parameter.trim().startsWith('q='))
      ?.trim()
      .slice(2);
    qualities.set(
      name.trim(),
      quality === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality) ? Number(quality) : 0,
    );
  }
  const wildcard = qualities.get('*');
  const candidates = (['br', 'gzip', 'identity'] as const).map((encoding) => ({
    encoding,
    quality:
      encoding === 'identity'
        ? (qualities.get('identity') ?? (wildcard === 0 ? 0 : -1))
        : (qualities.get(encoding) ?? wildcard ?? 0),
  }));
  return candidates
    .filter(({ quality }) => quality !== 0)
    .sort((a, b) => b.quality - a.quality)
    .map(({ encoding }) => encoding);
}

function matchesETag(header: string | undefined, etag: string) {
  return header?.split(',').some((tag) => {
    const candidate = tag.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
}

/** Same-origin distribution. Only the built client directory is ever exposed. */
export async function serveClient(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
  authOrigin?: string,
  captchaEnabled = false,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  let path: string;
  let search = '';
  let privateEntry = false;
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    path = decodeURIComponent(url.pathname);
    search = url.search;
    privateEntry = path === '/auth/callback' || /^\/room\//i.test(path) || url.searchParams.has('room');
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (privateEntry) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (path === '/guide' || path === '/index.html' || path === '/guide/index.html') {
    response.writeHead(308, { Location: `${path === '/index.html' ? '/' : '/guide/'}${search}` }).end();
    return;
  }
  // Internal app shell keeps invite/OAuth entry free of a misleading home-menu flash.
  if (path === '/app.html' || /\.(?:br|gz)$/i.test(path)) {
    response.writeHead(404).end();
    return;
  }
  // Older open tabs retain PNG references; redirect without exposing source masters.
  const artRedirect = ART_REDIRECTS[path];
  if (artRedirect) {
    response.writeHead(307, { Location: artRedirect, 'Cache-Control': 'no-cache' }).end();
    return;
  }
  const roomReference = /^\/room\/([^/]+)\/?$/i.exec(path)?.[1];
  const isAppRoute =
    path === '/' ||
    path === '/auth/callback' ||
    (!!roomReference && isRoomReference(normalizeRoomReference(roomReference)));
  const assetPath = isAppRoute
    ? privateEntry
      ? '/app.html'
      : '/index.html'
    : path === '/guide/'
      ? '/guide/index.html'
      : path;
  const root = resolve(directory),
    file = resolve(root, `.${assetPath}`);
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    let servedFile = file;
    let servedInfo = info;
    let encoding: Encoding = 'identity';
    if (textAsset.test(file)) {
      response.setHeader('Vary', 'Accept-Encoding');
      let acceptable = false;
      for (const candidate of encodings(request.headers['accept-encoding'])) {
        if (candidate === 'identity') {
          acceptable = true;
          break;
        }
        const variant = `${file}.${candidate === 'br' ? 'br' : 'gz'}`;
        const variantInfo = await stat(variant).catch(() => null);
        // A manually updated source must never serve an older compressed copy.
        if (variantInfo?.isFile() && variantInfo.mtimeMs >= info.mtimeMs) {
          servedFile = variant;
          servedInfo = variantInfo;
          encoding = candidate;
          acceptable = true;
          break;
        }
      }
      if (!acceptable) {
        response.writeHead(406, { 'Cache-Control': 'no-cache' }).end();
        return;
      }
    }
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Content-Length', servedInfo.size);
    if (encoding !== 'identity') response.setHeader('Content-Encoding', encoding);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'${captchaEnabled ? ' https://challenges.cloudflare.com' : ''};${captchaEnabled ? ' frame-src https://challenges.cloudflare.com;' : ''} style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:${authOrigin ? ' ' + new URL(authOrigin).origin : ''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    );
    response.setHeader(
      'Cache-Control',
      path.startsWith('/assets/') || immutableArt.test(path) || immutableAudio.test(path)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    const etag = `W/"${servedInfo.size.toString(16)}-${servedInfo.mtimeMs.toString(16)}-${encoding}"`;
    response.setHeader('ETag', etag);
    if (matchesETag(request.headers['if-none-match'], etag)) {
      response.removeHeader('Content-Length');
      response.writeHead(304).end();
      return;
    }
    response.writeHead(200);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(servedFile);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch {
    response.writeHead(404).end('{"error":"not_found"}');
  }
}
