/**
 * Big Table in the client: Room setup's turn style, the lobby chip, the rail's Lead and Partner, the prompts,
 * clock labels and trade lock of the new phases, card locks, history lines, results and the quick rules
 * (docs/GAME-MODES.md, "Matching the existing look").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Lobby } from '../apps/client/src/Lobby.js';
import { RoomConfiguration } from '../apps/client/src/GameSettings.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { TurnTimer } from '../apps/client/src/TurnTimer.js';
import { TradePanel } from '../apps/client/src/TradePanel.js';
import { GameOver } from '../apps/client/src/GameOver.js';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { historyTokens } from '../apps/client/src/MoveHistory.js';
import { AttentionTracker, gameStatus, requiredAction } from '../apps/client/src/game-attention.js';
import { playerTurnActivity } from '../apps/client/src/turn-activity.js';
import { cardLockReason } from '../apps/client/src/cards.js';
import { placementValid } from '../apps/client/src/placement.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { resultsFromRoom } from '../packages/protocol/src/results.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { gameView } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { NAMES, act, afterSetup, deal, give, roll } from './big-table-helpers.js';

const noop = () => {};
function room(g: Game | null, extra: Partial<RoomState> = {}, viewer = 'p0'): RoomState {
  const count = g?.players.length ?? 5;
  return {
    roomId: 'ABCDEFG2',
    revision: 9,
    counter: 0,
    settings: { turnTimerSeconds: 65, mode: BIG_TABLE.id },
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: NAMES[i]!,
      profile: defaultProfile(NAMES[i]!),
      connected: true,
      ready: i !== 0,
    })),
    ...(g ? { game: gameView(g, viewer) } : {}),
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
      onReady: noop,
      onStart: noop,
      onInvite: noop,
      onLeave: noop,
      onEdit: noop,
      onSettings: noop,
      onConfigure: noop,
      onAddBot: noop,
    }),
  );
/** A paired turn in the Partner's phase: Ann leads the first, Dan is her Partner. */
const partnerPhase = () => act(roll(afterSetup(5), 3, 5), 'p0', { kind: 'endTurn' });

test('Room setup shows Big Table’s turn style under its card, open while Big Table is picked', () => {
  const offered = room(null, { modes: [CLASSIC.id, BIG_TABLE.id], settings: { turnTimerSeconds: 90 } });
  const classic = setup(offered);
  // Classic is picked: the turn style is there, closed and out of reach.
  assert.match(classic, /<strong>Big Table<\/strong><small>For five and six players\.<\/small>/);
  assert.match(
    classic,
    /<div class="settings-turns t-acc" data-open="false"><div class="t-acc-panel" inert=""/,
  );
  assert.ok(!/name="turn-style"[^>]*checked=""/.test(classic), 'nothing is picked while Big Table is not');
  // In a Big Table room it is open, after Big Table's card and inside the Game mode fieldset, Paired turns first.
  const bigTable = setup({ ...offered, settings: { turnTimerSeconds: 90, mode: BIG_TABLE.id } });
  const fieldset = bigTable.match(/<fieldset class="settings-dice settings-mode"[^]*?<\/fieldset>/)![0];
  assert.match(
    fieldset,
    /<strong>Big Table<\/strong>[^]*?<\/label><div class="settings-turns t-acc" data-open="true">/,
  );
  assert.match(fieldset, /<p class="settings-caption" id="[^"]+">Turn style<\/p>/);
  assert.match(
    fieldset,
    /data-selected="true"><input type="radio" name="turn-style" checked="" value="paired"\/><span><strong>Paired turns<\/strong><small>After each turn, the Partner gets a full action phase, with no roll and no player trades\.<\/small>/,
  );
  assert.match(fieldset, /<strong>Between-turns build<\/strong><small>The older rule: /);
  // The room's own choice is shown picked, to the others too, who only read it.
  const older: RoomState = {
    ...offered,
    settings: { turnTimerSeconds: 90, mode: BIG_TABLE.id, turns: 'betweenTurnsBuild' },
  };
  assert.match(setup(older), /checked="" value="betweenTurnsBuild"/);
  const { modes: _modes, ...guest } = older;
  const read = setup(guest, 'p1');
  assert.match(read, /<fieldset class="settings-dice settings-mode" disabled="">/);
  assert.match(read, /checked="" value="betweenTurnsBuild"/);
  // The sheet that indents it loads last, and every rule in it, media queries included, reaches only Big
  // Table's parts: the turn style, the trade lock and the rail of five or six.
  const main = readFileSync(new URL('../apps/client/src/main.tsx', import.meta.url), 'utf8');
  const sheets = [...main.matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map((match) => match[1]);
  assert.equal(sheets.at(-1), 'big-table.css');
  const css = readFileSync(new URL('../apps/client/src/big-table.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('!important'));
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1]!.trim())
    .filter((selector) => !selector.startsWith('@'))
    .flatMap((selector) => selector.split(/,(?![^()]*\))/).map((part) => part.trim()));
  assert.ok(selectors.length >= 6);
  for (const selector of selectors)
    assert.match(
      selector,
      /settings-turns|trade-lock|:where\([^)]*player-rail\[data-seats\]/,
      `every rule is scoped to Big Table's parts: ${selector}`,
    );
});

test('the lobby chip names the mode and its turn style, and seats six', () => {
  const html = lobby(room(null, { settings: { turnTimerSeconds: 90, mode: BIG_TABLE.id } }));
  assert.match(
    html,
    /<button type="button" class="lobby-mode"[^>]*aria-label="Game mode: Big Table, Paired turns\. Room setup"><svg[^]*?<\/svg><span>Big Table <b>Paired<\/b><\/span><\/button>/,
  );
  const older = lobby(
    room(null, { settings: { turnTimerSeconds: 90, mode: BIG_TABLE.id, turns: 'betweenTurnsBuild' } }),
  );
  assert.match(older, /<span>Big Table <b>Build windows<\/b><\/span>/);
  const three = room(null, { settings: { turnTimerSeconds: 90, mode: BIG_TABLE.id } });
  three.players = three.players.slice(0, 3);
  assert.match(lobby(three), /Big Table needs five players/);
  // Five seated and an open sixth place.
  assert.equal([...lobby(room(null)).matchAll(/class="seat-place"/g)].length, 6);
});

test('both marker holders are on turn on the rail, labelled Lead and Partner, with the clock on the one acting', () => {
  const g = partnerPhase();
  const state = room(g, {
    turnClock: { playerId: 'p3', turn: 1, startedAt: 0, deadlineAt: 33_000 },
    serverNow: 1,
  });
  const lead = playerTurnActivity(state.game!, 'p0')!,
    partner = playerTurnActivity(state.game!, 'p3')!;
  assert.equal(lead.marker, 'Lead');
  assert.equal(partner.marker, 'Partner');
  assert.equal(partner.label, 'Partner’s phase: build, buy, trade with the bank, play one card');
  assert.equal(playerTurnActivity(state.game!, 'p1'), null, 'the others hold no marker');
  const html = renderToStaticMarkup(
    createElement(PlayerRail, {
      room: state,
      game: state.game!,
      me: 'p1',
      timer: createElement('span', { className: 'test-timer' }),
    }),
  );
  const card = (id: string) =>
    html.match(new RegExp(`<article data-player-profile="${id}"[^]*?</article>`))![0];
  assert.match(card('p0'), /class="player-profile active /);
  assert.match(card('p3'), /class="player-profile active /);
  assert.ok(!/class="player-profile active /.test(card('p1')));
  assert.match(card('p0'), /<span class="profile-turn-label">Lead<\/span>/);
  assert.match(card('p3'), /<span class="profile-turn-label">Partner<\/span><span class="test-timer">/);
  assert.ok(!card('p0').includes('test-timer'), 'the Lead waits without a clock');
  assert.match(card('p3'), /aria-label="Dan, current turn, Partner"/);
  assert.match(card('p0'), /aria-label="Ann, Lead"/);
  // In the Lead's part the clock is the Lead's.
  const leading = room(roll(afterSetup(5), 3, 5));
  const railLead = renderToStaticMarkup(
    createElement(PlayerRail, { room: leading, game: leading.game!, me: 'p1', timer: createElement('i') }),
  );
  assert.match(railLead, /<span class="profile-turn-label">Lead<\/span><i><\/i>/);
  assert.match(railLead, /<span class="profile-turn-label">Partner<\/span><\/span>/);
});

test('a build window moves the chip along the rail, with no marker, and the clock in its holder’s chip', () => {
  const g = act(roll(afterSetup(5, { turns: 'betweenTurnsBuild' }), 3, 5), 'p0', { kind: 'endTurn' });
  const view = gameView(g, 'p2');
  assert.deepEqual(playerTurnActivity(view, 'p1'), {
    icon: 'settlement',
    label: 'Build window: build or buy, no trading',
  });
  assert.equal(playerTurnActivity(view, 'p0'), null, 'the player whose turn it followed has no window');
  // Everyone else gets no prompt and no cue; the player in the window gets the prompt and no sound.
  assert.equal(requiredAction(view, 'p2'), null);
  assert.equal(requiredAction(gameView(g, 'p1'), 'p1'), null);
  assert.equal(gameStatus(gameView(g, 'p1'), 'p1').prompt, 'Build window: build or buy, no trading');
  assert.equal(gameStatus(view, 'p2').prompt, 'Ben has a build window');
  const state = room(g, {}, 'p1');
  assert.equal(new AttentionTracker().update(state, 'p1', true), null);
});

test('the Partner is prompted and cued, and the clock says whose phase it is', () => {
  const g = partnerPhase();
  const mine = gameView(g, 'p3');
  assert.equal(
    gameStatus(mine, 'p3').prompt,
    'Your Partner’s phase: build, buy, trade with the bank, play one card',
  );
  assert.equal(gameStatus(gameView(g, 'p1'), 'p1').prompt, 'Dan is taking the Partner’s phase');
  assert.equal(requiredAction(mine, 'p3'), 'partner');
  assert.equal(requiredAction(gameView(g, 'p0'), 'p0'), null, 'the Lead is owed nothing');
  assert.equal(new AttentionTracker().update(room(g, {}, 'p3'), 'p3', true), 'turn');
  const clock = (viewer: string) => {
    const state = room(
      g,
      { turnClock: { playerId: 'p3', turn: 1, startedAt: 0, deadlineAt: 33_000 } },
      viewer,
    );
    state.serverNow = 1_000;
    return renderToStaticMarkup(
      createElement(TurnTimer, {
        room: state,
        me: viewer,
        offset: 1_000 - Date.now(),
        connected: true,
        onWarning: noop,
      }),
    );
  };
  assert.match(clock('p3'), /title="Your Partner’s phase: time left"/);
  assert.match(clock('p3'), /<small>Partner<\/small>/);
  assert.match(clock('p1'), /title="Partner’s phase: time left"/);
  const window = act(roll(afterSetup(5, { turns: 'betweenTurnsBuild' }), 3, 5), 'p0', { kind: 'endTurn' });
  const state = room(
    window,
    { turnClock: { playerId: 'p1', turn: 1, startedAt: 0, deadlineAt: 20_000 } },
    'p1',
  );
  const html = renderToStaticMarkup(
    createElement(TurnTimer, {
      room: state,
      me: 'p1',
      offset: -Date.now(),
      connected: true,
      onWarning: noop,
    }),
  );
  assert.match(html, /title="Your build window: time left"/);
  assert.match(html, /<small>Build window<\/small>/);
});

test('the Partner’s trade panel opens on the bank, and says why player trades are off', () => {
  const g = partnerPhase();
  give(g, 'p3', { wood: 4 });
  const html = renderToStaticMarkup(
    createElement(TradePanel, { game: gameView(g, 'p3'), me: 'p3', disabled: false, onAction: noop }),
  );
  assert.match(html, /<button role="tab" aria-selected="true"><svg[^]*?<\/svg>Bank &amp; ports<\/button>/);
  assert.match(html, /<div role="tabpanel" aria-label="Bank and ports" class="bank-trade">/);
  // The bank is open to the Partner: a resource they can give is not greyed out.
  assert.match(html, /aria-label="You give"[^]*?<button[^>]*aria-pressed="false"(?![^>]*disabled)/);
  // In a Lead's part the Partner, like everyone else, trades only in answer to the Lead.
  const lead = roll(afterSetup(5), 3, 5);
  const leading = renderToStaticMarkup(
    createElement(TradePanel, { game: gameView(lead, 'p0'), me: 'p0', disabled: false, onAction: noop }),
  );
  assert.ok(!leading.includes('trade-lock'));
  assert.match(leading, /<button role="tab" aria-selected="true"><svg[^]*?<\/svg>Players<\/button>/);
});

test('card locks say when the Partner may play, and that no card is played in a build window', () => {
  let g = afterSetup(5);
  const card = deal(g, 'p3', 'knight');
  assert.equal(cardLockReason(card, gameView(g, 'p3'), 'p3'), 'You can play this in your Partner’s phase.');
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(cardLockReason(card, gameView(g, 'p3'), 'p3'), null);
  g = act(g, 'p3', { kind: 'playCard', cardId: card.id });
  g = act(
    g,
    'p3',
    timeoutAction(g, 'p3', () => 0.5)!,
  );
  const second = deal(g, 'p3', 'monopoly');
  assert.equal(
    cardLockReason(second, gameView(g, 'p3'), 'p3'),
    'You have already played a development card this phase.',
  );
  let w = afterSetup(5, { turns: 'betweenTurnsBuild' });
  const held = deal(w, 'p1', 'knight');
  w = act(roll(w, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(
    cardLockReason(held, gameView(w, 'p1'), 'p1'),
    'No development card is played in a build window.',
  );
});

test('a site picked in the Partner’s phase or a build window stays valid to confirm', () => {
  const g = partnerPhase();
  give(g, 'p3', { wood: 1, brick: 1 });
  const view = gameView(g, 'p3');
  const draft = {
    action: { kind: 'road' as const, edge: view.legal.roads[0]! },
    roomId: 'ABCDEFG2',
    player: 'p3',
    turn: view.turn,
    phase: view.phase,
    setupIndex: view.setupIndex,
  };
  assert.ok(placementValid(draft, view, 'ABCDEFG2', 'p3'));
  assert.ok(!placementValid(draft, gameView(g, 'p0'), 'ABCDEFG2', 'p0'));
});

test('history names the new situations, and the results name the mode and its turn style', () => {
  const names = NAMES.slice(0, 5);
  const text = (line: string) =>
    renderToStaticMarkup(createElement('p', null, ...historyTokens(line, names)));
  assert.match(
    text("Ann's turn, with Dan as Partner."),
    /<strong class="journal-person">Ann<\/strong>&#x27;s turn, with <strong class="journal-person">Dan<\/strong> as Partner\./,
  );
  assert.match(
    text("Dan begins the Partner's phase."),
    /^<p><strong class="journal-person">Dan<\/strong> begins/,
  );
  assert.match(
    text("Ben's build window."),
    /^<p><strong class="journal-person">Ben<\/strong>&#x27;s build window/,
  );
  assert.match(
    text('Dan wins as Partner with 10 points!'),
    /^<p><strong class="journal-person">Dan<\/strong> wins/,
  );
  // Results carry the mode and its turn style, and a Classic game's carry neither.
  let g = afterSetup(5, { victoryPoints: 8 });
  g.players[3]!.cards.push(
    ...Array.from({ length: 8 }, (_, i) => ({ id: `vp-${i}`, kind: 'victoryPoint' as const, boughtTurn: 0 })),
  );
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(g.winner, 'p3');
  const state = room(g);
  const results = resultsFromRoom(state);
  assert.equal(results.game.ruleset, BIG_TABLE.id);
  assert.equal(results.game.turns, 'paired');
  const html = renderToStaticMarkup(
    createElement(GameOver, { room: state, busy: false, canReturn: true, onReturn: noop, onQuit: noop }),
  );
  assert.match(html, /<div><dt>Mode<\/dt><dd>Big Table · Paired turns<\/dd><\/div><div><dt>Turns<\/dt>/);
  const classic = resultsFromRoom({
    ...state,
    game: { ...state.game!, ruleset: CLASSIC.id, turns: undefined },
  });
  assert.equal('ruleset' in classic.game, false);
  assert.equal('turns' in classic.game, false);
});

test('the quick rules explain the table’s turn structure in a few plain lines', () => {
  const paired = renderToStaticMarkup(createElement(QuickRules, { ruleset: BIG_TABLE }));
  assert.match(paired, /<span>Big Table<\/span>/);
  assert.match(paired, /Five or six play\. Each turn has a <b>Lead<\/b>/);
  assert.match(paired, /The Partner never rolls and never trades with players\./);
  const build = renderToStaticMarkup(
    createElement(QuickRules, { ruleset: BIG_TABLE, turns: 'betweenTurnsBuild' }),
  );
  assert.match(build, /everyone else in order gets 20 seconds to build and buy/);
  assert.ok(!renderToStaticMarkup(createElement(QuickRules, { ruleset: CLASSIC })).includes('Lead'));
});
