/** Open Sea on the board: its sea hexes, gold fields and harbours, and its ships and pirate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateBoard, isLand } from '../packages/rules/src/board.js';
import type { Board as Island } from '../packages/rules/src/board.js';
import { gameView } from '../packages/rules/src/game.js';
import { edgeCentre, HEX_SIZE, seaOutline, WATER_FEATHER, worldBox } from '../apps/client/src/scene.js';
import { Board, PirateShape, ShipShape } from '../apps/client/src/Board.js';
import { BOARD_THEMES } from '../apps/client/src/board-theme.js';
import { loungeGame } from './board-fixtures.js';
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

test('ships and the pirate are flat pieces in the house style, drawn on their edge and their sea hex', () => {
  const ship = renderToStaticMarkup(
    createElement('svg', null, createElement(ShipShape, { color: '#54b3dc' })),
  );
  assert.match(ship, /<ellipse class="ship-plinth"/);
  assert.equal((ship.match(/class="ship-sail"/g) ?? []).length, 2);
  assert.match(ship, /<path class="ship-mast" d="M0 1V-23"/);
  assert.match(ship, /<path class="ship-hull" fill="#54b3dc"/);
  assert.match(ship, /<path class="ship-sheen"/);
  assert.doesNotMatch(ship, /stroke="#54b3dc"|fill="#54b3dc"[^>]*class="ship-sail"/, 'no coloured stripe');
  const dark = renderToStaticMarkup(createElement('svg', null, createElement(PirateShape)));
  assert.match(dark, /^<svg><g transform="scale\(1\.1\)">/);
  assert.match(dark, /class="pirate-pennant"/);
  assert.doesNotMatch(dark, /fill="/, 'the pirate takes its colours from the robber’s');

  // The pieces come from props, or from the same-named fields of the game the board is given.
  const board = dealtOuterIsles4(),
    [a, b] = board.edges.filter((e) => e.hexes.every((h) => !isLand(board.hexes[h]!))),
    pirate = board.hexes.find((h) => !isLand(h) && h.neighbors.length === 6)!.id;
  const fromProps = render({ board, ships: { [a!.id]: 'p1', [b!.id]: 'p2' }, pirate });
  const view = gameView(loungeGame(), 'sample-0');
  const withGame = render({
    board,
    game: { ...view, board, ships: { [a!.id]: 'sample-1' }, pirate } as typeof view,
    colors: { 'sample-1': '#b08be4' },
  });
  for (const html of [fromProps, withGame]) {
    const at = edgeCentre(board, a!.id);
    assert.match(html, new RegExp(`data-ship-id="${a!.id}"[^>]*transform="translate\\(${at.x},${at.y}\\)"`));
    const h = board.hexes[pirate]!;
    assert.match(
      html,
      new RegExp(
        `class="pirate-piece" transform="translate\\(${h.x * HEX_SIZE},${h.y * HEX_SIZE + 6}\\)" filter="url\\(#piece-shadow\\)"`,
      ),
    );
    // Ships and the pirate draw above the harbours' badges.
    assert.ok(html.indexOf('class="harbor"') < html.indexOf('class="pirate-piece"'));
    assert.ok(html.indexOf('class="harbor"') < html.indexOf('data-ship-id'));
  }
  assert.equal((fromProps.match(/data-ship-id/g) ?? []).length, 2);
  assert.match(withGame, /aria-label="Mossling · Ship \d+"/);
  assert.match(withGame, /class="ship-hull" fill="#b08be4"/);
  // Before a game the pirate waits on its board's start; a game without one has no pirate.
  assert.match(
    render({ board: Object.assign(dealtOuterIsles4(), { pirateStart: pirate }) }),
    /aria-label="Pirate"/,
  );
  assert.doesNotMatch(render({ board: generateBoard(481), game: view }), /pirate-piece|ship-piece/);
});

test('a ship on any edge a ship may take, and the pirate on any sea hex, stay inside the scene', () => {
  const board = dealtOuterIsles4(),
    world = worldBox(board);
  // The ship's outline and plinth, and the pirate's at its scale and offset, as Board.tsx draws them.
  const inside = (x: number, y: number, [left, top, right, bottom]: number[]) =>
    x + left! >= world.x &&
    x + right! <= world.x + world.width &&
    y + top! >= world.y &&
    y + bottom! <= world.y + world.height;
  for (const edge of board.edges.filter(
    (e) => e.hexes.length === 2 && e.hexes.some((h) => !isLand(board.hexes[h]!)),
  )) {
    const { x, y } = edgeCentre(board, edge.id);
    assert.ok(inside(x, y, [-18.9, -24, 18.9, 15]), `edge ${edge.id}`);
  }
  for (const h of board.hexes.filter((h) => !isLand(h)))
    assert.ok(inside(h.x * HEX_SIZE, h.y * HEX_SIZE + 6, [-21, -26.5, 21, 12]), `hex ${h.id}`);
});

test('the Open Sea stylesheet gives the pieces the house contour and the robber’s colours, and loads last', () => {
  const css = readFileSync('apps/client/src/open-sea.css', 'utf8');
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[.*]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  assert.match(rule('.ship-hull'), /stroke: #31453e;\s*stroke-width: 1\.7;\s*stroke-linejoin: round;/);
  assert.match(rule('.ship-sail'), /fill: #fff0cc;\s*stroke: #31453e;/);
  assert.match(rule('.ship-mast'), /stroke: #31453e;/);
  assert.match(rule('.pirate-piece path'), /fill: #172231;\s*stroke: #c3b488;/);
  assert.match(rule('.pirate-piece .pirate-pennant'), /stroke: #e7d8af;/);
  assert.match(rule('.board-camera .sea-stage'), /filter: none;/);
  assert.doesNotMatch(css, /!important|#[\w-]+ \{|:not\(/);
  const imports = [
    ...readFileSync('apps/client/src/main.tsx', 'utf8').matchAll(/^import '\.\/([\w-]+\.css)';$/gm),
  ];
  assert.equal(imports.at(-1)?.[1], 'open-sea.css');
});
