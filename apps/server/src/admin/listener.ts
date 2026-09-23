/**
 * The admin listener: a second HTTP server inside the game process.
 *
 * It shares the game's Store and live socket state but nothing else. The public
 * server never routes here, and this server never serves the game. Production
 * binds it to the private Compose network, where only the Cloudflare Tunnel
 * connector reaches it; no port is published on the VM.
 *
 * Every request, whether for the page, a script or the API, runs the same
 * gauntlet, in this order:
 *
 *   1. security headers are set, so even a refusal carries them;
 *   2. the caller is authenticated: a verified Cloudflare Access token with an
 *      allowlisted email, or, in local development, a loopback Host header;
 *   3. a per-actor rate limit;
 *   4. API calls need our custom header and a same-origin fetch; changes also
 *      need POST, JSON, and an Origin equal to ADMIN_ORIGIN;
 *   5. only then is anything read or changed.
 *
 * Changes and their audit rows commit in one transaction.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Store } from '../store.js';
import { ProtocolError } from '../store.js';
import { RoomAccessLimit } from '../room-access.js';
import type { AdminConfig } from './config.js';
import { isLoopbackHost } from './config.js';
import { AdminAuthError, createAccessVerifier } from './access.js';
import type { AccessVerifier } from './access.js';
import { AdminAudit } from './audit.js';
import type { AuditInput } from './audit.js';
import { captureConsoleErrors, serverErrors } from './errors.js';
import { loadAdminAssets } from './assets.js';
import type { AdminAsset } from './assets.js';
import type { AdminSession, AuthRejection } from './types.js';

export const ADMIN_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
export const ADMIN_BODY_LIMIT = 16 * 1024;
/** Reads per actor per minute: page loads, a 10-second overview refresh and plenty of browsing. */
export const ADMIN_READS_PER_MINUTE = 240;
/** Changes per actor per minute. Ending games and resolving feedback are deliberate, one at a time. */
export const ADMIN_WRITES_PER_MINUTE = 20;

/** What the game server exposes to the admin listener: live socket counts and a way to push a room. */
export type GameRuntime = {
  sockets(): { total: number; players: number; spectators: number; seats: string[] };
  broadcast(roomId: string): void;
};

export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export type ApiRequest = {
  actor: string;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Written into audit rows. */
  audit: (entry: Omit<AuditInput, 'at' | 'actor' | 'ip' | 'requestId'>) => number;
  requestId: string;
  ip: string | null;
  ray: string | null;
};

export type ApiRoute = {
  method: 'GET' | 'POST';
  path: RegExp;
  handle: (request: ApiRequest) => unknown;
};

export type AdminContext = {
  config: AdminConfig;
  store: Store;
  runtime: GameRuntime;
  audit: AdminAudit;
  databasePath: string;
  now: () => number;
  rejections: () => AuthRejection[];
};

export type AdminServerOptions = {
  config: AdminConfig;
  store: Store;
  runtime: GameRuntime;
  databasePath: string;
  /** The Vite build of apps/admin. */
  assetsDirectory?: string;
  /** Tests inject a verifier pointed at their own key server. */
  verifier?: AccessVerifier;
  now?: () => number;
  /** Where refusals are logged; the container log by default. */
  log?: (line: string) => void;
  /** Extra API routes, added by the feature modules. */
  routes?: (context: AdminContext) => ApiRoute[];
};

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function secure(response: ServerResponse, requestId: string, https: boolean) {
  response.setHeader('Content-Security-Policy', ADMIN_CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  );
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Request-Id', requestId);
  if (https) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response: ServerResponse, status: number, code: string, message?: string) {
  sendJson(response, status, { error: { code, message: message ?? code } });
}

function sendText(response: ServerResponse, status: number, text: string) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = header(request, 'content-length');
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > ADMIN_BODY_LIMIT))
    throw new AdminRequestError(413, 'BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > ADMIN_BODY_LIMIT) throw new AdminRequestError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AdminRequestError(400, 'INVALID_JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AdminRequestError(400, 'INVALID_BODY', 'The request body must be a JSON object');
  return value as Record<string, unknown>;
}

const PROTOCOL_STATUS: Record<string, number> = {
  ROOM_NOT_FOUND: 404,
  NOT_STARTED: 409,
  GAME_FINISHED: 409,
  STATE_INTEGRITY: 409,
  VERSION_MISMATCH: 409,
};

export async function startAdminServer(options: AdminServerOptions) {
  const { config, store, runtime } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  const verify =
    options.verifier ??
    (config.auth.mode === 'cloudflare-access'
      ? createAccessVerifier({
          teamDomain: config.auth.teamDomain,
          audience: config.auth.audience,
          emails: config.auth.emails,
        })
      : undefined);
  if (config.auth.mode === 'cloudflare-access' && !verify) throw new Error('Admin verification is required');
  const assets = loadAdminAssets(options.assetsDirectory ?? 'dist/admin');
  const audit = new AdminAudit(store.db);
  const reads = new RoomAccessLimit(ADMIN_READS_PER_MINUTE, 60_000, 256);
  const writes = new RoomAccessLimit(ADMIN_WRITES_PER_MINUTE, 60_000, 256);
  const rejected: AuthRejection[] = [];
  let loggedRejections = 0,
    rejectionLogWindow = 0;
  const context: AdminContext = {
    config,
    store,
    runtime,
    audit,
    databasePath: options.databasePath,
    now,
    rejections: () => [...rejected].reverse(),
  };
  const routes: ApiRoute[] = [
    {
      method: 'GET',
      path: /^\/api\/admin\/session$/,
      handle: ({ actor }): AdminSession => ({ actor, mode: config.auth.mode, revision: config.revision }),
    },
    {
      method: 'GET',
      path: /^\/api\/admin\/audit$/,
      handle: ({ query }) => {
        const before = query.get('before');
        if (before !== null && !/^\d{1,15}$/.test(before)) throw new AdminRequestError(400, 'INVALID_CURSOR');
        const target = query.get('target');
        return audit.list({
          ...(before ? { before: Number(before) } : {}),
          ...(target ? { target: target.slice(0, 200) } : {}),
        });
      },
    },
    ...(options.routes?.(context) ?? []),
  ];

  function clientIp(request: IncomingMessage): string | null {
    // Cloudflare's view of the visitor. Only meaningful behind Access, where it is
    // set by Cloudflare's edge; locally it is the socket peer.
    const forwarded =
      config.auth.mode === 'cloudflare-access' ? header(request, 'cf-connecting-ip') : undefined;
    if (forwarded && isIP(forwarded)) return forwarded;
    return request.socket.remoteAddress ?? null;
  }

  function reject(request: IncomingMessage, response: ServerResponse, status: number, reason: string) {
    rejected.push({
      at: now(),
      status,
      reason,
      ip: clientIp(request),
      path: (request.url ?? '').slice(0, 200),
    });
    if (rejected.length > 50) rejected.shift();
    // Keep a trace in the container log without letting a flood fill it.
    if (now() - rejectionLogWindow > 60_000) {
      rejectionLogWindow = now();
      loggedRejections = 0;
    }
    if (++loggedRejections <= 10)
      log(JSON.stringify({ event: 'admin_rejected', status, reason, ip: clientIp(request) }));
    response.setHeader('Connection', 'close');
    sendText(
      response,
      status,
      status === 503 ? 'Service unavailable' : status === 403 ? 'Forbidden' : 'Unauthorized',
    );
  }

  async function authenticate(request: IncomingMessage): Promise<string> {
    if (config.auth.mode === 'local-dev') {
      // No token in development, so refuse any Host that is not this machine:
      // a DNS-rebinding page elsewhere cannot borrow the loopback listener.
      let hostname = '';
      try {
        hostname = new URL(`http://${header(request, 'host') ?? ''}`).hostname;
      } catch {
        hostname = '';
      }
      if (!hostname || !isLoopbackHost(hostname)) throw new AdminAuthError(403, 'HOST_NOT_LOOPBACK');
      return 'local-dev';
    }
    return (await verify!(header(request, 'cf-access-jwt-assertion'))).email;
  }

  function serveAsset(request: IncomingMessage, response: ServerResponse, path: string) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }
    if (!assets) {
      sendText(response, 503, 'The admin interface has not been built. Run npm run build.');
      return;
    }
    const asset: AdminAsset | undefined = assets.get(path);
    if (!asset) {
      sendText(response, 404, 'Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  }

  async function serveApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    actor: string,
    requestId: string,
  ) {
    // A cross-site page can neither add this header nor read our answers; both
    // are needed before any API does anything, reads included.
    if (header(request, 'x-catanova-admin') !== '1')
      return sendError(response, 403, 'ADMIN_HEADER_REQUIRED', 'Missing X-Catanova-Admin header');
    const site = header(request, 'sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') return sendError(response, 403, 'CROSS_SITE_REQUEST');
    const origin = header(request, 'origin');
    const matching = routes.filter((route) => route.path.test(url.pathname));
    const route = matching.find((candidate) => candidate.method === request.method);
    if (!route) {
      if (matching.length) {
        response.setHeader('Allow', [...new Set(matching.map((candidate) => candidate.method))].join(', '));
        return sendError(response, 405, 'METHOD_NOT_ALLOWED');
      }
      return sendError(response, 404, 'NOT_FOUND');
    }
    let body: Record<string, unknown> = {};
    if (route.method === 'POST') {
      if (origin !== config.origin) return sendError(response, 403, 'BAD_ORIGIN');
      const type = header(request, 'content-type') ?? '';
      if (!/^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i.test(type))
        return sendError(response, 415, 'JSON_REQUIRED');
      const limit = writes.consume(actor, now());
      if (!limit.allowed) {
        response.setHeader('Retry-After', String(limit.retryAfter));
        return sendError(response, 429, 'RATE_LIMITED');
      }
      body = await readBody(request);
    } else if (origin !== undefined && origin !== config.origin)
      return sendError(response, 403, 'BAD_ORIGIN');
    const params = route.path.exec(url.pathname)!.slice(1);
    const ip = clientIp(request);
    const rayHeader = header(request, 'cf-ray');
    const ray = rayHeader && /^[0-9a-f]{16}-[A-Z]{3}$/i.test(rayHeader) ? rayHeader : null;
    const result = await route.handle({
      actor,
      params,
      query: url.searchParams,
      body,
      requestId,
      ip,
      ray,
      audit: (entry) =>
        audit.record({
          ...entry,
          detail: { ...entry.detail, ...(ray ? { ray } : {}) },
          at: now(),
          actor,
          ip,
          requestId,
        }),
    });
    sendJson(response, 200, result);
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const requestId = randomUUID();
    secure(response, requestId, config.auth.mode === 'cloudflare-access');
    const target = request.url ?? '';
    // Origin-form targets only: no absolute URLs, no protocol-relative paths.
    if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\'))
      return sendText(response, 400, 'Bad request');
    let url: URL;
    try {
      url = new URL(target, 'http://admin.invalid');
    } catch {
      return sendText(response, 400, 'Bad request');
    }
    let actor: string;
    try {
      actor = await authenticate(request);
    } catch (error) {
      const failure = error instanceof AdminAuthError ? error : new AdminAuthError(503, 'VERIFY_FAILED');
      return reject(request, response, failure.status, failure.reason);
    }
    const limit = reads.consume(actor, now());
    if (!limit.allowed) {
      response.setHeader('Retry-After', String(limit.retryAfter));
      return sendText(response, 429, 'Too many requests');
    }
    if (url.pathname !== '/api/admin' && !url.pathname.startsWith('/api/admin/'))
      return serveAsset(request, response, url.pathname);
    try {
      await serveApi(request, response, url, actor, requestId);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof AdminRequestError) {
        if (error.status === 413) response.setHeader('Connection', 'close');
        return sendError(response, error.status, error.code, error.message);
      }
      if (error instanceof ProtocolError)
        return sendError(response, PROTOCOL_STATUS[error.code] ?? 400, error.code, error.message);
      serverErrors.record('admin', error);
      return sendError(response, 500, 'INTERNAL_ERROR', 'The request failed; see the server error log');
    }
  }

  const server = createServer(
    { requestTimeout: 30_000, headersTimeout: 15_000, maxHeaderSize: 32 * 1024 },
    (request, response) => {
      handle(request, response).catch((error) => {
        serverErrors.record('admin', error);
        if (!response.headersSent) sendText(response, 500, 'Internal error');
        else response.destroy();
      });
    },
  );
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  const restoreConsole = captureConsoleErrors();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    restoreConsole();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No admin TCP listener');
  return {
    port: address.port,
    context,
    async close() {
      restoreConsole();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
