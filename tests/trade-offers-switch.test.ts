/** A player may stop taking trade offers from anyone, and take them again: never a block on one player. */
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

const seats = ['Alice', 'Bob', 'Cara', 'Dan'].map((name, i) => ({ id: `p${i}`, name }));
const hand = (values: Partial<Hand>): Hand => ({ ...emptyHand(), ...values });
const move = (game: Game, action: GameAction, player: string) =>
  applyAction(game, player, action, () => 0.34);

/** A game in its first turn's actions, every hand able to pay for a small trade. */
function setup(players = seats) {
  let game = createGame(players, 82, () => 0.34);
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
      game.bank[resource] += player.hand[resource] - 2;
      player.hand[resource] = 2;
    }
  game.phase = 'actions';
  return {
    game,
    maker: activePlayer(game).id,
    others: game.players.map((p) => p.id).filter((id) => id !== activePlayer(game).id),
  };
}
const offer: GameAction = { kind: 'offerTrade', give: hand({ wood: 1 }), want: hand({ ore: 1 }) };
const lastLines = (game: Game, n: number) => game.log.slice(-n).map((entry) => entry.text);

test('a player who stops taking offers cannot answer one, and counts as having declined it', () => {
  let { game, maker, others } = setup();
  const [quiet, second, third] = others as [string, string, string];
  game = move(game, { kind: 'blockTrades', on: true }, quiet);
  assert.deepEqual(game.notTrading, [quiet]);
  assert.match(lastLines(game, 1)[0]!, / is not taking trade offers\.$/);
  // Everyone can see it: it is part of the public game.
  assert.deepEqual(gameView(game, second).notTrading, [quiet]);
  assert.throws(() => move(game, { kind: 'blockTrades', on: true }, quiet), /already not taking/);

  game = move(game, offer, maker);
  const id = game.trade!.id;
  assert.throws(() => move(game, { kind: 'acceptTrade', tradeId: id }, quiet), /not taking trade offers/);
  // The others' answers close the offer without waiting on the player who is not taking offers.
  game = move(game, { kind: 'declineTrade', tradeId: id }, second);
  assert.ok(game.trade);
  game = move(game, { kind: 'declineTrade', tradeId: id }, third);
  assert.equal(game.trade, null);
  assert.deepEqual(lastLines(game, 1), ['Trade closed: everyone declined.']);

  // Taking offers again, they can answer the next one, and the game carries no trace of the switch.
  game = move(game, { kind: 'blockTrades', on: false }, quiet);
  assert.equal(game.notTrading, undefined);
  assert.match(lastLines(game, 1)[0]!, / is taking trade offers again\.$/);
  game = move(game, offer, maker);
  game = move(game, { kind: 'acceptTrade', tradeId: game.trade!.id }, quiet);
  assert.deepEqual(
    game.trade!.proposals!.map((proposal) => proposal.player),
    [quiet],
  );
});

test('an offer nobody else can take is refused, and one already open closes when its last taker stops', () => {
  let { game, maker, others } = setup();
  for (const other of others.slice(1)) game = move(game, { kind: 'blockTrades', on: true }, other);
  game = move(game, offer, maker);
  // The last player still taking offers stops: nobody is left to answer, so the offer closes.
  game = move(game, { kind: 'blockTrades', on: true }, others[0]!);
  assert.equal(game.trade, null);
  assert.deepEqual(lastLines(game, 2).at(-1), 'Trade closed: everyone declined.');
  assert.throws(() => move(game, offer, maker), /Nobody else is taking trade offers/);
  assert.throws(() => move(game, { kind: 'openTrade', give: hand({ wood: 1 }) }, maker), /Nobody else/);
  // Bank trades never depend on anyone.
  const self = game.players.find((p) => p.id === maker)!;
  self.hand.wood += 2;
  game.bank.wood -= 2;
  const traded = move(game, { kind: 'bankTrade', give: 'wood', receive: 'ore' }, maker);
  assert.equal(traded.players.find((p) => p.id === maker)!.hand.ore, 3);
});

test('an acceptance made before stopping holds until the offer ends, and the maker may still take it', () => {
  let { game, maker, others } = setup();
  const [taker, second, third] = others as [string, string, string];
  game = move(game, offer, maker);
  game = move(game, { kind: 'acceptTrade', tradeId: game.trade!.id }, taker);
  game = move(game, { kind: 'blockTrades', on: true }, taker);
  for (const other of [second, third])
    game = move(game, { kind: 'declineTrade', tradeId: game.trade!.id }, other);
  // Still open: the taker's acceptance is committed, so the offer waits on the maker's choice.
  assert.ok(game.trade);
  game = move(game, { kind: 'acceptProposal', tradeId: game.trade!.id, player: taker }, maker);
  assert.equal(game.trade, null);
  assert.equal(game.players.find((p) => p.id === taker)!.hand.wood, 3);
  assert.equal(game.players.find((p) => p.id === maker)!.hand.ore, 3);
});

test('the switch is a player’s own at any time, and only a yes or no', () => {
  const { game, maker, others } = setup();
  // Off turn, on turn, even with an offer of one's own open.
  const own = move(move(game, offer, maker), { kind: 'blockTrades', on: true }, maker);
  assert.deepEqual(own.notTrading, [maker]);
  assert.ok(own.trade, 'blocking offers to yourself leaves your own offer open');
  assert.deepEqual(move(game, { kind: 'blockTrades', on: true }, others[2]!).notTrading, [others[2]]);
  assert.deepEqual(parseGameAction({ kind: 'blockTrades', on: false }), { kind: 'blockTrades', on: false });
  for (const on of [undefined, 'yes', 1, null])
    assert.throws(
      () => parseGameAction({ kind: 'blockTrades', on } as unknown as GameAction),
      /Invalid action/,
    );
  assert.throws(() => move(game, { kind: 'blockTrades', on: false }, others[0]!), /already taking/);
});

test('in a two-player game the other player stopping offers closes the offer at once', () => {
  let { game, maker, others } = setup(seats.slice(0, 2));
  game = move(game, offer, maker);
  game = move(game, { kind: 'blockTrades', on: true }, others[0]!);
  assert.equal(game.trade, null);
  assert.throws(() => move(game, offer, maker), /Nobody else is taking trade offers/);
});
