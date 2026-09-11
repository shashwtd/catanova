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

test('reconnect countdown explains the deadline and never resigns a player from a local clock', () => {
  assert.equal(reconnectSeconds(181000, 1000), 180);
  assert.equal(reconnectSeconds(181000, 180001), 1);
  assert.equal(reconnectSeconds(181000, 190000), 0);
  const render = (props: Parameters<typeof DisconnectStatus>[0]) =>
    renderToStaticMarkup(createElement(DisconnectStatus, props));
  assert.match(render({ deadline: 181000, now: 1000 }), /Auto-resign.*3:00/);
  const expired = render({ deadline: 181000, now: 190000 });
  assert.ok(expired.includes('0:00') && !expired.includes('>Resigned<'));
  assert.equal(render({ now: 1000 }), '', 'clearing a deadline on reconnect removes the countdown');
  assert.match(
    render({ deadline: 181000, now: 1000, paused: true }),
    /Auto-resign.*3:00/,
    'pausing gameplay never pauses the reconnect deadline',
  );
  assert.match(render({ resigned: true, now: 1000 }), />Resigned</);
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
  assert.match(html, /Auto-resign/);
  assert.match(html, /Disconnected/);
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
  assert.match(finished, /Winner by resignation/);
  assert.ok(!finished.includes('Auto-resign'));
  view.winner = null;
  view.finishReason = 'abandoned';
  assert.equal(gameStatus(view, 'b', room).prompt, 'Game ended — everyone left');
  assert.equal(gameStatus(view, 'b', room).favicon, null);
  assert.ok(!gameStatus(view, 'b', room).title.includes('wins'));
});
