/** Open Sea on the board: its sea hexes, gold fields and harbours. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateBoard } from '../packages/rules/src/board.js';
import type { Board as Island } from '../packages/rules/src/board.js';
import { seaOutline, WATER_FEATHER } from '../apps/client/src/scene.js';
import { Board } from '../apps/client/src/Board.js';
import { BOARD_THEMES } from '../apps/client/src/board-theme.js';
import { dealtOuterIsles4 } from './board-shapes.js';

const noop = () => {};
const render = (props: Partial<Parameters<typeof Board>[0]> & { board: Island }) =>
  renderToStaticMarkup(
    createElement(Board, { mode: null, disabled: true, onAction: noop, onRobber: noop, ...props }),
  );

test('an Open Sea board draws its sea round the frame, sea hexes to choose, gold fields, and harbours without boats', () => {
  const board = dealtOuterIsles4(),
    html = render({ board, art: BOARD_THEMES.classic });
  assert.match(html, /class="island-stage  sea-stage"/);
  assert.match(html, /viewBox="-576 -520 1152 1040"/);
  // Every hex keeps a target and a name; sea hexes have no tile, number or robber.
  assert.equal((html.match(/class="terrain-hit/g) ?? []).length, 77);
  assert.equal((html.match(/aria-label="Sea"/g) ?? []).length, 47);
  assert.equal((html.match(/aria-label="Gold field, 9, 4 production pips"/g) ?? []).length, 2);
  assert.equal((html.match(/<mask id="terrain-/g) ?? []).length, 30);
  assert.equal((html.match(/class="terrain-base"/g) ?? []).length, 30);
  assert.equal((html.match(/fill="#8f7f5a"/g) ?? []).length, 2);
  assert.equal((html.match(/>Gold<\/text>/g) ?? []).length, 2);
  assert.equal((html.match(new RegExp(`href="${BOARD_THEMES.classic.gold}"`, 'g')) ?? []).length, 2);
  // The water's mask is the frame's outline; the islands keep their shallows and sand, and cast the shadow.
  const [outline] = seaOutline(board, WATER_FEATHER / 2);
  assert.ok(html.includes(`points="${outline!.map((p) => `${p.x},${p.y}`).join(' ')}" fill="white"`));
  assert.equal((html.match(/fill="#52bebf"/g) ?? []).length, 5);
  assert.equal((html.match(/fill="url\(#sand-material\)"/g) ?? []).length, 5);
  assert.match(html, /<g class="island-shadow"[^>]*filter="url\(#island-shadow\)"/);
  assert.match(html, /<rect class="sea-base"/);
  // The robber starts on the desert and never on the sea.
  assert.equal((html.match(/aria-label="Robber"/g) ?? []).length, 1);
  // One harbour: its piers and badge, and no boat.
  assert.equal((html.match(/class="harbor"/g) ?? []).length, 1);
  assert.equal((html.match(/data-port-entrance/g) ?? []).length, 2);
  assert.doesNotMatch(html, /port-boat/);
  // Classic's harbours keep their boats.
  assert.equal((render({ board: generateBoard(42) }).match(/class="port-boat"/g) ?? []).length, 9);
});
