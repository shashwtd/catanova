import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AwardPresentationQueue, deriveAwardCelebrations } from '../apps/client/src/feedback.js';
import { AwardToast } from '../apps/client/src/GameEffects.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';

function room(revision = 1): RoomState {
  const players = ['Alice', 'Bob', 'Cara'].map((name, index) => ({ id: `p${index}`, name, connected: true }));
  return {
    roomId: 'AWARDS23',
    revision,
    counter: 0,
    players,
    game: gameView(
      createGame(players, 42, () => 0.34),
      'p0',
    ),
  };
}
function claim(before: RoomState, kind: 'longestRoad' | 'largestArmy', playerId: string, count: number) {
  const next = structuredClone(before);
  next.revision++;
  next.game![kind] = playerId;
  next.game!.players.find((p) => p.id === playerId)![kind === 'longestRoad' ? 'roadLength' : 'knights'] =
    count;
  return next;
}

test('award celebrations use public committed counts, carry transfer credit, and ignore private cards', () => {
  const start = room();
  const first = claim(start, 'longestRoad', 'p1', 7);
  assert.equal(first.game!.players[1]!.cards, undefined);
  assert.deepEqual(deriveAwardCelebrations(start, first), [
    {
      id: 'AWARDS23:2:longestRoad',
      kind: 'longestRoad',
      name: 'Longest Road',
      playerId: 'p1',
      playerName: 'Bob',
      previousPlayerName: undefined,
      count: 7,
      minimum: 5,
    },
  ]);
  const transfer = claim(first, 'longestRoad', 'p2', 8);
  const changed = deriveAwardCelebrations(first, transfer)[0]!;
  assert.equal(changed.playerName, 'Cara');
  assert.equal(changed.previousPlayerName, 'Bob');
  assert.equal(changed.count, 8);
  const army = claim(transfer, 'largestArmy', 'p0', 4);
  assert.equal(deriveAwardCelebrations(transfer, army)[0]!.count, 4);
  assert.equal(deriveAwardCelebrations(transfer, army)[0]!.minimum, 3);
});

test('award ownership, rather than increased counts or stale journal lines, controls celebrations', () => {
  const before = claim(room(), 'longestRoad', 'p0', 5);
  const extended = claim(before, 'longestRoad', 'p0', 6);
  assert.deepEqual(deriveAwardCelebrations(before, extended), []);
  extended.game!.log.push({ id: 10, text: 'Bob claimed Largest Army (+2 points).' });
  assert.deepEqual(deriveAwardCelebrations(before, extended), [], 'journal text cannot invent an award');
  const revoked = { ...structuredClone(extended), revision: extended.revision + 1 };
  revoked.game!.longestRoad = null;
  assert.deepEqual(deriveAwardCelebrations(extended, revoked), [], 'an unclaimed award has no new winner');
  assert.deepEqual(deriveAwardCelebrations(null, before), []);
  assert.deepEqual(deriveAwardCelebrations(before, before), []);
  assert.deepEqual(deriveAwardCelebrations(extended, before), []);
  assert.deepEqual(deriveAwardCelebrations(before, { ...extended, roomId: 'OTHER234' }), []);
});

test('both awards and rapid transfers remain ordered until each celebration finishes', () => {
  const before = room();
  const both = claim(before, 'longestRoad', 'p0', 6);
  both.game!.largestArmy = 'p1';
  both.game!.players[1]!.knights = 3;
  const queue = new AwardPresentationQueue();
  const first = queue.observe(before, both);
  assert.deepEqual(
    first.map((award) => award.kind),
    ['longestRoad', 'largestArmy'],
  );
  const transfer = claim(both, 'longestRoad', 'p2', 7);
  const pending = queue.observe(both, transfer);
  assert.deepEqual(
    pending.map((award) => award.playerName),
    ['Alice', 'Bob', 'Cara'],
  );
  assert.equal(queue.observe(before, both), pending, 'late/duplicate snapshots never append again');
  assert.equal(queue.finish(pending[1]!.id), pending, 'a stale timer cannot skip the current award');
  const second = queue.finish(pending[0]!.id);
  assert.deepEqual(
    second.map((award) => award.playerName),
    ['Bob', 'Cara'],
  );
  assert.deepEqual(
    queue.finish(second[0]!.id).map((award) => award.playerName),
    ['Cara'],
  );
});

test('resync, hidden-tab snapshots and room changes discard award playback without replaying history', () => {
  const before = room(),
    after = claim(before, 'longestRoad', 'p0', 6);
  const queue = new AwardPresentationQueue();
  assert.equal(queue.observe(before, after).length, 1);
  assert.deepEqual(
    queue.observe(before, after, false),
    [],
    'welcome/resync clears even a duplicate revision',
  );
  assert.deepEqual(queue.observe(before, after), [], 'the restored revision stays consumed');
  const extended = claim(after, 'longestRoad', 'p0', 7);
  assert.deepEqual(queue.observe(after, extended), []);
  const fresh = claim(extended, 'largestArmy', 'p1', 3);
  assert.equal(queue.observe(extended, fresh).length, 1, 'a genuinely new live award still plays');
  queue.reset();
  assert.deepEqual(queue.observe(fresh, fresh, false), []);
  const otherBefore = { ...room(), roomId: 'OTHER234' };
  const other = claim(otherBefore, 'longestRoad', 'p1', 5);
  assert.deepEqual(queue.observe(otherBefore, other), [], 'switching rooms is a baseline, not an old award');
});

test('profiles show the longest continuous route, not total pieces, and Knights already played', () => {
  const state = room();
  const saved = createGame(state.players, 42, () => 0.34);
  const junction = saved.board.vertices.find((vertex) => vertex.edges.length === 3)!;
  for (const edge of junction.edges) saved.roads[edge] = 'p1';
  saved.players[1]!.knights = 4;
  saved.players[1]!.cards = [{ id: 'secret-knight', kind: 'knight', boughtTurn: 0 }];
  saved.largestArmy = 'p1';
  const game = gameView(saved, 'p0');
  assert.equal(game.players[1]!.roadLength, 2, 'a fork with three edges has a two-edge continuous route');
  const html = renderToStaticMarkup(createElement(PlayerRail, { room: state, game, me: 'p0' }));
  const bob = html.match(/<article[^>]*data-player-profile="p1"[\s\S]*?<\/article>/)![0];
  assert.match(bob, /aria-label="Longest route, 2 connected roads"/);
  assert.match(bob, /aria-label="Largest Army, plus 2 victory points, 4 Knights played"/);
  assert.match(bob, /<b>4<\/b><small>\+2<\/small>/);
  assert.ok(!html.includes('secret-knight'));
  assert.equal([...html.matchAll(/aria-label="Award progress"/g)].length, 3);
});

test('the nonblocking award toast names the recipient, requirement, count and prior holder', () => {
  const first = claim(room(), 'longestRoad', 'p0', 5);
  const next = claim(first, 'longestRoad', 'p1', 7);
  const award = deriveAwardCelebrations(first, next)[0]!;
  const html = renderToStaticMarkup(createElement(AwardToast, { award, reducedMotion: true }));
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /Bob takes/);
  assert.match(html, /Longest Road/);
  assert.match(html, /<b>7<\/b> roads in one continuous route/);
  assert.match(html, /minimum 5/);
  assert.match(html, /Previously held by Alice/);
  assert.match(html, /<b>\+2<\/b><span>points<\/span>/);
  assert.ok(!html.includes('role="dialog"'));
});
