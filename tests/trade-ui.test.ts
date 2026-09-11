import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BankTrade, TradePanel, IncomingTrade } from '../apps/client/src/TradePanel.js';
import { ResourcePicker, ResourceChoice } from '../apps/client/src/ResourcePicker.js';
import { MoveHistory, historyTokens, historyTurns } from '../apps/client/src/MoveHistory.js';
import { activePlayer, applyAction, createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction, GameView, Hand } from '../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';
import type { HistoryEntry } from '../packages/protocol/src/index.js';

const hand = (values: Partial<Hand>): Hand => ({ ...emptyHand(), ...values });
const move = (game: Game, action: GameAction, player = 'p0') => applyAction(game, player, action, () => 0.34);
function setup() {
  let game = createGame(
    ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name })),
    82,
    () => 0.34,
  );
  while (!game.turn) {
    const player = activePlayer(game),
      legal = gameView(game, player.id).legal;
    game = move(
      game,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      player.id,
    );
  }
  for (const player of game.players)
    for (const resource of RESOURCES) {
      game.bank[resource] += player.hand[resource];
      player.hand[resource] = 0;
    }
  const hands = [hand({ wood: 3 }), hand({ sheep: 3, ore: 7 }), hand({ wheat: 2 })];
  game.players.forEach((player, i) => {
    player.hand = hands[i]!;
    for (const resource of RESOURCES) game.bank[resource] -= player.hand[resource];
  });
  game.phase = 'actions';
  return game;
}
function buttons(html: string) {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}
const text = (html: string) => html.replace(/<[^>]*>/g, '').trim();
function button(html: string, label: string) {
  const found = buttons(html).find(
    (candidate) => text(candidate) === label || candidate.includes(`aria-label="${label}"`),
  );
  assert.ok(found, `Missing button: ${label}`);
  return found;
}
const panel = (game: GameView, me: string, disabled = false) =>
  renderToStaticMarkup(createElement(TradePanel, { game, me, disabled, onAction: () => {} }));
const incoming = (game: GameView, me: string, disabled = false) =>
  renderToStaticMarkup(createElement(IncomingTrade, { game, me, disabled, onAction: () => {} }));

test('resource selection uses labeled card and minus buttons, respects inventory limits, and has no native number or select editors', () => {
  const html = renderToStaticMarkup(
    createElement(ResourcePicker, {
      value: hand({ wood: 1 }),
      max: hand({ wood: 1, sheep: 2 }),
      label: 'You give',
      onChange: () => {},
    }),
  );
  assert.ok(!/<input\b|<select\b|type="number"/.test(html));
  assert.equal(buttons(html).length, 10);
  for (const resource of RESOURCES) {
    assert.ok(
      button(html, `Add ${RESOURCE_NAMES[resource]} to You give; ${resource === 'wood' ? 1 : 0} selected`),
    );
    assert.ok(button(html, `Remove ${RESOURCE_NAMES[resource]} from You give`));
  }
  assert.ok(button(html, 'Add Timber to You give; 1 selected').includes('disabled=""'));
  assert.ok(button(html, 'Add Clay to You give; 0 selected').includes('disabled=""'));
  assert.ok(!button(html, 'Add Sheep to You give; 0 selected').includes('disabled=""'));
  assert.ok(!button(html, 'Remove Timber from You give').includes('disabled=""'));
  assert.ok(button(html, 'Remove Sheep from You give').includes('disabled=""'));
  const locked = renderToStaticMarkup(
    createElement(ResourcePicker, {
      value: emptyHand(),
      label: 'You give',
      disabled: true,
      onChange: () => {},
    }),
  );
  assert.match(locked, /<fieldset[^>]*disabled=""/);
  const choices = renderToStaticMarkup(
    createElement(ResourceChoice, {
      value: 'wood',
      label: 'Give',
      amount: () => 4,
      unavailable: ['ore'],
      onChange: () => {},
    }),
  );
  assert.equal(buttons(choices).length, 5);
  assert.ok(!/<input\b|<select\b/.test(choices));
  assert.ok(button(choices, 'Give 4 Timber').includes('aria-pressed="true"'));
  assert.ok(button(choices, 'Give 4 Rock').includes('disabled=""'));
});

test('trade creation locks while another player is active or the game is waiting on another phase', () => {
  const game = setup();
  for (const [viewer, phase, disabled] of [
    ['p1', 'actions', false],
    ['p0', 'roll', false],
    ['p0', 'actions', true],
  ] as const) {
    const view = gameView(game, viewer);
    view.phase = phase;
    const html = panel(view, viewer, disabled);
    assert.ok(button(html, 'Offer trade').includes('disabled=""'));
    assert.ok(button(html, '?Open to offers').includes('disabled=""'));
    assert.equal([...html.matchAll(/<fieldset[^>]*disabled=""/g)].length, 2);
  }
  const own = panel(gameView(game, 'p0'), 'p0');
  assert.ok(!button(own, '?Open to offers').includes('disabled=""'));
  assert.ok(button(own, 'Offer trade').includes('disabled=""'), 'an empty draft cannot be submitted');
});

test('the maker sees only offered proposal cards and can accept only while active, connected and able to pay', () => {
  let game = move(setup(), { kind: 'openTrade', give: hand({ wood: 2 }) });
  const tradeId = game.trade!.id;
  game = move(game, { kind: 'proposeTrade', tradeId, give: hand({ sheep: 1 }) }, 'p1');
  game = move(game, { kind: 'proposeTrade', tradeId, give: hand({ wheat: 1 }) }, 'p2');
  const view = gameView(game, 'p0'),
    html = panel(view, 'p0');
  assert.ok(!button(html, 'Accept Bob&#x27;s offer').includes('disabled=""'));
  assert.ok(!button(html, 'Accept Cara&#x27;s offer').includes('disabled=""'));
  assert.match(html, /aria-label="1 Sheep"/);
  assert.match(html, /aria-label="1 Hay"/);
  assert.ok(!html.includes('aria-label="7 Rock"'));
  assert.equal(view.players[1]!.hand, undefined);
  assert.equal(view.players[2]!.hand, undefined);
  for (const next of [view, { ...view, phase: 'roll' as const }]) {
    const markup = panel(next, 'p0', next === view);
    assert.ok(button(markup, 'Accept Bob&#x27;s offer').includes('disabled=""'));
  }
  const depleted = structuredClone(view);
  depleted.players[0]!.hand!.wood = 0;
  assert.ok(button(panel(depleted, 'p0'), 'Accept Bob&#x27;s offer').includes('disabled=""'));
  assert.ok(!panel(gameView(game, 'p1'), 'p1').includes('Accept Bob'));
});

test('specific incoming offers require the local payment and disappear when the offer or action phase ends', () => {
  const game = move(setup(), { kind: 'offerTrade', give: hand({ wood: 2 }), want: hand({ sheep: 1 }) });
  const view = gameView(game, 'p1');
  assert.ok(!button(incoming(view, 'p1'), 'Accept trade').includes('disabled=""'));
  assert.ok(button(incoming(view, 'p1', true), 'Accept trade').includes('disabled=""'));
  const depleted = structuredClone(view);
  depleted.players[1]!.hand!.sheep = 0;
  assert.ok(button(incoming(depleted, 'p1'), 'Accept trade').includes('disabled=""'));
  assert.equal(incoming(gameView(game, 'p0'), 'p0'), '');
  assert.equal(incoming(gameView(move(game, { kind: 'endTurn' }), 'p1'), 'p1'), '');
  assert.equal(incoming({ ...view, phase: 'robber' }, 'p1'), '');
  assert.equal(incoming({ ...view, trade: null }, 'p1'), '');
  assert.equal(
    incoming({ ...view, active: 2 }, 'p1'),
    '',
    'a cached offer from another turn is not actionable',
  );
});

test('unknown offers invite proposals instead of gifting cards and show only the local public proposal when restored', () => {
  let game = move(setup(), { kind: 'openTrade', give: hand({ wood: 2 }) });
  const tradeId = game.trade!.id;
  assert.ok(!incoming(gameView(game, 'p1'), 'p1').includes('Accept trade'));
  assert.ok(!button(incoming(gameView(game, 'p1'), 'p1'), 'Make an offer').includes('disabled=""'));
  assert.ok(button(incoming(gameView(game, 'p1'), 'p1', true), 'Make an offer').includes('disabled=""'));
  game = move(game, { kind: 'proposeTrade', tradeId, give: hand({ sheep: 1 }) }, 'p1');
  game = move(game, { kind: 'proposeTrade', tradeId, give: hand({ wheat: 1 }) }, 'p2');
  const html = incoming(gameView(game, 'p1'), 'p1');
  assert.ok(button(html, 'Change offer'));
  assert.ok(button(html, 'Withdraw'));
  assert.match(html, /aria-label="1 Sheep"/);
  assert.ok(!html.includes('aria-label="7 Rock"') && !html.includes('aria-label="1 Hay"'));
  const withdrawn = move(game, { kind: 'withdrawProposal', tradeId }, 'p1');
  assert.ok(button(incoming(gameView(withdrawn, 'p1'), 'p1'), 'Make an offer'));
});

const entry = (revision: number, turn: number, kind: string, lines: string[]): HistoryEntry => ({
  revision,
  turn,
  kind,
  lines,
  actor: 'p0',
  at: '2026-09-09T00:00:00.000Z',
});
test('history groups committed moves by turn, deduplicates pages and hides technical revisions', () => {
  const entries = [
    entry(904, 2, 'roll', ['Alice rolled 3 + 4 = 7.']),
    entry(901, 1, 'openTrade', ['Alice offered 2 Timber and invited trade proposals.']),
    entry(902, 1, 'proposeTrade', ["Bob proposed 1 Sheep for Alice's 2 Timber."]),
    entry(901, 1, 'openTrade', ['Alice offered 2 Timber and invited trade proposals.']),
    entry(900, 0, 'start', ['The island is ready.']),
  ];
  assert.deepEqual(
    historyTurns(entries).map((group) => ({
      turn: group.turn,
      revisions: group.moves.map((move) => move.revision),
    })),
    [
      { turn: 2, revisions: [904] },
      { turn: 1, revisions: [902, 901] },
      { turn: 0, revisions: [900] },
    ],
  );
  const html = renderToStaticMarkup(
    createElement(MoveHistory, {
      entries,
      game: gameView(setup(), 'p0'),
      hasMore: true,
      onEarlier: () => {},
    }),
  );
  assert.equal([...html.matchAll(/class="journal-turn"/g)].length, 3);
  assert.equal([...html.matchAll(/class="journal-move"/g)].length, 4);
  assert.match(html, /<h3>Turn 2<\/h3>/);
  assert.match(html, /<h3>Turn 1<\/h3>/);
  assert.match(html, /<h3>Island setup<\/h3>/);
  assert.ok(!/revision|#90[0-4]|\b90[0-4]\b/i.test(text(html)));
  assert.ok(button(html, 'Earlier turns'));
});

test('history keeps resource-like player names literal without matching their text inside other words or payments', () => {
  const render = (line: string, names: string[]) =>
    renderToStaticMarkup(createElement(Fragment, null, ...historyTokens(line, names)));
  const resourceNamed = render('2 Timber traded 1 Sheep to Bob for 2 Timber.', ['2 Timber', 'Bob']);
  assert.match(resourceNamed, /class="journal-person">2 Timber<\/strong>/);
  assert.equal(
    [...resourceNamed.matchAll(/class="journal-person"/g)].length,
    2,
    'only the actual maker and recipient are player-name spans',
  );
  assert.match(resourceNamed, /class="journal-resource"[^>]*aria-label="2 Timber"/);
  const oneLetter = render('r built a road.', ['r', 'Alice']);
  assert.equal(
    [...oneLetter.matchAll(/class="journal-person"/g)].length,
    1,
    'r inside road is not a player reference',
  );
  assert.match(oneLetter, /class="journal-item"[^>]*aria-label="road"/);
  const escaped = render('A.* traded 1 Sheep to <Bob> for 1 Hay.', ['A.*', '<Bob>']);
  assert.match(escaped, />A\.\*<\/strong>/);
  assert.match(escaped, />&lt;Bob&gt;<\/strong>/);
  assert.ok(!escaped.includes('<Bob>'));
  const proposed = render("Alice proposed 1 Sheep for 2 Timber's 2 Timber.", ['Alice', '2 Timber']);
  assert.equal([...proposed.matchAll(/class="journal-person"/g)].length, 2);
  assert.equal([...proposed.matchAll(/class="journal-resource"/g)].length, 2);
  const stolen = render('Alice moved the robber and stole a card from 1 Sheep.', ['Alice', '1 Sheep']);
  assert.equal([...stolen.matchAll(/class="journal-person"/g)].length, 2);
  assert.ok(
    !stolen.includes('journal-resource'),
    'a victim named like a resource must not imply the stolen card type',
  );
  const emptyVictim = render('Alice moved the robber. 1 Sheep had no resource cards.', ['Alice', '1 Sheep']);
  assert.equal([...emptyVictim.matchAll(/class="journal-person"/g)].length, 2);
  assert.ok(!emptyVictim.includes('journal-resource'));
});

test('history replacement icons retain accessible names for piece and development actions', () => {
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      ...historyTokens('Alice built a road and bought a development card.', ['Alice']),
    ),
  );
  for (const label of ['road', 'development card']) {
    const token = html.match(
      new RegExp(`<span[^>]*class="journal-item"[^>]*aria-label="${label}"[^>]*>`),
    )?.[0];
    assert.ok(
      token && token.includes('role="img"'),
      `${label} needs a semantic accessible wrapper around its decorative icon`,
    );
  }
});

function side(html: string, label: 'You give' | 'You get') {
  return [
    ...html.matchAll(new RegExp(`<section[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</section>`, 'g')),
  ].map((match) => match[1]!);
}
test('exact and open trade summaries consistently use the viewer’s give/get perspective', () => {
  let game = move(setup(), { kind: 'offerTrade', give: hand({ wood: 2 }), want: hand({ sheep: 1 }) });
  const maker = panel(gameView(game, 'p0'), 'p0');
  const responder = incoming(gameView(game, 'p1'), 'p1');
  assert.match(side(maker, 'You give')[0]!, /aria-label="2 Timber"/);
  assert.match(side(maker, 'You get')[0]!, /aria-label="1 Sheep"/);
  assert.match(side(responder, 'You give')[0]!, /aria-label="1 Sheep"/);
  assert.match(side(responder, 'You get')[0]!, /aria-label="2 Timber"/);
  assert.ok(button(responder, 'Decline'));
  assert.ok(button(incoming(gameView(game, 'p1'), 'p1', true), 'Decline').includes('disabled=""'));
  game = move(game, { kind: 'openTrade', give: hand({ wood: 2 }) });
  const tradeId = game.trade!.id;
  game = move(game, { kind: 'proposeTrade', tradeId, give: hand({ sheep: 1 }) }, 'p1');
  const reply = incoming(gameView(game, 'p1'), 'p1');
  assert.match(side(reply, 'You give')[0]!, /aria-label="1 Sheep"/);
  assert.match(side(reply, 'You get')[0]!, /aria-label="2 Timber"/);
  const offers = panel(gameView(game, 'p0'), 'p0');
  assert.match(side(offers, 'You give')[1]!, /aria-label="2 Timber"/);
  assert.match(side(offers, 'You get')[1]!, /aria-label="1 Sheep"/);
  game = move(game, { kind: 'declineTrade', tradeId }, 'p1');
  assert.equal(incoming(gameView(game, 'p1'), 'p1'), '', 'declined offer must stay hidden from that player');
  assert.match(panel(gameView(game, 'p0'), 'p0'), /Bob declined/);
  assert.ok(
    button(incoming(gameView(game, 'p2'), 'p2'), 'Make an offer'),
    'another player can still respond',
  );
});

test('bank trade clearly previews the local payment and return, with no number spinners or off-turn selection', () => {
  const game = setup();
  const view = gameView(game, 'p0');
  const render = (game: GameView, disabled = false) =>
    renderToStaticMarkup(createElement(BankTrade, { game, me: 'p0', disabled, onAction: () => {} }));
  const html = render(view);
  assert.match(side(html, 'You give')[0]!, new RegExp(`aria-label="${view.legal.rates.wood} Timber"`));
  assert.match(side(html, 'You get')[0]!, /aria-label="1 Clay"/);
  assert.ok(!/<input\b|<select\b|type="number"/.test(html));
  for (const markup of [render(view, true), render({ ...view, active: 1 })]) {
    assert.ok(
      buttons(markup).every((candidate) => candidate.includes('disabled=""')),
      'bank choices and commit all lock',
    );
  }
});
