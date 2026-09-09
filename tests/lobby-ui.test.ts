import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnTimer } from '../apps/client/src/TurnTimer.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { Lobby } from '../apps/client/src/Lobby.js';
import { GameSettings } from '../apps/client/src/GameSettings.js';
import { ProfileEditor } from '../apps/client/src/Profile.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { createGame, gameView } from '../packages/rules/src/game.js';

function lobby(): RoomState {
  return {
    roomId: 'ABCDEFG2',
    revision: 5,
    counter: 0,
    settings: { turnTimerSeconds: 90 },
    players: ['Host', 'Second', 'Third'].map((name, i) => ({
      id: `p${i}`,
      name,
      profile: defaultProfile(name),
      connected: true,
      ready: i !== 0,
    })),
  };
}
function renderLobby(room: RoomState, me: string, busy = false, connected = true) {
  return renderToStaticMarkup(
    createElement(Lobby, {
      room,
      me,
      busy,
      connected,
      onReady: () => {},
      onStart: () => {},
      onInvite: () => {},
      onLeave: () => {},
      onEdit: () => {},
      onSettings: () => {},
    }),
  );
}
function buttons(html: string) {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}
function text(button: string) {
  return button.replace(/<[^>]*>/g, '').trim();
}

test('host Start is enabled once the other players are ready without showing a separate host Ready button', () => {
  const room = lobby(),
    html = renderLobby(room, 'p0');
  const start = buttons(html).find((button) => text(button) === 'Start game')!;
  assert.ok(start);
  assert.ok(!start.includes('disabled=""'));
  assert.equal(room.players[0]!.ready, false);
  assert.ok(!buttons(html).some((button) => ['Ready', 'Not ready'].includes(text(button))));
  assert.ok(html.includes('90s'));
  assert.ok(html.includes('Everyone is ready'));
});

test('nonhosts can ready or unready and cannot start the room', () => {
  const room = lobby();
  room.players[1]!.ready = false;
  const notReady = buttons(renderLobby(room, 'p1')).find((button) => text(button) === 'Ready')!;
  assert.ok(notReady.includes('aria-pressed="false"'));
  assert.ok(!notReady.includes('disabled=""'));
  assert.ok(!buttons(renderLobby(room, 'p1')).some((button) => text(button) === 'Start game'));
  room.players[1]!.ready = true;
  const ready = buttons(renderLobby(room, 'p1')).find((button) => text(button) === 'Not ready')!;
  assert.ok(ready.includes('aria-pressed="true"'));
});

test('readiness, minimum seats, connection and pending commands all gate the host Start control', () => {
  const room = lobby();
  const missingReady = structuredClone(room);
  missingReady.players[1]!.ready = false;
  const disconnectedSeat = structuredClone(room);
  disconnectedSeat.players[2]!.connected = false;
  const short = structuredClone(room);
  short.players.pop();
  for (const html of [
    renderLobby(missingReady, 'p0'),
    renderLobby(disconnectedSeat, 'p0'),
    renderLobby(short, 'p0'),
    renderLobby(room, 'p0', true),
    renderLobby(room, 'p0', false, false),
  ]) {
    const start = buttons(html).find((button) => text(button) === 'Start game')!;
    assert.ok(start?.includes('disabled=""'));
  }
  assert.ok(renderLobby(disconnectedSeat, 'p0').includes('Disconnected'));
  const transferred = lobby();
  transferred.players[0]!.id = 'new-host';
  transferred.players[0]!.ready = false;
  assert.ok(
    !buttons(renderLobby(transferred, 'new-host'))
      .find((button) => text(button) === 'Start game')!
      .includes('disabled=""'),
  );
});

test('room timer controls are editable only by the host before play and expose all five duration choices', () => {
  const room = lobby();
  const render = (me: string) =>
    renderToStaticMarkup(
      createElement(GameSettings, {
        preferences: DEFAULT_PREFERENCES,
        update: () => {},
        room,
        me,
        busy: false,
        save: async () => {},
        previewSound: () => {},
        osReduced: false,
      }),
    );
  const duration = (html: string) => html.match(/<input\b[^>]*aria-label="Turn duration"[^>]*>/)?.[0];
  assert.ok(duration(render('p0')) && !duration(render('p0'))!.includes('disabled=""'));
  assert.ok(duration(render('p1'))!.includes('disabled=""'));
  assert.ok(render('p1').includes('Chosen by the host.'));
  for (const seconds of [40, 65, 90, 115, 140]) assert.ok(render('p0').includes(`>${seconds}</span>`));
  room.game = gameView(
    createGame(
      room.players.map(({ id, name }) => ({ id, name })),
      82,
      () => 0.34,
    ),
    'p0',
  );
  assert.ok(duration(render('p0'))!.includes('disabled=""'));
  assert.ok(render('p0').includes('Set before the game.'));
});

test('profile editing presents names and twelve fantasy portraits without the removed accent or frame selectors', () => {
  const profile = {
    ...defaultProfile('Captain'),
    avatar: 8,
    accent: 'plum' as const,
    frame: 'brass' as const,
  };
  const saved = structuredClone(profile);
  const html = renderToStaticMarkup(
    createElement(ProfileEditor, { initial: profile, busy: false, onSave: async () => {} }),
  );
  assert.equal([...html.matchAll(/aria-pressed=/g)].length, 12);
  assert.equal([...html.matchAll(/aria-pressed="true"/g)].length, 1);
  assert.equal([...html.matchAll(/<input\b/g)].length, 1);
  assert.ok(html.includes('Display name'));
  assert.ok(html.includes('Fox cartographer') && html.includes('Mushroom wanderer'));
  assert.ok(html.includes('/art/avatars-fantasy.png'));
  assert.ok(!/aria-label="(?:Accent|Frame|Choose accent|Choose frame)"/.test(html));
  assert.ok(!html.includes('frame-brass') && !html.includes('--avatar-accent'));
  assert.deepEqual(profile, saved, 'legacy cosmetic data remains compatible while its controls are removed');
});

test('the active portrait shows the active clock while a separate discard panel shows the local discard deadline', () => {
  const room = lobby();
  room.game = gameView(
    createGame(room.players, 82, () => 0.34),
    'p1',
  );
  room.serverNow = Date.now();
  room.turnClock = {
    playerId: 'p0',
    turn: 1,
    startedAt: room.serverNow - 20000,
    deadlineAt: room.serverNow + 45000,
    pausedAt: room.serverNow,
    discardDeadlines: { p1: room.serverNow + 90000 },
  };
  const render = (discard = false) =>
    renderToStaticMarkup(
      createElement(TurnTimer, { room, me: 'p1', connected: true, discard, onWarning: () => {} }),
    );
  assert.match(render(), /<b>45s<\/b>/);
  assert.match(render(), /Turn clock paused/);
  assert.match(render(true), /<b>90s<\/b>/);
  assert.ok(!render(true).includes('Turn clock paused'));
  delete room.turnClock.discardDeadlines!.p1;
  assert.equal(render(true), '', 'a completed discard leaves no phantom local deadline');
});

test('game profiles retain turn, score, awards and disconnect status without connected text or piece inventories', () => {
  const room = lobby();
  const game = gameView(
    createGame(room.players, 82, () => 0.34),
    'p0',
  );
  game.longestRoad = 'p0';
  room.players[1]!.connected = false;
  const html = renderToStaticMarkup(createElement(PlayerRail, { room, game, me: 'p0' }));
  assert.equal([...html.matchAll(/data-player-profile=/g)].length, 3);
  assert.equal([...html.matchAll(/aria-label="Current turn"/g)].length, 1);
  assert.match(html, /Longest Road, plus 2 victory points/);
  assert.match(html, /aria-label="Disconnected"/);
  assert.ok(!html.includes('profile-pieces'));
  assert.ok(!/>Connected<|>You<|>Playing</.test(html));
});

test('profile score plaques show only projected points and keep a long name available to assistive technology', () => {
  const room = lobby(),
    name = 'Alexandria of the Northern Isles';
  assert.equal(name.length, 32);
  room.players[0]!.name = name;
  room.players[0]!.profile = defaultProfile(name);
  room.players[1]!.connected = false;
  const saved = createGame(room.players, 82, () => 0.34);
  saved.players[0]!.cards = [{ id: 'own-point', kind: 'victoryPoint', boughtTurn: 0 }];
  saved.players[1]!.cards = [{ id: 'private-opponent-point', kind: 'victoryPoint', boughtTurn: 0 }];
  const game = gameView(saved, 'p0');
  assert.equal(game.players[0]!.points, 1);
  assert.equal(game.players[1]!.points, 0);
  const html = renderToStaticMarkup(createElement(PlayerRail, { room, game, me: 'p0' }));
  const own = html.match(/<article[^>]*data-player-profile="p0"[\s\S]*?<\/article>/)![0];
  const opponent = html.match(/<article[^>]*data-player-profile="p1"[\s\S]*?<\/article>/)![0];
  assert.match(own, /aria-label="1 victory points"/);
  assert.match(opponent, /aria-label="0 victory points"/);
  assert.ok(own.includes(`title="${name}"`) && own.includes(`>${name}</strong>`));
  assert.equal([...html.matchAll(/>VP<\/span>/g)].length, 3);
  assert.match(opponent, /aria-label="Disconnected"/);
  assert.match(opponent, />Offline<\/span>/);
  assert.ok(!html.includes('private-opponent-point'));
});
