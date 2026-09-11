import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntryScreen } from '../apps/client/src/EntryScreen.js';
import { Invite, Lobby } from '../apps/client/src/Lobby.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { RoomPreview, RoomState } from '../packages/protocol/src/index.js';
import type { useAuth } from '../apps/client/src/auth.js';
import { generateBoard } from '../packages/rules/src/board.js';

type Auth = ReturnType<typeof useAuth>;
type EntryProps = ComponentProps<typeof EntryScreen>;
const actions = {
  setEntry: () => {},
  setName: () => {},
  setCode: () => {},
  onEnter: () => {},
  onResume: () => {},
  onBack: () => {},
  onProfile: () => {},
  onFriends: () => {},
  onSettings: () => {},
  onSignOut: () => {},
};
function authState(overrides: Partial<Auth> = {}): Auth {
  return {
    config: { mode: 'authenticated', auth: { url: 'https://example.supabase.co', publishableKey: 'public' } },
    user: null,
    account: null,
    profile: defaultProfile('Captain'),
    loading: false,
    canPlay: false,
    needsOnboarding: false,
    guestExpired: false,
    ...overrides,
  } as Auth;
}
function renderEntry(overrides: Partial<EntryProps> = {}) {
  return renderToStaticMarkup(
    createElement(EntryScreen, {
      auth: authState(),
      entry: 'home',
      name: '',
      code: '',
      invite: null,
      previewRoom: null,
      previewLoading: false,
      previewError: '',
      resumableInvite: false,
      busy: false,
      ...actions,
      ...overrides,
    }),
  );
}
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const buttonWith = (html: string, text: string) =>
  buttons(html).find((button) => button.replace(/<[^>]*>/g, '').includes(text));
const members = ['Captain', 'Sailor'].map((name, i) => ({
  id: `p${i}`,
  name,
  ready: true,
  profile: defaultProfile(name),
}));
function preview(overrides: Partial<RoomPreview> = {}): RoomPreview {
  return { roomId: 'ABCDEFG2', board: generateBoard(82), players: members, started: false, ...overrides };
}

test('the landing menu makes Create and Join the first choices, with authentication after that choice', () => {
  const html = renderEntry();
  assert.ok(buttonWith(html, 'Create room') && buttonWith(html, 'Join room'));
  assert.ok(buttonWith(html, 'Sign in'));
  assert.ok(!buttonWith(html, 'Continue with Google') && !buttonWith(html, 'Play as guest'));
  assert.ok(html.includes('aria-label="Catanova"'));
  assert.ok(!html.includes('type="submit"'));
  for (const entry of ['create', 'join'] as const) {
    const gate = renderEntry({ entry });
    assert.ok(buttonWith(gate, 'Continue with Google') && buttonWith(gate, 'Play as guest'));
    assert.ok(!gate.includes('type="submit"'));
    assert.ok(gate.includes(`<h2>${entry === 'create' ? 'Create room' : 'Join room'}</h2>`));
  }
  const unavailable = renderEntry({
    entry: 'create',
    auth: authState({ config: { mode: 'authenticated', auth: null } }),
  });
  assert.ok(buttonWith(unavailable, 'Play as guest')?.includes('disabled=""'));
  assert.ok(buttonWith(unavailable, 'Continue with Google')?.includes('disabled=""'));
});

test('entry keeps branded Google and full guest actions without extra login copy', () => {
  const html = renderEntry({
    entry: 'create',
    auth: authState({
      config: {
        mode: 'authenticated',
        auth: { url: 'https://example.supabase.co', publishableKey: 'public' },
        captcha: { siteKey: 'public-site-key' },
      },
    }),
  });
  const google = buttonWith(html, 'Continue with Google')!;
  const guest = buttonWith(html, 'Play as guest')!;
  assert.ok(google.includes('src="/art/providers/google-g.png"'));
  assert.ok(!google.includes('aria-describedby="google-benefits"'));
  assert.ok(!html.includes('Keep your profile and add friends.'));
  assert.ok(!google.includes('disabled=""') && !guest.includes('disabled=""'));
  assert.ok(guest.includes('dark-button guest-button'));
  assert.ok(html.indexOf(google) < html.indexOf(guest));
  assert.ok(!html.includes('google-letter') && !html.includes('captcha-check-widget'));
  assert.ok(html.includes('Guests expire after 7 days of inactivity.'));
});

test('the landing footer provides crawlable guidance and an explicit external GitHub repository link', () => {
  const html = renderEntry();
  assert.ok(html.includes('<a href="/guide/">How to play</a>'));
  assert.ok(!html.includes('Catanova is open source.'));
  assert.match(
    html,
    /<a href="https:\/\/github\.com\/shashwtd\/catanova" target="_blank" rel="noopener noreferrer">/,
  );
  assert.ok(html.includes('src="/art/providers/github-invertocat-white.svg"'));
  assert.ok(html.includes('Open on GitHub'));
});

test('the small island loader appears only for pending connection or room work and exposes its status', () => {
  assert.ok(!renderEntry().includes('game-loader'));
  for (const entry of ['home', 'create'] as const) {
    const html = renderEntry({ entry, auth: authState({ loading: true }) });
    assert.ok(html.includes('game-loader-island'));
    assert.ok(html.includes('role="status" aria-label="Connecting…" aria-atomic="true"'));
    assert.ok(!html.includes('class="spin"'));
  }
  const opening = renderEntry({ busy: true, auth: authState({ canPlay: true }) });
  assert.ok(opening.includes('aria-label="Opening room…"'));
  const creating = renderEntry({ entry: 'create', busy: true, auth: authState({ canPlay: true }) });
  assert.ok(buttonWith(creating, 'Create room')?.includes('aria-label="Creating room…"'));
  const waiting = renderEntry({
    entry: 'invite',
    previewLoading: true,
    auth: authState({ canPlay: true }),
  });
  assert.ok(buttonWith(waiting, 'Join room')?.includes('aria-label="Loading room…"'));
  const ready = renderEntry({ entry: 'create', auth: authState({ canPlay: true }) });
  assert.ok(!ready.includes('game-loader'));
});

test('expired guests get fresh entry choices instead of the unusable retry-account branch', () => {
  const html = renderEntry({
    entry: 'create',
    auth: authState({ guestExpired: true, user: { id: 'expired' } as Auth['user'] }),
  });
  assert.ok(html.includes('Your guest profile expired.'));
  assert.ok(buttonWith(html, 'Play as guest') && buttonWith(html, 'Continue with Google'));
  assert.ok(!buttonWith(html, 'Retry account'));
});

test('onboarding replaces invite entry until a unique username and avatar have been saved', () => {
  const auth = authState({ needsOnboarding: true });
  auth.account = {
    id: 'new',
    username: null,
    isGuest: true,
    registered: false,
    profile: null,
    lastActiveAt: '2026-09-09T00:00:00Z',
    expiresAt: null,
  };
  auth.checkUsername = async () => ({ available: true });
  const html = renderEntry({ auth, entry: 'invite', invite: 'ABCDEFG2', previewRoom: preview() });
  assert.ok(html.includes('Set up your account'));
  assert.ok(html.includes('>Username<input'));
  assert.ok(buttonWith(html, 'Continue')?.includes('disabled=""'));
  assert.ok(!buttonWith(html, 'Join room') && !buttonWith(html, 'Resume room'));
});

test('authenticated create and join paths use the chosen username while local play asks for a username', () => {
  const auth = authState({ canPlay: true });
  const create = renderEntry({ auth, entry: 'create' });
  assert.ok(buttonWith(create, 'Create room'));
  assert.ok(!create.includes('>Username<input') && !create.includes('>Room code<input'));
  const join = renderEntry({ auth, entry: 'join', code: 'ABCDEFG2' });
  assert.ok(join.includes('>Room code<input') && join.includes('value="ABCDEFG2"'));
  assert.ok(!join.includes('>Username<input'));
  const local = renderEntry({
    auth: authState({ canPlay: true, config: { mode: 'local', auth: null } }),
    entry: 'create',
  });
  assert.ok(local.includes('>Username<input'));
});

test('invite entry waits for preview and blocks full or started rooms, while saved seats can resume', () => {
  const auth = authState({ canPlay: true });
  const waiting = renderEntry({ auth, entry: 'invite', invite: 'ABCDEFG2', previewLoading: true });
  assert.ok(buttonWith(waiting, 'Join room')?.includes('disabled=""'));
  const open = renderEntry({ auth, entry: 'invite', invite: 'ABCDEFG2', previewRoom: preview() });
  assert.ok(!buttonWith(open, 'Join room')?.includes('disabled=""'));
  assert.ok(open.includes('Sailor') && !open.includes('>Room code<input'));
  const started = renderEntry({
    auth,
    entry: 'invite',
    invite: 'ABCDEFG2',
    previewRoom: preview({ started: true }),
  });
  assert.ok(started.includes('This game has started.') && !buttonWith(started, 'Join room'));
  const full = renderEntry({
    auth,
    entry: 'invite',
    invite: 'ABCDEFG2',
    previewRoom: preview({
      players: [...members, { ...members[0]!, id: 'p2' }, { ...members[1]!, id: 'p3' }],
    }),
  });
  assert.ok(full.includes('This room is full.') && !buttonWith(full, 'Join room'));
  const resume = renderEntry({
    auth,
    entry: 'invite',
    invite: 'ABCDEFG2',
    previewRoom: preview({ started: true }),
    resumableInvite: true,
  });
  assert.ok(buttonWith(resume, 'Resume room'));
  assert.ok(!resume.includes('This game has started.') && !buttonWith(resume, 'Join room'));
});

test('room sharing exposes distinct Share, Copy link and Copy code actions without collapsing the invite', () => {
  const html = renderToStaticMarkup(createElement(Invite, { code: 'ABCDEFG2' }));
  const controls = buttons(html);
  assert.equal(controls.length, 3);
  for (const label of ['Share room', 'Copy invite link', 'Copy room code'])
    assert.equal(controls.filter((button) => button.includes(`aria-label="${label}"`)).length, 1);
  assert.ok(html.includes('<code>ABCDEFG2</code>'));
  assert.ok(!html.includes('share-link-field'));
  const room: RoomState = {
    roomId: 'ABCDEFG2',
    revision: 0,
    counter: 0,
    players: members.map((player) => ({ ...player, connected: true })),
  };
  const lobby = renderToStaticMarkup(
    createElement(Lobby, {
      room,
      me: 'p0',
      busy: false,
      connected: true,
      onReady: () => {},
      onStart: () => {},
      onInvite: () => {},
      onLeave: () => {},
      onEdit: () => {},
      onSettings: () => {},
    }),
  );
  assert.equal(buttons(lobby).filter((button) => button.includes('aria-label="Invite player"')).length, 2);
  for (const label of ['Share room', 'Copy invite link', 'Copy room code'])
    assert.ok(lobby.includes(`aria-label="${label}"`));
  assert.ok(!buttonWith(lobby, 'Start game')?.includes('disabled=""'));
});

test('permanent invitation links display the friendly code and never a UUID in the room heading', () => {
  const roomId = '9bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f';
  const html = renderEntry({
    auth: authState({ canPlay: true }),
    entry: 'invite',
    invite: roomId,
    previewRoom: preview({ roomId, roomCode: 'AB2C' }),
  });
  assert.match(html, /invite-room-code">AB2C</);
  assert.ok(!html.includes(roomId));
  const pending = renderEntry({ entry: 'invite', invite: roomId, previewLoading: true });
  assert.ok(!pending.includes(roomId));
  const share = renderToStaticMarkup(createElement(Invite, { code: 'AB2C', roomId }));
  assert.match(share, /<code>AB2C<\/code>/);
});
