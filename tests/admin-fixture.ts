/** Shared pieces for the admin console tests: a Cloudflare-like key server, token signing and requests. */
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { TestContext } from 'node:test';

export const TEAM = 'catanova-test.cloudflareaccess.com';
export const AUD = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
export const OWNER = 'owner@example.com';
export const ADMIN_ORIGIN = 'https://admin.catanova.test';

export function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signToken(
  privateKey: KeyObject,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): string {
  const head = encode(header),
    body = encode(claims);
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

/** Serves a JWKS the way https://<team>/cdn-cgi/access/certs does, with switches for failure and rotation. */
export async function keyServer(t: TestContext) {
  const pairs = new Map<string, { publicKey: KeyObject; privateKey: KeyObject }>();
  const addKey = (kid: string) => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    pairs.set(kid, pair);
    return pair;
  };
  addKey('key-1');
  let published = ['key-1'];
  let failing = false;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (failing) {
      response.writeHead(503).end('unavailable');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        keys: published.map((kid) => ({
          ...pairs.get(kid)!.publicKey.export({ format: 'jwk' }),
          kid,
          alg: 'RS256',
          use: 'sig',
        })),
        public_cert: { kid: published[0], cert: 'unused' },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no key server');
  return {
    certsUrl: `http://127.0.0.1:${address.port}/cdn-cgi/access/certs`,
    requests: () => requests,
    fail: (value: boolean) => {
      failing = value;
    },
    publish: (kids: string[]) => {
      for (const kid of kids) if (!pairs.has(kid)) addKey(kid);
      published = kids;
    },
    key: (kid = 'key-1') => pairs.get(kid) ?? addKey(kid),
    /** A token Cloudflare would issue for this team and application, adjustable per case. */
    token: (
      overrides: Record<string, unknown> = {},
      options: { kid?: string; header?: Record<string, unknown>; at?: number } = {},
    ) => {
      const kid = options.kid ?? 'key-1';
      const seconds = Math.floor((options.at ?? Date.now()) / 1000);
      return signToken(
        (pairs.get(kid) ?? addKey(kid)).privateKey,
        { alg: 'RS256', kid, typ: 'JWT', ...options.header },
        {
          aud: [AUD],
          email: OWNER,
          exp: seconds + 600,
          iat: seconds,
          nbf: seconds,
          iss: `https://${TEAM}`,
          type: 'app',
          sub: '6b8c8b6e-0000-4000-8000-000000000001',
          ...overrides,
        },
      );
    },
  };
}

export type RawResponse = { status: number; headers: IncomingHttpHeaders; body: string };

/** A raw HTTP request, so tests control every header, including Host and Origin. */
export function raw(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  const headers = { ...options.headers };
  const framed = Object.keys(headers).some((name) =>
    ['content-length', 'transfer-encoding'].includes(name.toLowerCase()),
  );
  if (options.body !== undefined && !framed)
    headers['Content-Length'] = String(Buffer.byteLength(options.body));
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

/** Headers the admin interface sends with every API call. */
export const API = { 'X-Catanova-Admin': '1', 'Sec-Fetch-Site': 'same-origin' };
/** Headers the admin interface sends with a change. */
export const MUTATION = { ...API, Origin: ADMIN_ORIGIN, 'Content-Type': 'application/json' };
