import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../apps/client/src/Board.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import { DICE_ROLL_MS } from '../apps/client/src/DiceThrow.js';
import {
  resourceCardArrival,
  resourceFlightStart,
  RESOURCE_FLIGHT_MS,
} from '../apps/client/src/useFeedback.js';
import type { FeedbackEvent } from '../apps/client/src/feedback.js';

test('only the live production event lights tiles, and 3D keeps measured SVG anchors and accessible pieces', () => {
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
  assert.match(initial, /data-piece-road="0"/);
  assert.match(initial, /data-road-id="0" role="img" aria-label="A · Road 1"/);
  const live = renderToStaticMarkup(
    createElement(Board, { ...props, glowHexes: [1, 2], effectId: 'accepted:22' }),
  );
  assert.equal([...live.matchAll(/class="production-bloom"/g)].length, 2);
  assert.match(live, new RegExp(`animation-delay:${DICE_ROLL_MS}ms`));
  const flat = renderToStaticMarkup(createElement(Board, { ...props, depth: false }));
  assert.ok(!flat.includes('data-piece-road='));
  assert.match(flat, /data-road-id="0"/);
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
  assert.equal(resourceFlightStart(true, 0), DICE_ROLL_MS);
  assert.equal(resourceCardArrival(event, 'wood'), DICE_ROLL_MS + 44 + RESOURCE_FLIGHT_MS);
  assert.equal(resourceCardArrival(event, 'sheep'), DICE_ROLL_MS + 22 + RESOURCE_FLIGHT_MS);
  assert.equal(resourceCardArrival(event, 'ore'), 0);
  assert.equal(resourceFlightStart(false, 100), 110, 'many transfers cannot create an unbounded delay');
});
