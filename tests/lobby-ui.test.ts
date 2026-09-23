import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnTimer } from '../apps/client/src/TurnTimer.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { Invite, Lobby } from '../apps/client/src/Lobby.js';
import { BotMark } from '../apps/client/src/GameIcons.js';
import { PlayerSettings, RoomConfiguration } from '../apps/client/src/GameSettings.js';
import { ProfileEditor } from '../apps/client/src/Profile.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';
import { BOT_LEVELS, BOT_LEVEL_LABEL } from '../packages/protocol/src/bots.js';
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
function renderLobby(
  room: RoomState,
  me: string,
  busy = false,
  connected = true,
  extra: Record<string, unknown> = {},
) {
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
      onConfigure: () => {},
      onKick: async () => {},
      ...extra,
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
  assert.ok(!html.includes('Manage') && !html.includes('Remove player'));
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

test('room gathering shows actual players and one open place, never four mandatory-looking slots', () => {
  for (const count of [1, 2, 3, 4]) {
    const room = lobby();
    room.players = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Player${i}`,
      profile: defaultProfile(`Player${i}`),
      connected: true,
      ready: i !== 0,
    }));
    const html = renderLobby(room, 'p0');
    assert.equal([...html.matchAll(/<article\b/g)].length, count);
    // Exactly one place is open, at the same size as a seat, and it goes once
    // the room is full.
    assert.equal([...html.matchAll(/class="seat-card seat-open"/g)].length, count < 4 ? 1 : 0);
    assert.equal([...html.matchAll(/>Open seat</g)].length, count < 4 ? 1 : 0);
    assert.ok(html.includes('10 points'));
    assert.ok(!html.includes('Your crew') && !html.includes('open-seat'));
    assert.ok(!html.includes(`${count}/4`));
    const start = buttons(html).find((button) => text(button) === 'Start game')!;
    assert.equal(start.includes('disabled=""'), count === 1);
  }
});

test('an open place offers both answers where you can see them, and both are host-only for bots', () => {
  const room = lobby();
  room.players = [room.players[0]!];
  const withBots = { onAddBot: () => {} };
  const asHost = renderLobby(room, 'p0', false, true, withBots);
  // Inviting is one press from the place itself rather than two through a menu.
  assert.ok(asHost.includes('Invite a friend'));
  assert.ok(!asHost.includes('aria-haspopup="menu"'), 'no hidden menu stands between them');
  // Seating a bot is one action. Which of the three sits down is the room's
  // draw, so there is nothing here to choose.
  assert.ok(asHost.includes('Add a bot'));
  for (const level of BOT_LEVELS) assert.ok(!asHost.includes(`Add a ${level}`));

  const asGuest = renderLobby(room, 'pX', false, true, withBots);
  assert.ok(asGuest.includes('Invite a friend'));
  assert.ok(!asGuest.includes('Add a bot'), 'only a host seats a bot');
});

test('each bot level is marked by its own machine, never the word BOT', () => {
  const marks = new Set<string>();
  for (const level of BOT_LEVELS) {
    const room = lobby();
    room.players[1] = { ...room.players[1]!, bot: true, botLevel: level, name: 'Anchor' };
    const html = renderLobby(room, 'p0');
    assert.ok(!/>\s*BOT\s*</.test(html), 'the word is gone');
    assert.match(html, new RegExp(`player-bot-tag[^>]*data-level="${level}"`));
    // The mark says "bot" and never which one: naming the difficulty on the
    // seat would give away a game that has not been played yet.
    assert.match(html, /player-bot-tag[^>]*aria-label="Bot"/);
    assert.ok(!html.includes(`${BOT_LEVEL_LABEL[level]} bot`), 'the level is not announced');
    assert.ok(html.includes('>Bot<'), 'the seat says bot, and stops there');
    // Three levels, three drawings: a shared shape with nothing to tell them
    // apart would make the mark decoration rather than information. Rendered
    // on its own, so this cannot accidentally match another seat's icon.
    marks.add(renderToStaticMarkup(createElement(BotMark, { level })));
  }
  assert.equal(marks.size, BOT_LEVELS.length, 'every level looks different');
});

test('room options name the turn timer explicitly and long player names remain accessible', () => {
  const room = lobby();
  room.players[1]!.name = 'Alexandria of the Northern Isles';
  let html = renderLobby(room, 'p0');
  assert.match(html, /aria-label="Turn timer: 90 seconds\. Room setup"/);
  assert.match(html, /title="Alexandria of the Northern Isles"/);
  assert.match(html, /aria-label="Edit your profile"/);
  room.settings = { turnTimerSeconds: null };
  html = renderLobby(room, 'p1');
  assert.match(html, /aria-label="Turn timer off\. Room setup"/);
  assert.ok(html.includes('Turn timer <b>Off</b>'));
});

test('sharing keeps three distinct controls and a screen-reader status without an extra visible feedback row', () => {
  const html = renderToStaticMarkup(
    createElement(Invite, { code: 'AB2C', roomId: '9bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f' }),
  );
  const controls = buttons(html);
  assert.equal(controls.length, 3);
  for (const label of ['Share room', 'Copy invite link', 'Copy room code'])
    assert.equal(controls.filter((button) => button.includes(`aria-label="${label}"`)).length, 1);
  assert.match(html, /<code>AB2C<\/code>/);
  assert.match(html, /class="room-share-status" role="status" aria-live="polite"/);
  assert.ok(!html.includes('copy-feedback') && !html.includes('share-link-field'));
});

test('readiness, minimum seats, connection and pending commands all gate the host Start control', () => {
  const room = lobby();
  const missingReady = structuredClone(room);
  missingReady.players[1]!.ready = false;
  const disconnectedSeat = structuredClone(room);
  disconnectedSeat.players[2]!.connected = false;
  const short = structuredClone(room);
  short.players.splice(1);
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
    renderToStaticMarkup(createElement(RoomConfiguration, { room, me, busy: false, save: async () => {} }));
  const duration = (html: string) => html.match(/<input\b[^>]*aria-label="Turn duration"[^>]*>/)?.[0];
  assert.ok(duration(render('p0')) && !duration(render('p0'))!.includes('disabled=""'));
  assert.ok(duration(render('p1'))!.includes('disabled=""'));
  assert.ok(render('p1').includes('The host sets these for the table.'));
  for (const seconds of [40, 65, 90, 115, 140]) assert.ok(render('p0').includes(`>${seconds}</span>`));
  room.game = gameView(
    createGame(
      room.players.map(({ id, name }) => ({ id, name })),
      82,
      () => 0.34,
    ),
    'p0',
  );
  assert.ok(duration(render('p0'))!.includes('disabled=""'), 'the table rules lock once play starts');
  // A player's own panel carries sound and appearance, and nothing of the table's.
  const mine = renderToStaticMarkup(
    createElement(PlayerSettings, {
      preferences: DEFAULT_PREFERENCES,
      update: () => {},
      previewSound: () => {},
    }),
  );
  assert.equal(duration(mine), undefined);
  assert.match(mine, /Effects volume/);
  assert.match(mine, /Music volume/);
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
  assert.ok(html.includes('/art/optimized/avatars-fantasy.6bf04e83341a.webp'));
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
  assert.equal([...html.matchAll(/aria-label="Current turn: Place a starting settlement"/g)].length, 1);
  assert.match(html, /Longest Road, plus 2 victory points/);
  assert.match(html, /aria-label="Disconnected"/);
  assert.ok(!html.includes('profile-pieces'));
  assert.ok(!/>Connected<|>You<|>Playing</.test(html));
});

const profileCard = (html: string, id: string) =>
  html.match(new RegExp(`<article[^>]*data-player-profile="${id}"[\\s\\S]*?</article>`))![0];

test('each profile shows its road length and knights played on its portrait, the holders gilded', () => {
  const room = lobby();
  const game = gameView(
    createGame(room.players, 82, () => 0.34),
    'p0',
  );
  game.players[0]!.roadLength = 6;
  game.players[1]!.knights = 3;
  game.longestRoad = 'p0';
  game.largestArmy = 'p1';
  const html = renderToStaticMarkup(createElement(PlayerRail, { room, game, me: 'p0' }));
  const first = profileCard(html, 'p0');
  assert.match(
    first,
    /class="profile-road-count" data-held="true" title="Longest road: 6, holds Longest Road"/,
  );
  assert.match(first, /class="profile-knight-count" data-held="false" title="Knights played: 0"/);
  assert.match(profileCard(html, 'p1'), /title="Knights played: 3, holds Largest Army"/);
  assert.match(profileCard(html, 'p2'), /title="Longest road: 0"/);
  // On the portrait, so the name and the counters beside it keep their room.
  assert.ok(first.indexOf('profile-award-counts') < first.indexOf('profile-caption'));
  const css = readFileSync('apps/client/src/game-feedback-polish.css', 'utf8');
  assert.ok(
    css.includes('.playing .profile-portrait:has(> .profile-absence) > .profile-award-counts'),
    'an absence label, in the same place, takes precedence',
  );
});

test('compact profile scores show only projected points and keep a long name available to assistive technology', () => {
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
  assert.ok(!html.includes('profile-score-plaque') && !html.includes('>VP</span>'));
  assert.match(own, /class="profile-stats"><span class="profile-score"/);
  assert.ok(own.indexOf('profile-score') < own.indexOf('profile-resource-count'));
  assert.ok(own.indexOf('profile-resource-count') < own.indexOf('profile-development-count'));
  assert.match(opponent, /aria-label="Disconnected"/);
  assert.ok(!opponent.includes('>Offline</span>') && !opponent.includes('profile-offline-distress'));
  assert.ok(!html.includes('private-opponent-point'));
});

test('profiles display the current phase and preserve the active clock without a Turn text badge', () => {
  const room = lobby(),
    game = gameView(
      createGame(room.players, 82, () => 0.34),
      'p0',
    );
  const phases = [
    ['setupSettlement', 'settlement', 'Place a starting settlement'],
    ['setupRoad', 'road', 'Place a starting road'],
    ['freeRoads', 'road', 'Place a free road'],
    ['roll', 'dice', 'Roll the dice'],
    ['robber', 'robber', 'Move the robber'],
    ['actions', 'trade', 'Build, trade or play a development card'],
  ] as const;
  for (const [phase, icon, label] of phases) {
    game.phase = phase;
    const html = renderToStaticMarkup(
      createElement(PlayerRail, { room, game, timer: createElement('span', {}, '42s') }),
    );
    assert.equal([...html.matchAll(/data-turn-activity=/g)].length, 1);
    assert.ok(html.includes(`data-turn-activity="${icon}"`));
    assert.ok(html.includes(`aria-label="Current turn: ${label}"`));
    assert.equal([...html.matchAll(/>42s<\/span>/g)].length, 1);
    assert.ok(!html.includes('profile-turn-label'));
  }
});

test('each pending discard player gets an activity marker which clears independently', () => {
  const room = lobby(),
    game = gameView(
      createGame(room.players, 82, () => 0.34),
      'p0',
    );
  game.phase = 'discard';
  game.discards = { p0: 4, p1: 5, p2: 0 };
  const render = () => renderToStaticMarkup(createElement(PlayerRail, { room, game }));
  let html = render();
  assert.equal([...html.matchAll(/data-turn-activity="discard"/g)].length, 2);
  assert.ok(html.includes('Current turn: Discard 4 resource cards'));
  assert.ok(html.includes('aria-label="Discard 5 resource cards"'));
  delete game.discards.p0;
  html = render();
  assert.equal([...html.matchAll(/data-turn-activity="discard"/g)].length, 1);
  assert.ok(html.includes('Current turn: Waiting for players to discard'));
  delete game.discards.p1;
  assert.ok(!render().includes('data-turn-activity="discard"'));
  game.winner = 'p0';
  assert.ok(!render().includes('data-turn-activity='));
});

test('only hosts can remove human or bot guests from the lobby', () => {
  const room = lobby();
  room.players[2]!.bot = true;
  const host = renderLobby(room, 'p0');
  assert.ok(host.includes('aria-label="Remove Second"'));
  assert.ok(host.includes('aria-label="Remove Third"'));
  assert.ok(!host.includes('aria-label="Remove Host"'));
  assert.ok(!renderLobby(room, 'p1').includes('lobby-remove-player'));
  for (const button of buttons(renderLobby(room, 'p0', false, false)).filter((b) =>
    b.includes('lobby-remove-player'),
  )) {
    assert.ok(button.includes('disabled=""'));
  }
});
