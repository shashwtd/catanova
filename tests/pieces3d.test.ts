import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pieces3D, piecePosition } from '../apps/client/src/Pieces3D.js';
import { createGame, gameView } from '../packages/rules/src/game.js';

test('dimensional pieces retain every authoritative edge and vertex, including vertical roads', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    99,
    () => 0.25,
  );
  const view = gameView(game, 'a');
  view.roads = Object.fromEntries(game.board.edges.map((edge) => [edge.id, 'a']));
  view.buildings = { 0: { player: 'a', kind: 'settlement' }, 1: { player: 'b', kind: 'city' } };
  const html = renderToStaticMarkup(createElement(Pieces3D, { board: view.board, game: view, me: 'a' }));
  assert.equal([...html.matchAll(/data-piece-road=/g)].length, 72);
  assert.equal([...html.matchAll(/data-piece-building=/g)].length, 2);
  assert.equal(
    [...html.matchAll(/class="piece3d-roof"/g)].length,
    3,
    'a city has two distinct roofed volumes',
  );
  assert.equal([...html.matchAll(/piece3d-road-block/g)].length, 72);
  assert.ok(!html.includes('<filter') && !html.includes('<canvas'));
  assert.match(html, /rotateZ\(-?90deg\)/);
  assert.match(html, /aria-hidden="true"/);
  assert.deepEqual(piecePosition(0, 0), { left: '50%', top: '50%' });
});
