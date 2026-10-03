import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InviteRoster, Lobby } from '../apps/client/src/Lobby.js';
import { ModeChooser } from '../apps/client/src/ModeChooser.js';
import { RoomConfiguration } from '../apps/client/src/GameSettings.js';
import { ResourcePicker } from '../apps/client/src/ResourcePicker.js';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { emptyHand } from '../packages/rules/src/game.js';
import { BIG_TABLE, CLASSIC, OPEN_SEA, registerRuleset } from '../packages/rules/src/rulesets.js';
import { modeSample } from '../apps/client/src/mode-samples.js';
import { MODE_SAMPLES_FILE, modeSamplesSource } from '../scripts/mode-samples.js';
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
const chooser = (state: RoomState, me = 'p0') =>
  renderToStaticMarkup(
    createElement(ModeChooser, { room: state, me, busy: false, save: async () => {}, onClose: () => {} }),
  );
/** The chooser's modes, each as its button's markup. */
const picks = (html: string) => html.match(/<button type="button" class="mode-pick"[^]*?<\/button>/g) ?? [];
/** The room's mode, as its banner beside Start. */
const banner = (html: string) =>
  html.match(/<button type="button" class="lobby-mode-banner"[^]*?<\/button>/)?.[0];

test('with Classic alone, Room setup and the lobby show no mode at all', () => {
  const html = setup(room(2));
  assert.ok(!html.includes('Game mode'));
  assert.ok(!html.includes('settings-mode'));
  assert.match(html, /<span>8<\/span><span>10 · Standard<\/span><span>15<\/span>/);
  const hall = lobby(room(2));
  assert.equal(banner(hall), undefined);
  assert.ok(!hall.includes('lobby-mode'));
  assert.match(hall, /title="Which one turns up is the luck of the draw"/);
});

test('a host offered another mode opens the chooser from the banner beside Start; Room setup lists no modes', () => {
  const offered = room(2, { modes: [CLASSIC.id, TEST] });
  const html = lobby(offered);
  const mark = banner(html)!;
  assert.match(mark, /aria-label="Game mode: Classic\. Choose a game mode"/);
  assert.match(mark, /<img src="\/art\/optimized\/mode-emblem-classic\.[0-9a-f]{12}\.webp" alt=""\/>/);
  assert.match(
    mark,
    /<small>Game mode<\/small><strong>Classic<\/strong><span><svg[^]*?<\/svg>2–4 players<\/span>/,
  );
  assert.match(mark, /class="lobby-mode-banner-change"/);
  // It leads the start row, and the room's options keep only the points, the timer and the dice.
  assert.match(html, /<div class="lobby-start-controls"><button type="button" class="lobby-mode-banner"/);
  assert.ok(!html.includes('class="lobby-mode"') && !html.includes('data-mode'));
  // Room setup keeps the timer, the target and the dice, and no longer lists the modes.
  assert.ok(!setup(offered).includes('Game mode'));
  assert.ok(!setup(offered).includes('name="game-mode"'));
  // The chooser shows every mode the host may pick, the room's pressed.
  const dialog = chooser(offered);
  assert.match(dialog, /<h2>Choose a mode<\/h2>/);
  const [classic, testMode] = picks(dialog);
  assert.match(classic!, /aria-pressed="true"/);
  assert.match(
    classic!,
    /<span class="mode-pick-name">Classic<\/span><span class="mode-pick-meta"><span><svg[^]*?<\/svg>2–4 players<\/span><\/span><span class="mode-pick-tagline">The island everyone knows\./,
  );
  assert.match(testMode!, /aria-pressed="false"/);
  assert.ok(!testMode!.includes('disabled'));
  assert.match(testMode!, /<span class="mode-pick-name">Test Table<\/span>[^]*?3–5 players/);
  assert.match(
    testMode!,
    /<span class="mode-pick-tagline">A mode for tests, for three to five players\.<\/span>/,
  );
  assert.match(dialog, /Select Classic/);
  // Only the host hears which modes they may pick; the others see the room's mode only once it is not Classic,
  // with nothing to swap, and in the chooser that one mode, with nothing to press.
  const { modes: _modes, ...guestView } = offered;
  assert.equal(banner(lobby(guestView, 'p1')), undefined);
  const inTest: RoomState = { ...guestView, settings: { turnTimerSeconds: 90, mode: TEST } };
  assert.match(banner(lobby(inTest, 'p1'))!, /aria-label="Game mode: Test Table\. Game modes"/);
  assert.ok(!banner(lobby(inTest, 'p1'))!.includes('lobby-mode-banner-change'));
  const guest = picks(chooser(inTest, 'p1'));
  assert.equal(guest.length, 1);
  assert.match(guest[0]!, /aria-pressed="true" disabled=""/);
  assert.match(
    chooser(inTest, 'p1'),
    /<h2>Game mode<\/h2>[^]*The host picks the mode for the table\.[^]*>Close</,
  );
});

test('a mode the table does not fit is shown blocked in the chooser, with the reason where its line was', () => {
  const [, withBot] = picks(chooser(room(2, { modes: [CLASSIC.id, TEST] }, true)));
  assert.match(withBot!, /aria-pressed="false" disabled=""/);
  assert.match(withBot!, /<span class="mode-pick-tagline is-note">Bots play Classic only<\/span>/);
  // Five players fit the test mode but not Classic, so Classic is the one blocked.
  const five = room(5, { modes: [CLASSIC.id, TEST], settings: { turnTimerSeconds: 90, mode: TEST } });
  const [classic, testMode] = picks(chooser(five));
  assert.match(classic!, /disabled=""/);
  assert.match(classic!, /<span class="mode-pick-tagline is-note">For up to four players<\/span>/);
  assert.ok(!testMode!.includes('disabled'));
  assert.match(testMode!, /aria-pressed="true"/);
  // A room left in a mode its host may no longer pick keeps it pressed, and says so.
  const closed = picks(chooser(room(3, { settings: { turnTimerSeconds: 90, mode: TEST } })));
  assert.equal(closed.length, 2);
  assert.match(
    closed[1]!,
    /aria-pressed="true"[^]*<span class="mode-pick-tagline is-note">No longer open to this room<\/span>/,
  );
  assert.ok(!closed[1]!.includes('disabled'), 'the room keeps it until the host picks another');
  // The others at the table see the room's mode without reasons: nothing is theirs to pick.
  const guest = picks(chooser(room(5, { settings: { turnTimerSeconds: 90, mode: TEST } }), 'p1'));
  assert.equal(guest.length, 1);
  assert.match(
    guest[0]!,
    /<span class="mode-pick-tagline">A mode for tests, for three to five players\.<\/span>/,
  );
});

test('each mode’s picture in the chooser is a game of it a few turns in, dealt and set up by the rules', () => {
  for (const mode of [CLASSIC, BIG_TABLE, OPEN_SEA]) {
    const sample = modeSample(mode.id);
    assert.equal(sample.ruleset, mode.id);
    assert.equal(sample.board.preset, mode.board);
    assert.equal(sample.players.length, mode === BIG_TABLE ? 6 : 4);
    assert.equal(sample.phase, 'roll', `${mode.name}: setup is over`);
    const buildings = Object.values(sample.buildings);
    assert.equal(buildings.length, 2 * sample.players.length, `${mode.name}: two houses each`);
    assert.equal(buildings.filter((b) => b.kind === 'city').length, 2);
    assert.ok(Object.keys(sample.roads).length >= sample.players.length);
    // Open Sea's card shows ships as well as roads.
    assert.equal(Object.keys(sample.ships ?? {}).length > 0, !!mode.sea);
    assert.equal(modeSample(mode.id), sample, 'made once');
  }
  // The browser draws the samples stored in mode-samples.data.ts, which must be the ones the rules make today.
  assert.equal(
    readFileSync(MODE_SAMPLES_FILE, 'utf8'),
    modeSamplesSource(),
    'mode-samples.data.ts is out of date: run npx tsx scripts/mode-samples.ts',
  );
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
  assert.match(html, /<strong>Test Table<\/strong>/);
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

test('the chooser’s and the room’s stylesheets load after every layered sheet and reach only their own parts', () => {
  const main = readFileSync(new URL('../apps/client/src/main.tsx', import.meta.url), 'utf8');
  const imports = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  // Only the components' own sheets come after table-light.css, the last layered one.
  assert.deepEqual(imports.slice(imports.indexOf('table-light.css') + 1), [
    'mode-chooser.css',
    'room-layout.css',
    'open-sea.css',
    'ship-sites.css',
    'placement-choice.css',
    'gold-pick.css',
    'six-seat-rail.css',
    'six-seat-trade.css',
    'six-seat-robber.css',
    'big-table.css',
  ]);
  for (const sheet of ['mode-chooser.css', 'room-layout.css']) {
    const css = readFileSync(new URL(`../apps/client/src/${sheet}`, import.meta.url), 'utf8');
    assert.ok(!css.includes('!important'), sheet);
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)]
      .map((match) => match[1]!.trim())
      .filter((selector) => !selector.startsWith('@') && !/^(from|to)$/.test(selector))
      .flatMap((selector) => selector.split(/,(?![^()]*\))/).map((part) => part.trim()));
    assert.ok(selectors.length > 10, sheet);
    for (const selector of selectors)
      assert.match(
        selector,
        sheet === 'room-layout.css' ? /^(\.lobby )?\.room-lobby\b/ : /\.mode-|\.lobby-mode-banner/,
        `${sheet} reaches only its own parts: ${selector}`,
      );
  }
  // A test ruleset that nobody registers is never offered.
  assert.throws(() => registerRuleset({ ...TEST_TABLE }), /already registered/);
});
