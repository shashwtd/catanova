import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { InviteRoster, Lobby } from '../apps/client/src/Lobby.js';
import { TradePanel } from '../apps/client/src/TradePanel.js';
import { RobberFlow } from '../apps/client/src/RobberFlow.js';
import { createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';

const seated = (size: number) =>
  Array.from({ length: size }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, connected: true }));
/** A game view at a table of `size`. The rules deal four at most, so a fifth and sixth join after. */
function table(size: number) {
  const seats = seated(size);
  const game = createGame(seats.slice(0, Math.min(size, 4)), 42, () => 0.34);
  for (const seat of seats.slice(4))
    game.players.push({
      ...seat,
      hand: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      cards: [],
      knights: 0,
    });
  const room: RoomState = { roomId: 'BIGTABLE', revision: 1, counter: 0, players: seats };
  return { room, game: gameView(game, 'p0') };
}
const rail = (size: number) => {
  const { room, game } = table(size);
  return renderToStaticMarkup(createElement(PlayerRail, { room, game, me: 'p0' }));
};

test('only a table of five or six carries a seat count, so four renders as it always did', () => {
  for (const size of [2, 3, 4]) assert.ok(!rail(size).includes('data-seats'), `${size} seats`);
  assert.match(rail(5), /<aside class="player-rail"[^>]* data-seats="5"/);
  assert.match(rail(6), /<aside class="player-rail"[^>]* data-seats="6"/);
});

test('five and six seats also put the award counts in the score, for the small cards', () => {
  const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
  // Four seats: once per card, on the portrait.
  const four = rail(4);
  assert.equal(count(four, /class="profile-award-counts"/g), 4);
  assert.equal(count(four, /<div class="profile-stats">(?:(?!<\/div>).)*profile-award-counts/g), 0);
  // Six: the portrait's copy stays for desktop, and one joins the score for phones.
  const six = rail(6);
  assert.equal(count(six, /class="profile-award-counts"/g), 12);
  assert.equal(count(six, /<div class="profile-stats">(?:(?!<\/div>).)*profile-award-counts/g), 6);
});

const lobby = (players: number, seats?: number) =>
  renderToStaticMarkup(
    createElement(Lobby, {
      room: { roomId: 'BIGTABLE', revision: 1, counter: 0, players: seated(players) },
      me: 'p0',
      busy: false,
      connected: true,
      onReady() {},
      onStart() {},
      onInvite() {},
      onLeave() {},
      onEdit() {},
      onSettings() {},
      ...(seats ? { seats } : {}),
    }),
  );

test('the lobby marks five and six places for its three columns, and nothing less', () => {
  const places = (html: string) => html.match(/<ol class="seat-row"[^>]*>/)![0];
  // A table of four: an open place until it is full, and no mark either way.
  for (const players of [1, 2, 3, 4]) assert.ok(!places(lobby(players)).includes('data-places'));
  assert.match(places(lobby(3)), /--places:4/);
  // Big Table's six seats: four players and an open place make five.
  assert.match(places(lobby(4, 6)), /data-places="5"/);
  assert.match(places(lobby(5, 6)), /data-places="6"/);
  assert.match(places(lobby(6, 6)), /data-places="6"/);
  assert.equal(lobby(6, 6).match(/seat-open/g), null, 'a full table of six has no open place');
});

test('an invitation counts against the seats the table has', () => {
  const room = { roomId: 'BIGTABLE', board: createGame(seated(2), 42, () => 0.34).board };
  const roster = (players: number, seats?: number) =>
    renderToStaticMarkup(
      createElement(InviteRoster, {
        room: { ...room, started: false, players: seated(players) },
        ...(seats ? { seats } : {}),
      }),
    );
  assert.match(roster(3), /<span class="invite-capacity">3\/4<\/span>/);
  assert.match(roster(5, 6), /<span class="invite-capacity">5\/6<\/span>/);
});

test('a trade row is marked only with more than three partners to wrap', () => {
  const partners = (size: number, resigned = 0) => {
    const { room, game } = table(size);
    game.players.slice(1, 1 + resigned).forEach((player) => (player.resigned = true));
    game.phase = 'actions';
    game.trade = { id: 1, player: 'p0', give: { ...emptyHand(), wood: 1 }, want: emptyHand(), open: true };
    const html = renderToStaticMarkup(
      createElement(TradePanel, {
        game,
        me: 'p0',
        disabled: false,
        onAction() {},
        roomPlayers: room.players,
      }),
    );
    return html.match(/<div class="trade-partners"[^>]*>/)![0];
  };
  assert.ok(!partners(3).includes('data-partners'));
  assert.ok(!partners(4).includes('data-partners'));
  assert.match(partners(5), /data-partners="4"/);
  assert.match(partners(6), /data-partners="5"/);
  // Two of six resigned leaves three, who fit one row as at a table of four.
  assert.ok(!partners(6, 2).includes('data-partners'));
});

test('the robber panel is marked only at a table of five or six', () => {
  const panel = (size: number) => {
    const { room, game } = table(size);
    game.phase = 'discard';
    game.discards = { p1: 4 };
    const html = renderToStaticMarkup(
      createElement(RobberFlow, {
        room: { ...room, game },
        me: 'p0',
        selectedHex: null,
        onSelectHex() {},
        onAction() {},
        disabled: false,
        connected: true,
        onWarning() {},
      }),
    );
    return html.match(/<aside class="robber-flow[^>]*>/)![0];
  };
  assert.ok(!panel(4).includes('data-seats'));
  assert.match(panel(5), /data-seats="5"/);
  assert.match(panel(6), /data-seats="6"/);
});

/** Every selector in a six-seat stylesheet, from `after` on, comments and at-rules aside. */
function selectors(file: string, after = '') {
  const source = readFileSync(new URL(`../apps/client/src/${file}`, import.meta.url), 'utf8');
  const css = source.slice(after ? source.indexOf(after) : 0).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1]!.trim())
    .filter((selector) => !selector.startsWith('@'))
    .flatMap((selector) => selector.split(/,(?![^()]*\))/).map((part) => part.trim()));
}

test('every six-seat rule is reached only through its mark, at no extra specificity', () => {
  for (const [file, mark] of [
    ['six-seat-rail.css', /:where\([^)]*\[data-seats(='[56]')?\]/],
    ['six-seat-trade.css', /:where\([^)]*\[data-partners(='[45]')?\]/],
    ['six-seat-robber.css', /:where\([^)]*\[data-seats\]/],
  ] as const) {
    const css = readFileSync(new URL(`../apps/client/src/${file}`, import.meta.url), 'utf8');
    assert.ok(!css.includes('!important'), file);
    const found = selectors(file);
    assert.ok(found.length > 2, file);
    for (const selector of found) assert.match(selector, mark, `${file}: ${selector} must hang off its mark`);
  }
});

test('the seat card at five and six places is reached only through their mark', () => {
  const found = selectors('room-seats.css', '/* --- five and six places');
  assert.ok(found.length > 10);
  for (const selector of found)
    assert.match(selector, /\[data-places(='[56]')?\]/, `${selector} must hang off the seat row's places`);
});

test('the six-seat stylesheets load after every other one', () => {
  const main = readFileSync(new URL('../apps/client/src/main.tsx', import.meta.url), 'utf8');
  const sheets = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  assert.deepEqual(sheets.slice(-4), [
    'table-light.css',
    'six-seat-rail.css',
    'six-seat-trade.css',
    'six-seat-robber.css',
  ]);
});
