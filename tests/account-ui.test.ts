import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountSetup } from '../apps/client/src/AccountSetup.js';
import { FriendsPanel, FriendSearchResults } from '../apps/client/src/FriendsPanel.js';
import { Avatar, ProfileEditor } from '../apps/client/src/Profile.js';
import type { useAuth } from '../apps/client/src/auth.js';
import { defaultProfile, emptyFriends } from '../packages/protocol/src/profile.js';
import type { Account, Profile, PublicAccount } from '../packages/protocol/src/profile.js';

type Auth = ReturnType<typeof useAuth>;
const photo = 'https://lh3.googleusercontent.com/a/photo=s96-c';
const person = (id: string, isGuest = false): PublicAccount => ({
  id,
  username: id,
  isGuest,
  profile: defaultProfile(id),
});
function authFor(isGuest = false): Auth {
  const account: Account = {
    id: 'me',
    username: 'Captain',
    isGuest,
    registered: true,
    profile: defaultProfile('Captain'),
    googleAvatarUrl: photo,
    lastActiveAt: '2026-09-09T00:00:00Z',
    expiresAt: null,
  };
  return {
    account,
    googleAvatarUrl: photo,
    loading: false,
    friends: emptyFriends(),
    checkUsername: async () => ({ available: true }),
    saveProfile: async (input: Profile) => input,
    signIn: async () => {},
    refreshFriends: async () => {},
  } as unknown as Auth;
}
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

test('Google avatars use the verified HTTPS image with no referrer and unsafe URLs retain a generated portrait', () => {
  const profile = { ...defaultProfile('Captain'), avatarSource: 'google' as const, avatarUrl: photo };
  const html = renderToStaticMarkup(createElement(Avatar, { profile }));
  assert.match(html, /class="avatar-photo"/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.ok(html.includes(photo));
  assert.ok(!html.includes('<image href="/art/optimized/avatars-fantasy.6bf04e83341a.webp"'));
  for (const avatarUrl of [
    'http://lh3.googleusercontent.com/a/photo',
    'javascript:alert(1)',
    'https://example.com/photo',
    'https://lh3.googleusercontent.com.evil.example/photo',
  ]) {
    const fallback = renderToStaticMarkup(createElement(Avatar, { profile: { ...profile, avatarUrl } }));
    assert.ok(fallback.includes('<image href="/art/optimized/avatars-fantasy.6bf04e83341a.webp"'));
    assert.ok(!fallback.includes('class="avatar-photo"'));
  }
});

test('username setup starts without a selected name and cannot submit before the availability check', () => {
  const auth = authFor(true);
  auth.account!.username = null;
  auth.account!.profile = null;
  auth.account!.registered = false;
  const html = renderToStaticMarkup(createElement(AccountSetup, { auth }));
  assert.match(html, />Username<input/);
  assert.match(html, /maxLength="20"/);
  assert.match(html, /minLength="3"/);
  assert.match(html, /value=""/);
  assert.match(html, /Use 3–20 letters, numbers or underscores/);
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Continue'))
      ?.includes('disabled=""'),
  );
  assert.ok(html.includes('You can link Google later and keep this username.'));
});

test('the optional Google choice and all twelve generated portraits retain one clear selected avatar', () => {
  const html = renderToStaticMarkup(
    createElement(ProfileEditor, {
      initial: { ...defaultProfile('Captain'), avatarSource: 'google', avatarUrl: photo },
      busy: false,
      onSave: async () => {},
      googleAvatarUrl: photo,
      checkUsername: async () => ({ available: true }),
      submitLabel: 'Continue',
    }),
  );
  assert.equal([...html.matchAll(/aria-pressed=/g)].length, 13);
  assert.equal([...html.matchAll(/aria-pressed="true"/g)].length, 1);
  assert.ok(html.includes('Use my Google photo'));
  assert.ok(html.includes('Mushroom wanderer'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Continue'))
      ?.includes('disabled=""'),
  );
});

test('guest friends UI offers explicit Google linking without exposing friend request actions', () => {
  const html = renderToStaticMarkup(createElement(FriendsPanel, { auth: authFor(true) }));
  assert.ok(html.includes('Link Google to add friends and keep your username.'));
  assert.equal(buttons(html).length, 1);
  assert.ok(buttons(html)[0]!.includes('Link Google'));
  assert.ok(!html.includes('Find a username') && !html.includes('Received requests'));
});

test('friends lists expose explicit accept, decline, cancel and remove actions', () => {
  const auth = authFor();
  auth.friends = { friends: [person('Sailor')], incoming: [person('Mason')], outgoing: [person('Fox')] };
  const html = renderToStaticMarkup(createElement(FriendsPanel, { auth }));
  for (const label of [
    'Received requests',
    'Sent requests',
    'Your friends',
    'Accept Mason&#x27;s friend request',
    'Decline Mason&#x27;s friend request',
    'Cancel friend request to Fox',
    'Remove Sailor from friends',
  ])
    assert.ok(html.includes(label), label);
  assert.ok(!html.includes('Invite'));
});

test('search results prevent adding guests and duplicate relationships, while escaping displayed usernames', () => {
  const results = [
    person('Guest', true),
    person('Available'),
    person('Friend'),
    person('Sent'),
    person('Received'),
    person('<script>'),
  ];
  const html = renderToStaticMarkup(
    createElement(FriendSearchResults, {
      results,
      friendships: {
        friends: [person('Friend')],
        incoming: [person('Received')],
        outgoing: [person('Sent')],
      },
      busy: false,
      onRequest: () => {},
    }),
  );
  assert.ok(html.includes('Guest · needs Google'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Add Guest as a friend'))
      ?.includes('disabled=""'),
  );
  assert.ok(
    !buttons(html)
      .find((button) => button.includes('Add Available as a friend'))
      ?.includes('disabled=""'),
  );
  for (const name of ['Friend', 'Sent', 'Received'])
    assert.ok(!buttons(html).some((button) => button.includes(`Add ${name} as a friend`)));
  assert.ok(html.includes('Request sent') && html.includes('Request received'));
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
});
