import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { AdminAuthError, createAccessVerifier, parseKeySet } from '../apps/server/src/admin/access.js';
import { AdminConfigError, isLoopbackHost, readAdminConfig } from '../apps/server/src/admin/config.js';
import { AUD, OWNER, TEAM, encode, keyServer } from './admin-fixture.js';

async function refused(promise: Promise<unknown>, status: number, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminAuthError, `expected a refusal, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.reason, reason);
    return true;
  });
}

function verifierFor(certsUrl: string, clock: { now: number }) {
  return createAccessVerifier({
    teamDomain: TEAM,
    audience: AUD,
    emails: new Set([OWNER]),
    certsUrl,
    now: () => clock.now,
  });
}

test('a Cloudflare Access token is accepted only when every check passes', async (t) => {
  const keys = await keyServer(t);
  const clock = { now: Date.now() };
  const verify = verifierFor(keys.certsUrl, clock);
  const at = clock.now;

  // Valid, including an audience list and an address in another case.
  assert.deepEqual(await verify(keys.token({}, { at })), {
    email: OWNER,
    expiresAt: (Math.floor(at / 1000) + 600) * 1000,
  });
  assert.equal(
    (await verify(keys.token({ email: 'Owner@Example.COM', aud: ['other', AUD] }, { at }))).email,
    OWNER,
  );
  assert.equal((await verify(keys.token({ aud: AUD }, { at }))).email, OWNER, 'a single audience string');

  // Missing or malformed header.
  await refused(verify(undefined), 401, 'MISSING_TOKEN');
  await refused(verify(''), 401, 'MISSING_TOKEN');
  await refused(verify('not-a-token'), 401, 'MALFORMED_TOKEN');
  await refused(verify(`${keys.token({}, { at })}, ${keys.token({}, { at })}`), 401, 'MALFORMED_TOKEN');

  // Bad signature: a valid token with its payload swapped, and one signed by a stranger's key.
  const [head, , signature] = keys.token({}, { at }).split('.');
  const forged = `${head}.${encode({ aud: [AUD], email: 'intruder@example.com', exp: 9e9, iat: 1, iss: `https://${TEAM}` })}.${signature}`;
  await refused(verify(forged), 401, 'BAD_SIGNATURE');
  const stranger = keys.key('stranger');
  keys.publish(['key-1']);
  const strangerSigned = keys.token({}, { at, kid: 'stranger' }).split('.');
  const legit = keys.token({}, { at }).split('.');
  await refused(verify(`${legit[0]}.${legit[1]}.${strangerSigned[2]}`), 401, 'BAD_SIGNATURE');
  assert.ok(stranger);

  // Wrong kid: a key the team never published.
  await refused(verify(keys.token({}, { at, kid: 'stranger' })), 401, 'UNKNOWN_KEY');

  // alg none, with and without a signature segment.
  const none = `${encode({ alg: 'none', kid: 'key-1' })}.${encode({ aud: [AUD], email: OWNER, exp: 9e9, iat: 1, iss: `https://${TEAM}` })}`;
  await refused(verify(`${none}.`), 401, 'MALFORMED_TOKEN');
  await refused(verify(`${none}.c2lnbmF0dXJl`), 401, 'UNSUPPORTED_ALGORITHM');
  for (const alg of ['RS384', 'PS256', 'ES256', 'rs256', 'HS512'])
    await refused(verify(keys.token({}, { at, header: { alg } })), 401, 'UNSUPPORTED_ALGORITHM');

  // HS256 signed with the public key as the HMAC secret: the classic algorithm confusion.
  const secret = keys.key().publicKey.export({ type: 'spki', format: 'pem' });
  const hsHead = encode({ alg: 'HS256', kid: 'key-1', typ: 'JWT' });
  const hsBody = encode({
    aud: [AUD],
    email: OWNER,
    exp: Math.floor(at / 1000) + 600,
    iat: Math.floor(at / 1000),
    iss: `https://${TEAM}`,
  });
  const hmac = createHmac('sha256', secret).update(`${hsHead}.${hsBody}`).digest('base64url');
  await refused(verify(`${hsHead}.${hsBody}.${hmac}`), 401, 'UNSUPPORTED_ALGORITHM');

  // Claims.
  await refused(verify(keys.token({ aud: ['another-application'] }, { at })), 401, 'WRONG_AUDIENCE');
  await refused(verify(keys.token({ aud: undefined }, { at })), 401, 'WRONG_AUDIENCE');
  await refused(
    verify(keys.token({ iss: 'https://evil.cloudflareaccess.com' }, { at })),
    401,
    'WRONG_ISSUER',
  );
  await refused(verify(keys.token({ iss: `http://${TEAM}` }, { at })), 401, 'WRONG_ISSUER');
  const seconds = Math.floor(at / 1000);
  await refused(verify(keys.token({ exp: seconds - 61 }, { at })), 401, 'EXPIRED');
  assert.equal((await verify(keys.token({ exp: seconds - 30 }, { at }))).email, OWNER, 'within the skew');
  await refused(verify(keys.token({ nbf: seconds + 61 }, { at })), 401, 'NOT_YET_VALID');
  await refused(verify(keys.token({ iat: seconds + 3600 }, { at })), 401, 'ISSUED_IN_FUTURE');
  await refused(verify(keys.token({ exp: undefined }, { at })), 401, 'MISSING_TIME_CLAIMS');
  await refused(verify(keys.token({ exp: '9999999999' }, { at })), 401, 'MISSING_TIME_CLAIMS');
  await refused(verify(keys.token({ iat: undefined }, { at })), 401, 'MISSING_TIME_CLAIMS');
  await refused(verify(keys.token({}, { at, header: { crit: ['exp'] } })), 401, 'UNSUPPORTED_HEADER');
  await refused(verify(keys.token({}, { at, header: { kid: undefined } })), 401, 'MISSING_KEY_ID');

  // Email allowlist: a real Cloudflare login that is not the owner, and a service token with no email.
  await refused(verify(keys.token({ email: 'friend@example.com' }, { at })), 403, 'EMAIL_NOT_ALLOWED');
  await refused(
    verify(keys.token({ email: undefined, common_name: 'svc' }, { at })),
    403,
    'EMAIL_NOT_ALLOWED',
  );
  await refused(verify(keys.token({ email: ['owner@example.com'] }, { at })), 403, 'EMAIL_NOT_ALLOWED');

  // The same token, reused after it expires.
  const token = keys.token({}, { at });
  assert.equal((await verify(token)).email, OWNER);
  clock.now = at + 600_000 + 59_000;
  assert.equal((await verify(token)).email, OWNER, 'still inside the minute of skew');
  clock.now = at + 600_000 + 61_000;
  await refused(verify(token), 401, 'EXPIRED');
});

test('signing keys are cached, refreshed for rotation at most once a minute, and never bypassed when unavailable', async (t) => {
  const keys = await keyServer(t);
  const clock = { now: Date.now() };
  const verify = verifierFor(keys.certsUrl, clock);

  // Unavailable before the first fetch: 503, and never a pass.
  keys.fail(true);
  await refused(verify(keys.token({}, { at: clock.now })), 503, 'KEYS_UNAVAILABLE');
  const failedAttempts = keys.requests();
  // A failing endpoint is not hammered: requests inside ten seconds get 503 without fetching.
  await refused(verify(keys.token({}, { at: clock.now })), 503, 'KEYS_UNAVAILABLE');
  assert.equal(keys.requests(), failedAttempts);
  keys.fail(false);
  clock.now += 10_001;
  assert.equal((await verify(keys.token({}, { at: clock.now }))).email, OWNER);
  const afterFirst = keys.requests();

  // Cached: many requests, no fetches.
  for (let i = 0; i < 5; i++) await verify(keys.token({}, { at: clock.now }));
  assert.equal(keys.requests(), afterFirst);

  // Rotation: a token with a new kid refreshes once and is accepted.
  keys.publish(['key-1', 'key-2']);
  clock.now += 60_001;
  assert.equal((await verify(keys.token({}, { at: clock.now, kid: 'key-2' }))).email, OWNER);
  assert.equal(keys.requests(), afterFirst + 1);

  // Unknown kids cannot force a fetch per request: at most one a minute.
  await refused(verify(keys.token({}, { at: clock.now, kid: 'forged-1' })), 401, 'UNKNOWN_KEY');
  await refused(verify(keys.token({}, { at: clock.now, kid: 'forged-2' })), 401, 'UNKNOWN_KEY');
  assert.equal(keys.requests(), afterFirst + 1);
  clock.now += 60_001;
  await refused(verify(keys.token({}, { at: clock.now, kid: 'forged-3' })), 401, 'UNKNOWN_KEY');
  assert.equal(keys.requests(), afterFirst + 2);

  // A retired key stops working once the refreshed set no longer carries it.
  keys.publish(['key-2']);
  clock.now += 60 * 60_000 + 1;
  await refused(verify(keys.token({}, { at: clock.now, kid: 'key-1' })), 401, 'UNKNOWN_KEY');
  assert.equal((await verify(keys.token({}, { at: clock.now, kid: 'key-2' }))).email, OWNER);

  // An expired cache whose refresh fails is a 503, even for a key it used to hold.
  keys.fail(true);
  clock.now += 60 * 60_000 + 1;
  await refused(verify(keys.token({}, { at: clock.now, kid: 'key-2' })), 503, 'KEYS_UNAVAILABLE');
});

test('key sets accept only RSA signing keys of at least 2048 bits', async (t) => {
  const keys = await keyServer(t);
  const jwk = keys.key().publicKey.export({ format: 'jwk' });
  assert.equal(parseKeySet({ keys: [{ ...jwk, kid: 'ok' }] }).size, 1);
  assert.throws(() => parseKeySet({ keys: [{ ...jwk, kid: 'enc', use: 'enc' }] }));
  assert.throws(() => parseKeySet({ keys: [{ ...jwk, kid: 'hs', alg: 'HS256' }] }));
  assert.throws(() => parseKeySet({ keys: [{ kty: 'oct', k: 'c2VjcmV0', kid: 'sym' }] }));
  assert.throws(() => parseKeySet({ keys: [{ ...jwk }] }), 'a key without a kid is unusable');
  assert.throws(() => parseKeySet({}));
  assert.throws(() => parseKeySet(null));
});

const PRODUCTION = {
  NODE_ENV: 'production',
  ADMIN_PORT: '3100',
  ADMIN_HOST: '0.0.0.0',
  ADMIN_AUTH: 'cloudflare-access',
  ADMIN_ACCESS_TEAM_DOMAIN: TEAM,
  ADMIN_ACCESS_AUD: AUD,
  ADMIN_EMAILS: ' Owner@Example.com , second@example.com ',
  ADMIN_ORIGIN: 'https://admin.catanova.io',
  STATUS_DIR: '/app/status',
};

test('the admin listener refuses to start in production without complete Cloudflare Access settings', () => {
  assert.equal(readAdminConfig({ NODE_ENV: 'production' }), null, 'off unless ADMIN_PORT is set');
  const config = readAdminConfig(PRODUCTION)!;
  assert.equal(config.port, 3100);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.origin, 'https://admin.catanova.io');
  assert.ok(config.auth.mode === 'cloudflare-access');
  assert.deepEqual([...config.auth.emails], ['owner@example.com', 'second@example.com']);
  const broken: [Record<string, string | undefined>, RegExp][] = [
    [{ ADMIN_AUTH: undefined }, /cloudflare-access in production/],
    [{ ADMIN_AUTH: 'local-dev' }, /refused when NODE_ENV=production/],
    [{ ADMIN_AUTH: 'none' }, /cloudflare-access in production/],
    [{ ADMIN_ACCESS_TEAM_DOMAIN: undefined }, /TEAM_DOMAIN/],
    [{ ADMIN_ACCESS_TEAM_DOMAIN: 'https://x.cloudflareaccess.com' }, /TEAM_DOMAIN/],
    [{ ADMIN_ACCESS_TEAM_DOMAIN: 'attacker.example.com' }, /TEAM_DOMAIN/],
    [{ ADMIN_ACCESS_AUD: undefined }, /AUD/],
    [{ ADMIN_ACCESS_AUD: 'short' }, /AUD/],
    [{ ADMIN_EMAILS: undefined }, /at least one/],
    [{ ADMIN_EMAILS: ' , ' }, /at least one/],
    [{ ADMIN_EMAILS: 'not-an-email' }, /invalid address/],
    [{ ADMIN_ORIGIN: undefined }, /ADMIN_ORIGIN/],
    [{ ADMIN_ORIGIN: 'http://admin.catanova.io' }, /https/],
    [{ ADMIN_ORIGIN: 'https://admin.catanova.io/' }, /exact origin/],
    [{ ADMIN_ORIGIN: 'https://admin.catanova.io/path' }, /exact origin/],
    [{ ADMIN_PORT: '0' }, /ADMIN_PORT/],
    [{ ADMIN_PORT: '3000' }, /differ from the public PORT/],
    [{ ADMIN_PORT: 'abc' }, /ADMIN_PORT/],
    [{ ADMIN_HOST: 'admin.internal' }, /ADMIN_HOST/],
  ];
  for (const [change, message] of broken)
    assert.throws(
      () => readAdminConfig({ ...PRODUCTION, ...change }),
      (error: unknown) => error instanceof AdminConfigError && message.test(error.message),
      JSON.stringify(change),
    );
});

test('local development mode exists only outside production and only on loopback', () => {
  const local = { ADMIN_PORT: '3100', ADMIN_AUTH: 'local-dev' };
  const config = readAdminConfig(local)!;
  assert.equal(config.auth.mode, 'local-dev');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.origin, 'http://127.0.0.1:3100');
  assert.equal(readAdminConfig({ ...local, ADMIN_HOST: '::1' })!.host, '::1');
  assert.throws(() => readAdminConfig({ ...local, ADMIN_HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readAdminConfig({ ...local, ADMIN_HOST: '10.0.0.5' }), /loopback/);
  assert.throws(() => readAdminConfig({ ...local, NODE_ENV: 'production' }), /refused/);
  assert.throws(
    () => readAdminConfig({ ...local, ADMIN_ORIGIN: 'https://admin.catanova.io' }),
    /loopback origin/,
  );
  assert.throws(() => readAdminConfig({ ADMIN_PORT: '3100' }), /cloudflare-access or local-dev/);
  for (const host of ['127.0.0.1', '127.8.0.1', '::1', '[::1]', 'localhost', 'LOCALHOST'])
    assert.ok(isLoopbackHost(host), host);
  for (const host of ['0.0.0.0', '::', '10.0.0.1', 'localhost.evil.com', '127.0.0.1.nip.io', ''])
    assert.ok(!isLoopbackHost(host), host);
});
