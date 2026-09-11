import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerHub, PlayerProfile } from '../apps/client/src/PlayerHub.js';
import { MatchHistory, PlayerStats, MatchRow } from '../apps/client/src/MatchHistory.js';
import type { PlayerGameState } from '../apps/client/src/MatchHistory.js';
import { mergePlayerGames } from '../apps/client/src/usePlayerGames.js';
import { showPlayerHome } from '../apps/client/src/navigation.js';
import { defaultProfile, emptyFriends } from '../packages/protocol/src/profile.js';
import type { PlayerGames, MatchSummary } from '../packages/protocol/src/player-hub.js';
import type { useAuth } from '../apps/client/src/auth.js';

type Auth = ReturnType<typeof useAuth>;
const noop = () => {};
const profile = defaultProfile('FernCaptain');
const account = {
  id: 'me',
  registered: true,
  isGuest: false,
  username: profile.name,
  profile,
  lastActiveAt: '',
  expiresAt: null,
};
const auth = {
  profile,
  account,
  friends: emptyFriends(),
  config: { mode: 'authenticated' },
  canPlay: true,
  signIn: async () => {},
  checkUsername: async () => ({ available: true }),
} as unknown as Auth;
const match: MatchSummary = {
  roomId: 'private-stable-room-id',
  roomCode: null,
  startedAt: null,
  finishedAt: null,
  turns: 42,
  outcome: 'playing',
  points: 7,
  resumable: true,
  players: [
    { id: 'seat-a', name: profile.name, profile, points: 7, winner: false },
    { id: 'seat-b', name: 'Oak', points: 6, winner: false },
  ],
};
const data: PlayerGames = { stats: { played: 12, wins: 4 }, games: [match], nextCursor: null };
const state: PlayerGameState = { data, error: '', loading: false, refresh: noop, loadMore: noop };
const renderHub = (props: Partial<Parameters<typeof PlayerHub>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PlayerHub, {
      auth,
      games: state,
      busy: false,
      onCreate: noop,
      onJoin: async () => {},
      onResume: noop,
      onProfile: noop,
      onFriends: noop,
      onSettings: noop,
      onSignOut: noop,
      ...props,
    }),
  );
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

test('signed-in home preserves setup, invite precedence and local mode while admitting both registered guests and Google accounts', () => {
  assert.equal(showPlayerHome(auth, null), true);
  const guest = { ...auth, account: { ...account, isGuest: true } };
  assert.equal(showPlayerHome(guest, null), true);
  assert.equal(showPlayerHome(auth, 'AB2C'), false);
  assert.equal(showPlayerHome({ ...auth, canPlay: false }, null), false);
  assert.equal(showPlayerHome({ ...auth, account: { ...account, registered: false } }, null), false);
  assert.equal(showPlayerHome({ ...auth, account: null }, null), false);
  assert.equal(showPlayerHome({ ...auth, config: { mode: 'local' } }, null), false);
});

test('player lobby exposes history, profile and social controls without opening a room or forcing a join form', () => {
  const html = renderHub();
  for (const label of [
    'Player lobby',
    'Game history',
    'View FernCaptain&#x27;s profile',
    'Friends',
    'Create room',
    'Join room',
    'Resume game',
  ])
    assert.ok(html.includes(label), label);
  assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('Continue with Google'));
  assert.ok(!html.includes('guest login'));
  assert.match(html, /<dd>4<\/dd>/);
  assert.match(html, /<dd>12<\/dd>/);
});

test('join intent reveals a labelled explicit form and busy connections disable every room-entry action', () => {
  const html = renderHub({ initialJoin: true, busy: true });
  assert.match(html, /<label for="hub-room-code">Room code<\/label>/);
  assert.match(html, /maxLength="8"/); // Accept older codes while new rooms use four.
  assert.match(html, /autoCapitalize="characters"/);
  assert.ok(!html.includes('Resume game'));
  for (const label of ['Join room', 'Cancel joining', 'Create room']) {
    assert.ok(
      buttons(html)
        .find((button) => button.includes(label))
        ?.includes('disabled=""'),
      label,
    );
  }
});

test('history distinguishes unfinished games, excludes invented dates, and only offers resume when the server permits it', () => {
  const html = renderToStaticMarkup(createElement(MatchRow, { game: match, onResume: noop }));
  assert.ok(html.includes('In progress') && html.includes('Earlier game'));
  assert.ok(!html.includes('datetime=') && !html.includes('private-stable-room-id'));
  assert.ok(html.includes('Players and scores') && html.includes('Return to game'));
  for (const outcome of ['won', 'lost', 'resigned'] as const) {
    const done = renderToStaticMarkup(
      createElement(MatchRow, { game: { ...match, outcome, resumable: false }, onResume: noop }),
    );
    assert.ok(!done.includes('Return to game'));
  }
});

test('unknown stats remain unknown and errors never masquerade as an empty match history', () => {
  const unknown = renderToStaticMarkup(createElement(PlayerStats, {}));
  assert.equal((unknown.match(/<dd>—<\/dd>/g) ?? []).length, 2);
  const html = renderToStaticMarkup(
    createElement(MatchHistory, {
      state: { ...state, data: null, error: 'Could not reach your account.' },
      onResume: noop,
    }),
  );
  assert.ok(html.includes('Could not reach your account.') && html.includes('Try again'));
  assert.ok(!html.includes('No games yet'));
  const empty = renderToStaticMarkup(
    createElement(MatchHistory, { state: { ...state, data: { ...data, games: [] } }, onResume: noop }),
  );
  assert.ok(empty.includes('No games yet'));
});

test('pagination retains room identity, updates existing results and uses the latest total and cursor', () => {
  const next: PlayerGames = {
    stats: { played: 13, wins: 5 },
    nextCursor: 'next',
    games: [
      { ...match, outcome: 'won', points: 10 },
      { ...match, roomId: 'second-room' },
    ],
  };
  const merged = mergePlayerGames(data, next);
  assert.equal(merged.games.length, 2);
  assert.equal(merged.games[0]?.outcome, 'won');
  assert.equal(merged.games[0]?.points, 10);
  assert.deepEqual(merged.stats, next.stats);
  assert.equal(merged.nextCursor, 'next');
});

test('profile opens on the player record rather than an editor and cannot silently switch rooms', () => {
  const html = renderToStaticMarkup(
    createElement(PlayerProfile, {
      auth,
      profile,
      games: state,
      busy: false,
      resumeDisabled: true,
      onSave: async () => {},
      onResume: noop,
    }),
  );
  assert.ok(html.includes('FernCaptain') && html.includes('Edit profile'));
  assert.ok(html.includes('Recent games') && html.includes('Games played'));
  assert.ok(!html.includes('<input'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Return to game'))
      ?.includes('disabled=""'),
  );
  assert.ok(
    !buttons(html)
      .find((button) => button.includes('Edit profile'))
      ?.includes('disabled=""'),
  );
});

test('guests keep the same player lobby and profile but have a clear account-link path', () => {
  const guest = { ...auth, account: { ...account, isGuest: true } };
  const html = renderHub({ auth: guest });
  assert.ok(html.includes('Guest') && html.includes('Link Google to add friends.'));
  const regular = renderHub();
  assert.ok(!regular.includes('Link Google to add friends.'));
});

test('room invitations contribute to the friends badge and appear before the main hub content', () => {
  const html = renderHub({
    invitationCount: 2,
    notifications: createElement('aside', { 'aria-label': 'Game invitation' }, 'Mossling invited you'),
  });
  assert.ok(html.includes('Friends, 2 invitations and requests'));
  assert.ok(html.indexOf('Mossling invited you') < html.indexOf('hub-lobby-content'));
});

test('the hub presents the player identity once rather than repeating it in the header', () => {
  const html = renderHub();
  const header = html.match(/<header class="hub-header">([\s\S]*?)<\/header>/)?.[1] ?? '';
  assert.ok(!header.includes('FernCaptain'));
  assert.ok(!header.includes('avatar-medallion'));
  assert.ok(html.includes('hub-character-portrait') && html.includes('View FernCaptain'));
});
