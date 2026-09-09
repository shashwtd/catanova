import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
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
  try {
    path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const root = resolve(directory),
    file = resolve(
      root,
      `.${path === '/' || path === '/auth/callback' || /^\/room\/[A-Z2-9]{8}\/?$/i.test(path) ? '/index.html' : path}`,
    );
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
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Content-Length', info.size);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'${captchaEnabled ? ' https://challenges.cloudflare.com' : ''};${captchaEnabled ? ' frame-src https://challenges.cloudflare.com;' : ''} style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' ws: wss:${authOrigin ? ' ' + new URL(authOrigin).origin : ''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    );
    response.setHeader(
      'Cache-Control',
      path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    response.setHeader('ETag', etag);
    if (
      request.headers['if-none-match']
        ?.split(',')
        .map((tag) => tag.trim())
        .includes(etag)
    ) {
      response.removeHeader('Content-Length');
      response.writeHead(304).end();
      return;
    }
    response.writeHead(200);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch {
    response.writeHead(404).end('{"error":"not_found"}');
  }
}
