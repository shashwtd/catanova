import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountHomePath,
  browserRoomPath,
  navigationRoomReference,
  previewJoinReference,
  roomNavigationState,
  roomPath,
  safeEntryPath,
  shouldResume,
} from '../apps/client/src/navigation.js';
import { newSession } from '../apps/client/src/connection.js';

const id = '9bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f';
const room = { roomId: id, roomCode: 'AB2C' };
test('signed-in home is distinct from the public landing and survives a safe OAuth return', () => {
  assert.equal(accountHomePath({ canPlay: false, config: { mode: 'authenticated' } }), '/');
  assert.equal(accountHomePath({ canPlay: true, config: { mode: 'authenticated' } }), '/play');
  assert.equal(accountHomePath({ canPlay: true, config: { mode: 'local' } }), '/');
  for (const path of ['/play', '/play/', '/play?source=google']) assert.equal(safeEntryPath(path), '/play');
  for (const path of ['/play/extra', '//example.com/play', '/play#evil', 'https://example.com/play'])
    assert.equal(safeEntryPath(path), '/');
  assert.equal(safeEntryPath(roomPath(id)), roomPath(id));
});
test('the short browser address keeps permanent identity in its own history entry', () => {
  assert.equal(browserRoomPath(room), '/room/AB2C');
  assert.equal(roomPath(room.roomId), `/room/${id}`, 'durable shared links do not expire with a code lease');
  const state = roomNavigationState(room);
  assert.equal(navigationRoomReference('/room/AB2C', '', state), id);
  assert.equal(navigationRoomReference('/room/AB2C/', '', state), id);
  assert.equal(
    navigationRoomReference('/room/XY3Z', '', state),
    'XY3Z',
    'an unrelated URL never inherits a previous room binding',
  );
  assert.equal(navigationRoomReference('/', '?room=XY3Z', state), 'XY3Z');
  assert.equal(navigationRoomReference('/play', '', state), null);
  assert.equal(
    navigationRoomReference('/room/AB2C', '', null),
    'AB2C',
    'a fresh short URL must be previewed',
  );
  assert.equal(
    shouldResume(
      { ...newSession('Player', id), joined: true },
      navigationRoomReference('/room/AB2C', '', state),
    ),
    true,
  );
});
test('corrupt browser history cannot inject external routes or bind one short alias to another', () => {
  for (const value of [
    undefined,
    null,
    [],
    { catanovaRoom: 'broken' },
    { catanovaRoom: { id: 'https://evil.test', path: '/room/AB2C' } },
    { catanovaRoom: { id: 'XY3Z', path: '/room/AB2C' } },
  ])
    assert.equal(navigationRoomReference('/room/AB2C', '', value), 'AB2C');
  assert.equal(browserRoomPath({ roomId: id, roomCode: 'garbage' }), roomPath(id));
});
test('joining a short link uses the exact previewed permanent identity instead of re-resolving an alias', () => {
  assert.equal(previewJoinReference('ab2c', room), id);
  assert.equal(previewJoinReference(id, room), id);
  assert.equal(previewJoinReference('XY3Z', room), null);
  assert.equal(previewJoinReference('AB2C', null), null);
  assert.equal(previewJoinReference('AB2C', { roomId: '/evil', roomCode: 'AB2C' }), null);
  const reused = { roomId: '0bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f', roomCode: 'AB2C' };
  assert.equal(previewJoinReference('AB2C', room), id);
  assert.notEqual(previewJoinReference('AB2C', room), reused.roomId);
});
