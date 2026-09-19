import { GameOver } from '../apps/client/src/GameOver.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DisconnectStatus, reconnectSeconds } from '../apps/client/src/DisconnectStatus.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { AttentionTracker, gameStatus } from '../apps/client/src/game-attention.js';
import { playerTurnActivity } from '../apps/client/src/turn-activity.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';

test('an empty chair says which of the three things it is, and never resigns from a local clock', () => {
  assert.equal(reconnectSeconds(181000, 1000), 180);
  assert.equal(reconnectSeconds(181000, 180001), 1);
  assert.equal(reconnectSeconds(181000, 190000), 0);
  const render = (props: Parameters<typeof DisconnectStatus>[0]) =>
    renderToStaticMarkup(createElement(DisconnectStatus, props));
  // Away, with the table still playing: a bot is about to take the seat, and
  // nothing about that is a punishment to count down to.
  assert.match(render({ deadline: 181000, now: 1000 }), />Away</);
  assert.ok(!render({ deadline: 181000, now: 1000 }).includes('resign'));
  const expired = render({ deadline: 181000, now: 190000 });
  assert.ok(!expired.includes('0:00') && !expired.includes('>Resigned<'));
  assert.equal(render({ now: 1000 }), '', 'clearing a deadline on reconnect removes the countdown');
  // Covered: who is playing, not how long is left.
  const covered = render({ standIn: true, now: 1000 });
  assert.match(covered, />Bot playing</);
  assert.ok(!covered.includes('0:0'), 'a covered seat is not on a clock');
  // The countdown still means something in the one case where it is true:
  // nobody is at the table and the match will be filed as abandoned.
  assert.match(render({ deadline: 181000, now: 1000, paused: true }), /Abandoned in.*3:00/);
  assert.match(render({ resigned: true, now: 1000 }), />Resigned</);
  // Resigning outranks everything: a seat that is gone is not being covered.
  assert.match(render({ resigned: true, standIn: true, now: 1000 }), />Resigned</);
});

test('profiles and turn prompts distinguish reconnecting, paused, resigned and resignation wins', () => {
  const players = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ];
  const game = createGame(players, 42, () => 0.34);
  game.phase = 'roll';
  game.turn = 1;
  const view = gameView(game, 'b');
  const room: RoomState = {
    roomId: 'ABCD2345',
    revision: 10,
    counter: 0,
    game: view,
    players: players.map((p) => ({
      ...p,
      connected: p.id === 'b',
      ...(p.id === 'a' ? { disconnectedAt: 1000, resignAt: Date.now() + 180000 } : {}),
    })),
  };
  assert.match(gameStatus(view, 'b', room).prompt, /Waiting for Alice to reconnect/);
  const html = renderToStaticMarkup(createElement(PlayerRail, { game: view, room, me: 'b' }));
  assert.match(html, /Away/);
  assert.match(html, /Disconnected/);
  // Once the seat is covered the rail says so, and marks it with the same bot
  // symbol a bot seat carries, because for now that is who is playing it.
  room.players[0]!.standIn = true;
  const held = renderToStaticMarkup(createElement(PlayerRail, { game: view, room, me: 'b' }));
  assert.match(held, />Bot playing</);
  assert.match(held, /aria-label="Bot"/);
  delete room.players[0]!.standIn;
  room.paused = true;
  assert.match(gameStatus(view, 'b', room).prompt, /Game paused/);
  assert.equal(new AttentionTracker().update(room, 'a', true), null);
  delete room.paused;
  view.players[0]!.resigned = true;
  assert.equal(playerTurnActivity(view, 'a'), null);
  assert.match(gameStatus(view, 'a', room).prompt, /You resigned/);
  view.winner = 'b';
  view.phase = 'finished';
  view.finishReason = 'resignation';
  assert.match(gameStatus(view, 'b', room).prompt, /Bob wins by resignation/);
  const finished = renderToStaticMarkup(createElement(PlayerRail, { game: view, room, me: 'b' }));
  assert.match(finished, />Resigned</);
  assert.ok(!finished.includes('award-ribbon winner'));
  const results = renderToStaticMarkup(
    createElement(GameOver, {
      room: { ...room, game: view },
      busy: false,
      canReturn: true,
      onReturn: () => {},
      onQuit: () => {},
    }),
  );
  assert.match(results, /Bob wins</);
  assert.match(results, /results-timber/);
  assert.doesNotMatch(results, /Dice statistics|dice-histogram/);
  assert.match(results, /Won by resignation/);
  assert.match(results, /Return to lobby/);
  assert.ok(!finished.includes('Away'));
  view.winner = null;
  view.finishReason = 'abandoned';
  assert.equal(gameStatus(view, 'b', room).prompt, 'Game ended — everyone left');
  assert.equal(gameStatus(view, 'b', room).favicon, null);
  assert.ok(!gameStatus(view, 'b', room).title.includes('wins'));
});
