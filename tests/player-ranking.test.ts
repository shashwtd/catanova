import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { playerStandings } from '../apps/client/src/player-ranking.js';
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
test('profiles always retain turn order while the leader receives a badge from three public points', () => {
  const game = setup();
  let view = gameView(game, 'p0');
  assert.deepEqual(
    playerStandings(view).map((p) => [p.player.id, p.leading]),
    seats.map((p) => [p.id, false]),
  );
  Object.values(game.buildings).find((b) => b.player === 'p2')!.kind = 'city';
  view = gameView(game, 'p0');
  const original = structuredClone(view);
  assert.deepEqual(
    playerStandings(view).map((p) => p.player.id),
    ['p0', 'p1', 'p2', 'p3'],
  );
  assert.deepEqual(
    playerStandings(view).map((p) => p.seatIndex),
    [0, 1, 2, 3],
  );
  assert.equal(playerStandings(view)[2]!.leading, true);
  assert.deepEqual(view, original);
  const html = renderToStaticMarkup(
    createElement(PlayerRail, {
      room: { roomId: 'ranking-room', roomCode: 'RANK', revision: 0, counter: 0, players: seats },
      game: view,
      me: 'p0',
    }),
  );
  assert.match(html, /Leader, 3 public points/);
  assert.ok(html.indexOf('data-player-profile="p0"') < html.indexOf('data-player-profile="p2"'));
  assert.ok(html.includes(`--player-color:${PLAYER_COLORS[2]}`));
});
test('private victory cards never influence ranking or leak through the leader badge', () => {
  const game = setup();
  game.players[0]!.cards = [0, 1].map((i) => ({ id: `vp${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  for (const { id } of seats) assert.ok(playerStandings(gameView(game, id)).every((p) => !p.leading));
  Object.values(game.buildings).find((b) => b.player === 'p3')!.kind = 'city';
  const expected = playerStandings(gameView(game, 'p0')).map((p) => [p.player.id, p.publicPoints, p.leading]);
  for (const { id } of seats)
    assert.deepEqual(
      playerStandings(gameView(game, id)).map((p) => [p.player.id, p.publicPoints, p.leading]),
      expected,
    );
  assert.equal(expected[3]![2], true);
  assert.equal(gameView(game, 'p0').players[0]!.points, 4, 'private score still appears on your own profile');
});
test('ties, awards and resignations never disturb turn order', () => {
  const game = setup();
  for (const id of ['p1', 'p3']) Object.values(game.buildings).find((b) => b.player === id)!.kind = 'city';
  let ranked = playerStandings(gameView(game, 'p0'));
  assert.deepEqual(
    ranked.map((p) => p.player.id),
    ['p0', 'p1', 'p2', 'p3'],
  );
  assert.deepEqual(
    ranked.filter((p) => p.leading).map((p) => p.player.id),
    ['p1', 'p3'],
  );
  game.longestRoad = 'p2';
  ranked = playerStandings(gameView(game, 'p0'));
  assert.deepEqual(
    ranked.map((p) => p.player.id),
    ['p0', 'p1', 'p2', 'p3'],
  );
  game.longestRoad = 'p0';
  assert.deepEqual(
    playerStandings(gameView(game, 'p0')).map((p) => p.player.id),
    ['p0', 'p1', 'p2', 'p3'],
  );
  game.players[0]!.resigned = true;
  assert.equal(playerStandings(gameView(game, 'p1'))[0]!.leading, false);
  game.phase = 'finished';
  game.winner = 'p2';
  game.finishReason = 'resignation';
  assert.equal(playerStandings(gameView(game, 'p2'))[2]!.leading, true);
});

test('award details list public route lengths and Knight counts, with the current holder identified', () => {
  const game = setup();
  game.longestRoad = 'p1';
  game.largestArmy = 'p2';
  game.players[2]!.knights = 3;
  const view = gameView(game, 'p0');
  view.players[1]!.roadLength = 6;
  const html = renderToStaticMarkup(
    createElement(PlayerRail, {
      room: { roomId: 'award-room', roomCode: 'TEST', revision: 0, counter: 0, players: seats },
      game: view,
    }),
  );
  assert.match(html, /Player 2: 6, award holder/);
  assert.match(html, /Player 3: 3, award holder/);
  assert.equal([...html.matchAll(/aria-label="Award standings"/g)].length, 2);
  assert.equal([...html.matchAll(/role="listitem"/g)].length, 8);
});
