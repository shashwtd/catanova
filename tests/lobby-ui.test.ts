import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  assert.ok(render('p1').includes('The host chooses these rules.'));
  for (const seconds of [40, 65, 90, 115, 140]) assert.ok(render('p0').includes(`${seconds}s`));
  room.game = gameView(
    createGame(
      room.players.map(({ id, name }) => ({ id, name })),
      82,
      () => 0.34,
    ),
    'p0',
  );
  assert.ok(duration(render('p0'))!.includes('disabled=""'));
  assert.ok(render('p0').includes('Room rules are locked during play.'));
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
