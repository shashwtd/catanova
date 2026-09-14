import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, applyAction, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { BankTrade, TradePanel, IncomingTrade } from '../apps/client/src/TradePanel.js';

function prepared(count = 2) {
  const game = createGame(
    ['Fern', 'Oak', 'Pip'].slice(0, count).map((name, i) => ({ id: `p${i}`, name })),
    82,
    () => 0.34,
  );
  game.phase = 'actions';
  game.turn = 1;
  for (const player of game.players)
    for (const resource of RESOURCES) {
      player.hand[resource] = 3;
      game.bank[resource] -= 3;
    }
  return game;
}
const hand = (wood = 0, ore = 0) => ({ ...emptyHand(), wood, ore });
const move = (g: Game, actor: string, action: GameAction) => applyAction(g, actor, action, () => 0.34);
const offer = (g: Game) => move(g, 'p0', { kind: 'offerTrade', give: hand(2), want: hand(0, 1) });
const onAction = () => {};

test('two-player fixed offers settle once on recipient confirmation, preserving every resource', () => {
  const opened = offer(prepared());
  const accepted = move(opened, 'p1', { kind: 'acceptTrade', tradeId: opened.trade!.id });
  assert.equal(accepted.trade, null);
  assert.equal(accepted.players[0]!.hand.wood, 1);
  assert.equal(accepted.players[0]!.hand.ore, 4);
  assert.equal(accepted.players[1]!.hand.wood, 5);
  assert.equal(accepted.players[1]!.hand.ore, 2);
  for (const r of RESOURCES)
    assert.equal(accepted.bank[r] + accepted.players.reduce((n, p) => n + p.hand[r], 0), 19);
  assert.throws(
    () => move(accepted, 'p1', { kind: 'acceptTrade', tradeId: opened.trade!.id }),
    /no longer available/,
  );
  assert.ok(opened.trade, 'input state is unchanged');
  const spent = structuredClone(opened);
  spent.players[1]!.hand.ore = 0;
  assert.throws(() => move(spent, 'p1', { kind: 'acceptTrade', tradeId: opened.trade!.id }), /no longer has/);
});

test('counteroffers and multiplayer offers still need the maker to approve the exact exchange', () => {
  let opened = move(prepared(), 'p0', { kind: 'openTrade', give: hand(2) });
  opened = move(opened, 'p1', { kind: 'proposeTrade', tradeId: opened.trade!.id, give: hand(0, 2) });
  assert.ok(opened.trade);
  assert.equal(opened.players[0]!.hand.wood, 3);
  const counteroffer = renderToStaticMarkup(
    createElement(TradePanel, {
      game: gameView(opened, 'p0'),
      me: 'p0',
      disabled: false,
      onAction,
    }),
  );
  assert.ok(!counteroffer.includes('Choose a trading partner'));
  assert.match(counteroffer, /Oak sent an offer/);
  assert.match(counteroffer, /Confirm trade/);
  const finished = move(opened, 'p0', {
    kind: 'acceptProposal',
    tradeId: opened.trade!.id,
    player: 'p1',
    expectedGive: hand(0, 2),
  });
  assert.equal(finished.trade, null);
  const three = offer(prepared(3));
  assert.ok(move(three, 'p1', { kind: 'acceptTrade', tradeId: three.trade!.id }).trade);
});

test('two-player UI waits for the named opponent and gives them one clear confirmation', () => {
  const g = offer(prepared());
  const maker = renderToStaticMarkup(
    createElement(TradePanel, { game: gameView(g, 'p0'), me: 'p0', disabled: false, onAction }),
  );
  assert.match(maker, /Waiting for Oak to confirm/);
  assert.ok(!maker.includes('Choose a trading partner') && !maker.includes('Confirm trade'));
  const recipient = renderToStaticMarkup(
    createElement(IncomingTrade, { game: gameView(g, 'p1'), me: 'p1', disabled: false, onAction }),
  );
  assert.match(recipient, /Confirm trade/);
  const bank = renderToStaticMarkup(
    createElement(BankTrade, { game: gameView(g, 'p0'), me: 'p0', disabled: false, onAction }),
  );
  assert.ok(!bank.includes('aria-pressed="true"'));
  assert.match(bank, /disabled=""[^>]*>[\s\S]*Choose resources/);
});
