import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTurnstileLoader,
  mountTurnstile,
  type TurnstileApi,
  type TurnstileOptions,
} from '../apps/client/src/Turnstile.js';

function fakeApi() {
  const options: TurnstileOptions[] = [];
  const removed: string[] = [];
  const reset: string[] = [];
  const api: TurnstileApi = {
    render: (_element, value) => {
      options.push(value);
      return String(options.length);
    },
    remove: (id) => removed.push(id),
    reset: (id) => reset.push(id),
  };
  return { api, options, removed, reset };
}

function fakeDocument() {
  class Script extends EventTarget {
    src = '';
    async = false;
    defer = false;
    removed = false;
    remove() {
      this.removed = true;
    }
  }
  const scripts: Script[] = [];
  const callbacks: Record<string, () => void> = {};
  const doc = {
    defaultView: callbacks,
    createElement: () => new Script(),
    head: { append: (script: Script) => scripts.push(script) },
  } as unknown as Document;
  const loaded = (i: number) => callbacks[new URL(scripts[i]!.src).searchParams.get('onload')!]!();
  return { doc, scripts, loaded };
}

test('Turnstile shares one official script load across mounts and keeps the successful loader', async () => {
  const { doc, scripts, loaded } = fakeDocument();
  let api: TurnstileApi | undefined;
  const load = createTurnstileLoader(doc, () => api);
  const first = load();
  assert.equal(load(), first);
  assert.equal(scripts.length, 1);
  assert.ok(
    scripts[0]!.src.startsWith(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=',
    ),
  );
  scripts[0]!.dispatchEvent(new Event('load')); // DOM load alone is not API readiness.
  api = fakeApi().api;
  loaded(0);
  assert.equal(await first, api);
  assert.equal(await load(), api);
  assert.equal(scripts.length, 1);
});

test('Turnstile removes blocked scripts and allows a fresh user retry after errors or timeout', async () => {
  const { doc, scripts, loaded } = fakeDocument();
  let api: TurnstileApi | undefined;
  const load = createTurnstileLoader(doc, () => api, 5);
  const first = load();
  scripts[0]!.dispatchEvent(new Event('error'));
  await assert.rejects(first, /could not load/);
  assert.equal(scripts[0]!.removed, true);
  await assert.rejects(load(), /could not load/);
  assert.equal(scripts[1]!.removed, true);
  const retry = load();
  api = fakeApi().api;
  loaded(2);
  assert.equal(await retry, api);
});

test('Turnstile cleanup before script completion prevents an abandoned StrictMode widget', async () => {
  const fake = fakeApi();
  let resolve!: (api: TurnstileApi) => void;
  const ready = new Promise<TurnstileApi>((done) => {
    resolve = done;
  });
  const states: string[] = [];
  const props = {
    siteKey: 'test-site-key',
    action: 'guest',
    onVerify: () => assert.fail('Abandoned verification'),
  };
  const dispose = mountTurnstile(
    {} as HTMLElement,
    props,
    (state) => states.push(state),
    () => ready,
  );
  dispose();
  resolve(fake.api);
  await ready;
  assert.deepEqual(states, []);
  assert.equal(fake.options.length, 0);
});

test('Turnstile delivers each token once, refreshes expiry, and ignores callbacks after removal', async () => {
  const fake = fakeApi();
  const tokens: string[] = [];
  const states: string[] = [];
  let expired = 0;
  const dispose = mountTurnstile(
    {} as HTMLElement,
    {
      siteKey: 'test-site-key',
      action: 'guest',
      onVerify: (token) => tokens.push(token),
      onExpire: () => {
        expired++;
      },
    },
    (state) => states.push(state),
    async () => fake.api,
  );
  await Promise.resolve();
  const widget = fake.options[0]!;
  assert.equal(widget.theme, 'light');
  assert.equal(widget.size, 'compact');
  assert.equal(widget.appearance, 'always');
  assert.equal(widget['response-field'], false);
  widget.callback('first');
  widget.callback('first');
  widget['expired-callback']();
  widget.callback('first');
  widget.callback('fresh');
  assert.deepEqual(tokens, ['first', 'fresh']);
  assert.deepEqual(fake.reset, ['1']);
  assert.equal(expired, 1);
  dispose();
  widget.callback('late');
  widget['expired-callback']();
  widget['error-callback']();
  assert.deepEqual(fake.removed, ['1']);
  assert.deepEqual(tokens, ['first', 'fresh']);
  assert.equal(expired, 1);
  assert.equal(states.at(-1), 'verified');
});

test('Turnstile widget errors or interactive timeouts invalidate verification until a fresh mount', async () => {
  for (const callback of ['error-callback', 'timeout-callback', 'unsupported-callback'] as const) {
    const fake = fakeApi();
    const states: string[] = [];
    let expired = 0;
    const dispose = mountTurnstile(
      {} as HTMLElement,
      {
        siteKey: 'test-site-key',
        action: 'guest',
        onVerify: () => assert.fail('Failed widget verified'),
        onExpire: () => {
          expired++;
        },
      },
      (state) => states.push(state),
      async () => fake.api,
    );
    await Promise.resolve();
    fake.options[0]![callback]();
    fake.options[0]!.callback('late');
    assert.equal(states.at(-1), 'error');
    assert.equal(expired, 1);
    dispose();
  }
});

test('Turnstile ignores a preinstalled partial API until the official onload callback', async () => {
  const { doc, loaded } = fakeDocument();
  const api = fakeApi().api;
  const partial = { ...api, ready: () => assert.fail('Never call ready on the async API') };
  let resolved = false;
  const pending = createTurnstileLoader(doc, () => partial)().then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  loaded(0);
  await pending;
  assert.equal(resolved, true);
});
