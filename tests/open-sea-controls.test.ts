/**
 * Open Sea's in-game controls (docs/RULEBOOK-OPEN-SEA.md, docs/GAME-MODES.md "Matching the existing look"): the
 * road-or-ship choice, ship moves, the robber or the pirate, gold picks, the island bonus, and the words and
 * icons that go with them. Each is rendered from a real Open Sea game's view, as the client draws it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dealBoard, isLand } from '../packages/rules/src/board.js';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction, GameView } from '../packages/rules/src/game.js';
import { CLASSIC, OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { SHIP_MOVE_BLOCKS, edgeKind, hexEdges, isCoastalIntersection } from '../packages/rules/src/sea.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { Board } from '../apps/client/src/Board.js';
import { PlacementConfirmation, placementSelector } from '../apps/client/src/PlacementConfirmation.js';
import { buildShown, edgePieces, isBuildAction, placementValid } from '../apps/client/src/placement.js';
import type { BuildAction } from '../apps/client/src/placement.js';
import { MoveShipButton, shipMoveUnavailable } from '../apps/client/src/ShipMove.js';
import { RobberFlow } from '../apps/client/src/RobberFlow.js';
import { GoldPick } from '../apps/client/src/GoldPick.js';
import { TurnTimer } from '../apps/client/src/TurnTimer.js';
import { SEA_ICONS } from '../apps/client/src/GameIcons.js';
import { ICON_ATLAS, PAINTED_ICONS } from '../apps/client/src/painted-icons.js';
import { deriveAwardCelebrations, deriveFeedback } from '../apps/client/src/feedback.js';
import { AwardToast, GameEffects } from '../apps/client/src/GameEffects.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { GameOver } from '../apps/client/src/GameOver.js';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { CARD_LORE, cardEffect, cardLockReason } from '../apps/client/src/cards.js';
import { gameStatus } from '../apps/client/src/game-attention.js';
import { MoveHistory, historyTokens } from '../apps/client/src/MoveHistory.js';
import {
  PIRATE_BOUNDS,
  PORT_BADGE_BOUNDS,
  piratePlacement,
  portPlacement,
  seaBadge,
} from '../apps/client/src/scene.js';
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

test('a ship that may move takes the orbit and a chosen one shows where it may go; the others say why they stay', () => {
  const g = blueToAct();
  const view = gameView(g, 'blue');
  assert.ok(Object.keys(view.legal.shipMoves!).length, 'a starting ship may move on its owner’s first turn');
  // One of Blue's ships built this turn stays put, and says so.
  const built = view.legal.ships!.find((e) => edgeKind(g.board, e) === 'sea')!;
  const after = applyAction(g, 'blue', { kind: 'ship', edge: built }, () => 0.5);
  const busy = gameView(after, 'blue');
  const movable = Object.keys(busy.legal.shipMoves!).map(Number);
  assert.ok(movable.length);
  assert.equal(busy.legal.shipMoveBlocks![built], 'built-this-turn');
  const html = board(busy);
  assert.equal(
    count(html, /class="ship-move-site" data-build-site="movable"/g),
    Object.keys(busy.legal.shipMoves!).length,
  );
  assert.match(
    html,
    new RegExp(
      `aria-disabled="true" aria-label="Your ship on edge ${built + 1}. It cannot move: ${SHIP_MOVE_BLOCKS['built-this-turn']}"`,
    ),
  );
  // Nothing marks a ship until it is the player's own action phase.
  assert.doesNotMatch(board(gameView(after, 'red'), { me: 'red' }), /ship-move-site/);
  assert.doesNotMatch(board({ ...busy, phase: 'roll' }), /ship-move-site/);
  // Move ship: every movable ship orbits, and nothing is built meanwhile.
  const choosing = board(busy, { shipMove: { from: null } });
  assert.equal(count(choosing, /data-build-site="movable" data-guided="true"/g), movable.length);
  assert.doesNotMatch(choosing, /data-build-site="(road|ship|settlement|city)"/);
  // A ship chosen: its destinations are sites, guided, and nothing else is.
  const from = movable[0]!;
  const destinations = busy.legal.shipMoves![from]!;
  const chosen = board(busy, { shipMove: { from } });
  assert.equal(count(chosen, /data-build-site="moveShip"/g), destinations.length);
  assert.match(
    chosen,
    new RegExp(`aria-pressed="true"[^>]*aria-label="Your ship on edge ${from + 1}. Chosen to move"`),
  );
  for (const to of destinations)
    assert.match(
      chosen,
      new RegExp(
        `aria-label="Move the ship to edge ${to + 1}" class="legal-road" data-build-site="moveShip" data-site-id="${to}" data-guided="true"`,
      ),
    );
  // Confirming it: the ship waits lifted, and its ghost stands where it goes.
  const move = { kind: 'moveShip' as const, from, to: destinations[0]! };
  assert.ok(placementValid(draft(busy, move), busy, 'ROOM', 'blue'));
  const pending = board(busy, { shipMove: { from }, pendingBuild: move });
  assert.match(pending, new RegExp(`data-ship-id="${from}"[^>]*data-moving="true"`));
  assert.match(pending, /class="build-ghost ship-piece" data-pending-build="moveShip"/);
  // The move made: one a turn, and the dock's button says so.
  const moved = applyAction(after, 'blue', { kind: 'moveShip', from, to: destinations[0]! }, () => 0.5);
  const done = gameView(moved, 'blue');
  assert.deepEqual(done.legal.shipMoves, {});
  assert.ok(!placementValid(draft(done, move), done, 'ROOM', 'blue'));
  assert.ok(buildShown(done, move));
  assert.equal(shipMoveUnavailable(done, 'blue'), SHIP_MOVE_BLOCKS['move-used']);
  const button = (view: GameView) =>
    renderToStaticMarkup(
      createElement(MoveShipButton, {
        game: view,
        me: 'blue',
        active: false,
        disabled: false,
        onToggle: noop,
      }),
    );
  assert.match(
    button(busy),
    /<button class="trade-action ship-move-action " aria-label="Move ship" aria-pressed="false" title="Move ship">/,
  );
  assert.match(button(done), /title="Move ship · You have already moved a ship this turn" disabled=""/);
  assert.match(
    button({ ...busy, ships: {} }),
    /title="Move ship · You have no ships on the board" disabled=""/,
  );
});

test('after a seven, Open Sea offers the robber and the pirate, then only the chosen one’s hexes, then its victims', () => {
  const g = blueToAct();
  // Red's ship lies on a sea hex away from the pirate: the pirate's victim there.
  const redShip = Number(Object.entries(g.ships!).find(([, owner]) => owner === 'red')![0]);
  const hex = g.board.edges[redShip]!.hexes.find(
    (h) => h !== g.pirate && g.board.hexes[h]!.terrain === 'sea',
  )!;
  g.phase = 'robber';
  const view = gameView(g, 'blue');
  assert.ok(view.legal.robberHexes!.length && view.legal.pirateHexes!.includes(hex));
  const flow = (props: Partial<ComponentProps<typeof RobberFlow>> = {}, state = view) =>
    renderToStaticMarkup(
      createElement(RobberFlow, {
        room: room(state),
        me: 'blue',
        selectedHex: null,
        onSelectHex: noop,
        onAction: noop,
        disabled: false,
        connected: true,
        onWarning: noop,
        ...props,
      }),
    );
  const choice = flow();
  assert.match(choice, /<h2 aria-live="polite">Move the robber or the pirate<\/h2>/);
  const buttons = choice.match(/<button type="button" class="robber-victim"[^]*?<\/button>/g)!;
  assert.equal(buttons.length, 2);
  assert.match(
    buttons[0]!,
    /<strong>Robber<\/strong><small>Block a land tile, and rob a building beside it<\/small>/,
  );
  assert.match(
    buttons[1]!,
    /<strong>Pirate<\/strong><small>Block a sea hex, and rob a ship beside it<\/small>/,
  );
  // Only what is legal is offered.
  const noSea = flow({}, { ...view, legal: { ...view.legal, pirateHexes: [] } });
  assert.equal(count(noSea, /class="robber-victim"/g), 1);
  assert.doesNotMatch(noSea, /Pirate/);
  // Before the choice no hex is a target; after it, only that piece's hexes, land or sea, never both. Both are
  // marked as the robber's tiles are.
  assert.doesNotMatch(board(view), /robber-target/);
  const pirate = board(view, { robberPiece: 'pirate' });
  assert.equal(count(pirate, /class="terrain-hit robber-target"/g), view.legal.pirateHexes!.length);
  assert.equal(count(pirate, /aria-label="Sea. Move pirate here"/g), view.legal.pirateHexes!.length);
  assert.doesNotMatch(pirate, /Move robber here/);
  const robber = board(view, { robberPiece: 'robber' });
  assert.equal(count(robber, /class="terrain-hit robber-target"/g), view.legal.robberHexes!.length);
  assert.doesNotMatch(robber, /Move pirate here|aria-label="Sea\. Move/);
  // The pirate chosen: the sea hexes, and a way back to the robber.
  const sailing = flow({ piece: 'pirate' });
  assert.match(sailing, /<h2 aria-live="polite">Move the pirate<\/h2>/);
  assert.match(sailing, /Choose a sea hex, then a player with a ship beside it to steal from\./);
  assert.match(sailing, />Move the robber instead<\/button>/);
  // A sea hex chosen: whoever has a ship on its edges, never a building's owner, and one action with the victim.
  const victims = flow({ piece: 'pirate', selectedHex: hex });
  assert.match(victims, /<h2 aria-live="polite">Choose who to steal from<\/h2>/);
  assert.match(victims, /<strong>Red<\/strong>/);
  assert.ok(hexEdges(g.board, hex).includes(redShip));
  assert.match(victims, />Choose another sea hex<\/button>/);
  // Everyone else waits, told it may be either.
  assert.match(flow({ me: 'red' }, gameView(g, 'red')), /Blue is moving the robber or the pirate/);
});

test('a gold pick is made with Year of Plenty’s buttons, only from what the bank has, in the order of picks', () => {
  const g = blueToAct();
  g.phase = 'goldPick';
  g.goldOwed = [
    { player: 'blue', picks: 2 },
    { player: 'green', picks: 1 },
  ];
  g.bank.ore = 0;
  const clock = {
    playerId: 'blue',
    turn: 1,
    startedAt: 1,
    pausedAt: 990_000,
    goldDeadlines: { blue: 1_014_000 },
  };
  const panel = (me: string) =>
    renderToStaticMarkup(
      createElement(GoldPick, {
        room: room(gameView(g, me), { turnClock: clock }),
        me,
        disabled: false,
        connected: true,
        onAction: noop,
        onWarning: noop,
      }),
    );
  const picker = panel('blue');
  assert.match(picker, /<aside class="robber-flow gold-pick needs-you" aria-label="Gold picks">/);
  assert.match(picker, /<h2 aria-live="polite">Gold field: choose 2<\/h2>/);
  // The picker's own 20 seconds, 14 of them left.
  assert.match(picker, /title="Your time to pick from the gold field"><svg[^]*?<b>14s<\/b>/);
  // The bank has no Rock: its button cannot be chosen; the others can.
  assert.match(picker, /aria-label="Choose Rock, 0 selected, 0 available" aria-pressed="false" disabled=""/);
  assert.match(picker, /aria-label="Choose Timber, 0 selected, \d+ available" aria-pressed="false">/);
  assert.match(picker, /<button type="button" class="gold-button" disabled="">[^]*Choose 2 more<\/button>/);
  // The order of picks, in the discard list's rows.
  const rows = picker.match(/<div class="discard-player"[^]*?<\/div>/g)!;
  assert.match(rows[0]!, /data-current="true"[^]*<strong>You<\/strong><small>Picking now<\/small>/);
  assert.match(rows[1]!, /data-current="false"[^]*<strong>Green<\/strong><small>Next<\/small>/);
  // Everyone else sees who is picking, without the buttons.
  const waiting = panel('red');
  assert.match(waiting, /<h2 aria-live="polite">Blue is picking from a gold field<\/h2>/);
  assert.match(waiting, /title="Time left to pick from the gold field"/);
  assert.doesNotMatch(waiting, /development-resources/);
  // The count follows the bank when it holds fewer cards than are owed.
  for (const r of ['wood', 'brick', 'sheep', 'wheat'] as const) g.bank[r] = 0;
  g.bank.wheat = 1;
  assert.match(panel('blue'), /Gold field: choose 1/);
  // Outside gold picks, nothing.
  g.phase = 'actions';
  assert.equal(panel('blue'), '');
  // The turn clock itself stays paused, as it says, while picks are made.
  g.phase = 'goldPick';
  const paused = renderToStaticMarkup(
    createElement(TurnTimer, {
      room: room(gameView(g, 'red'), { turnClock: { ...clock, deadlineAt: 1_050_000 } }),
      me: 'red',
      connected: true,
      onWarning: noop,
    }),
  );
  assert.match(paused, /<small>Gold picks<\/small>/);
});

test('the stand-in icons for the pirate, gold and the island bonus are painted icons, named in one place', () => {
  const painted = readFileSync('apps/client/src/painted-icons.ts', 'utf8');
  for (const name of Object.values(SEA_ICONS)) assert.match(painted, new RegExp(`^  '?${name}'?: \\[`, 'm'));
});

/** A painted icon's cell in the atlas, as GameIcon draws it. */
const painted = (name: keyof typeof PAINTED_ICONS) =>
  `<image href="${ICON_ATLAS}" x="${-PAINTED_ICONS[name][0]}" y="${-PAINTED_ICONS[name][1]}"`;

test('an island bonus is celebrated once, named in the score’s tooltip, and listed with its icon in the results', () => {
  const g = blueToAct();
  const before = gameView(g, 'red');
  g.islandBonuses = { blue: ['a'] };
  const after = gameView(g, 'red');
  const [award] = deriveAwardCelebrations(room(before), room(after, { revision: 13 }));
  assert.deepEqual(award, {
    id: 'ROOM:13:islandBonus:blue',
    revision: 13,
    kind: 'islandBonus',
    name: 'Island bonus',
    playerId: 'blue',
    playerName: 'Blue',
    count: 1,
    minimum: 1,
  });
  assert.deepEqual(deriveAwardCelebrations(room(after), room(after, { revision: 14 })), [], 'once');
  const toast = renderToStaticMarkup(createElement(AwardToast, { award: award!, reducedMotion: true }));
  assert.match(toast, /data-award="islandBonus"/);
  assert.ok(toast.includes(painted(SEA_ICONS.islandBonus)));
  assert.match(
    toast,
    /<span class="award-recipient">Blue earns<\/span><h2>Island bonus<\/h2><p><b>1<\/b> island settled<\/p>/,
  );
  assert.match(toast, /<small>A first settlement on a new island<\/small>/);
  assert.match(toast, /<b>\+2<\/b><span>points<\/span>/);
  // The rail's score says where the points came from.
  g.islandBonuses = { blue: ['a', 'b'] };
  const rail = renderToStaticMarkup(
    createElement(PlayerRail, { room: room(gameView(g, 'red')), game: gameView(g, 'red'), me: 'red' }),
  );
  assert.match(rail, /title="6 victory points · Island bonus × 2 \+4"/);
  assert.match(
    rail,
    /title="2 victory points" aria-label="2 victory points"/,
    'a player without one keeps the plain score',
  );
  // The results: the mode, and the bonus with its icon.
  g.phase = 'finished';
  g.winner = 'blue';
  const results = renderToStaticMarkup(
    createElement(GameOver, {
      room: { ...room(gameView(g, 'blue')), round: 1 },
      busy: false,
      canReturn: true,
      onReturn: noop,
      onQuit: noop,
    }),
  );
  assert.match(
    results,
    /<dl class="game-over-facts" aria-label="This match"><div><dt>Mode<\/dt><dd>Open Sea<\/dd><\/div><div><dt>Turns<\/dt>/,
  );
  const part = results.match(/<li data-part="islandBonus">[^]*?<\/li>/)![0];
  assert.ok(part.includes(painted(SEA_ICONS.islandBonus)));
  assert.match(part, /<span>Island bonus × 2<\/span><b>\+4<\/b>/);
  // Classic's results have no Mode.
  const classic = createGame(SEATS.slice(0, 3), 481, () => 0.5);
  Object.assign(classic, { phase: 'finished', winner: 'blue', turn: 9 });
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(GameOver, {
        room: { ...room(gameView(classic, 'blue')), round: 1 },
        busy: false,
        canReturn: true,
        onReturn: noop,
        onQuit: noop,
      }),
    ),
    /Mode/,
  );
});

test('Open Sea’s words: the guide’s section and costs, the cards, the prompts and the move history', () => {
  const guide = renderToStaticMarkup(createElement(QuickRules, { ruleset: OPEN_SEA }));
  assert.match(
    guide,
    /<section class="guide-section t-acc" data-open="true"><button class="t-acc-head" aria-expanded="true"[^>]*>[^]*?<span>Open Sea<\/span>/,
  );
  for (const words of [
    'A ship costs 1 Timber and 1 Sheep.',
    'Once a turn, after the roll, you may move one ship',
    'A gold field pays the resource you choose',
    'After a 7 or a Knight, move the robber or the pirate.',
    'Your first settlement on each small island is worth 2 extra points.',
    'Open Sea plays to 14 points unless the host chose another target.',
    'Longest Route · +2 points',
  ])
    assert.ok(guide.includes(words), words);
  assert.match(
    guide,
    /<span>Ship<\/span><\/dt><dd><span class="recipe-pay">Pay<\/span><span class="resource-summary"><span role="img" aria-label="1 Timber"[^]*?aria-label="1 Sheep"/,
  );
  assert.match(guide, /<dt>Island bonus<\/dt><dd>2 points<\/dd>/);
  assert.match(
    guide,
    /href="https:\/\/github.com\/shashwtd\/catanova\/blob\/main\/docs\/RULEBOOK-OPEN-SEA.md"/,
  );
  const classic = renderToStaticMarkup(createElement(QuickRules, { ruleset: CLASSIC }));
  assert.doesNotMatch(classic, /Open Sea|pirate|Ship|Longest Route/);
  // Cards in Open Sea, and Road Building when only a ship can be placed.
  const g = blueToAct();
  g.players[0]!.cards = [{ id: 'rb', kind: 'roadBuilding', boughtTurn: 0 }];
  for (
    let e = 0;
    e < g.board.edges.length && Object.values(g.roads).filter((p) => p === 'blue').length < 15;
    e++
  )
    if (!g.roads[e] && !g.ships![e]) g.roads[e] = 'blue';
  const view = gameView(g, 'blue');
  assert.equal(cardLockReason(view.players[0]!.cards![0]!, view, 'blue'), null, 'a ship will do');
  assert.match(cardEffect('knight', view), /robber or the pirate/);
  assert.match(cardEffect('roadBuilding', view), /roads or ships/);
  assert.equal(cardEffect('knight', { ruleset: CLASSIC.id }), CARD_LORE.knight.effect);
  assert.equal(cardEffect('monopoly', view), CARD_LORE.monopoly.effect);
  const played = structuredClone(g);
  played.log.push({ id: played.nextLog++, text: 'Blue played Knight.' });
  const event = deriveFeedback(
    room(gameView(g, 'red')),
    room(gameView(played, 'red'), { revision: 13 }),
    'red',
  )!;
  assert.deepEqual(event.cardPlay, { kind: 'knight', playerName: 'Blue', sea: true });
  assert.match(
    renderToStaticMarkup(
      createElement(GameEffects, { event, reducedMotion: true, activity: true, lastDice: null }),
    ),
    /<p>The watch rides out. Move the robber or the pirate.<\/p>/,
  );
  // The prompts.
  for (const [phase, freeRoads, mine, others] of [
    ['setupRoad', 0, 'Place a road or a ship on a highlighted path', 'Blue is placing a road or a ship'],
    [
      'freeRoads',
      2,
      'Place 2 free roads or ships on the highlighted paths',
      'Blue is placing free roads or ships',
    ],
    [
      'freeRoads',
      1,
      'Place 1 free road or ship on the highlighted paths',
      'Blue is placing free roads or ships',
    ],
    ['robber', 0, 'Move the robber or the pirate', 'Blue is moving the robber or the pirate'],
  ] as const) {
    const state = { ...view, phase, freeRoads };
    assert.equal(gameStatus(state, 'blue').prompt, mine);
    assert.equal(gameStatus(state, 'red').prompt, others);
  }
  // The move history: names, words and icons.
  const names = ['Blue', 'Red', 'Green'];
  const line = (text: string) =>
    renderToStaticMarkup(createElement('p', null, ...historyTokens(text, names)));
  assert.match(
    line('Blue moved the pirate and stole a card from Red.'),
    /^<p><strong class="journal-person">Blue<\/strong> moved the <span class="journal-item" role="img" aria-label="pirate"><svg[^]*?<span>pirate<\/span><\/span> and stole a card from <strong class="journal-person">Red<\/strong>/,
  );
  assert.match(
    line('Blue moved the pirate. Red had no resource cards.'),
    /<strong class="journal-person">Red<\/strong> had no/,
  );
  const island = line('Blue settled a new island (+2 points).');
  assert.match(
    island,
    /^<p><strong class="journal-person">Blue<\/strong> settled a <span class="journal-item" role="img" aria-label="new island">/,
  );
  assert.ok(island.includes(painted(SEA_ICONS.islandBonus)));
  const ship = line('Blue built a ship on edge 5.');
  assert.match(
    ship,
    /<span class="journal-item" role="img" aria-label="ship"><svg[^]*?<\/svg><span><\/span><\/span> on edge 5\./,
  );
  assert.ok(ship.includes(painted('boat')));
  assert.match(
    line('Blue moved a ship from edge 4 to edge 9.'),
    /aria-label="ship"[^]*from edge 4 to edge 9\./,
  );
  const gold = line('Blue took 1 Timber, 1 Rock from the bank for gold.');
  assert.match(
    gold,
    /aria-label="1 Timber"[^]*aria-label="1 Rock"[^]*aria-label="gold"><svg[^]*<span>gold<\/span>/,
  );
  const history = renderToStaticMarkup(
    createElement(MoveHistory, {
      entries: ['ship', 'moveShip', 'pirate', 'goldPick'].map((kind, i) => ({
        revision: 20 - i,
        actor: 'blue',
        kind,
        turn: 4,
        at: '2026-09-26T12:00:00Z',
        lines: ['Blue built a ship on edge 5.'],
      })),
      game: view,
      hasMore: false,
      onEarlier: noop,
    }),
  );
  const actions = history.match(/<span class="journal-action">[^]*?<\/span>/g)!;
  assert.equal(actions.length, 4);
  for (const [i, icon] of (['boat', 'boat', SEA_ICONS.pirate, SEA_ICONS.gold] as const).entries())
    assert.ok(actions[i]!.includes(painted(icon)), icon);
});

test('the pirate stands clear of every harbour badge on its hex, and in the middle of any other', () => {
  for (const players of [3, 4])
    for (const seed of [1, 2, 3, 7, 11, 42, 481, 2026]) {
      const b = dealBoard(seed, 'outer-isles-v1', players);
      const harboured = new Set(b.ports.flatMap((port) => b.edges[port.edge]!.hexes));
      for (const hex of b.hexes.filter((h) => !isLand(h))) {
        const at = piratePlacement(b, hex.id);
        if (!harboured.has(hex.id)) {
          assert.deepEqual(at, { x: hex.x * 64, y: hex.y * 64 + 6 });
          continue;
        }
        for (const port of b.ports) {
          const { markerX, markerY } = seaBadge(portPlacement(b, port.edge));
          const clear =
            at.x + PIRATE_BOUNDS.left >= markerX + PORT_BADGE_BOUNDS.x + PORT_BADGE_BOUNDS.width ||
            at.x + PIRATE_BOUNDS.right <= markerX + PORT_BADGE_BOUNDS.x ||
            at.y + PIRATE_BOUNDS.top >= markerY + PORT_BADGE_BOUNDS.y + PORT_BADGE_BOUNDS.height ||
            at.y + PIRATE_BOUNDS.bottom <= markerY + PORT_BADGE_BOUNDS.y;
          assert.ok(clear, `seed ${seed}, ${players} players: the pirate on hex ${hex.id} covers a badge`);
        }
        // It keeps to its own hex: less than half a hex from the middle.
        assert.ok(Math.hypot(at.x - hex.x * 64, at.y - hex.y * 64) < 32, `hex ${hex.id}`);
      }
    }
});

test('each new component has one stylesheet, loaded last, in the house’s selector shapes', () => {
  const main = readFileSync('apps/client/src/main.tsx', 'utf8');
  const sheets = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  assert.deepEqual(sheets.slice(sheets.indexOf('open-sea.css') + 1), [
    'ship-sites.css',
    'placement-choice.css',
    'gold-pick.css',
  ]);
  for (const sheet of ['ship-sites.css', 'placement-choice.css', 'gold-pick.css']) {
    const css = readFileSync(`apps/client/src/${sheet}`, 'utf8');
    assert.doesNotMatch(css, /!important|#[\w-]+[\s{:.[]|:not\(|@keyframes|animation/, sheet);
    // Barlow only, never a new family or weight.
    for (const [, weight, family] of css.matchAll(/font:\s*(\d+) [^,]*? (\w+),/g))
      assert.ok(
        ['400', '500', '600'].includes(weight!) && family === 'Barlow',
        `${sheet}: ${weight} ${family}`,
      );
  }
});
