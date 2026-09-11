import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, applyAction, gameView } from '../packages/rules/src/game.js';
import { parseRoomSettings } from '../packages/protocol/src/settings.js';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { readyLobby } from './helpers.js';
import { GameSettings, GameInfo } from '../apps/client/src/GameSettings.js';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';
const seats = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
];
function scored(points: number, target?: number) {
  const game = createGame(seats, 82, () => 0.34, { victoryPoints: target });
  game.phase = 'actions';
  game.turn = 1;
  const cities = Math.min(5, Math.floor(points / 2));
  for (let i = 0; i < cities; i++) game.buildings[i] = { kind: 'city', player: 'a' };
  game.players[0]!.cards = Array.from({ length: points - cities * 2 }, (_, i) => ({
    id: `vp-${i}`,
    kind: 'victoryPoint',
    boughtTurn: 0,
  }));
  game.players[0]!.hand.wood = 4;
  game.bank.wood -= 4;
  return game;
}
const trigger = (game: ReturnType<typeof scored>) =>
  applyAction(game, 'a', { kind: 'bankTrade', give: 'wood', receive: 'ore' }, () => 0.34);

test('victory targets validate integer limits and preserve legacy omitted settings', () => {
  assert.deepEqual(parseRoomSettings({ turnTimerSeconds: null }), { turnTimerSeconds: null });
  for (let target = 8; target <= 15; target++)
    assert.equal(parseRoomSettings({ turnTimerSeconds: null, victoryPoints: target }).victoryPoints, target);
  for (const target of [0, 7, 16, 10.5, '12', null, NaN, Infinity]) {
    assert.throws(() => parseRoomSettings({ turnTimerSeconds: null, victoryPoints: target }), /8 to 15/);
    assert.throws(() => createGame(seats, 82, () => 0.34, { victoryPoints: target as number }), /8 to 15/);
  }
});
test('the configured goal controls winning, including hidden points and old game snapshots', () => {
  assert.equal(trigger(scored(8, 8)).winner, 'a');
  assert.equal(trigger(scored(11, 12)).winner, null);
  const won = trigger(scored(12, 12));
  assert.equal(won.winner, 'a');
  assert.equal(won.phase, 'finished');
  assert.equal(gameView(won, 'b').victoryPoints, 12);
  assert.equal(trigger(scored(15, 15)).winner, 'a');
  const legacy = scored(9);
  delete legacy.victoryPoints;
  assert.equal(trigger(JSON.parse(JSON.stringify(legacy))).winner, null);
  const legacyWon = scored(10);
  delete legacyWon.victoryPoints;
  assert.equal(trigger(legacyWon).winner, 'a');
});
test('reaching the target off-turn still waits for that player’s turn', () => {
  const game = scored(12, 12);
  for (const building of Object.values(game.buildings)) building.player = 'b';
  game.players[1]!.cards = game.players[0]!.cards;
  game.players[0]!.cards = [];
  const next = trigger(game);
  assert.equal(next.winner, null);
  assert.equal(applyAction(next, 'a', { kind: 'endTurn' }, () => 0.34).winner, 'b');
});
test('host target persists across restart, reaches the match snapshot, and locks after start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-goal-'));
  const path = join(dir, 'game.sqlite');
  let store = new Store(path, { random: () => 0.34 });
  try {
    const h = newSession('Host'),
      f = newSession('Friend');
    const host = store.enter('create', h.token, h.name);
    const friend = store.enter('join', f.token, f.name, host.room_id);
    const settings = { turnTimerSeconds: null, victoryPoints: 12 };
    assert.throws(() => store.configureSettings(friend, 'not-host', 0, settings), /Only the host/);
    store.configureSettings(host, 'target', 0, settings);
    store.close();
    store = new Store(path, { random: () => 0.34 });
    assert.equal(store.preview(host.room_id).settings.victoryPoints, 12);
    store.action(host, 'start', readyLobby(store, host.room_id), { kind: 'start' });
    assert.equal(store.loadGame(host.room_id)!.victoryPoints, 12);
    assert.throws(
      () =>
        store.configureSettings(host, 'too-late', store.snapshot(host.room_id).revision, {
          ...settings,
          victoryPoints: 8,
        }),
      /locked/,
    );
    const snapshot = store.snapshot(host.room_id);
    const room = { ...snapshot, players: snapshot.players.map((player) => ({ ...player, connected: true })) };
    room.game = gameView(store.loadGame(host.room_id)!, host.id);
    assert.match(renderToStaticMarkup(createElement(GameInfo, { room })), /12 points on your turn/);
    const props = {
      preferences: DEFAULT_PREFERENCES,
      room: { ...room, game: undefined },
      me: host.id,
      busy: false,
      update: () => {},
      save: async () => {},
      previewSound: () => {},
    };
    const lobby = renderToStaticMarkup(createElement(GameSettings, props));
    assert.match(lobby, /Points to win/);
    assert.match(lobby, /aria-valuetext="12 victory points"/);
    const spectator = renderToStaticMarkup(createElement(GameSettings, { ...props, me: friend.id }));
    assert.match(spectator, /<input[^>]*id="victory-target"[^>]*disabled=""/);
    const playing = renderToStaticMarkup(createElement(GameSettings, { ...props, room }));
    assert.ok(!playing.includes('victory-target'), 'in-game settings remain audio-only');
    assert.match(
      renderToStaticMarkup(createElement(QuickRules, { victoryPoints: 12 })),
      /First to 12 victory points/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
