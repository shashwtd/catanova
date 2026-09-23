import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_STYLESHEET,
  MEASURED_PATHS,
  analyticsLoader,
} from '../apps/client/src/analytics.js';

/** Just enough of a document for the loader: elements, listeners and a cookie jar. */
class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  textContent = '';
  className = '';
  type = '';
  rel = '';
  href = '';
  src = '';
  async = false;
  hidden = false;
  onload: (() => void) | null = null;
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: FakeElement, before: FakeElement) {
    child.parentNode = this;
    this.children.splice(Math.max(0, this.children.indexOf(before)), 0, child);
    return child;
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((node) => node !== child);
    child.parentNode = null;
    return child;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
  find(match: (element: FakeElement) => boolean): FakeElement | undefined {
    for (const child of this.children) {
      if (match(child)) return child;
      const found = child.find(match);
      if (found) return found;
    }
    return undefined;
  }
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** One public page load with the loader, as the production host would see it. */
function page({
  pathname = '/',
  stored,
  storage,
  cookies = '',
}: { pathname?: string; stored?: string; storage?: 'throws'; cookies?: string } = {}) {
  const location = { hostname: 'catanova.io', origin: 'https://catanova.io', pathname };
  const saved = new Map<string, string>(stored ? [[CONSENT_STORAGE_KEY, stored]] : []);
  const listeners = new Map<string, { callback: () => void; capture: boolean }>();
  const history = {
    pushState(_state: unknown, _title: string, path: string) {
      location.pathname = path;
    },
    replaceState(_state: unknown, _title: string, path: string) {
      location.pathname = path;
    },
  };
  const window: Record<string, unknown> = {
    dataLayer: [] as unknown[],
    history,
    addEventListener(name: string, callback: () => void, capture: boolean) {
      listeners.set(name, { callback, capture });
    },
  };
  if (storage === 'throws')
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('SecurityError: storage is disabled');
      },
    });
  else
    window.localStorage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    } satisfies Storage;
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  head.appendChild(new FakeElement('script'));
  const cookieWrites: string[] = [];
  const document = {
    title: 'Catanova',
    readyState: 'complete',
    head,
    body,
    get cookie() {
      return cookies;
    },
    set cookie(value: string) {
      cookieWrites.push(value);
    },
    createElement: (tag: string) => new FakeElement(tag),
    getElementsByTagName: (tag: string) => head.children.filter((node) => node.tagName === tag),
    addEventListener() {},
  };
  const script = analyticsLoader('G-TEST');
  const run = () => runInNewContext(script, { window, document, location });
  run();
  const events = window.dataLayer as unknown[];
  const commands = () =>
    events.filter((event): event is IArguments => typeof (event as IArguments)[0] === 'string');
  const tags = () => head.children.filter((node) => node.tagName === 'script' && node.src);
  const stylesheet = () => head.find((node) => node.tagName === 'link');
  const banner = () => body.find((node) => node.className === 'consent-banner');
  const button = (choice: string) =>
    banner()?.find((node) => node.getAttribute('data-consent-choice') === choice);
  return {
    window,
    history,
    location,
    listeners,
    saved,
    cookieWrites,
    events,
    commands,
    tags,
    stylesheet,
    banner,
    button,
    run,
    /** The banner is added only once its stylesheet has loaded. */
    showBanner() {
      stylesheet()?.onload?.();
      return banner();
    },
  };
}

const index = (commands: IArguments[], ...call: string[]) =>
  commands.findIndex((event) => call.every((part, i) => event[i] === part));

test('analytics sets safe Google tag defaults before load and after SPA navigation', () => {
  const visit = page({ stored: 'granted' });
  const commands = visit.commands();
  assert.equal(visit.tags().length, 1);
  assert.equal(visit.tags()[0]!.src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST');
  // Consent Mode v2: every purpose is denied before anything else, the stored
  // answer is applied, and only then is the property configured.
  assert.deepEqual([commands[0]![0], commands[0]![1]], ['consent', 'default']);
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0]![2])), {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
  const update = index(commands, 'consent', 'update');
  assert.equal(JSON.stringify(commands[update]![2]), '{"analytics_storage":"granted"}');
  assert.ok(index(commands, 'set') < index(commands, 'config'), 'safe URLs are set before config');
  assert.ok(update < index(commands, 'config', 'G-TEST'));
  assert.equal(visit.stylesheet(), undefined, 'somebody who answered is not asked again');
  visit.history.pushState(null, '', '/room/ABCD?invite=SECRET');
  const latest = visit.events.at(-1) as Record<string, string>;
  assert.equal(latest.page_location, 'https://catanova.io/room');
  assert.equal(latest.page_referrer, '');
  assert.equal(latest.page_title, 'Catanova');
  visit.history.replaceState(null, '', '/auth/callback#access_token=SECRET');
  assert.equal((visit.events.at(-1) as Record<string, string>).page_location, 'https://catanova.io/auth');
  assert.ok(!JSON.stringify(visit.events).includes('SECRET'));
  visit.location.hostname = 'localhost';
  visit.location.pathname = '/';
  visit.run();
  assert.equal(visit.tags().length, 1, 'local previews must not load GA4');
});

test('nothing reaches Google until the visitor allows it, and the answer is remembered', () => {
  const visit = page();
  assert.equal(visit.tags().length, 0, 'the Google tag is not even fetched before an answer');
  assert.equal(index(visit.commands(), 'config'), -1);
  assert.equal(index(visit.commands(), 'js'), -1);
  assert.equal(visit.stylesheet()?.href, CONSENT_STYLESHEET);
  assert.equal(visit.banner(), undefined, 'the banner waits for its styles');
  const banner = visit.showBanner()!;
  assert.equal(banner.tagName, 'section');
  assert.match(banner.find((node) => node.tagName === 'p')!.textContent, /Google Analytics/);
  assert.equal(visit.button('granted')?.textContent, 'Allow analytics');
  assert.equal(visit.button('denied')?.textContent, 'No thanks');
  visit.button('granted')!.click();
  assert.equal(visit.banner(), undefined);
  assert.equal(visit.saved.get(CONSENT_STORAGE_KEY), 'granted');
  const commands = visit.commands();
  assert.ok(index(commands, 'consent', 'update') < index(commands, 'config', 'G-TEST'));
  assert.equal(visit.tags().length, 1);
  visit.history.pushState(null, '', '/room/ABCD');
  visit.history.replaceState(null, '', '/');
  assert.equal(visit.tags().length, 1);
});

test('No thanks is remembered, loads nothing and clears cookies Google Analytics left behind', () => {
  const visit = page({ cookies: '_ga=GA1.1.1; theme=dark; _ga_TEST=GS1.1.1; ga=kept' });
  visit.showBanner();
  visit.button('denied')!.click();
  assert.equal(visit.banner(), undefined);
  assert.equal(visit.saved.get(CONSENT_STORAGE_KEY), 'denied');
  assert.equal(visit.tags().length, 0);
  assert.equal(index(visit.commands(), 'config'), -1);
  assert.deepEqual(visit.cookieWrites, [
    '_ga=; Max-Age=0; path=/',
    '_ga=; Max-Age=0; path=/; domain=catanova.io',
    '_ga_TEST=; Max-Age=0; path=/',
    '_ga_TEST=; Max-Age=0; path=/; domain=catanova.io',
  ]);
  const again = page({ stored: 'denied' });
  assert.equal(again.stylesheet(), undefined, 'no banner and no stylesheet once answered');
  assert.equal(again.tags().length, 0);
});

test('storage that refuses access still asks, and the answer holds for the page', () => {
  const visit = page({ storage: 'throws' });
  visit.showBanner();
  assert.doesNotThrow(() => visit.button('granted')!.click());
  assert.equal(visit.banner(), undefined);
  assert.equal(visit.tags().length, 1);
});

test('the question stays on the public pages and never follows anyone into a room', () => {
  const visit = page({ pathname: '/guide/' });
  visit.showBanner();
  visit.listeners.get('hashchange')!.callback();
  assert.ok(visit.banner(), 'a contents link on the guide keeps it');
  visit.history.replaceState(null, '', '/guide/');
  assert.ok(visit.banner(), 'rewriting the same public address keeps it');
  visit.history.pushState(null, '', '/room/ABCD');
  assert.equal(visit.banner(), undefined);
  // An answer given after the address changed is kept for the next public page,
  // but this document never measures again, so the tag is not fetched for nothing.
  const late = page();
  late.showBanner();
  late.history.replaceState(null, '', '/');
  late.button('granted')!.click();
  assert.equal(late.saved.get(CONSENT_STORAGE_KEY), 'granted');
  assert.equal(late.tags().length, 0);
  const back = page();
  back.showBanner();
  back.location.pathname = '/play';
  back.listeners.get('popstate')!.callback();
  assert.equal(back.banner(), undefined);
  // A stylesheet that arrives after the visitor has left shows nothing.
  const away = page();
  away.history.pushState(null, '', '/room/ABCD');
  assert.equal(away.showBanner(), undefined);
});

test('build rejects measurement IDs containing markup or executable script', () => {
  for (const bad of ['G-X" onload=alert(1)', "G-X';alert(1)//", '']) {
    assert.throws(() => analyticsLoader(bad), /Invalid GA4/);
  }
});

test('collection stops before other history wrappers run and stays off after returning home', () => {
  const location = { hostname: 'catanova.io', origin: 'https://catanova.io', pathname: '/' };
  const listeners = new Map<string, { callback: () => void; capture: boolean }>();
  const observed: boolean[] = [];
  const window: any = {
    dataLayer: [],
    history: Object.fromEntries(
      ['pushState', 'replaceState'].map((method) => [
        method,
        (_state: unknown, _title: string, path: string) => {
          observed.push(window['ga-disable-G-TEST'] === true);
          location.pathname = path;
        },
      ]),
    ),
    addEventListener(name: string, callback: () => void, capture: boolean) {
      listeners.set(name, { callback, capture });
    },
    localStorage: { getItem: () => 'granted', setItem() {} },
  };
  const head = new FakeElement('head');
  head.appendChild(new FakeElement('script'));
  const document = {
    title: 'Catanova',
    readyState: 'complete',
    head,
    body: new FakeElement('body'),
    createElement: (tag: string) => new FakeElement(tag),
    getElementsByTagName: () => head.children,
  };
  runInNewContext(analyticsLoader('G-TEST'), { window, document, location });
  assert.equal(window['ga-disable-G-TEST'], undefined, 'public landing still measures');
  window.history.pushState(null, '', '/room/ABCD');
  window.history.replaceState(null, '', '/');
  assert.deepEqual(observed, [true, true], 'even a previously installed wrapper sees disabled collection');
  assert.equal(window['ga-disable-G-TEST'], true, 'back to public does not leak private referrer');
  for (const name of ['popstate', 'hashchange']) {
    assert.equal(listeners.get(name)?.capture, true);
    window['ga-disable-G-TEST'] = false;
    listeners.get(name)!.callback();
    assert.equal(window['ga-disable-G-TEST'], true);
  }
});

test('a loader delayed until after entry into the app never loads Google', () => {
  for (const pathname of ['/room/ABCD', '/play', '/auth/callback']) {
    const window = {};
    runInNewContext(analyticsLoader('G-TEST'), {
      window,
      document: {},
      location: { hostname: 'catanova.io', pathname },
    });
    assert.deepEqual(window, {}, pathname);
  }
  assert.deepEqual([...MEASURED_PATHS], ['/', '/guide/']);
});
