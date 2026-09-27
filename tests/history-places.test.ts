/** The move history names where a piece went by the tiles it touches, not by a corner or edge number. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateBoard, isLand, pips } from '../packages/rules/src/board.js';
import { historyTokens, placeTiles } from '../apps/client/src/MoveHistory.js';

const board = generateBoard(481);
const line = (text: string, onPlace?: () => void) =>
  renderToStaticMarkup(createElement('p', null, historyTokens(text, ['Ann'], { board, onPlace })));

test('a corner is its land tiles, likeliest number first, and its harbour', () => {
  const harbourEdge = board.edges[board.ports[0]!.edge]!;
  const corner = placeTiles(board, { vertex: harbourEdge.a })!;
  assert.ok(corner.tiles.length >= 1 && corner.tiles.every(isLand));
  assert.deepEqual(
    corner.tiles.map((h) => pips(h.number)),
    corner.tiles.map((h) => pips(h.number)).sort((a, b) => b - a),
  );
  assert.equal(corner.harbour, board.ports[0]);
  const inland = board.vertices.find(
    (v) => v.hexes.length === 3 && v.hexes.every((h) => isLand(board.hexes[h]!)),
  )!;
  assert.equal(placeTiles(board, { vertex: inland.id })!.tiles.length, 3);
  assert.equal(placeTiles(board, { vertex: 9999 }), null);
});

test('a history line shows tiles in place of a number, and only a board it names can be shown', () => {
  const vertex = board.vertices.find((v) => v.hexes.length === 3)!;
  const html = line(`Ann built a settlement at corner ${vertex.id + 1}.`, () => {});
  assert.doesNotMatch(html, /corner \d/);
  assert.match(html, / on <span class="journal-place-end"><button type="button" class="journal-place"/);
  assert.equal((html.match(/class="journal-tile"/g) ?? []).length, 3);
  assert.match(html, /<\/button>\.<\/span>/, 'the full stop stays with the place');
  // A road is by its tiles; without a way to show it, a place is a plain label.
  const edge = board.edges.find((e) => e.hexes.length === 2)!;
  const road = line(`Ann built a road on edge ${edge.id + 1}.`);
  assert.match(road, / by <span class="journal-place-end"><span class="journal-place" role="img"/);
  // A number the board does not have stays as the log wrote it.
  assert.match(line('Ann built a road on edge 9999.'), /on edge 9999/);
});
