import test from 'node:test';
import assert from 'node:assert/strict';
import { GameLaunch, LAUNCH_LIMIT_MS, LAUNCH_MIN_MS } from '../apps/server/src/game-launch.js';
import type { RoomState } from '../packages/protocol/src/index.js';
function fixture() {
  let now = 100;
  const state: RoomState = {
    roomId: 'island',
    counter: 0,
    revision: 4,
    players: [
      { id: 'a', name: 'A', connected: true },
      { id: 'b', name: 'B', connected: true, ready: true },
    ],
  };
  let commits = 0;
  const failures: string[] = [];
  const request = { roomId: 'island', hostId: 'a', commandId: 'start-1234', revision: 4 };
  const gate = new GameLaunch({
    now: () => now,
    state: () => state,
    commit: () => {
      commits++;
    },
    changed: () => {},
    failed: (_, message) => failures.push(message),
  });
  return {
    gate,
    state,
    request,
    failures,
    commits: () => commits,
    advance: (ms: number) => {
      now += ms;
      gate.tick();
    },
  };
}
test('launch waits for every player and minimum two seconds, commits once', () => {
  const f = fixture();
  f.gate.begin(f.request);
  f.gate.ready('island', 'a', 'start-1234', true);
  f.advance(LAUNCH_MIN_MS);
  assert.equal(f.commits(), 0);
  f.gate.ready('island', 'b', 'wrong-id', true);
  assert.equal(f.commits(), 0);
  f.gate.ready('island', 'b', 'start-1234', true);
  assert.equal(f.commits(), 1);
  f.advance(10000);
  assert.equal(f.commits(), 1);
});
test('fast cached assets still keep the two-second minimum', () => {
  const f = fixture();
  f.gate.begin(f.request);
  for (const id of ['a', 'b']) f.gate.ready('island', id, 'start-1234', true);
  f.advance(LAUNCH_MIN_MS - 1);
  assert.equal(f.commits(), 0);
  f.advance(1);
  assert.equal(f.commits(), 1);
});
test('replayed start does not reset loading deadline and slow clients leave the game unstarted', () => {
  const f = fixture();
  f.gate.begin(f.request);
  const started = f.gate.view('island')!.startedAt;
  f.advance(9000);
  f.gate.begin(f.request);
  assert.equal(f.gate.view('island')!.startedAt, started);
  f.advance(1000);
  assert.equal(f.commits(), 0);
  assert.equal(f.failures.length, 1);
  assert.equal(f.gate.view('island'), undefined);
  assert.throws(() => f.gate.begin(f.request), /cancelled/);
  f.gate.ready('island', 'a', 'start-1234', true);
  assert.equal(f.commits(), 0);
});
test('disconnect, revision changes and asset errors cancel safely', () => {
  for (const cause of ['disconnect', 'revision', 'asset'] as const) {
    const f = fixture();
    f.gate.begin(f.request);
    if (cause === 'disconnect') f.state.players[1]!.connected = false;
    if (cause === 'revision') f.state.revision++;
    if (cause === 'asset') f.gate.ready('island', 'b', 'start-1234', false);
    f.advance(LAUNCH_LIMIT_MS);
    assert.equal(f.commits(), 0);
    assert.equal(f.failures.length, 1);
  }
});
test('only a ready host may initiate a launch; outsiders cannot send readiness', () => {
  const f = fixture();
  assert.throws(() => f.gate.begin({ ...f.request, hostId: 'b' }), /Only the host/);
  f.state.players[1]!.ready = false;
  assert.throws(() => f.gate.begin(f.request), /ready/);
  f.state.players[1]!.ready = true;
  f.gate.begin(f.request);
  f.gate.ready('island', 'outsider', 'start-1234', false);
  assert.equal(f.failures.length, 0);
});
