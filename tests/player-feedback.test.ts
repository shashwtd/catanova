import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { startServer } from '../apps/server/src/server.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import type { FeedbackPage, PlayerDetail } from '../apps/server/src/admin/types.js';
import { FEEDBACK_PER_HOUR } from '../apps/server/src/feedback.js';
import {
  FEEDBACK_MESSAGE_MAX,
  FeedbackError,
  parseFeedbackSubmission,
} from '../packages/protocol/src/feedback.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Account } from '../packages/protocol/src/profile.js';
import { SendFeedback, feedbackContext } from '../apps/client/src/SendFeedback.js';
import { GameTools } from '../apps/client/src/GameTools.js';
import { PlayerHub } from '../apps/client/src/PlayerHub.js';
import type { PlayerGameState } from '../apps/client/src/MatchHistory.js';
import type { useAuth } from '../apps/client/src/auth.js';
import { emptyFriends } from '../packages/protocol/src/profile.js';
import { API, raw } from './admin-fixture.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const valid = {
  category: 'bug',
  message: 'The dice stopped rolling.',
  context: { roomCode: 'AB2C', revision: 12 },
};

test('feedback is parsed strictly and technical details are limited to known short fields', () => {
  assert.deepEqual(parseFeedbackSubmission(valid), {
    category: 'bug',
    message: 'The dice stopped rolling.',
    context: { roomCode: 'AB2C', revision: 12 },
  });
  for (const input of [
    null,
    [],
    'text',
    { ...valid, category: 'rant' },
    { ...valid, message: '' },
    { ...valid, message: '   \n  ' },
    { ...valid, message: 42 },
    { ...valid, message: 'x'.repeat(FEEDBACK_MESSAGE_MAX + 1) },
    { ...valid, context: 'details' },
  ])
    assert.throws(() => parseFeedbackSubmission(input), FeedbackError, JSON.stringify(input)?.slice(0, 60));
  assert.equal(
    parseFeedbackSubmission({ ...valid, message: 'x'.repeat(FEEDBACK_MESSAGE_MAX) }).message.length,
    2000,
  );
  const cleaned = parseFeedbackSubmission({
    category: 'idea',
    message: '  Line one\r\nline\u0000 two\u202e\t done  ',
    context: {
      roomCode: 'AB2C\n<script>',
      revision: -1,
      userAgent: 'x'.repeat(1000),
      lastError: 'Could not save',
      unknown: 'dropped',
      hand: { wood: 3 },
    },
  });
  assert.equal(cleaned.message, 'Line one\nline two\t done');
  assert.deepEqual(cleaned.context, {
    roomCode: 'AB2C <script>',
    userAgent: 'x'.repeat(400),
    lastError: 'Could not save',
  });
  assert.equal(parseFeedbackSubmission({ ...valid, context: {} }).context, null);
  assert.equal(parseFeedbackSubmission({ ...valid, context: null }).context, null);
});

async function localServer(t: TestContext, trustedProxyCidrs: string[] = []) {
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    auth: null,
    captcha: null,
    trustedProxyCidrs,
  });
  t.after(() => server.close());
  const send = (body: unknown, headers: Record<string, string> = JSON_HEADERS, method = 'POST') =>
    raw(server.port, '/api/feedback', {
      method,
      headers,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { server, send };
}

test('a local playtest server accepts feedback without an account, within the hourly limit', async (t) => {
  const { server, send } = await localServer(t);
  const accepted = await send(valid);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.headers['cache-control'], 'no-store');
  const row = server.store.db
    .prepare('SELECT * FROM feedback WHERE id = ?')
    .get(JSON.parse(accepted.body).id)!;
  assert.equal(row.user_id, null);
  assert.equal(row.username, null);
  assert.equal(row.category, 'bug');
  assert.equal(row.status, 'new');
  assert.deepEqual(JSON.parse(row.context as string), { roomCode: 'AB2C', revision: 12 });
  // Shape and transport checks.
  assert.equal((await send(undefined, {}, 'GET')).status, 405);
  assert.equal((await send(valid, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send(valid, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await send(valid, { ...JSON_HEADERS, Origin: 'https://evil.example' })).status, 403);
  // A malformed body is refused, and still counts as an attempt against the hour.
  assert.equal((await send('{not json')).status, 400);
  for (let i = 2; i < FEEDBACK_PER_HOUR; i++) assert.equal((await send(valid)).status, 201);
  const limited = await send(valid);
  assert.equal(limited.status, 429);
  assert.equal(JSON.parse(limited.body).code, 'FEEDBACK_RATE_LIMIT');
  assert.ok(Number(limited.headers['retry-after']) > 3000);
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM feedback').get()!.n, FEEDBACK_PER_HOUR - 1);
});

test('oversized and invalid feedback is refused before it is stored', async (t) => {
  const { server, send } = await localServer(t);
  assert.equal((await send({ ...valid, message: 'x'.repeat(20_000) })).status, 413);
  const invalid = await send({ ...valid, category: 'rant' });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.parse(invalid.body).code, 'FEEDBACK_INVALID');
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM feedback').get()!.n, 0);
});

/** Supabase stand-in: the bearer token names the account the RPC returns. */
async function authenticatedServer(t: TestContext) {
  const now = Date.now();
  const account = (id: number, patch: Partial<Account> = {}): Account => ({
    id: `00000000-0000-4000-8000-00000000010${id}`,
    username: `Player${id}`,
    isGuest: false,
    registered: true,
    profile: { ...defaultProfile(`Player${id}`), username: `Player${id}` },
    lastActiveAt: new Date(now).toISOString(),
    expiresAt: null,
    ...patch,
  });
  const accounts = new Map<string, Account>([
    ['one', account(1)],
    ['two', account(2)],
    ['new', account(3, { registered: false, username: null, profile: null })],
    ['expired', account(4, { isGuest: true, expiresAt: new Date(now - 1000).toISOString() })],
  ]);
  const supabase = createServer((request, response) => {
    const token = request.headers.authorization?.slice('Bearer '.length) ?? '';
    const found = accounts.get(token);
    response.setHeader('Content-Type', 'application/json');
    if (!found || request.url !== '/rest/v1/rpc/catanova_account_get') {
      response.writeHead(401).end(JSON.stringify({ code: 'bad_jwt', message: 'Invalid JWT' }));
      return;
    }
    response.end(JSON.stringify(found));
  });
  supabase.listen(0, '127.0.0.1');
  await once(supabase, 'listening');
  const address = supabase.address();
  assert.ok(address && typeof address !== 'string');
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    captcha: null,
    auth: { url: `http://127.0.0.1:${address.port}`, publishableKey: 'sb_publishable_fixture' },
    verifyIdentity: async () => {
      throw new Error('not used by feedback');
    },
    trustedProxyCidrs: ['127.0.0.1/32'],
  });
  t.after(async () => {
    await server.close();
    await new Promise<void>((resolve) => supabase.close(() => resolve()));
  });
  const send = (token: string | null, from = '203.0.113.1', body: unknown = valid) =>
    raw(server.port, '/api/feedback', {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'X-Forwarded-For': from,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { server, send, accounts };
}

test('with accounts configured, only a signed-in, registered, unexpired account can send feedback', async (t) => {
  const { server, send, accounts } = await authenticatedServer(t);
  const status = async (token: string | null, from: string) => {
    const response = await send(token, from);
    return [response.status, JSON.parse(response.body).code as string | undefined];
  };
  assert.deepEqual(await status(null, '203.0.113.10'), [401, 'AUTH_REQUIRED']);
  assert.deepEqual(await status('forged', '203.0.113.11'), [401, 'AUTH_REQUIRED']);
  assert.deepEqual(await status('new', '203.0.113.12'), [403, 'ONBOARDING_REQUIRED']);
  assert.deepEqual(await status('expired', '203.0.113.13'), [410, 'GUEST_EXPIRED']);
  assert.equal(server.store.db.prepare('SELECT count(*) AS n FROM feedback').get()!.n, 0);
  const accepted = await send('one', '203.0.113.14');
  assert.equal(accepted.status, 201);
  const row = server.store.db.prepare('SELECT user_id, username FROM feedback').get()!;
  assert.equal(row.user_id, accounts.get('one')!.id);
  assert.equal(row.username, 'Player1');
  // Five an hour per account, whichever address it comes from...
  for (let i = 1; i < FEEDBACK_PER_HOUR; i++)
    assert.equal((await send('one', `198.51.100.${i}`)).status, 201);
  assert.deepEqual(await status('one', '198.51.100.99'), [429, 'FEEDBACK_RATE_LIMIT']);
  // ...and five an hour per address, whichever account sends it.
  for (let i = 0; i < FEEDBACK_PER_HOUR; i++)
    assert.notEqual((await send(i % 2 ? 'two' : 'forged', '192.0.2.7')).status, 429);
  assert.deepEqual(await status('two', '192.0.2.7'), [429, 'FEEDBACK_RATE_LIMIT']);
});

test('the admin inbox lists feedback and records every resolve and reopen', async (t) => {
  const { server, send } = await localServer(t, ['127.0.0.1/32']);
  const at = (i: number) => ({ ...JSON_HEADERS, 'X-Forwarded-For': `203.0.113.${i}` });
  await send({ category: 'bug', message: 'First' }, at(1));
  await send({ category: 'idea', message: 'Second' }, at(2));
  await send({ category: 'other', message: 'Third' }, at(3));
  const userId = '00000000-0000-4000-8000-000000000201';
  server.store.db
    .prepare(
      "INSERT INTO feedback(at, user_id, username, category, message) VALUES (?, ?, 'Fern', 'bug', 'From an account')",
    )
    .run(Date.now(), userId);
  server.store.enter('create', 'fern-seat-token-'.padEnd(64, '0'), 'Fern', undefined, {
    id: userId,
    name: 'Fern',
    expiresAt: Date.now() + 3_600_000,
    profile: defaultProfile('Fern'),
  });
  const admin = await startAdminServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      auth: { mode: 'local-dev' },
      origin: 'http://127.0.0.1:3100',
      statusDir: '/nonexistent',
      revision: null,
    },
    store: server.store,
    runtime: server.runtime,
    databasePath: ':memory:',
    log: () => {},
  });
  t.after(() => admin.close());
  const get = async <T>(path: string) =>
    JSON.parse((await raw(admin.port, path, { headers: API })).body) as T;
  const post = (id: number, body: unknown) =>
    raw(admin.port, `/api/admin/feedback/${id}/status`, {
      method: 'POST',
      headers: { ...API, Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const inbox = await get<FeedbackPage>('/api/admin/feedback');
  assert.deepEqual(
    inbox.items.map((item) => item.message),
    ['From an account', 'Third', 'Second', 'First'],
  );
  assert.deepEqual(inbox.counts, { new: 4, resolved: 0 });
  assert.deepEqual(
    (await get<FeedbackPage>('/api/admin/feedback?category=idea')).items.map((item) => item.message),
    ['Second'],
  );
  assert.equal((await raw(admin.port, '/api/admin/feedback?status=spam', { headers: API })).status, 400);
  const first = inbox.items.at(-1)!;
  // Resolve, resolve again (no change, no second record), then reopen.
  const resolved = await post(first.id, { resolved: true });
  assert.equal(resolved.status, 200);
  assert.equal(JSON.parse(resolved.body).status, 'resolved');
  assert.equal(JSON.parse(resolved.body).resolvedBy, 'local-dev');
  assert.equal((await post(first.id, { resolved: true })).status, 200);
  assert.equal(JSON.parse((await post(first.id, { resolved: false })).body).status, 'new');
  const audit = server.store.db
    .prepare('SELECT action, target, actor FROM admin_audit WHERE target = ? ORDER BY id')
    .all(`feedback:${first.id}`);
  assert.deepEqual(
    audit.map((row) => row.action),
    ['feedback.resolve', 'feedback.reopen'],
  );
  assert.equal(audit[0]!.actor, 'local-dev');
  await post(first.id, { resolved: true });
  assert.deepEqual(
    (await get<FeedbackPage>('/api/admin/feedback?status=resolved')).items.map((item) => item.id),
    [first.id],
  );
  for (const body of [{}, { resolved: 'yes' }, { resolved: true, note: 'x' }])
    assert.equal((await post(first.id, body)).status, 400, JSON.stringify(body));
  assert.equal((await post(9999, { resolved: true })).status, 404);
  // An account's page shows what it sent.
  const player = await get<PlayerDetail>(`/api/admin/players/${userId}`);
  assert.deepEqual(
    player.feedback.map((item) => item.category),
    ['bug'],
  );
});

type Auth = ReturnType<typeof useAuth>;
const games: PlayerGameState = {
  data: null,
  error: '',
  loading: false,
  refresh: () => {},
  loadMore: () => {},
};

test('the game menu and the player lobby each offer Send feedback, in the settings style', () => {
  const tools = renderToStaticMarkup(
    createElement(GameTools, { fullscreen: false, onPanel() {}, onFullscreen() {}, onLeave() {} }),
  );
  assert.match(tools, /data-game-tool="feedback"[^>]*aria-label="Send feedback"/);
  assert.ok(tools.indexOf('data-game-tool="feedback"') < tools.indexOf('data-game-tool="leave"'));
  const profile = defaultProfile('Fern');
  const auth = {
    profile,
    account: null,
    friends: emptyFriends(),
    config: { mode: 'local' },
    canPlay: true,
  } as unknown as Auth;
  const hub = (onFeedback?: () => void) =>
    renderToStaticMarkup(
      createElement(PlayerHub, {
        auth,
        games,
        busy: false,
        onCreate() {},
        onJoin: async () => {},
        onResume() {},
        onProfile() {},
        onFriends() {},
        onSettings() {},
        onSignOut() {},
        ...(onFeedback ? { onFeedback } : {}),
      }),
    );
  const tools2 = hub(() => {}).match(/<nav class="hub-player-tools"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.ok(tools2.includes('Send feedback') && tools2.indexOf('Send feedback') < tools2.indexOf('Sign out'));
  assert.ok(!hub().includes('Send feedback'));
  const dialog = renderToStaticMarkup(createElement(SendFeedback, { details: {}, onClose() {} }));
  assert.match(dialog, /class="settings-content settings-menu feedback-form"/);
  assert.equal((dialog.match(/role="radio"/g) ?? []).length, 3);
  assert.match(dialog, /aria-checked="true"[^>]*>Bug</);
  assert.match(dialog, /<textarea[^>]*maxLength="2000"/i);
  assert.match(dialog, /type="checkbox" role="switch"[^>]*checked=""/);
  assert.match(dialog, /Never your cards/);
  assert.match(dialog, /class="dark-button"[^>]*>Cancel<\/button>/);
  assert.match(dialog, /type="submit" class="gold-button" disabled=""/);
});

test('technical details name the room, build, browser, screen, connection and last error, and nothing else', () => {
  const context = feedbackContext(
    { roomCode: 'AB2C', revision: 41, connection: 'reconnecting', lastError: 'Could not save the action' },
    { userAgent: 'TestBrowser/1.0', width: 390.4, height: 844, pixelRatio: 3 },
  );
  assert.deepEqual(Object.keys(context).sort(), [
    'clientBuild',
    'connection',
    'lastError',
    'revision',
    'roomCode',
    'userAgent',
    'viewport',
  ]);
  assert.equal(context.viewport, '390x844 @3x');
  assert.equal(context.roomCode, 'AB2C');
  assert.equal(context.clientBuild, 'SendFeedback.tsx');
  assert.deepEqual(parseFeedbackSubmission({ category: 'bug', message: 'x', context }).context, context);
  assert.deepEqual(
    Object.keys(feedbackContext({}, { userAgent: 'x', width: 1, height: 1, pixelRatio: 1 })).sort(),
    ['clientBuild', 'userAgent', 'viewport'],
  );
});
