import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePlayer,
  applyAction,
  createGame,
  emptyHand,
  gameView,
  parseGameAction,
} from '../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import { deriveFeedback } from '../apps/client/src/feedback.js';

const seats = ['Alice', 'Bob', 'Cara', 'Dan'].map((name, i) => ({ id: `p${i}`, name }));
const hand = (values: Partial<Hand>): Hand => ({ ...emptyHand(), ...values });
const move = (game: Game, action: GameAction, player = 'p0') => applyAction(game, player, action, () => 0.34);
function setup() {
  let game = createGame(seats, 82, () => 0.34);
  while (!game.turn) {
    const player = activePlayer(game),
      legal = gameView(game, player.id).legal;
    game = move(
      game,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      player.id,
    );
  }
  for (const player of game.players)
    for (const resource of RESOURCES) {
      game.bank[resource] += player.hand[resource];
      player.hand[resource] = 0;
    }
  const hands = [
    hand({ wood: 3, brick: 1 }),
    hand({ sheep: 4, ore: 2 }),
    hand({ wheat: 4 }),
    hand({ ore: 2 }),
  ];
  game.players.forEach((player, index) => {
    player.hand = hands[index]!;
    for (const resource of RESOURCES) game.bank[resource] -= player.hand[resource];
  });
  game.phase = 'actions';
  return game;
}
const open = (game = setup()) => move(game, { kind: 'openTrade', give: hand({ wood: 2 }) });
function conserved(game: Game) {
  for (const resource of RESOURCES) {
    assert.equal(game.bank[resource] + game.players.reduce((n, player) => n + player.hand[resource], 0), 19);
    assert.ok(
      game.players.every((player) => Number.isInteger(player.hand[resource]) && player.hand[resource] >= 0),
    );
  }
}

test('open trades require active-player consent and cannot be accepted as gifts through the exact-trade action', () => {
  const game = setup(),
    saved = structuredClone(game);
  assert.throws(() => move(game, { kind: 'openTrade', give: hand({ wood: 2 }) }, 'p1'), /Wait/);
  assert.throws(() => move(game, { kind: 'openTrade', give: emptyHand() }), /at least one/);
  assert.throws(() => move(game, { kind: 'openTrade', give: hand({ wood: 4 }) }), /offered cards/);
  assert.deepEqual(game, saved);
  const opened = open(game),
    id = opened.trade!.id;
  assert.deepEqual(opened.trade, {
    id: 0,
    player: 'p0',
    give: hand({ wood: 2 }),
    want: emptyHand(),
    open: true,
    proposals: [],
  });
  assert.throws(() => move(opened, { kind: 'acceptTrade', tradeId: id }, 'p1'), /no longer available/);
  assert.throws(
    () => move(opened, { kind: 'proposeTrade', tradeId: id, give: hand({ brick: 1 }) }),
    /open trade/,
  );
  for (const phase of ['roll', 'discard', 'robber', 'freeRoads', 'finished'] as const) {
    const changed = structuredClone(opened);
    changed.phase = phase;
    assert.throws(() => move(changed, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1'));
  }
});

test('opponents publish bounded, affordable, disjoint proposals and can replace or withdraw only their own', () => {
  let game = open();
  const id = game.trade!.id;
  for (const give of [emptyHand(), hand({ sheep: 5 }), hand({ wood: 1, sheep: 1 })])
    assert.throws(() => move(game, { kind: 'proposeTrade', tradeId: id, give }, 'p1'));
  assert.throws(
    () => move(game, { kind: 'proposeTrade', tradeId: id + 1, give: hand({ sheep: 1 }) }, 'p1'),
    /no longer available/,
  );
  const original = structuredClone(game.players);
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1');
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ wheat: 1 }) }, 'p2');
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ ore: 1 }) }, 'p3');
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 2, ore: 1 }) }, 'p1');
  assert.equal(game.trade!.proposals!.length, 3);
  assert.equal(new Set(game.trade!.proposals!.map((proposal) => proposal.player)).size, 3);
  assert.deepEqual(
    game.trade!.proposals!.find((proposal) => proposal.player === 'p1')!.give,
    hand({ sheep: 2, ore: 1 }),
  );
  assert.deepEqual(game.players, original, 'proposing reserves or transfers no cards');
  game = move(game, { kind: 'withdrawProposal', tradeId: id }, 'p1');
  assert.deepEqual(
    game.trade!.proposals!.map((proposal) => proposal.player),
    ['p2', 'p3'],
  );
  assert.throws(() => move(game, { kind: 'withdrawProposal', tradeId: id }, 'p1'), /no proposal/);
  assert.throws(() => move(game, { kind: 'withdrawProposal', tradeId: id }), /open trade/);
  conserved(game);
});

test('only the maker chooses a proposal; both inventories are rechecked before atomic exchange', () => {
  let game = open();
  const id = game.trade!.id;
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 2 }) }, 'p1');
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ wheat: 1 }) }, 'p2');
  assert.throws(
    () => move(game, { kind: 'acceptProposal', tradeId: id, player: 'p2' }, 'p1'),
    /no longer available/,
  );
  for (const player of ['p0', 'p3', 'missing'])
    assert.throws(() => move(game, { kind: 'acceptProposal', tradeId: id, player }), /no longer available/);
  for (const [playerIndex, resource] of [
    [0, 'wood'],
    [1, 'sheep'],
  ] as const) {
    const depleted = structuredClone(game);
    depleted.bank[resource] += depleted.players[playerIndex]!.hand[resource];
    depleted.players[playerIndex]!.hand[resource] = 0;
    const before = structuredClone(depleted);
    assert.throws(
      () => move(depleted, { kind: 'acceptProposal', tradeId: id, player: 'p1' }),
      /no longer has/,
    );
    assert.deepEqual(depleted, before, 'a failure cannot transfer even the first half');
  }
  const before = structuredClone(game),
    next = move(game, { kind: 'acceptProposal', tradeId: id, player: 'p1' });
  assert.deepEqual(next.players[0]!.hand, hand({ wood: 1, brick: 1, sheep: 2 }));
  assert.deepEqual(next.players[1]!.hand, hand({ wood: 2, sheep: 2, ore: 2 }));
  assert.deepEqual(next.players[2], before.players[2]);
  assert.deepEqual(next.bank, before.bank);
  assert.equal(next.trade, null);
  assert.match(next.log.at(-1)!.text, /^Alice traded 2 Timber to Bob for 2 Sheep\.$/);
  assert.throws(
    () => move(next, { kind: 'acceptProposal', tradeId: id, player: 'p1' }),
    /no longer available/,
  );
  conserved(next);
});

test('another accepted active move expires every proposal; failures retain the unchanged offer', () => {
  let game = open();
  const id = game.trade!.id;
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1');
  for (const action of [
    { kind: 'endTurn' },
    { kind: 'cancelTrade' },
    { kind: 'road', edge: gameView(game, 'p0').legal.roads[0]! },
  ] as GameAction[]) {
    const next = move(game, action);
    assert.equal(next.trade, null);
    assert.throws(
      () => move(next, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1'),
      /no longer available/,
    );
    assert.throws(
      () => move(next, { kind: 'acceptProposal', tradeId: id, player: 'p1' }),
      /no longer available/,
    );
  }
  const changed = move(game, { kind: 'openTrade', give: hand({ wood: 1 }) });
  assert.ok(changed.trade!.id > id);
  assert.deepEqual(changed.trade!.proposals, []);
  assert.throws(() => move(game, { kind: 'road', edge: -1 }));
  assert.equal(game.trade!.proposals!.length, 1);
});

test('legacy exact trade shapes remain valid and public open proposals expose no unoffered hand contents', () => {
  const base = setup();
  const exact = move(base, { kind: 'offerTrade', give: hand({ wood: 2 }), want: hand({ sheep: 1 }) });
  assert.equal(exact.trade!.open, undefined);
  assert.equal(exact.trade!.proposals, undefined);
  assert.throws(
    () => move(exact, { kind: 'proposeTrade', tradeId: exact.trade!.id, give: hand({ sheep: 1 }) }, 'p1'),
    /open trade/,
  );
  conserved(move(JSON.parse(JSON.stringify(exact)), { kind: 'acceptTrade', tradeId: exact.trade!.id }, 'p1'));
  let game = open(base);
  const id = game.trade!.id;
  game.players[1]!.cards = [{ id: 'private-development', kind: 'knight', boughtTurn: 0 }];
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1');
  for (const viewer of seats) {
    const view = gameView(game, viewer.id);
    assert.deepEqual(view.trade!.proposals, [{ player: 'p1', give: hand({ sheep: 1 }) }]);
    for (const player of view.players) {
      assert.equal(!!player.hand, player.id === viewer.id);
      assert.equal(!!player.cards, player.id === viewer.id);
    }
  }
  const next = move(game, { kind: 'acceptProposal', tradeId: id, player: 'p1' });
  const snapshot = (game: Game, revision: number) => ({
    roomId: 'ABCDEFG2',
    revision,
    counter: 0,
    players: [],
    game: gameView(game, 'p3'),
  });
  assert.ok(deriveFeedback(snapshot(game, 10), snapshot(next, 11), 'p3')!.sounds.includes('trade'));
});

test('new trade commands canonicalize at the protocol boundary and reject invalid counts or identifiers', () => {
  for (const action of [
    { kind: 'openTrade', give: hand({ wood: 1 }) },
    { kind: 'proposeTrade', tradeId: 0, give: hand({ sheep: 1 }) },
    { kind: 'acceptProposal', tradeId: 0, player: 'p1' },
    { kind: 'withdrawProposal', tradeId: 0 },
  ]) {
    assert.deepEqual(parseGameAction({ ...action, playerId: 'spoofed', ignored: true }), action);
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({ type: 'action', commandId: 'open-trade-parse', expectedRevision: 2, action }),
      ),
      { type: 'action', commandId: 'open-trade-parse', expectedRevision: 2, action },
    );
  }
  for (const count of [-1, 1.5, 20, NaN, Infinity, '1'])
    assert.throws(() =>
      parseGameAction({ kind: 'proposeTrade', tradeId: 0, give: { ...emptyHand(), sheep: count } }),
    );
  for (const id of [-1, 1.1, NaN, Infinity, '0'])
    assert.throws(() => parseGameAction({ kind: 'withdrawProposal', tradeId: id }));
  for (const player of ['', 'x'.repeat(81), 42, null])
    assert.throws(() => parseGameAction({ kind: 'acceptProposal', tradeId: 0, player }));
});
