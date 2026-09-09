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
    googleAvatarUrl: null,
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
    googleAvatarUrl: null,
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

test('authenticated create and join paths use the profile name while local play retains its Name field', () => {
  const auth = authState({ canPlay: true });
  const create = renderEntry({ auth, entry: 'create' });
  assert.ok(buttonWith(create, 'Create room'));
  assert.ok(!create.includes('>Name<input') && !create.includes('>Room code<input'));
  const join = renderEntry({ auth, entry: 'join', code: 'ABCDEFG2' });
  assert.ok(join.includes('>Room code<input') && join.includes('value="ABCDEFG2"'));
  assert.ok(!join.includes('>Name<input'));
  const local = renderEntry({
    auth: authState({ canPlay: true, config: { mode: 'local', auth: null } }),
    entry: 'create',
  });
  assert.ok(local.includes('>Name<input'));
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
