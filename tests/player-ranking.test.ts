import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { finalStandings, playerStandings } from '../apps/client/src/player-ranking.js';
import { GameOver } from '../apps/client/src/GameOver.js';
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
test('profiles always retain turn order while the leader receives a badge from three visible points', () => {
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
  assert.match(html, /Leader, 3 points/);
  assert.ok(html.indexOf('data-player-profile="p0"') < html.indexOf('data-player-profile="p2"'));
  assert.ok(html.includes(`--player-color:${PLAYER_COLORS[2]}`));
});
test('three private VP cards count toward your five-point lead without revealing the lead to opponents', () => {
  const game = setup();
  game.players[0]!.cards = [0, 1, 2].map((i) => ({ id: `vp${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  Object.values(game.buildings).find((b) => b.player === 'p3')!.kind = 'city';
  const view = gameView(game, 'p0');
  const own = playerStandings(view);
  assert.equal(view.players[0]!.points, 5);
  assert.equal(own[0]!.points, 5, 'the projected score already contains the three VP cards');
  assert.deepEqual(
    own.filter((p) => p.leading).map((p) => p.player.id),
    ['p0'],
  );
  const html = renderToStaticMarkup(
    createElement(PlayerRail, {
      room: { roomId: 'vp-room', revision: 0, counter: 0, players: seats },
      game: view,
      me: 'p0',
    }),
  );
  const profile = html.match(/<article[^>]*data-player-profile="p0"[\s\S]*?<\/article>/)![0];
  assert.match(profile, /Leader, 5 points/);
  assert.match(profile, /#1/);
  assert.doesNotMatch(profile, /5 public points/);

  const withoutHiddenPoints = structuredClone(game);
  withoutHiddenPoints.players[0]!.cards.forEach((card) => {
    card.kind = 'knight';
  });
  for (const viewer of ['p1', 'p2', 'p3']) {
    const opponentsView = gameView(game, viewer);
    assert.equal(opponentsView.players[0]!.cards, undefined);
    assert.equal(opponentsView.players[0]!.points, 2);
    assert.deepEqual(
      playerStandings(opponentsView),
      playerStandings(gameView(withoutHiddenPoints, viewer)),
      'a hidden card type cannot affect another viewer’s badge, points or ordering',
    );
    assert.deepEqual(
      playerStandings(opponentsView)
        .filter((p) => p.leading)
        .map((p) => p.player.id),
      ['p3'],
    );
  }
});
test('five public points plus three VP cards rank as eight, and private-score ties share the badge', () => {
  const game = setup();
  Object.values(game.buildings).find((b) => b.player === 'p0')!.kind = 'city';
  game.longestRoad = 'p0';
  for (const building of Object.values(game.buildings)) if (building.player === 'p1') building.kind = 'city';
  game.largestArmy = 'p1';
  game.players[0]!.cards = [0, 1, 2].map((i) => ({ id: `vp${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  let ranked = playerStandings(gameView(game, 'p0'));
  assert.equal(ranked[0]!.points, 8);
  assert.equal(ranked[1]!.points, 6);
  assert.deepEqual(
    ranked.filter((p) => p.leading).map((p) => p.player.id),
    ['p0'],
  );
  game.players[0]!.cards = game.players[0]!.cards.slice(0, 1);
  ranked = playerStandings(gameView(game, 'p0'));
  assert.deepEqual(
    ranked.filter((p) => p.leading).map((p) => p.player.id),
    ['p0', 'p1'],
  );
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

test('results rank the ten-point winner above an eight-point first seat, including revealed VP cards', () => {
  const game = setup();
  game.phase = 'finished';
  game.winner = 'p1';
  game.players[1]!.cards = [0, 1, 2].map((i) => ({ id: `vp${i}`, kind: 'victoryPoint', boughtTurn: 0 }));
  const view = gameView(game, 'p0');
  assert.equal(view.players[1]!.points, 5, 'opponent VP cards are included once at game end');
  [8, 10, 6, 6].forEach((points, i) => {
    view.players[i]!.points = points;
  });
  const original = structuredClone(view);
  assert.deepEqual(
    finalStandings(view).map(({ player, points, place }) => [player.id, points, place]),
    [
      ['p1', 10, 1],
      ['p0', 8, 2],
      ['p2', 6, 3],
      ['p3', 6, 3],
    ],
  );
  assert.deepEqual(view, original, 'sorting results cannot mutate server state or gameplay seats');
  const html = renderToStaticMarkup(
    createElement(GameOver, {
      room: { roomId: 'results-room', revision: 0, counter: 0, players: seats, game: view },
      busy: false,
      canReturn: true,
      onReturn() {},
      onQuit() {},
    }),
  );
  const rows = html.match(/<article class="game-over-player[^]*?<\/article>/g)!;
  assert.match(rows[0]!, /is-winner/);
  assert.match(rows[0]!, /game-over-place">1<.*<strong>Player 2<.*<b>10</);
  assert.match(rows[1]!, /game-over-place">2<.*<strong>Player 1<.*<b>8</);
});

test('the declared winner leads resignation results and equal-score rivals share places', () => {
  const view = gameView(setup(), 'p0');
  view.phase = 'finished';
  view.winner = 'p3';
  view.finishReason = 'resignation';
  [8, 8, 7, 2].forEach((points, i) => {
    view.players[i]!.points = points;
    view.players[i]!.resigned = i !== 3;
  });
  assert.deepEqual(
    finalStandings(view).map(({ player, place }) => [player.id, place]),
    [
      ['p3', 1],
      ['p0', 2],
      ['p1', 2],
      ['p2', 4],
    ],
  );
});
