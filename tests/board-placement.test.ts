import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../apps/client/src/Board.js';
import { applyAction, createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Game, GameView } from '../packages/rules/src/game.js';

function game() {
  return createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    42,
    () => 0.25,
  );
}
function render(view: GameView, props: Partial<ComponentProps<typeof Board>> = {}) {
  return renderToStaticMarkup(
    createElement(Board, {
      board: view.board,
      game: view,
      me: 'a',
      mode: null,
      disabled: false,
      onAction: () => {},
      onRobber: () => {},
      ...props,
    }),
  );
}
function siteCount(html: string, kind: string) {
  return [...html.matchAll(new RegExp(`data-build-site="${kind}"`, 'g'))].length;
}
function actionGame(): Game {
  const g = game();
  g.phase = 'actions';
  g.buildings[0] = { player: 'a', kind: 'settlement' };
  const first = g.board.edges[g.board.vertices[0]!.edges[0]!]!;
  const nextVertex = first.a === 0 ? first.b : first.a;
  const second = g.board.vertices[nextVertex]!.edges.find((edge) => edge !== first.id)!;
  g.roads[first.id] = 'a';
  g.roads[second] = 'a';
  g.players[0]!.hand = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
  g.bank = { wood: 14, brick: 14, sheep: 14, wheat: 14, ore: 14 };
  return g;
}

test('affordable board sites are focusable without a toolbar selection, and a selected kind filters them', () => {
  const view = gameView(actionGame(), 'a');
  assert.ok(view.legal.roads.length && view.legal.settlements.length && view.legal.cities.length);
  const html = render(view);
  for (const [kind, ids] of [
    ['road', view.legal.roads],
    ['settlement', view.legal.settlements],
    ['city', view.legal.cities],
  ] as const) {
    assert.equal(siteCount(html, kind), ids.length);
    const filtered = render(view, { mode: kind });
    assert.equal(siteCount(filtered, kind), ids.length);
    assert.equal([...filtered.matchAll(/data-build-site=/g)].length, ids.length);
  }
  const sites = [...html.matchAll(/<g[^>]*data-build-site=[^>]*>/g)];
  assert.ok(sites.every(([site]) => site.includes('role="button"') && site.includes('tabindex="0"')));
  assert.equal([...html.matchAll(/class="build-site-preview"/g)].length, sites.length);
});

test('no placement targets survive missing resources, disabled input, another player, or a non-build phase', () => {
  const g = actionGame();
  const funded = gameView(g, 'a');
  for (const props of [{ disabled: true }, { me: 'b' }]) {
    assert.equal([...render(funded, props).matchAll(/data-build-site=/g)].length, 0);
  }
  g.players[0]!.hand = emptyHand();
  assert.equal([...render(gameView(g, 'a')).matchAll(/data-build-site=/g)].length, 0);
  for (const phase of ['roll', 'discard', 'robber', 'finished'] as const) {
    // Even an old set of private legal hints must not make a later phase clickable.
    assert.equal([...render({ ...funded, phase }).matchAll(/data-build-site=/g)].length, 0);
  }
});

test('setup and free-road phases expose their mandatory legal kind regardless of toolbar mode or cost', () => {
  const initial = game();
  const setup = gameView(initial, 'a');
  assert.equal(siteCount(render(setup, { mode: 'city' }), 'settlement'), setup.legal.settlements.length);
  const placed = applyAction(
    initial,
    'a',
    { kind: 'settlement', vertex: setup.legal.settlements[0]! },
    () => 0.25,
  );
  const road = gameView(placed, 'a');
  assert.ok(road.legal.roads.length > 0);
  assert.equal(siteCount(render(road, { mode: 'city' }), 'road'), road.legal.roads.length);
  assert.equal(siteCount(render(road), 'settlement'), 0);
  const free = actionGame();
  free.phase = 'freeRoads';
  free.freeRoads = 2;
  free.players[0]!.hand = emptyHand();
  const freeView = gameView(free, 'a');
  assert.ok(freeView.legal.roads.length > 0);
  assert.equal(siteCount(render(freeView, { mode: 'settlement' }), 'road'), freeView.legal.roads.length);
  assert.equal(siteCount(render(freeView), 'city'), 0);
});

test('draft road, settlement, and city ghosts leave authoritative pieces unchanged and reject stale sites', () => {
  const view = gameView(actionGame(), 'a');
  const before = structuredClone(view);
  const proposals = [
    { kind: 'road' as const, edge: view.legal.roads[0]! },
    { kind: 'settlement' as const, vertex: view.legal.settlements[0]! },
    { kind: 'city' as const, vertex: view.legal.cities[0]! },
  ];
  for (const pendingBuild of proposals) {
    const html = render(view, { pendingBuild });
    assert.match(html, new RegExp(`data-pending-build="${pendingBuild.kind}"`));
    assert.equal([...html.matchAll(/data-road-id=/g)].length, Object.keys(view.roads).length);
    assert.equal([...html.matchAll(/data-building-id=/g)].length, Object.keys(view.buildings).length);
    assert.match(html, /aria-label="A · settlement"/);
    assert.match(html, /data-pending="true"/);
    assert.equal(
      [...render({ ...view, phase: 'roll' }, { pendingBuild }).matchAll(/data-pending-build=/g)].length,
      0,
    );
  }
  assert.deepEqual(view, before);
  const occupied = Number(Object.keys(view.roads)[0]);
  assert.equal(
    [...render(view, { pendingBuild: { kind: 'road', edge: occupied } }).matchAll(/data-pending-build=/g)]
      .length,
    0,
  );
});

test('terrain retains accessible production odds without native title popups', () => {
  const html = render(gameView(game(), 'a'));
  assert.match(html, /aria-label="[^"]+, 6, 5 production pips"/);
  assert.ok(!/<title>[^<]*production pips/.test(html));
  assert.equal([...html.matchAll(/class="port-boat"/g)].length, 9);
  assert.equal([...html.matchAll(/class="port-cargo"/g)].length, 9);
  assert.equal(
    [...html.matchAll(/class="port-boat" transform="translate\([^)]+\) rotate\(90\)"/g)].length,
    9,
  );
  assert.equal([...html.matchAll(/viewBox="1536 512 512 512"/g)].length, 9);
  assert.ok(!html.includes('class="ship-hull"'));
});
