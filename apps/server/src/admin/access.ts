/**
 * Verifies the token Cloudflare Access attaches to every request it lets through.
 *
 * Cloudflare signs a short JWT (`Cf-Access-Jwt-Assertion`) for each request
 * that passed its login and policy. Being reachable only through the tunnel is
 * the first wall; this is the second, and it does not trust the first. Every
 * request is checked on its own: RS256 only, a key from the team's published
 * set, this application's audience, this team's issuer, a live validity window
 * and an allowlisted email. Anything unexpected is a refusal, and if the keys
 * cannot be fetched the answer is 503, never a pass.
 */
import { constants, createPublicKey, verify as verifySignature } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** Clock tolerance for exp, nbf and iat. Never more than a minute. */
export const MAX_CLOCK_SKEW_SECONDS = 60;
/** Unknown `kid`s trigger a refresh, but no more than once a minute. */
export const KEY_REFRESH_INTERVAL_MS = 60_000;
/** A fetched key set is trusted for an hour, then fetched again. */
export const KEY_CACHE_TTL_MS = 60 * 60_000;
/** After a failed fetch, wait this long before trying again. Until then: 503. */
export const KEY_FAILURE_RETRY_MS = 10_000;

export type AccessIdentity = { email: string; expiresAt: number };
export type AccessVerifier = (token: string | undefined) => Promise<AccessIdentity>;

/**
 * A refused request. `reason` is for our own log and the admin's rejected-request
 * list; the response itself only ever carries the status.
 */
export class AdminAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly reason: string,
  ) {
    super(reason);
  }
}

export type AccessVerifierOptions = {
  teamDomain: string;
  audience: string;
  emails: ReadonlySet<string>;
  /** Tests serve their own key set; production always uses the team domain. */
  certsUrl?: string;
  now?: () => number;
  fetch?: typeof fetch;
  clockSkewSeconds?: number;
};

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeObject(segment: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new AdminAuthError(401, 'MALFORMED_TOKEN');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AdminAuthError(401, 'MALFORMED_TOKEN');
  return value as Record<string, unknown>;
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Signing key response is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Only RSA signing keys of at least 2048 bits, described as RS256 if they say anything at all. */
export function parseKeySet(value: unknown): Map<string, KeyObject> {
  const list = (value as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) throw new Error('Signing key set has no keys');
  const keys = new Map<string, KeyObject>();
  for (const entry of list.slice(0, 32)) {
    if (!entry || typeof entry !== 'object') continue;
    const jwk = entry as Record<string, unknown>;
    if (
      jwk.kty !== 'RSA' ||
      typeof jwk.kid !== 'string' ||
      !jwk.kid ||
      jwk.kid.length > 256 ||
      typeof jwk.n !== 'string' ||
      typeof jwk.e !== 'string' ||
      (jwk.alg !== undefined && jwk.alg !== 'RS256') ||
      (jwk.use !== undefined && jwk.use !== 'sig')
    )
      continue;
    try {
      // Only the public parameters: nothing else in the entry can change how it verifies.
      const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) continue;
      keys.set(jwk.kid, key);
    } catch {
      continue;
    }
  }
  if (!keys.size) throw new Error('Signing key set has no usable RS256 keys');
  return keys;
}

export function createAccessVerifier(options: AccessVerifierOptions): AccessVerifier {
  const issuer = `https://${options.teamDomain}`;
  const certsUrl = options.certsUrl ?? `${issuer}/cdn-cgi/access/certs`;
  const now = options.now ?? Date.now;
  const fetchKeys = options.fetch ?? fetch;
  const skew = Math.min(
    MAX_CLOCK_SKEW_SECONDS,
    Math.max(0, options.clockSkewSeconds ?? MAX_CLOCK_SKEW_SECONDS),
  );
  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity,
    attemptedAt = -Infinity,
    failed = false;
  let inflight: Promise<void> | null = null;

  /** One fetch at a time; everyone waiting shares its result. */
  function refresh(): Promise<void> {
    if (inflight) return inflight;
    attemptedAt = now();
    inflight = (async () => {
      try {
        const response = await fetchKeys(certsUrl, {
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Signing key fetch returned ${response.status}`);
        keys = parseKeySet(JSON.parse(await readLimited(response, 256 * 1024)));
        fetchedAt = now();
        failed = false;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function keyFor(kid: string): Promise<KeyObject | undefined> {
    const at = now();
    if (inflight || at - fetchedAt >= KEY_CACHE_TTL_MS) {
      // Nothing trustworthy cached: fetch, but give a failing endpoint a moment before asking again.
      if (!inflight && failed && at - attemptedAt < KEY_FAILURE_RETRY_MS)
        throw new AdminAuthError(503, 'KEYS_UNAVAILABLE');
      try {
        await refresh();
      } catch {
        throw new AdminAuthError(503, 'KEYS_UNAVAILABLE');
      }
      return keys.get(kid);
    }
    const key = keys.get(kid);
    if (key || at - attemptedAt < KEY_REFRESH_INTERVAL_MS) return key;
    // A fresh set without this kid: Cloudflare may have rotated its signing key.
    try {
      await refresh();
    } catch {
      throw new AdminAuthError(503, 'KEYS_UNAVAILABLE');
    }
    return keys.get(kid);
  }

  return async (token) => {
    if (!token) throw new AdminAuthError(401, 'MISSING_TOKEN');
    const parts = token.split('.');
    if (token.length > 16_384 || parts.length !== 3 || !parts.every((part) => SEGMENT.test(part)))
      throw new AdminAuthError(401, 'MALFORMED_TOKEN');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = decodeObject(encodedHeader);
    // The algorithm is fixed here, never taken from the token: `none`, HS256 and
    // everything else are refused before any key is touched.
    if (header.alg !== 'RS256') throw new AdminAuthError(401, 'UNSUPPORTED_ALGORITHM');
    if (header.crit !== undefined) throw new AdminAuthError(401, 'UNSUPPORTED_HEADER');
    if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 256)
      throw new AdminAuthError(401, 'MISSING_KEY_ID');
    const key = await keyFor(header.kid);
    if (!key) throw new AdminAuthError(401, 'UNKNOWN_KEY');
    let valid = false;
    try {
      valid = verifySignature(
        'sha256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        { key, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(encodedSignature, 'base64url'),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new AdminAuthError(401, 'BAD_SIGNATURE');
    const claims = decodeObject(encodedPayload);
    if (claims.iss !== issuer) throw new AdminAuthError(401, 'WRONG_ISSUER');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.some((aud) => aud === options.audience)) throw new AdminAuthError(401, 'WRONG_AUDIENCE');
    const seconds = now() / 1000;
    const time = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const exp = time(claims.exp),
      iat = time(claims.iat),
      nbf = claims.nbf === undefined ? undefined : time(claims.nbf);
    if (exp === undefined || iat === undefined || (claims.nbf !== undefined && nbf === undefined))
      throw new AdminAuthError(401, 'MISSING_TIME_CLAIMS');
    if (seconds > exp + skew) throw new AdminAuthError(401, 'EXPIRED');
    if (nbf !== undefined && seconds < nbf - skew) throw new AdminAuthError(401, 'NOT_YET_VALID');
    if (iat > seconds + skew) throw new AdminAuthError(401, 'ISSUED_IN_FUTURE');
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email || !options.emails.has(email)) throw new AdminAuthError(403, 'EMAIL_NOT_ALLOWED');
    return { email, expiresAt: exp * 1000 };
  };
}
