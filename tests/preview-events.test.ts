import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import {
  PREVIEW_EVENTS,
  previewEvent,
  previewOpenTrade,
  previewRobber,
  previewTrade,
} from '../apps/client/src/dev/preview-events.js';
import { deriveAwardCelebrations, deriveFeedback } from '../apps/client/src/feedback.js';
import type { Game } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';
const seats = ['Alice', 'Bob', 'Cara', 'Drew'].map((name, i) => ({
  id: `p${i}`,
  name,
  ready: true,
  connected: true,
}));
function fixture() {
  let game = createGame(seats, 481, () => 0.34);
  while (!game.turn) {
    const id = game.players[game.active]!.id,
      legal = gameView(game, id).legal;
    game = applyAction(
      game,
      id,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.34,
    );
  }
  game.turn = 8;
  return game;
}
const room = (game: Game, revision: number): RoomState => ({
  roomId: 'preview',
  roomCode: 'TEST',
  revision,
  counter: 0,
  players: seats,
  game: gameView(game, 'p0'),
});
test('every preview event uses real rules and produces public visual/audio feedback without mutating its fixture', () => {
  const base = fixture(),
    saved = structuredClone(base);
  for (const event of Object.keys(PREVIEW_EVENTS) as (keyof typeof PREVIEW_EVENTS)[]) {
    const { before, after } = previewEvent(base, 'p0', event);
    const first = room(before, 1),
      next = room(after, 2);
    const feedback = deriveFeedback(first, next, 'p0')!;
    assert.ok(feedback.sounds.length || deriveAwardCelebrations(first, next).length, event);
    if (event === 'longestRoad' || event === 'largestArmy')
      assert.equal(deriveAwardCelebrations(first, next)[0]!.kind, event);
    if (event === 'win') {
      assert.equal(after.winner, 'p0');
      assert.ok(feedback.sounds.includes('win'));
    }
    if (event === 'buy') {
      const spending = feedback.flights.filter((f) => f.spending);
      assert.equal(spending.length, 3);
      assert.ok(spending.every((f) => f.to === '[data-development-purchase]'));
    }
  }
  assert.deepEqual(base, saved);
});
test('robber and trade scenarios expose the real decision states for local UI inspection', () => {
  const base = fixture();
  assert.ok(previewRobber(base, 'p0', 'discard').discards.p0);
  assert.equal(previewRobber(base, 'p0', 'waiting').discards.p0, undefined);
  assert.equal(previewRobber(base, 'p0', 'robber').phase, 'robber');
  const offer = previewTrade(base, 'p0', false);
  assert.equal(offer.trade!.proposals!.length, 2);
  assert.equal(offer.trade!.player, 'p0');
  const received = previewTrade(base, 'p0', true);
  assert.notEqual(received.trade!.player, 'p0');
  assert.equal(received.phase, 'actions');
});
test('a big table can show every seat discarding and an open offer answered every way', () => {
  const base = fixture();
  // The preview seats a fifth and sixth player after setup, as the rules deal four at most.
  for (const id of ['p4', 'p5'])
    base.players.push({
      id,
      name: id,
      hand: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      cards: [],
      knights: 0,
    });
  assert.deepEqual(Object.keys(previewRobber(base, 'p0', 'waiting', true).discards).sort(), [
    'p1',
    'p2',
    'p3',
    'p4',
    'p5',
  ]);
  assert.equal(Object.keys(previewRobber(base, 'p0', 'discard', true).discards).length, 6);
  // Four seats still show one discard, as before.
  assert.deepEqual(Object.keys(previewRobber(fixture(), 'p0', 'waiting').discards), ['p1']);
  const open = previewOpenTrade(base, 'p0');
  assert.equal(open.trade!.open, true);
  assert.deepEqual(
    open.trade!.proposals!.map((p) => p.player),
    ['p1', 'p2', 'p3'],
  );
  assert.deepEqual(open.trade!.declinedBy, ['p4']);
});
