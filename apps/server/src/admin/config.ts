/**
 * Admin listener configuration, read once at startup.
 *
 * Everything here fails closed. A production process refuses to start the
 * admin listener unless Cloudflare Access verification is fully configured,
 * and the unauthenticated development mode only exists on a loopback address
 * outside production. A mistake stops startup with a message naming the
 * variable, rather than quietly opening a door.
 */
import { isIP } from 'node:net';
import { resolve } from 'node:path';

export type AdminAuthConfig =
  | {
      mode: 'cloudflare-access';
      /** `<team>.cloudflareaccess.com`: the issuer, and the host serving its signing keys. */
      teamDomain: string;
      /** The Access application's Audience (AUD) tag. */
      audience: string;
      /** Lower-cased addresses allowed in. Cloudflare decides who can sign in; this decides who gets in. */
      emails: ReadonlySet<string>;
    }
  | { mode: 'local-dev' };

export type AdminConfig = {
  port: number;
  host: string;
  auth: AdminAuthConfig;
  /** The only browser origin whose mutations are accepted. */
  origin: string;
  /** Where the host's backup and watchdog scripts leave their JSON status files. */
  statusDir: string;
  /** The deployed commit, when the deployment passes it in. */
  revision: string | null;
};

export class AdminConfigError extends Error {}

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUDIENCE = /^[a-f0-9]{64}$/;
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** True for addresses that never leave this machine. Hostnames other than `localhost` are refused elsewhere. */
export function isLoopbackHost(value: string): boolean {
  const host = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (host.toLowerCase() === 'localhost') return true;
  const family = isIP(host);
  if (family === 4) return host.startsWith('127.');
  if (family === 6) return new URL(`http://[${host}]/`).hostname === '[::1]';
  return false;
}

function fail(message: string): never {
  throw new AdminConfigError(message);
}

/** An exact origin: scheme, host and optional port, nothing else. */
function exactOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be an origin such as https://admin.catanova.io`);
  }
  if (url.origin !== value || url.username || url.password)
    fail(`${name} must be an exact origin with no path, query or trailing slash`);
  return url;
}

export function readAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig | null {
  const rawPort = env.ADMIN_PORT?.trim();
  if (!rawPort) return null;
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
    fail('ADMIN_PORT must be an integer from 1 to 65535');
  const port = Number(rawPort);
  if (String(port) === (env.PORT ?? '3000').trim()) fail('ADMIN_PORT must differ from the public PORT');
  const host = env.ADMIN_HOST?.trim() || '127.0.0.1';
  if (host !== 'localhost' && !isIP(host)) fail('ADMIN_HOST must be an IP address or localhost');
  const production = env.NODE_ENV === 'production';
  const mode = env.ADMIN_AUTH?.trim();
  const statusDir = resolve(env.STATUS_DIR?.trim() || '/app/status');
  const revision = env.CATANOVA_REVISION?.trim().slice(0, 64) || null;
  if (mode === 'local-dev') {
    if (production) fail('ADMIN_AUTH=local-dev is refused when NODE_ENV=production');
    if (!isLoopbackHost(host)) fail('ADMIN_AUTH=local-dev only listens on a loopback ADMIN_HOST');
    const origin = env.ADMIN_ORIGIN?.trim() || `http://127.0.0.1:${port}`;
    if (!isLoopbackHost(exactOrigin(origin, 'ADMIN_ORIGIN').hostname))
      fail('ADMIN_ORIGIN must be a loopback origin with ADMIN_AUTH=local-dev');
    return { port, host, auth: { mode: 'local-dev' }, origin, statusDir, revision };
  }
  if (mode !== 'cloudflare-access')
    fail(
      production
        ? 'ADMIN_AUTH must be cloudflare-access in production'
        : 'ADMIN_AUTH must be cloudflare-access or local-dev',
    );
  const teamDomain = env.ADMIN_ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? '';
  if (!TEAM_DOMAIN.test(teamDomain))
    fail('ADMIN_ACCESS_TEAM_DOMAIN must be your team domain, such as example.cloudflareaccess.com');
  const audience = env.ADMIN_ACCESS_AUD?.trim().toLowerCase() ?? '';
  if (!AUDIENCE.test(audience))
    fail('ADMIN_ACCESS_AUD must be the Access application’s 64-character Audience (AUD) tag');
  const listed = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  // Printable ASCII, checked before lower-casing, exactly as tokens are checked.
  for (const email of listed)
    if (!/^[!-~]+$/.test(email) || !EMAIL.test(email)) fail('ADMIN_EMAILS contains an invalid address');
  const emails = new Set(listed.map((email) => email.toLowerCase()));
  if (!emails.size) fail('ADMIN_EMAILS must list at least one address');
  if (emails.size > 20) fail('ADMIN_EMAILS may list at most 20 addresses');
  const origin = env.ADMIN_ORIGIN?.trim() ?? '';
  if (!origin) fail('ADMIN_ORIGIN must be set, such as https://admin.catanova.io');
  if (exactOrigin(origin, 'ADMIN_ORIGIN').protocol !== 'https:') fail('ADMIN_ORIGIN must use https');
  return {
    port,
    host,
    auth: { mode: 'cloudflare-access', teamDomain, audience, emails },
    origin,
    statusDir,
    revision,
  };
}
