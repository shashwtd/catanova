import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, emptyHand, gameView, tradeOffersRemaining } from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { readyLobby } from './helpers.js';

test('dice settings survive restart and server results and five-offer receipts stay idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-dice-trades-'));
  const path = join(dir, 'game.sqlite');
  let store = new Store(path, { random: () => 0.34 });
  try {
    const sessions = ['Host', 'Second', 'Third'].map((name) => newSession(name));
    const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
    const guests = sessions.slice(1).map((s) => store.enter('join', s.token, s.name, host.room_id));
    const roomId = host.room_id;
    assert.throws(
      () =>
        store.configureSettings(guests[0]!, 'guest-dice-mode', 0, {
          turnTimerSeconds: null,
          diceMode: 'balanced',
        }),
      /Only the host/,
    );
    store.configureSettings(host, 'balanced-dice-mode', 0, { turnTimerSeconds: null, diceMode: 'balanced' });
    store.close();
    store = new Store(path, { random: () => 0.34 });
    assert.equal(store.settings(roomId).diceMode, 'balanced');
    assert.equal(store.preview(roomId).settings.diceMode, 'balanced');
    store.action(host, 'start-balanced-game', readyLobby(store, roomId), { kind: 'start' });
    assert.equal(store.loadGame(roomId)!.diceMode, 'balanced');
    assert.throws(
      () =>
        store.configureSettings(host, 'change-started-dice', store.snapshot(roomId).revision, {
          turnTimerSeconds: null,
          diceMode: 'classic',
        }),
      /locked/,
    );
    let step = 0;
    while (!store.loadGame(roomId)!.turn) {
      const game = store.loadGame(roomId)!;
      const player = activePlayer(game),
        legal = gameView(game, player.id).legal;
      const action: GameAction =
        game.phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: legal.settlements[0]! }
          : { kind: 'road', edge: legal.roads[0]! };
      store.action(
        { ...player, room_id: roomId },
        `setup-${step++}`,
        store.snapshot(roomId).revision,
        action,
      );
    }
    const seat = { ...activePlayer(store.loadGame(roomId)!), room_id: roomId };
    const rollRevision = store.snapshot(roomId).revision;
    const result = store.action(seat, 'roll-once', rollRevision, { kind: 'roll' });
    assert.deepEqual(store.loadGame(roomId)!.dice, [3, 1], 'the fixed server mode controls the result');
    const savedDeck = structuredClone(store.loadGame(roomId)!.balancedDice);
    assert.equal(savedDeck?.remaining.length, 35);
    assert.equal(store.action(seat, 'roll-once', rollRevision, { kind: 'roll' }).duplicate, true);
    assert.deepEqual(store.loadGame(roomId)!.balancedDice, savedDeck);
    assert.equal(store.snapshot(roomId).revision, result.revision);
    const resource = RESOURCES.find((r) => activePlayer(store.loadGame(roomId)!).hand[r] > 0)!;
    assert.ok(resource, 'a starting settlement has resources to offer');
    const offer: GameAction = { kind: 'openTrade', give: { ...emptyHand(), [resource]: 1 } };
    const firstOfferRevision = store.snapshot(roomId).revision;
    store.action(seat, 'offer-1', firstOfferRevision, offer);
    store.action(seat, 'offer-2', store.snapshot(roomId).revision, offer);
    assert.equal(tradeOffersRemaining(store.loadGame(roomId)!), 3);
    store.close();
    store = new Store(path, { random: () => 0.34 });
    assert.equal(store.loadGame(roomId)!.diceMode, 'balanced');
    assert.deepEqual(store.loadGame(roomId)!.balancedDice, savedDeck, 'deck survives the database restart');
    assert.equal(store.action(seat, 'offer-1', firstOfferRevision, offer).duplicate, true);
    assert.equal(
      tradeOffersRemaining(store.loadGame(roomId)!),
      3,
      'retrying a saved receipt cannot consume another offer',
    );
    for (let n = 3; n <= 5; n++) store.action(seat, `offer-${n}`, store.snapshot(roomId).revision, offer);
    const final = store.snapshot(roomId),
      game = store.loadGame(roomId)!;
    assert.equal(tradeOffersRemaining(game), 0);
    assert.throws(() => store.action(seat, 'offer-6', final.revision, offer), /all five/);
    assert.equal(store.snapshot(roomId).revision, final.revision);
    assert.deepEqual(
      store.loadGame(roomId),
      game,
      'rejected offers do not withdraw the active trade or change resources',
    );
    assert.equal(store.action(seat, 'offer-1', firstOfferRevision, offer).duplicate, true);
    store.action(seat, 'cancel-last-offer', final.revision, { kind: 'cancelTrade' });
    assert.equal(tradeOffersRemaining(store.loadGame(roomId)!), 0);
    store.action(seat, 'end-capped-turn', store.snapshot(roomId).revision, { kind: 'endTurn' });
    assert.equal(tradeOffersRemaining(store.loadGame(roomId)!), 5);
    const next = store.loadGame(roomId)!;
    for (const r of RESOURCES)
      assert.equal(next.bank[r] + next.players.reduce((n, p) => n + p.hand[r], 0), 19);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
