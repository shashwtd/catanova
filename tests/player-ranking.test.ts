import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { rankedPlayers } from '../apps/client/src/player-ranking.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { PLAYER_COLORS } from '../apps/client/src/Board.js';
const seats = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i}`,
  name: `Player ${i + 1}`,
  ready: true,
  connected: true,
}));
function setup() {
  let game = createGame(seats, 82, () => 0.37);
  while (!game.turn) {
    const id = game.players[game.active]!.id;
    const legal = gameView(game, id).legal;
    game = applyAction(
      game,
      id,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.37,
    );
  }
  return game;
}
test('profiles retain seat order until a player has three public points', () => {
  const game = setup();
  let view = gameView(game, 'p0');
  assert.deepEqual(
    rankedPlayers(view).map((p) => [p.player.id, p.leading]),
    seats.map((p) => [p.id, false]),
  );
  Object.values(game.buildings).find((b) => b.player === 'p2')!.kind = 'city';
  view = gameView(game, 'p0');
  const original = structuredClone(view);
  assert.deepEqual(
    rankedPlayers(view).map((p) => p.player.id),
    ['p2', 'p0', 'p1', 'p3'],
  );
  assert.deepEqual(
    rankedPlayers(view).map((p) => p.seatIndex),
    [2, 0, 1, 3],
  );
  assert.equal(rankedPlayers(view)[0]!.leading, true);
  assert.deepEqual(view, original);
  const html = renderToStaticMarkup(
    createElement(PlayerRail, {
      room: { roomId: 'ranking-room', roomCode: 'RANK', revision: 0, counter: 0, players: seats },
      game: view,
      me: 'p0',
    }),
  );
  assert.match(html, /Leader, 3 public points/);
  assert.ok(html.indexOf('data-player-profile="p2"') < html.indexOf('data-player-profile="p0"'));
  assert.ok(html.includes(`--player-color:${PLAYER_COLORS[2]}`));
});
test('private victory cards never influence ranking or leak through the leader badge', () => {
  const game = setup();
  game.players[0]!.cards = [0, 1].map((i) => ({ id: `vp${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  for (const { id } of seats) assert.ok(rankedPlayers(gameView(game, id)).every((p) => !p.leading));
  Object.values(game.buildings).find((b) => b.player === 'p3')!.kind = 'city';
  const expected = rankedPlayers(gameView(game, 'p0')).map((p) => [p.player.id, p.publicPoints, p.leading]);
  for (const { id } of seats)
    assert.deepEqual(
      rankedPlayers(gameView(game, id)).map((p) => [p.player.id, p.publicPoints, p.leading]),
      expected,
    );
  assert.equal(expected[0]![0], 'p3');
  assert.equal(gameView(game, 'p0').players[0]!.points, 4, 'private score still appears on your own profile');
});
test('ties stay in seat order, awards reorder all ranks, and finished winners take the top spot', () => {
  const game = setup();
  for (const id of ['p1', 'p3']) Object.values(game.buildings).find((b) => b.player === id)!.kind = 'city';
  let ranked = rankedPlayers(gameView(game, 'p0'));
  assert.deepEqual(
    ranked.map((p) => p.player.id),
    ['p1', 'p3', 'p0', 'p2'],
  );
  assert.deepEqual(
    ranked.filter((p) => p.leading).map((p) => p.player.id),
    ['p1', 'p3'],
  );
  game.longestRoad = 'p2';
  ranked = rankedPlayers(gameView(game, 'p0'));
  assert.deepEqual(
    ranked.map((p) => p.player.id),
    ['p2', 'p1', 'p3', 'p0'],
  );
  game.longestRoad = 'p0';
  assert.deepEqual(
    rankedPlayers(gameView(game, 'p0')).map((p) => p.player.id),
    ['p0', 'p1', 'p3', 'p2'],
  );
  game.players[0]!.resigned = true;
  assert.equal(rankedPlayers(gameView(game, 'p1')).at(-1)!.player.id, 'p0');
  game.phase = 'finished';
  game.winner = 'p2';
  game.finishReason = 'resignation';
  assert.equal(rankedPlayers(gameView(game, 'p2'))[0]!.player.id, 'p2');
});
