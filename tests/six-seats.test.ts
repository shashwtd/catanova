import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';

/** A game view at a table of `size`. The rules deal four at most, so a fifth and sixth join after. */
function table(size: number) {
  const seats = Array.from({ length: size }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    connected: true,
  }));
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

/** Every selector in a six-seat stylesheet, comments and at-rules aside. */
function selectors(file: string) {
  const css = readFileSync(new URL(`../apps/client/src/${file}`, import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  return [...css.matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1]!.trim())
    .filter((selector) => !selector.startsWith('@'))
    .flatMap((selector) => selector.split(/,(?![^()]*\))/).map((part) => part.trim()));
}

test('every six-seat rule is reached only through the seat count, at no extra specificity', () => {
  const css = readFileSync(new URL('../apps/client/src/six-seat-rail.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('!important'));
  const found = selectors('six-seat-rail.css');
  assert.ok(found.length > 20);
  for (const selector of found)
    assert.match(
      selector,
      /:where\([^)]*\[data-seats(='[56]')?\]/,
      `${selector} must hang off the rail's seat count inside :where()`,
    );
});

test('the six-seat stylesheet loads after every other one', () => {
  const main = readFileSync(new URL('../apps/client/src/main.tsx', import.meta.url), 'utf8');
  const sheets = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  assert.equal(sheets.at(-1), 'six-seat-rail.css');
});
