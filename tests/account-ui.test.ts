import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountSetup } from '../apps/client/src/AccountSetup.js';
import {
  FriendsPanel,
  FriendSearchResults,
  FriendRemovalConfirmation,
  FriendSearchSequence,
} from '../apps/client/src/FriendsPanel.js';
import { FriendsDrawer } from '../apps/client/src/FriendsDrawer.js';
import { Avatar, ProfileEditor, canSaveProfile, gameProfileDraft } from '../apps/client/src/Profile.js';
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
    lastActiveAt: '2026-09-09T00:00:00Z',
    expiresAt: null,
  };
  return {
    account,
    loading: false,
    friends: emptyFriends(),
    checkUsername: async () => ({ available: true }),
    saveProfile: async (input: Profile) => input,
    signIn: async () => {},
    refreshFriends: async () => {},
  } as unknown as Auth;
}
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

test('legacy Google avatars always render the chosen game portrait without requesting a provider photo', () => {
  for (const avatarUrl of [
    photo,
    'http://lh3.googleusercontent.com/a/photo',
    'javascript:alert(1)',
    'https://example.com/photo',
    'https://lh3.googleusercontent.com.evil.example/photo',
  ]) {
    const profile = { ...defaultProfile('Captain'), avatar: 6, avatarSource: 'google' as const, avatarUrl };
    const html = renderToStaticMarkup(createElement(Avatar, { profile }));
    assert.ok(html.includes('<image href="/art/optimized/avatars-fantasy.6bf04e83341a.webp"'));
    assert.match(html, /viewBox="724 350 362 348"/);
    assert.ok(!html.includes('<img') && !html.includes('avatar-photo'));
    assert.ok(!html.includes(avatarUrl));
  }
});

test('profile edits strip obsolete provider fields while retaining the chosen username and avatar', () => {
  const legacy = {
    ...defaultProfile('Captain'),
    username: 'Captain',
    avatar: 8,
    avatarSource: 'google' as const,
    avatarUrl: photo,
    full_name: 'Private Provider Name',
  };
  assert.deepEqual(gameProfileDraft(legacy), {
    ...defaultProfile('Captain'),
    username: 'Captain',
    avatar: 8,
  });
  assert.equal(gameProfileDraft({ ...legacy, avatar: 99 }).avatar, 0);
  assert.ok(!JSON.stringify(gameProfileDraft(legacy)).includes(photo));
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

test('the editor offers exactly twelve game portraits and selects the stored game avatar for legacy profiles', () => {
  const legacy = {
    ...defaultProfile('Captain'),
    avatar: 9,
    avatarSource: 'google' as const,
    avatarUrl: photo,
  };
  const html = renderToStaticMarkup(
    createElement(ProfileEditor, {
      initial: legacy,
      busy: false,
      onSave: async () => {},
      checkUsername: async () => ({ available: true }),
      submitLabel: 'Continue',
    }),
  );
  assert.equal([...html.matchAll(/aria-pressed=/g)].length, 12);
  assert.equal([...html.matchAll(/aria-pressed="true"/g)].length, 1);
  assert.ok(!html.includes('Use my Google photo') && !html.includes(photo));
  assert.ok(html.includes('Mushroom wanderer'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Tide trader'))
      ?.includes('aria-pressed="true"'),
  );
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Continue'))
      ?.includes('disabled=""'),
  );
});

test('account setup never prefills a provider display name, even from an older profile', () => {
  const auth = authFor();
  auth.account!.username = null;
  auth.account!.registered = false;
  auth.account!.profile = { ...defaultProfile('Private Provider Name'), avatar: 7 };
  const html = renderToStaticMarkup(createElement(AccountSetup, { auth }));
  assert.match(html, /value=""/);
  assert.ok(!html.includes('Private Provider Name'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Goblin merchant'))
      ?.includes('aria-pressed="true"'),
  );
  auth.account!.username = 'ChosenCaptain';
  const chosen = renderToStaticMarkup(createElement(AccountSetup, { auth }));
  assert.match(chosen, /value="ChosenCaptain"/);
  assert.ok(!chosen.includes('Private Provider Name'));
});

test('Google onboarding ignores real name, photo and email metadata and needs only a verified chosen username', () => {
  const auth = authFor();
  auth.account!.username = null;
  auth.account!.registered = false;
  auth.account!.profile = null;
  const realName = 'Private Provider Name';
  const email = 'private-person@example.com';
  Object.assign(auth, {
    user: {
      id: 'me',
      email,
      user_metadata: { name: realName, full_name: realName, email, picture: photo, avatar_url: photo },
      identities: [{ provider: 'google', identity_data: { full_name: realName, email, avatar_url: photo } }],
    },
  });
  const html = renderToStaticMarkup(createElement(AccountSetup, { auth }));
  for (const privateValue of [realName, email, photo]) assert.ok(!html.includes(privateValue));
  assert.match(html, /value=""/);
  assert.equal([...html.matchAll(/aria-pressed="true"/g)].length, 1);
  assert.ok(
    buttons(html)
      .find((button) => button.includes('Fox cartographer'))
      ?.includes('aria-pressed="true"'),
  );
  const draft = gameProfileDraft(defaultProfile('MyCaptain'));
  assert.equal(draft.avatar, 0, 'the default game portrait is already selected');
  assert.equal(canSaveProfile(draft, true, null), false);
  assert.equal(canSaveProfile(draft, true, { name: 'MyCaptain', status: 'checking' }), false);
  assert.equal(canSaveProfile(draft, true, { name: 'OtherName', status: 'available' }), false);
  assert.equal(
    canSaveProfile(draft, true, { name: 'MyCaptain', status: 'available' }),
    true,
    'a verified username may continue without changing the default avatar',
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
    'Players',
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

test('friends drawer has one clear title, a native modal, and a labelled search with its own clear space', () => {
  const html = renderToStaticMarkup(createElement(FriendsDrawer, { auth: authFor(), onClose: () => {} }));
  assert.match(html, /<dialog[^>]+class="friends-drawer"[^>]+aria-labelledby=/);
  assert.equal([...html.matchAll(/<h2[^>]*>Friends<\/h2>/g)].length, 1);
  assert.match(html, /aria-label="Close friends"/);
  assert.match(html, /<form[^>]+role="search"/);
  assert.match(html, /<label for="[^"]+">Find a player<\/label>/);
  assert.match(html, /type="search"[^>]+maxLength="20"/);
  assert.ok(html.indexOf('roster-fixed') < html.indexOf('roster-scroll'));
  assert.ok(!html.includes('Your friends'));
});

test('confirmed friends show explicit server presence while unknown and pending presence stays unknown', () => {
  const auth = authFor();
  const pendingPlayer = { ...person('RequestPlayer'), online: true };
  const searchPlayer = { ...person('SearchPlayer'), online: true };
  auth.friends = {
    friends: [
      { ...person('OnlinePlayer'), online: true },
      { ...person('OfflinePlayer'), online: false },
      person('UnknownPlayer'),
    ],
    incoming: [pendingPlayer],
    outgoing: [],
  };
  const html = renderToStaticMarkup(createElement(FriendsPanel, { auth }));
  assert.equal([...html.matchAll(/class="roster-presence"/g)].length, 2);
  assert.equal([...html.matchAll(/data-online="true"/g)].length, 1);
  assert.equal([...html.matchAll(/data-online="false"/g)].length, 1);
  assert.ok(html.includes('UnknownPlayer') && html.includes('RequestPlayer'));
  const search = renderToStaticMarkup(
    createElement(FriendSearchResults, {
      results: [searchPlayer],
      friendships: auth.friends,
      busy: false,
      onRequest: () => {},
    }),
  );
  assert.ok(!search.includes('roster-presence'));
});

test('removing a friend begins with an icon and requires a named, separate confirmation', () => {
  const auth = authFor();
  auth.friends.friends = [person('Sailor')];
  const html = renderToStaticMarkup(createElement(FriendsPanel, { auth }));
  const remove = buttons(html).find((button) => button.includes('Remove Sailor from friends'))!;
  assert.match(remove, /<svg/);
  assert.match(remove, /aria-expanded="false"/);
  assert.ok(!remove.includes('>Remove<'));
  assert.ok(!html.includes('from your friends?'));
  const confirmation = renderToStaticMarkup(
    createElement(FriendRemovalConfirmation, {
      account: person('Sailor'),
      busy: false,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.match(confirmation, /role="group" aria-labelledby=/);
  assert.ok(confirmation.includes('<strong>Sailor</strong> from your friends?'));
  assert.ok(
    buttons(confirmation)
      .find((button) => button.includes('Keep friend'))
      ?.includes('autofocus=""'),
  );
  assert.ok(buttons(confirmation).some((button) => button.includes('>Remove<')));
  const pending = renderToStaticMarkup(
    createElement(FriendRemovalConfirmation, {
      account: person('Sailor'),
      busy: true,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(buttons(pending).every((button) => button.includes('disabled=""')));
});

test('cleared, edited and abandoned searches cannot overwrite newer search results or errors', async () => {
  const sequence = new FriendSearchSequence();
  let visible = '';
  let finishOld!: (value: string) => void;
  let failOld!: (error: Error) => void;
  const search = async (response: Promise<string>) => {
    const version = sequence.start();
    try {
      const value = await response;
      if (sequence.isCurrent(version)) visible = value;
    } catch (error) {
      if (sequence.isCurrent(version)) visible = (error as Error).message;
    }
  };
  const old = search(
    new Promise((resolve) => {
      finishOld = resolve;
    }),
  );
  sequence.invalidate(); // Input was edited before the first response arrived.
  await search(Promise.resolve('new username'));
  finishOld('old username');
  await old;
  assert.equal(visible, 'new username');
  const failed = search(
    new Promise((_, reject) => {
      failOld = reject;
    }),
  );
  sequence.invalidate(); // Clearing the input or leaving this account cancels the request lifetime.
  visible = '';
  failOld(new Error('late error'));
  await failed;
  assert.equal(visible, '');
});
