import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../apps/client/src/Board.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import { DICE_READABLE_MS } from '../apps/client/src/DiceThrow.js';
import {
  resourceCardArrival,
  resourceFlightStart,
  RESOURCE_FLIGHT_MS,
  RESOURCE_STAGGER_MS,
  MAX_RESOURCE_STAGGER,
  presentationHold,
  PROFILE_GAIN_DWELL_MS,
} from '../apps/client/src/useFeedback.js';
import { profileGainArrival } from '../apps/client/src/GameEffects.js';
import type { FeedbackEvent } from '../apps/client/src/feedback.js';

test('only the live production event lights tiles, while 2D pieces keep measured anchors and accessible labels', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    42,
    () => 0.25,
  );
  const view = gameView(game, 'a');
  view.dice = [3, 4];
  view.roads = { 0: 'a' };
  view.buildings = { 0: { player: 'a', kind: 'settlement' } };
  const props = {
    board: view.board,
    game: view,
    me: 'a',
    mode: null,
    disabled: true,
    onAction: () => {},
    onRobber: () => {},
  };
  const initial = renderToStaticMarkup(createElement(Board, props));
  assert.ok(
    !initial.includes('production-bloom'),
    'loading a snapshot with old dice does not replay harvest effects',
  );
  assert.equal([...initial.matchAll(/data-effect-hex=/g)].length, 19);
  assert.equal([...initial.matchAll(/data-effect-bank=/g)].length, 1);
  assert.ok(!initial.includes('data-piece-road='));
  assert.match(initial, /data-road-id="0" role="img" aria-label="A · Road 1"/);
  const live = renderToStaticMarkup(
    createElement(Board, { ...props, glowHexes: [1, 2], effectId: 'accepted:22' }),
  );
  assert.equal([...live.matchAll(/class="production-bloom"/g)].length, 2);
  assert.match(live, new RegExp(`animation-delay:${DICE_READABLE_MS}ms`));
  assert.equal([...initial.matchAll(/class="water-band"/g)].length, 1);
});

test('opponent resource flights do not postpone the local hand, and profile badges wait for delivery', () => {
  const event: FeedbackEvent = {
    id: 'roll:22',
    dice: [3, 3],
    notices: [],
    sounds: [],
    glowHexes: [],
    sites: [],
    hand: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    changed: ['wood'],
    gains: [
      { playerId: 'a', resource: 'wood', amount: 1 },
      { playerId: 'b', resource: 'wood', amount: 2 },
    ],
    flights: [
      { resource: 'wood', amount: 1, from: '#tile', to: '[data-resource-card="wood"]' },
      { resource: 'wood', amount: 2, from: '#tile', to: '[data-player-profile="b"]' },
    ],
  };
  assert.equal(resourceCardArrival(event, 'wood'), DICE_READABLE_MS + RESOURCE_FLIGHT_MS);
  assert.equal(profileGainArrival(event, 'a'), DICE_READABLE_MS + RESOURCE_FLIGHT_MS);
  assert.equal(profileGainArrival(event, 'b'), DICE_READABLE_MS + RESOURCE_FLIGHT_MS + RESOURCE_STAGGER_MS);
  assert.ok(PROFILE_GAIN_DWELL_MS >= 2000, 'gains remain readable after delivery');
  assert.ok(presentationHold(event) >= profileGainArrival(event, 'b'));
  assert.equal(presentationHold(event, true), 0, 'reduced motion never blocks gameplay');
  assert.ok(presentationHold({ dice: event.dice, flights: Array(1000).fill(event.flights[0]) }) < 4000);
});

test('resource counts update after the last matching flight, including the capped stagger', () => {
  const event: Pick<FeedbackEvent, 'dice' | 'flights'> = {
    dice: [4, 2],
    flights: [
      { resource: 'wood', amount: 1, from: '#tile-a', to: '#wood' },
      { resource: 'sheep', amount: 1, from: '#tile-b', to: '#sheep' },
      { resource: 'wood', amount: 2, from: '#tile-c', to: '#wood' },
    ],
  };
  assert.equal(resourceFlightStart(true, 0), DICE_READABLE_MS);
  assert.equal(
    resourceCardArrival(event, 'wood'),
    DICE_READABLE_MS + 2 * RESOURCE_STAGGER_MS + RESOURCE_FLIGHT_MS,
  );
  assert.equal(
    resourceCardArrival(event, 'sheep'),
    DICE_READABLE_MS + RESOURCE_STAGGER_MS + RESOURCE_FLIGHT_MS,
  );
  assert.equal(resourceCardArrival(event, 'ore'), 0);
  assert.equal(
    resourceFlightStart(false, 100),
    MAX_RESOURCE_STAGGER * RESOURCE_STAGGER_MS,
    'many transfers cannot create an unbounded delay',
  );
});
