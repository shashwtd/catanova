import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, gameView, applyAction, emptyHand } from '../packages/rules/src/game.js';
import type { GameView } from '../packages/rules/src/game.js';
import { placementValid } from '../apps/client/src/placement.js';
import type { BuildAction, PlacementDraft } from '../apps/client/src/placement.js';

function draft(game: GameView, action: BuildAction): PlacementDraft {
  return {
    action,
    roomId: 'ABCDEFG2',
    player: 'a',
    turn: game.turn,
    phase: game.phase,
    setupIndex: game.setupIndex,
  };
}
const initial = () =>
  createGame(
    [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Cara' },
    ],
    42,
    () => 0.25,
  );

test('a starting-piece confirmation is valid only for the same room, owner, phase and setup step', () => {
  const game = initial(),
    view = gameView(game, 'a'),
    action = { kind: 'settlement' as const, vertex: view.legal.settlements[0]! },
    intent = draft(view, action),
    before = structuredClone(view);
  assert.ok(placementValid(intent, view, 'ABCDEFG2', 'a'));
  assert.deepEqual(view, before, 'preview validation cannot install a piece');
  assert.ok(!placementValid(intent, view, 'OTHER234', 'a'));
  assert.ok(!placementValid(intent, view, 'ABCDEFG2', 'b'));
  assert.ok(!placementValid(intent, { ...view, setupIndex: 1 }, 'ABCDEFG2', 'a'));
  const placed = gameView(
    applyAction(game, 'a', action, () => 0.25),
    'a',
  );
  assert.ok(
    !placementValid(intent, placed, 'ABCDEFG2', 'a'),
    'a confirmed or advanced setup invalidates its old intent',
  );
});

test('payment or occupancy changes invalidate a build preview before it can be confirmed', () => {
  const game = initial();
  game.phase = 'actions';
  game.turn = 3;
  game.buildings[0] = { player: 'a', kind: 'settlement' };
  game.players[0]!.hand = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  const view = gameView(game, 'a');
  const road = draft(view, { kind: 'road', edge: view.legal.roads[0]! }),
    city = draft(view, { kind: 'city', vertex: 0 });
  assert.ok(placementValid(road, view, 'ABCDEFG2', 'a'));
  assert.ok(placementValid(city, view, 'ABCDEFG2', 'a'));
  game.players[0]!.hand = emptyHand();
  assert.ok(!placementValid(road, gameView(game, 'a'), 'ABCDEFG2', 'a'));
  assert.ok(!placementValid(city, gameView(game, 'a'), 'ABCDEFG2', 'a'));
  for (const changed of [
    { ...view, turn: 4 },
    { ...view, active: 1 },
    { ...view, winner: 'b' },
    { ...view, legal: { ...view.legal, roads: [] } },
  ])
    assert.ok(!placementValid(road, changed, 'ABCDEFG2', 'a'));
});

test('stale legal hints cannot create a confirmation during a non-build phase', () => {
  const view = gameView(initial(), 'a');
  for (const phase of ['roll', 'robber', 'discard', 'finished'] as const) {
    const stale = { ...view, phase };
    assert.ok(
      !placementValid(
        draft(stale, { kind: 'settlement', vertex: view.legal.settlements[0]! }),
        stale,
        'ABCDEFG2',
        'a',
      ),
    );
  }
});
