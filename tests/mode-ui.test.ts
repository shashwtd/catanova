import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InviteRoster, Lobby } from '../apps/client/src/Lobby.js';
import { RoomConfiguration } from '../apps/client/src/GameSettings.js';
import { ResourcePicker } from '../apps/client/src/ResourcePicker.js';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { emptyHand } from '../packages/rules/src/game.js';
import { CLASSIC, registerRuleset } from '../packages/rules/src/rulesets.js';
import { TEST_TABLE, useTestTable } from './test-ruleset.js';

useTestTable();
const TEST = TEST_TABLE.id;
function room(count: number, extra: Partial<RoomState> = {}, bot = false): RoomState {
  return {
    roomId: 'ABCDEFG2',
    revision: 5,
    counter: 0,
    settings: { turnTimerSeconds: 90 },
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i + 1}`,
      profile: defaultProfile(`Player ${i + 1}`),
      connected: true,
      ready: i !== 0,
      ...(bot && i === count - 1 ? { bot: true, botLevel: 'steady' } : {}),
    })),
    ...extra,
  };
}
const setup = (state: RoomState, me = 'p0') =>
  renderToStaticMarkup(
    createElement(RoomConfiguration, { room: state, me, busy: false, save: async () => {} }),
  );
const lobby = (state: RoomState, me = 'p0') =>
  renderToStaticMarkup(
    createElement(Lobby, {
      room: state,
      me,
      busy: false,
      connected: true,
      onReady: () => {},
      onStart: () => {},
      onInvite: () => {},
      onLeave: () => {},
      onEdit: () => {},
      onSettings: () => {},
      onConfigure: () => {},
      onAddBot: () => {},
    }),
  );
const cards = (html: string) =>
  (html.match(/<fieldset class="settings-dice settings-mode"[^]*?<\/fieldset>/)?.[0] ?? '').match(
    /<label[^>]*>[^]*?<\/label>/g,
  ) ?? [];

test('with Classic alone, Room setup and the lobby show no mode at all', () => {
  const html = setup(room(2));
  assert.ok(!html.includes('Game mode'));
  assert.ok(!html.includes('settings-mode'));
  assert.match(html, /<span>8<\/span><span>10 · Standard<\/span><span>15<\/span>/);
  const hall = lobby(room(2));
  assert.ok(!hall.includes('lobby-mode'));
  assert.ok(!hall.includes('data-mode'));
  assert.match(hall, /title="Which one turns up is the luck of the draw"/);
});

test('a host offered another mode picks it from the same option cards as the dice', () => {
  const offered = room(2, { modes: [CLASSIC.id, TEST] });
  const [classic, testMode] = cards(setup(offered));
  assert.match(classic!, /class="settings-dice-option" data-selected="true"/);
  assert.match(classic!, /<strong>Classic<\/strong><small>The base game, for two to four players\.<\/small>/);
  assert.match(testMode!, /data-selected="false"/);
  assert.ok(!testMode!.includes('data-disabled'));
  assert.match(testMode!, /<small>A mode for tests, for three to five players\.<\/small>/);
  assert.match(setup(offered), /<legend><svg[^]*?<\/svg> Game mode<\/legend>/);
  // Only the host hears which modes they may pick; the others see the room's mode only once it is not Classic.
  const { modes: _modes, ...guestView } = offered;
  assert.ok(!setup(guestView, 'p1').includes('Game mode'));
  assert.match(
    setup({ ...guestView, settings: { turnTimerSeconds: 90, mode: TEST } }, 'p1'),
    /<fieldset class="settings-dice settings-mode" disabled="">/,
  );
  // The lobby names the mode first among its options.
  assert.match(
    lobby(offered),
    /<div class="lobby-room-options" data-mode="base-3-4-v1"><button type="button" class="lobby-mode"[^>]*aria-label="Game mode: Classic. Room setup"/,
  );
});

test('a mode the table does not fit is shown blocked, with the reason where its line was', () => {
  const [, withBot] = cards(setup(room(2, { modes: [CLASSIC.id, TEST] }, true)));
  assert.match(withBot!, /data-disabled="true"/);
  assert.match(withBot!, /<input[^>]*disabled=""/);
  assert.match(withBot!, /<small>Bots play Classic only<\/small>/);
  // Five players fit the test mode but not Classic, so Classic is the one blocked.
  const five = room(5, { modes: [CLASSIC.id, TEST], settings: { turnTimerSeconds: 90, mode: TEST } });
  const [classic, testMode] = cards(setup(five));
  assert.match(classic!, /data-disabled="true"/);
  assert.match(classic!, /<small>For up to four players<\/small>/);
  assert.ok(!testMode!.includes('data-disabled'));
  // A room left in a mode its host may no longer pick keeps it selected, and says so.
  const closed = cards(setup(room(3, { settings: { turnTimerSeconds: 90, mode: TEST } })));
  assert.equal(closed.length, 2);
  assert.match(closed[1]!, /data-selected="true"[^]*<small>No longer open to this room<\/small>/);
  assert.ok(!closed[1]!.includes('data-disabled'), 'the room keeps it until the host picks another');
  // The others at the table read the section without reasons: nothing is theirs to pick.
  const guest = cards(setup(room(5, { settings: { turnTimerSeconds: 90, mode: TEST } }), 'p1'));
  assert.ok(guest.every((card) => !card.includes('data-disabled')));
  assert.match(guest[1]!, /<small>A mode for tests/);
});

test('the target’s range and its standard come from the room’s mode', () => {
  const html = setup(room(3, { settings: { turnTimerSeconds: 90, mode: TEST } }));
  assert.match(html, /<input[^>]*id="victory-target"[^>]*min="9" max="13"[^>]*value="11"/);
  assert.match(html, /<span>9<\/span><span>11 · Standard<\/span><span>13<\/span>/);
  assert.ok(!html.includes('Apply the new mode first'));
  assert.match(
    renderToStaticMarkup(createElement(QuickRules, { ruleset: TEST_TABLE })),
    /First to 11 points/,
  );
});

test('the lobby seats the mode’s number, bars bots with the reason, and says how many it needs', () => {
  const four = room(4, { settings: { turnTimerSeconds: 90, mode: TEST } });
  const html = lobby(four);
  // Four people, and a fifth seat still open in the test mode.
  assert.match(html, /style="--places:5"/);
  assert.match(html, /Open seat/);
  const bot = html.match(/<button type="button" class="seat-fill is-bot"[^>]*>/)![0];
  assert.match(bot, /disabled=""/);
  assert.match(bot, /title="Bots play Classic only"/);
  assert.match(html, /aria-label="Game mode: Test Table. Room setup"[^]*?<span>Test Table<\/span>/);
  assert.match(html, /<span>11 points<\/span>/);
  assert.match(
    lobby(room(2, { settings: { turnTimerSeconds: 90, mode: TEST } })),
    /Test Table needs three players/,
  );
  assert.match(lobby(room(1)), /Invite another player/);
  assert.match(lobby(room(4)), /style="--places:4"/);
  assert.match(
    renderToStaticMarkup(
      createElement(InviteRoster, {
        room: {
          roomId: 'r',
          board: undefined as never,
          players: [],
          started: false,
          settings: four.settings!,
        },
      }),
    ),
    /0(<!-- -->)?\/5/,
  );
});

test('one resource is capped at the game’s bank in the trade pickers', () => {
  const picker = (bank?: number) =>
    renderToStaticMarkup(
      createElement(ResourcePicker, {
        label: 'You get',
        value: { ...emptyHand(), wood: 19 },
        onChange: () => {},
        ...(bank ? { bank } : {}),
      }),
    );
  assert.match(picker(), /disabled="" aria-label="Add Timber to You get; 19 selected"/);
  assert.doesNotMatch(picker(24), /disabled="" aria-label="Add Timber to You get; 19 selected"/);
});

test('the mode stylesheet loads last and adds only the blocked state and the phone chip layout', () => {
  const main = readFileSync(new URL('../apps/client/src/main.tsx', import.meta.url), 'utf8');
  const imports = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  assert.equal(imports.at(-1), 'game-mode.css');
  const css = readFileSync(new URL('../apps/client/src/game-mode.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('!important'));
  for (const rule of css.match(/^[^\s/*@}][^{]*\{/gm) ?? [])
    assert.match(rule, /data-disabled|data-mode/, `every rule is scoped to a mode state: ${rule}`);
  // A test ruleset that nobody registers is never offered.
  assert.throws(() => registerRuleset({ ...TEST_TABLE }), /already registered/);
});
