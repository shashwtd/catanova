import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { analyticsLoader } from '../apps/client/src/analytics.js';

test('analytics sets safe Google tag defaults before load and after SPA navigation', () => {
  const events: unknown[] = [];
  const inserted: unknown[] = [];
  const location = { hostname: 'catanova.io', origin: 'https://catanova.io', pathname: '/' };
  const window = {
    dataLayer: events,
    history: {
      pushState(_state: unknown, _title: string, path: string) { location.pathname = path; },
      replaceState(_state: unknown, _title: string, path: string) { location.pathname = path; },
    },
    addEventListener() {},
  };
  const document = {
    title: 'Catanova',
    createElement() { return {}; },
    getElementsByTagName() { return [{ parentNode: { insertBefore(tag: unknown) { inserted.push(tag); } } }]; },
  };
  const script = analyticsLoader('G-TEST');
  runInNewContext(script, { window, document, location });
  assert.equal(inserted.length, 1);
  assert.equal((inserted[0] as { src: string }).src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST');
  assert.ok(events.some((event) => (event as IArguments)[0] === 'config' && (event as IArguments)[1] === 'G-TEST'));
  assert.equal((events[0] as IArguments)[0], 'set');
  window.history.pushState(null, '', '/room/ABCD?invite=SECRET');
  const latest = events.at(-1) as Record<string, string>;
  assert.equal(latest.page_location, 'https://catanova.io/room');
  assert.equal(latest.page_referrer, '');
  assert.equal(latest.page_title, 'Catanova');
  window.history.replaceState(null, '', '/auth/callback#access_token=SECRET');
  assert.equal((events.at(-1) as Record<string, string>).page_location, 'https://catanova.io/auth');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  location.hostname = 'localhost';
  runInNewContext(script, { window, document, location });
  assert.equal(inserted.length, 1, 'local previews must not load GA4');
});

test('build rejects measurement IDs containing markup or executable script', () => {
  for (const bad of ['G-X\" onload=alert(1)', "G-X';alert(1)//", '']) {
    assert.throws(() => analyticsLoader(bad), /Invalid GA4/);
  }
});
