import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rollDice } from '../packages/rules/src/dice.js';
import {
  createGame,
  applyAction,
  emptyHand,
  gameView,
  resignPlayers,
  tradeRate,
  tradeOffersRemaining,
} from '../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { generateBoard } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { parseRoomSettings } from '../packages/protocol/src/settings.js';
import { GameSettings, GameInfo } from '../apps/client/src/GameSettings.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { TradeSubmission } from '../apps/client/src/trade-submission.js';
import { TradePanel } from '../apps/client/src/TradePanel.js';

const seats = ['Alice', 'Bob', 'Cara', 'Dan'].map((name, i) => ({ id: `p${i}`, name }));
const hand = (patch: Partial<Hand>) => ({ ...emptyHand(), ...patch });
const move = (game: Game, action: GameAction, id = 'p0') => applyAction(game, id, action, () => 0.34);
function prepared() {
  const game = createGame(seats, 82, () => 0.34);
  game.phase = 'actions';
  game.turn = 1;
  for (const player of game.players) {
    player.hand = hand({ wood: 3, sheep: 3, brick: 3, wheat: 3, ore: 3 });
    for (const r of RESOURCES) game.bank[r] -= 3;
  }
  return game;
}
function conserved(game: Game) {
  for (const r of RESOURCES) assert.equal(game.bank[r] + game.players.reduce((n, p) => n + p.hand[r], 0), 19);
}

test('Classic dice cover all 36 equally sized ordered-pair buckets; Flat totals cover 11 totals with valid conditional pairs', () => {
  const frequencies = Array(13).fill(0);
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const draws = [(a - 0.5) / 6, (b - 0.5) / 6];
      const pair = rollDice('classic', () => draws.shift()!);
      assert.deepEqual(pair, [a, b]);
      frequencies[a + b]++;
    }
  assert.deepEqual(frequencies.slice(2), [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
  for (let sum = 2; sum <= 12; sum++) {
    const choices = 6 - Math.abs(7 - sum),
      first = Math.max(1, sum - 6),
      seen = new Set<string>();
    for (let index = 0; index < choices; index++) {
      const draws = [(sum - 1.5) / 11, (index + 0.5) / choices];
      const pair = rollDice('flat', () => draws.shift()!);
      assert.deepEqual(pair, [first + index, sum - first - index]);
      assert.ok(pair.every((n) => n >= 1 && n <= 6));
      seen.add(pair.join(','));
    }
    assert.equal(seen.size, choices);
  }
});

test('dice reject the tiny incomplete random bucket and invalid sources; old saved games retain Classic behavior', () => {
  const draws = [(2 ** 32 - 1) / 2 ** 32, 0.5, 0.34];
  assert.deepEqual(
    rollDice('classic', () => draws.shift()!),
    [4, 3],
  );
  assert.equal(draws.length, 0);
  for (const value of [NaN, Infinity, -0.1, 1])
    assert.throws(() => rollDice('classic', () => value), /randomness/);
  assert.throws(() => rollDice('flat', () => (2 ** 32 - 1) / 2 ** 32), /unavailable/);
  const game = prepared();
  game.phase = 'roll';
  delete game.diceMode;
  const before = structuredClone(game),
    rolled = move(game, { kind: 'roll' });
  assert.deepEqual(rolled.dice, [3, 3]);
  assert.deepEqual(game, before);
  assert.deepEqual(move({ ...game, diceMode: 'flat' }, { kind: 'roll' }).dice, [2, 3]);
});

test('five offers are counted across open, replacement and cancelled offers, and reset only for the next turn', () => {
  let game = prepared();
  assert.throws(
    () => move(game, { kind: 'offerTrade', give: hand({ wood: 4 }), want: hand({ ore: 1 }) }),
    /offered cards/,
  );
  assert.equal(tradeOffersRemaining(game), 5);
  const offers: GameAction[] = [
    { kind: 'offerTrade', give: hand({ wood: 1 }), want: hand({ sheep: 1 }) },
    { kind: 'openTrade', give: hand({ wood: 2 }) },
    { kind: 'offerTrade', give: hand({ wood: 1 }), want: hand({ ore: 1 }) },
    { kind: 'openTrade', give: hand({ wood: 1 }) },
    { kind: 'offerTrade', give: hand({ wood: 1 }), want: hand({ wheat: 1 }) },
  ];
  for (const [index, offer] of offers.entries()) {
    game = move(game, offer);
    assert.equal(tradeOffersRemaining(game), 4 - index);
    if (index === 2) game = move(game, { kind: 'cancelTrade' });
  }
  const before = structuredClone(game);
  for (const offer of offers) assert.throws(() => move(game, offer), /all five/);
  assert.deepEqual(game, before, 'failed sixth offers cannot change the live fifth trade');
  game = move(game, { kind: 'acceptTrade', tradeId: game.trade!.id }, 'p1');
  assert.equal(tradeOffersRemaining(game), 0, 'finishing a trade is still allowed at the cap');
  const port = game.board.ports.find((p) => p.resource === 'any')!,
    edge = game.board.edges[port.edge]!;
  game.buildings[edge.a] = { player: 'p0', kind: 'settlement' };
  game = move(game, { kind: 'bankTrade', give: 'ore', receive: 'brick' });
  assert.equal(tradeOffersRemaining(game), 0, 'bank and port trades do not spend offers');
  game = move(game, { kind: 'endTurn' });
  assert.equal(tradeOffersRemaining(game), 5);
  conserved(game);
});

test('responses to the final open offer remain available and do not consume another player’s turn allowance', () => {
  let game = prepared();
  game.tradeOffersThisTurn = 4;
  game = move(game, { kind: 'openTrade', give: hand({ wood: 1 }) });
  const id = game.trade!.id;
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ sheep: 1 }) }, 'p1');
  game = move(game, { kind: 'withdrawProposal', tradeId: id }, 'p1');
  game = move(game, { kind: 'proposeTrade', tradeId: id, give: hand({ ore: 1 }) }, 'p1');
  game = move(game, { kind: 'declineTrade', tradeId: id }, 'p2');
  game = move(game, { kind: 'acceptProposal', tradeId: id, player: 'p1', expectedGive: hand({ ore: 1 }) });
  assert.equal(game.trade, null);
  assert.equal(tradeOffersRemaining(game), 0);
  conserved(game);
  const html = renderToStaticMarkup(
    createElement(TradePanel, { game: gameView(game, 'p0'), me: 'p0', disabled: false, onAction: () => {} }),
  );
  assert.match(html, /All 5 offers used/);
  assert.match(html, /<button[^>]*class="gold-button trade-submit"[^>]*disabled=""/);
});

test('trade submission locks before React can render and releases on acknowledgement or failure', async () => {
  const latch = new TradeSubmission();
  let resolve!: () => void,
    calls = 0;
  const first = latch.run({ kind: 'cancelTrade' }, () => {
    calls++;
    return new Promise<void>((done) => {
      resolve = done;
    });
  });
  assert.equal(
    await latch.run({ kind: 'cancelTrade' }, () => {
      calls++;
    }),
    false,
  );
  assert.equal(calls, 1);
  resolve();
  assert.equal(await first, true);
  await assert.rejects(
    latch.run({ kind: 'cancelTrade' }, async () => {
      throw new Error('Connection lost');
    }),
    /Connection lost/,
  );
  assert.equal(
    await latch.run({ kind: 'cancelTrade' }, () => {
      calls++;
    }),
    true,
  );
  assert.equal(calls, 2);
});

test('all-player abandonment conserves resources and pieces without granting a winner, and manual leave has distinct history', () => {
  const game = prepared();
  game.buildings[0] = { player: 'p0', kind: 'city' };
  game.roads[0] = 'p0';
  game.players[0]!.cards = [{ id: 'held-card', kind: 'knight', boughtTurn: 0 }];
  const original = structuredClone(game),
    abandoned = resignPlayers(
      game,
      seats.map((p) => p.id),
      { winnerEligibleIds: [] },
    );
  assert.equal(abandoned.phase, 'finished');
  assert.equal(abandoned.winner, null);
  assert.equal(abandoned.finishReason, 'abandoned');
  assert.deepEqual(abandoned.buildings, game.buildings);
  assert.deepEqual(abandoned.roads, game.roads);
  assert.deepEqual(game, original);
  assert.ok(abandoned.players.every((p) => p.resigned && p.cards.length === 0));
  conserved(abandoned);
  assert.equal(resignPlayers(abandoned, []), abandoned);
  const manual = resignPlayers(game, ['p1'], { reason: 'leave' });
  assert.ok(manual.log.some((line) => line.text === 'Bob left the game and resigned.'));
});

test('an absent sole survivor must reconnect to win, and offline award transfers cannot invent points wins', () => {
  const game = prepared();
  let waiting = resignPlayers(game, ['p1', 'p2', 'p3'], { winnerEligibleIds: [] });
  assert.equal(waiting.winner, null);
  assert.notEqual(waiting.phase, 'finished');
  assert.equal(resignPlayers(waiting, [], { winnerEligibleIds: [] }), waiting);
  const won = resignPlayers(waiting, [], { winnerEligibleIds: ['p0'] });
  assert.equal(won.winner, 'p0');
  assert.equal(won.finishReason, 'resignation');
  assert.equal(resignPlayers(waiting, ['p0'], { winnerEligibleIds: [] }).finishReason, 'abandoned');
  const awards = prepared();
  for (let n = 0; n < 4; n++) awards.buildings[n] = { player: 'p0', kind: 'city' };
  awards.players[0]!.knights = 3;
  awards.players[1]!.knights = 4;
  awards.largestArmy = 'p1';
  const offline = resignPlayers(awards, ['p1'], { winnerEligibleIds: [] });
  assert.equal(offline.largestArmy, 'p0');
  assert.equal(offline.winner, null);
  const connected = resignPlayers(awards, ['p1'], { winnerEligibleIds: ['p0'] });
  assert.equal(connected.winner, 'p0');
  assert.equal(connected.finishReason, undefined);
});

test('the port inventory, coastal spacing and both ownership endpoints preserve standard harbor behavior', () => {
  for (let seed = 0; seed < 100; seed++) {
    const board = generateBoard(seed);
    assert.equal(board.ports.length, 9);
    assert.equal(board.ports.filter((p) => p.resource === 'any').length, 4);
    for (const r of RESOURCES) assert.equal(board.ports.filter((p) => p.resource === r).length, 1);
    assert.equal(
      new Set(board.ports.flatMap((p) => [board.edges[p.edge]!.a, board.edges[p.edge]!.b])).size,
      18,
    );
    for (const port of board.ports) {
      const edge = board.edges[port.edge]!;
      assert.equal(edge.hexes.length, 1);
      for (const vertex of [edge.a, edge.b])
        for (const kind of ['settlement', 'city'] as const) {
          const state = {
            board,
            roads: { [edge.id]: 'p0' },
            buildings: { [vertex]: { player: 'p0', kind } },
          };
          for (const resource of RESOURCES)
            assert.equal(
              tradeRate(state, 'p0', resource),
              port.resource === resource ? 2 : port.resource === 'any' ? 3 : 4,
            );
          assert.equal(tradeRate(state, 'p1', 'wood'), 4, 'opponents cannot borrow this harbor');
        }
      assert.equal(
        tradeRate({ board, roads: { [edge.id]: 'p0' }, buildings: {} }, 'p0', 'wood'),
        4,
        'a road alone does not own a harbor',
      );
    }
  }
});

test('lobby dice settings validate and game settings show only audio after start, with rules in Game info', () => {
  assert.deepEqual(parseRoomSettings({ turnTimerSeconds: null }), { turnTimerSeconds: null });
  assert.equal(parseRoomSettings({ turnTimerSeconds: 90, diceMode: 'flat' }).diceMode, 'flat');
  for (const diceMode of ['adaptive', null, 5])
    assert.throws(() => parseRoomSettings({ turnTimerSeconds: null, diceMode }), /Classic/);
  const room: RoomState = {
    roomId: 'test-room',
    revision: 0,
    counter: 0,
    players: seats.map((p) => ({ ...p, connected: true })),
    settings: { turnTimerSeconds: 90, diceMode: 'flat' },
  };
  const settings = () =>
    renderToStaticMarkup(
      createElement(GameSettings, {
        preferences: DEFAULT_PREFERENCES,
        update: () => {},
        room,
        me: 'p0',
        busy: false,
        save: async () => {},
        previewSound: () => {},
      }),
    );
  assert.match(settings(), /Flat totals/);
  assert.match(settings(), /Turn duration/);
  room.game = gameView(
    createGame(seats, 82, () => 0.34, { diceMode: 'flat' }),
    'p0',
  );
  assert.ok(!settings().includes('Turn duration'));
  assert.ok(!settings().includes('Flat totals'));
  assert.match(settings(), /Effects volume/);
  assert.match(settings(), /Music volume/);
  const info = renderToStaticMarkup(createElement(GameInfo, { room }));
  assert.match(info, /1 in 11/);
  assert.match(info, /house rule/);
  assert.match(info, /90 seconds/);
  assert.ok(!/<input|<button/.test(info));
});
