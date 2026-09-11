import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FriendsDrawer } from '../apps/client/src/FriendsDrawer.js';
import { RoomInviteInbox } from '../apps/client/src/RoomInvitePanel.js';
import type { useAuth } from '../apps/client/src/auth.js';
import type { RoomInvitesController } from '../apps/client/src/useRoomInvites.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import type { RoomInvite } from '../packages/protocol/src/room-invites.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
const id = '9bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f';
const account = (id: string) => ({ id, username: id, isGuest: false, profile: defaultProfile(id) });
const controller = (): RoomInvitesController => ({
  incoming: [],
  sent: [],
  busy: '',
  loading: false,
  error: '',
  refresh: async () => {},
  send: async () => true,
  dismiss: async () => true,
});
function auth(guest = false): ReturnType<typeof useAuth> {
  return {
    account: { ...account('Host'), registered: true, isGuest: guest },
    friends: {
      friends: [
        { ...account('Sailor'), online: true },
        { ...account('Mason'), online: false },
      ],
      incoming: [account('Pending')],
      outgoing: [],
    },
    loading: false,
    error: '',
    refreshFriends: async () => {},
    signIn: async () => {},
  } as unknown as ReturnType<typeof useAuth>;
}
const room = (): RoomState => ({
  roomId: id,
  roomCode: 'AB2C',
  revision: 1,
  counter: 0,
  players: [{ id: 'host-seat', name: 'Host', ready: false, connected: true }],
  settings: { turnTimerSeconds: 90 },
});
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

test('room invitation mode shows accepted friends with Invite actions and distinct room sharing below', () => {
  const html = renderToStaticMarkup(
    createElement(FriendsDrawer, { auth: auth(), room: room(), invites: controller(), onClose: () => {} }),
  );
  assert.equal([...html.matchAll(/<h2[^>]*>Invite friends<\/h2>/g)].length, 1);
  assert.ok(html.includes('Invite Sailor to this room') && html.includes('Invite Mason to this room'));
  assert.ok(
    !html.includes('Pending') && !html.includes('Remove Sailor') && !html.includes('Received requests'),
  );
  assert.ok(
    html.includes('Room details') && html.includes('<code>AB2C</code>') && html.includes('90s turns'),
  );
  assert.ok(!html.includes(id), 'the permanent identity is never printed as a visible room code');
  for (const label of ['Share room', 'Copy invite link', 'Copy room code'])
    assert.ok(html.includes(`aria-label="${label}"`));
});
test('guest room invitations preserve public room sharing and explain Google linking', () => {
  const html = renderToStaticMarkup(
    createElement(FriendsDrawer, {
      auth: auth(true),
      room: room(),
      invites: controller(),
      onClose: () => {},
    }),
  );
  assert.ok(html.includes('Link Google to invite friends and keep your username.'));
  assert.ok(!html.includes('Invite Sailor to this room') && !html.includes('Sailor'));
  assert.ok(buttons(html).some((button) => button.includes('Link Google')));
  assert.ok(html.includes('Copy invite link') && html.includes('Copy room code'));
});
test('sent invitations are scoped to the permanent room and full rooms disable further invitations', () => {
  const invites = controller();
  invites.sent = [{ id: 'invitation', roomId: id, to: 'Sailor', createdAt: 1, expiresAt: 999_999 }];
  let html = renderToStaticMarkup(
    createElement(FriendsDrawer, { auth: auth(), room: room(), invites, onClose: () => {} }),
  );
  assert.ok(html.includes('Invited') && !html.includes('Invite Sailor to this room'));
  assert.ok(html.includes('Invite Mason to this room'));
  invites.sent[0]!.roomId = 'another-room';
  html = renderToStaticMarkup(
    createElement(FriendsDrawer, { auth: auth(), room: room(), invites, onClose: () => {} }),
  );
  assert.ok(html.includes('Invite Sailor to this room'));
  const full = room();
  full.players = Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    name: `Member${i}`,
    connected: true,
    ready: false,
  }));
  html = renderToStaticMarkup(
    createElement(FriendsDrawer, { auth: auth(), room: full, invites, onClose: () => {} }),
  );
  assert.ok(html.includes('This room is full.'));
  assert.ok(
    buttons(html)
      .filter((button) => /Invite (Sailor|Mason) to this room/.test(button))
      .every((button) => button.includes('disabled=""')),
  );
});
test('received invitations clearly name the friend, preview the room and support dismissal', () => {
  const invite: RoomInvite = {
    id: 'invite',
    roomId: id,
    roomCode: 'AB2C',
    from: account('Sailor'),
    createdAt: 1,
    expiresAt: 300_001,
    players: 2,
  };
  const html = renderToStaticMarkup(
    createElement(RoomInviteInbox, {
      invitations: [invite],
      busy: false,
      onOpen: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(html.includes('Sailor') && html.includes('Invited you to play') && html.includes('AB2C'));
  assert.ok(buttons(html).some((button) => button.includes('View room')));
  assert.ok(html.includes('Dismiss room invitation from Sailor'));
  assert.ok(!html.includes(id));
});
test('an unavailable short code never exposes the UUID in room details or offers copying it as a code', () => {
  const noCode = room();
  delete noCode.roomCode;
  const html = renderToStaticMarkup(
    createElement(FriendsDrawer, { auth: auth(), room: noCode, invites: controller(), onClose: () => {} }),
  );
  assert.ok(!html.includes(id));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('aria-label="Copy room code"'))
      ?.includes('disabled=""'),
  );
  assert.ok(
    !buttons(html)
      .find((button) => button.includes('aria-label="Copy invite link"'))
      ?.includes('disabled=""'),
  );
});

test('a received invitation has a persistent live notice with sender, room action and dismissal', async () => {
  const { RoomInviteNotice } = await import('../apps/client/src/RoomInvitePanel.js');
  const invite: RoomInvite = {
    id: 'received',
    roomId: id,
    roomCode: 'AB2C',
    from: account('Sailor'),
    createdAt: 1,
    expiresAt: 300_001,
    players: 2,
  };
  const props = {
    invitations: [invite],
    busy: false,
    onOpen: () => {},
    onDismiss: () => {},
    onShowAll: () => {},
  };
  const html = renderToStaticMarkup(createElement(RoomInviteNotice, props));
  assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'));
  assert.ok(html.includes('Sailor') && html.includes('AB2C'));
  assert.ok(!html.includes('hidden=""'));
  assert.ok(buttons(html).some((button) => button.includes('View room')));
  assert.ok(html.includes('Dismiss invitation from Sailor'));
  assert.ok(!html.includes(id), 'private room identity is not displayed');
  const busy = renderToStaticMarkup(createElement(RoomInviteNotice, { ...props, busy: true }));
  assert.ok(
    buttons(busy)
      .filter((button) => button.includes('View room') || button.includes('Dismiss invitation'))
      .every((button) => button.includes('disabled=""')),
  );
  const blocked = renderToStaticMarkup(
    createElement(RoomInviteNotice, { ...props, blockedReason: 'Leave your current room to join another.' }),
  );
  assert.ok(blocked.includes('Leave your current room'));
  assert.ok(
    !buttons(blocked).some((button) => button.includes('View room')),
    'no invitation action that silently fails in an occupied room',
  );
  const empty = renderToStaticMarkup(createElement(RoomInviteNotice, { ...props, invitations: [] }));
  assert.ok(empty.includes('hidden=""') && !empty.includes('Sailor'));
});

test('room invitation drawer also shows incoming invitations and explains room switching', () => {
  const invites = controller();
  invites.incoming = [
    {
      id: 'received',
      roomId: 'another-room',
      roomCode: 'FERN',
      from: account('Mason'),
      createdAt: 1,
      expiresAt: 300_001,
      players: 2,
    },
  ];
  const html = renderToStaticMarkup(
    createElement(FriendsDrawer, {
      auth: auth(),
      room: room(),
      invites,
      onClose: () => {},
      onOpenRoom: () => {},
    }),
  );
  assert.ok(html.includes('Room invitations') && html.includes('FERN'));
  assert.ok(html.includes('Leave your current room to join another.'));
  assert.ok(
    buttons(html)
      .find((button) => button.includes('View room'))
      ?.includes('disabled=""'),
  );
  invites.incoming[0]!.roomId = id;
  const current = renderToStaticMarkup(
    createElement(FriendsDrawer, {
      auth: auth(),
      room: room(),
      invites,
      onClose: () => {},
      onOpenRoom: () => {},
    }),
  );
  assert.ok(!current.includes('Room invitations'), 'do not offer an invitation to the room already occupied');
});
