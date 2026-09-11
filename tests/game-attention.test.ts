import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, gameView, emptyHand } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { AttentionTracker, gameStatus } from '../apps/client/src/game-attention.js';
import { RobberFlow, discardChoice, validDiscard } from '../apps/client/src/RobberFlow.js';

const seats = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cara' },
];
function game() {
  return createGame(seats, 48, () => 0.3);
}
function room(g: Game, me = 'a', revision = 1): RoomState {
  return {
    roomId: 'ABCD2345',
    revision,
    counter: 0,
    players: seats.map((p) => ({ ...p, connected: p.id !== 'b' })),
    game: gameView(g, me),
  };
}
function render(g: Game, me = 'a', hex: number | null = null) {
  return renderToStaticMarkup(
    createElement(RobberFlow, {
      room: room(g, me),
      me,
      selectedHex: hex,
      onSelectHex: () => {},
      onAction: () => {},
      disabled: false,
      connected: true,
      onWarning: () => {},
    }),
  );
}

test('title status follows setup, individual discards, robber, actions and winner; only own dice/robber change the icon', () => {
  const g = game();
  assert.match(gameStatus(gameView(g, 'a'), 'a').title, /Place a settlement/);
  assert.match(gameStatus(gameView(g, 'b'), 'b').title, /Alice is placing/);
  g.phase = 'roll';
  g.turn = 1;
  assert.equal(gameStatus(gameView(g, 'a'), 'a').favicon, 'dice');
  assert.equal(gameStatus(gameView(g, 'b'), 'b').favicon, null);
  g.phase = 'discard';
  g.discards = { b: 4, c: 5 };
  assert.match(gameStatus(gameView(g, 'a'), 'a').title, /Bob, Cara to discard/);
  assert.match(gameStatus(gameView(g, 'b'), 'b').title, /Choose 4 cards/);
  assert.equal(gameStatus(gameView(g, 'b'), 'b').favicon, null);
  g.phase = 'robber';
  assert.equal(gameStatus(gameView(g, 'a'), 'a').favicon, 'robber');
  assert.equal(gameStatus(gameView(g, 'b'), 'b').favicon, null);
  g.phase = 'actions';
  assert.equal(gameStatus(gameView(g, 'a'), 'a').favicon, null);
  g.phase = 'finished';
  g.winner = 'b';
  assert.match(gameStatus(gameView(g, 'a'), 'a').title, /Bob wins/);
});

test('attention cues cover setup turn zero and personal obligations, without replaying on duplicates or reconnect', () => {
  const tracker = new AttentionTracker(),
    g = game();
  assert.equal(tracker.update(room(g), 'a', true), 'turn');
  assert.equal(tracker.update(room(g, 'a', 2), 'a', true), null);
  assert.equal(tracker.update(room(g), 'a', false), null);
  assert.equal(tracker.update(room(g), 'a', true), null);
  g.phase = 'setupRoad';
  assert.equal(
    tracker.update(room(g), 'a', true),
    null,
    'construction sound leads into the same starting road',
  );
  g.active = 1;
  g.setupIndex = 1;
  g.phase = 'setupSettlement';
  assert.equal(tracker.update(room(g), 'a', true), null);
  g.active = 0;
  g.turn = 1;
  g.phase = 'roll';
  assert.equal(tracker.update(room(g), 'a', true), 'turn');
  g.phase = 'discard';
  g.discards = { a: 4, b: 4 };
  assert.equal(tracker.update(room(g), 'a', true, true), null, 'wait until dice can be read');
  assert.equal(tracker.update(room(g), 'a', true), 'warning');
  delete g.discards.b;
  assert.equal(tracker.update(room(g, 'a', 3), 'a', true), null);
  delete g.discards.a;
  g.phase = 'robber';
  assert.equal(tracker.update(room(g), 'a', true), 'warning');
  assert.equal(tracker.update(room(g), 'a', true), null);
  g.winner = 'a';
  g.phase = 'finished';
  assert.equal(tracker.update(room(g), 'a', true), null);
});

test('everyone can identify who is discarding; only obligated players have card controls and submitted players stop blocking', () => {
  const g = game();
  g.phase = 'discard';
  g.turn = 1;
  g.discards = { b: 4, c: 5 };
  g.players[1]!.hand = { wood: 3, brick: 3, sheep: 3, wheat: 0, ore: 0 };
  g.players[2]!.hand = { wood: 2, brick: 2, sheep: 2, wheat: 2, ore: 2 };
  const watching = render(g);
  assert.match(watching, /Waiting for discards/);
  assert.match(watching, /Bob/);
  assert.match(watching, /Cara/);
  assert.match(watching, /Disconnected/);
  assert.match(watching, /Then you move the robber/);
  assert.ok(!watching.includes('discard-add'));
  assert.match(render(g, 'b'), /Discard 4 cards/);
  assert.equal([...render(g, 'b').matchAll(/class="discard-add"/g)].length, 5);
  delete g.discards.b;
  const finished = render(g, 'b');
  assert.match(finished, /Waiting for discards/);
  assert.ok(!finished.includes('discard-add'));
  assert.equal([...finished.matchAll(/class="discard-player"/g)].length, 1);
});

test('discard selection cannot exceed held cards or quota, and invalid stale hands cannot submit', () => {
  const hand = { wood: 2, brick: 2, sheep: 4, wheat: 0, ore: 0 };
  let choice = emptyHand();
  for (let i = 0; i < 6; i++) choice = discardChoice(choice, hand, 4, 'wood', 1);
  assert.equal(choice.wood, 2);
  for (let i = 0; i < 6; i++) choice = discardChoice(choice, hand, 4, 'sheep', 1);
  assert.equal(choice.sheep, 2);
  assert.equal(validDiscard(choice, hand, 4), true);
  assert.equal(validDiscard(choice, { ...hand, wood: 1 }, 4), false);
  choice = discardChoice(choice, hand, 4, 'wood', -1);
  assert.equal(validDiscard(choice, hand, 4), false);
  assert.deepEqual(discardChoice(choice, hand, 4, 'ore', -1), choice);
});

test('robber destination and victim review explain steals and empty destinations without private hand disclosure', () => {
  const g = game();
  g.phase = 'robber';
  g.turn = 1;
  const tile = g.board.hexes.find((h) => h.id !== g.robber)!;
  assert.match(render(g, 'a'), /Choose a highlighted tile/);
  assert.match(render(g, 'a', tile.id), /without stealing/);
  g.buildings[tile.vertices[0]!] = { player: 'b', kind: 'settlement' };
  assert.match(render(g, 'a', tile.id), /No cards to steal/);
  g.players[1]!.hand = { wood: 4, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const html = render(g, 'a', tile.id);
  assert.match(html, /Bob/);
  assert.match(html, /Steal 1 card/);
  assert.ok(!html.includes('4 Timber'));
  assert.match(render(g, 'b'), /Alice is moving the robber/);
  assert.ok(!render(g, 'b', tile.id).includes('class="robber-victim"'));
});
