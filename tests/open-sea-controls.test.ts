/**
 * Open Sea's in-game controls (docs/RULEBOOK-OPEN-SEA.md, docs/GAME-MODES.md "Matching the existing look"): the
 * road-or-ship choice, ship moves, the robber or the pirate, gold picks, the island bonus, and the words and
 * icons that go with them. Each is rendered from a real Open Sea game's view, as the client draws it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction, GameView } from '../packages/rules/src/game.js';
import { OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { edgeKind, isCoastalIntersection } from '../packages/rules/src/sea.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { Board } from '../apps/client/src/Board.js';
import { PlacementConfirmation, placementSelector } from '../apps/client/src/PlacementConfirmation.js';
import { buildShown, edgePieces, isBuildAction, placementValid } from '../apps/client/src/placement.js';
import type { BuildAction } from '../apps/client/src/placement.js';
import { SEATS, giveCards } from './open-sea-game.js';

const noop = () => {};
/** An Open Sea game for three after setup, every player on a coastal corner with a starting ship out to sea. */
function afterSetup(seed = 5): Game {
  let g = createGame(SEATS.slice(0, 3), seed, () => 0.5, { ruleset: OPEN_SEA.id });
  while (g.turn === 0) {
    const [move] = owedMoves(g);
    const view = gameView(g, move!.player);
    let action: GameAction;
    if (move!.kind === 'setupSettlement') {
      const coastal = view.legal.settlements.filter((v) => isCoastalIntersection(g.board, v));
      action = { kind: 'settlement', vertex: (coastal[0] ?? view.legal.settlements[0])! };
    } else {
      const out = view.legal.ships!.filter((e) => edgeKind(g.board, e) === 'sea');
      action = out.length ? { kind: 'ship', edge: out[0]! } : { kind: 'road', edge: view.legal.roads[0]! };
    }
    g = applyAction(g, move!.player, action, () => 0.5);
  }
  return g;
}
/** Blue's action phase, with cards to spend. */
function blueToAct(g = afterSetup()): Game {
  g.active = 0;
  g.phase = 'actions';
  g.dice = [3, 5];
  giveCards(g, 'blue', { wood: 3, brick: 3, sheep: 3, wheat: 3, ore: 3 });
  return g;
}
const room = (view: GameView, extra: Partial<RoomState> = {}): RoomState => ({
  roomId: 'ROOM',
  revision: 12,
  counter: 0,
  serverNow: 1_000_000,
  players: view.players.map((p) => ({ id: p.id, name: p.name, connected: true })),
  game: view,
  ...extra,
});
const board = (view: GameView, props: Partial<ComponentProps<typeof Board>> = {}) =>
  renderToStaticMarkup(
    createElement(Board, {
      board: view.board,
      game: view,
      me: 'blue',
      mode: null,
      disabled: false,
      onAction: noop,
      onRobber: noop,
      ...props,
    }),
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const draft = (view: GameView, action: BuildAction) => ({
  action,
  roomId: 'ROOM',
  player: 'blue',
  turn: view.turn,
  phase: view.phase,
  setupIndex: view.setupIndex,
});

test('in setup, a coastal edge offers a road or a ship, a sea edge a ship, and the board shows each as one site', () => {
  let g = createGame(SEATS.slice(0, 3), 5, () => 0.5, { ruleset: OPEN_SEA.id });
  const first = gameView(g, 'blue');
  const corner = first.legal.settlements.find((v) => isCoastalIntersection(g.board, v))!;
  g = applyAction(g, 'blue', { kind: 'settlement', vertex: corner }, () => 0.5);
  const view = gameView(g, 'blue');
  assert.equal(view.phase, 'setupRoad');
  const kinds = view.board.vertices[corner]!.edges.map((e) => [e, edgeKind(view.board, e)] as const);
  for (const [edge, kind] of kinds) {
    const expected = { land: ['road'], coastal: ['road', 'ship'], sea: ['ship'], rim: [] }[kind];
    assert.deepEqual(edgePieces(view, edge), expected, `edge ${edge} is ${kind}`);
  }
  const html = board(view);
  const coastal = kinds.filter(([, kind]) => kind === 'coastal').map(([edge]) => edge);
  const sea = kinds.filter(([, kind]) => kind === 'sea').map(([edge]) => edge);
  assert.ok(coastal.length && sea.length, 'the corner has both kinds of edge');
  for (const edge of coastal) {
    const site = html.match(new RegExp(`<g[^>]*data-site-id="${edge}"[^>]*>`))![0];
    assert.match(site, /aria-label="Build road or ship on edge \d+"/);
    assert.match(site, /data-build-site="road" data-ship-site="true"/);
    assert.match(site, /data-guided="true"/);
  }
  for (const edge of sea)
    assert.match(
      html,
      new RegExp(
        `aria-label="Build ship on edge ${edge + 1}" class="legal-road" data-build-site="ship" data-site-id="${edge}" data-guided="true"`,
      ),
    );
  // Each edge is one site, whatever it takes; a ship site previews the ship upright on its edge.
  assert.equal(count(html, /data-build-site=/g), view.legal.roads.length + sea.length);
  assert.equal(count(html, /<g class="build-site-preview"[^>]*transform="translate/g), sea.length);
  // A ship being confirmed shows its ghost, and its selector finds the coastal edge's single site.
  const ship = { kind: 'ship' as const, edge: coastal[0]! };
  assert.ok(placementValid(draft(view, ship), view, 'ROOM', 'blue'));
  assert.ok(isBuildAction(ship));
  const ghost = board(view, { pendingBuild: ship });
  assert.match(
    ghost,
    /class="build-ghost ship-piece" data-pending-build="ship" role="img" aria-label="Ship placement preview"/,
  );
  assert.match(ghost, new RegExp(`data-site-id="${coastal[0]}" data-guided="true" data-pending="true"`));
  assert.equal(
    placementSelector(ship),
    `[data-site-id="${coastal[0]}"]:is([data-build-site="ship"], [data-ship-site])`,
  );
  assert.equal(placementSelector({ kind: 'road', edge: 7 }), '[data-build-site="road"][data-site-id="7"]');
  // Not in another phase, and not once the ship is on the board.
  assert.ok(!placementValid(draft(view, ship), { ...view, phase: 'roll' }, 'ROOM', 'blue'));
  assert.equal(buildShown(view, ship), false);
  assert.equal(buildShown({ ...view, ships: { [ship.edge]: 'blue' } }, ship), true);
});

test('the confirmation offers Road or Ship on an edge that takes both, with the costs when they are bought', () => {
  const render = (props: Partial<ComponentProps<typeof PlacementConfirmation>>) =>
    renderToStaticMarkup(
      createElement(PlacementConfirmation, {
        action: { kind: 'road', edge: 3 },
        disabled: false,
        onCancel: noop,
        onConfirm: noop,
        ...props,
      }),
    );
  const bought = render({
    action: { kind: 'ship', edge: 3 },
    choice: {
      pieces: ['road', 'ship'],
      costs: { road: OPEN_SEA.costs.road, ship: OPEN_SEA.costs.ship! },
      onChoose: noop,
    },
  });
  const [road, ship] = bought.match(/<button type="button" class="placement-option"[^]*?<\/button>/g)!;
  assert.match(road!, /data-piece="road" aria-pressed="false" aria-label="Road, 1 Timber, 1 Clay"/);
  assert.match(ship!, /data-piece="ship" aria-pressed="true" aria-label="Ship, 1 Timber, 1 Sheep"/);
  assert.deepEqual(
    [...ship!.matchAll(/data-cost-resource="(\w+)"/g)].map((m) => m[1]),
    ['wood', 'sheep'],
  );
  assert.deepEqual(
    [...road!.matchAll(/data-cost-resource="(\w+)"/g)].map((m) => m[1]),
    ['wood', 'brick'],
  );
  // The choice stands in for the question, and the confirm button names the piece chosen.
  assert.doesNotMatch(bought, /<strong>/);
  assert.match(bought, /aria-label="Confirm ship"/);
  // Free, in setup or from Road Building: no costs.
  const free = render({ choice: { pieces: ['road', 'ship'], onChoose: noop } });
  assert.doesNotMatch(free, /placement-option-cost/);
  assert.match(free, /data-piece="road" aria-pressed="true" aria-label="Road"/);
  // A ship alone asks as a road does; a ship move asks where it goes.
  assert.match(render({ action: { kind: 'ship', edge: 3 } }), /<strong>Confirm ship\?<\/strong>/);
  const move = render({ action: { kind: 'moveShip', from: 2, to: 3 } });
  assert.match(move, /<strong>Move ship here\?<\/strong>/);
  assert.match(move, /aria-label="Confirm ship move"/);
  // Classic's confirmation is as it was.
  assert.match(render({}), /<strong>Confirm road\?<\/strong>/);
  assert.doesNotMatch(render({}), /placement-choice/);
});
