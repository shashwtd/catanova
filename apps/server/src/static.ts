import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
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

/**
 * The host the browser asked for, when it is safe to repeat inside a header.
 *
 * It is the address the page's socket connects to (`location.host`), and the
 * same value the WebSocket upgrade compares Origin against. Only a DNS name or
 * an IPv4 address with an optional port qualifies, so nothing sent in the
 * header can add a directive to the policy; anything else gets no host at all.
 */
function requestHost(request: IncomingMessage): string | undefined {
  const host = request.headers.host?.toLowerCase();
  return host && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/.test(host) ? host : undefined;
}

/** HTTPS as the browser saw it: TLS on this socket, or the scheme Caddy forwards in front of it. */
function secureRequest(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-proto'];
  const scheme = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim().toLowerCase();
  return (request.socket as Partial<TLSSocket>).encrypted === true || scheme === 'https';
}

/**
 * Loopback names and bare addresses never get HSTS. A browser that pinned
 * `localhost` to HTTPS for a year would refuse plain-http local play on every
 * port, and HSTS is ignored for IP addresses anyway.
 */
function localHost(host: string) {
  const name = host.replace(/:\d+$/, '');
  return name === 'localhost' || name.endsWith('.localhost') || /^[\d.]+$/.test(name);
}

/** Pre-rendered public pages kept as a directory index; each has one canonical address. */
const PAGE_DIRECTORIES = ['/guide/', '/privacy/'];

/** Same-origin distribution. Only the built client directory is ever exposed. */
/** Off when the site was built with `GA_MEASUREMENT_ID=off`, so the policy matches the pages. */
const analyticsEnabled = process.env.GA_MEASUREMENT_ID !== 'off';

export async function serveClient(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
  authOrigin?: string,
  captchaEnabled = false,
) {
  const host = requestHost(request);
  const secure = secureRequest(request);
  // Only for requests that arrived over HTTPS (Caddy in production). Browsers
  // ignore the header on a plain-http response in any case.
  if (secure && host && !localHost(host))
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
    privateEntry =
      path === '/play' ||
      path === '/auth/callback' ||
      /^\/room\//i.test(path) ||
      url.searchParams.has('room');
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (privateEntry) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const canonicalPage =
    path === '/index.html'
      ? '/'
      : PAGE_DIRECTORIES.find((page) => path === page.slice(0, -1) || path === `${page}index.html`);
  if (canonicalPage) {
    response.writeHead(308, { Location: `${canonicalPage}${search}` }).end();
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
    path === '/play' ||
    path === '/auth/callback' ||
    (!!roomReference && isRoomReference(normalizeRoomReference(roomReference)));
  const assetPath = isAppRoute
    ? privateEntry
      ? '/app.html'
      : '/index.html'
    : PAGE_DIRECTORIES.includes(path)
      ? `${path}index.html`
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
    /**
     * The policy has to name the tag manager or nothing measures anything.
     *
     * A blocked tag fails silently: the console shows a violation, the report
     * shows no traffic, and the two are easy not to connect. Our own loader is
     * a file on this origin, so `'self'` still covers it and inline script
     * stays refused everywhere. A Custom HTML tag added in the tag manager
     * later will be blocked by that, which is the tradeoff and is deliberate.
     */
    const analyticsSources = analyticsEnabled
      ? {
          script: ' https://www.googletagmanager.com',
          frame: '',
          img: ' https://www.googletagmanager.com https://www.google-analytics.com',
          connect:
            ' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com',
        }
      : { script: '', frame: '', img: '', connect: '' };
    const frameSources = `${captchaEnabled ? ' https://challenges.cloudflare.com' : ''}${analyticsSources.frame}`;
    /**
     * The game's socket, and no other.
     *
     * The client opens exactly one socket, to `location.host`. CSP3 lets
     * `'self'` cover same-host ws:/wss:, but WebKit only matched it from April
     * 2022 (Safari 15.4 and older block it), so the socket's own origin is
     * named as well. `ws:` and `wss:` used to allow a socket to any host.
     */
    const socketSource = host ? ` ${secure ? 'wss' : 'ws'}://${host}` : '';
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'${captchaEnabled ? ' https://challenges.cloudflare.com' : ''}${analyticsSources.script};${frameSources ? ` frame-src${frameSources};` : ''} style-src 'self' 'unsafe-inline'; img-src 'self' data:${analyticsSources.img}; connect-src 'self'${socketSource}${captchaEnabled ? ' https://challenges.cloudflare.com' : ''}${authOrigin ? ' ' + new URL(authOrigin).origin : ''}${analyticsSources.connect}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
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
