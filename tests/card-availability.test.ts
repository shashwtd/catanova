import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_LORE, DEVELOPMENT_ART_INDEX, cardLockReason } from '../apps/client/src/cards.js';
import { DevelopmentCards, developmentStacks } from '../apps/client/src/DevelopmentCards.js';
import { ResourceHand } from '../apps/client/src/ResourceHand.js';
import { activePlayer, applyAction, createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Card, Game, GameView } from '../packages/rules/src/game.js';
import { DEVELOPMENT_DECK, RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';

function setup(): Game {
  let game = createGame(
    ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name })),
    82,
    () => 0.34,
  );
  while (!game.turn) {
    const player = activePlayer(game),
      legal = gameView(game, player.id).legal;
    game = applyAction(
      game,
      player.id,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.34,
    );
  }
  return game;
}
function ownCards(game: GameView) {
  return game.players.find((p) => p.id === 'p0')!.cards!;
}

test('a new development card explains its next-turn lock and becomes playable on its owner’s next actual turn', () => {
  let game = setup();
  const fresh: Card = { id: 'new-knight', kind: 'knight', boughtTurn: game.turn };
  game.players[0]!.cards = [fresh];
  let view = gameView(game, 'p0');
  assert.equal(cardLockReason(ownCards(view)[0]!, view, 'p0'), 'You can play this on your next turn.');
  assert.ok(!view.legal.playableCards.includes(fresh.id));
  for (let n = 0; n < 3; n++) {
    game = applyAction(game, activePlayer(game).id, { kind: 'roll' }, () => 0.34);
    game = applyAction(game, activePlayer(game).id, { kind: 'endTurn' }, () => 0.34);
    view = gameView(game, 'p0');
    if (n < 2)
      assert.equal(cardLockReason(ownCards(view)[0]!, view, 'p0'), 'You can play this on your turn.');
  }
  assert.equal(game.turn, 4);
  assert.equal(game.phase, 'roll');
  assert.equal(activePlayer(game).id, 'p0');
  assert.equal(cardLockReason(ownCards(view)[0]!, view, 'p0'), null);
  assert.equal(applyAction(game, 'p0', { kind: 'playCard', cardId: fresh.id }, () => 0.34).phase, 'robber');
});

test('held cards distinguish an already-used development turn, a mandatory choice, victory points and the end of a game', () => {
  const game = setup();
  const old: Card = { id: 'old-knight', kind: 'knight', boughtTurn: 0 };
  const point: Card = { id: 'new-point', kind: 'victoryPoint', boughtTurn: game.turn };
  game.players[0]!.cards = [old, point];
  let view = gameView(game, 'p0');
  assert.equal(cardLockReason(point, view, 'p0'), 'Already counts toward your victory points.');
  assert.equal(view.players[0]!.points, 3);
  assert.ok(!view.legal.playableCards.includes(point.id));
  assert.equal(cardLockReason(old, view, 'p0'), null);
  game.playedCard = true;
  view = gameView(game, 'p0');
  assert.equal(cardLockReason(old, view, 'p0'), 'You have already played a development card this turn.');
  game.playedCard = false;
  game.phase = 'robber';
  view = gameView(game, 'p0');
  assert.equal(cardLockReason(old, view, 'p0'), 'Finish the current action first.');
  game.winner = 'p1';
  game.phase = 'finished';
  view = gameView(game, 'p0');
  assert.equal(cardLockReason(old, view, 'p0'), 'The game has ended.');
  assert.equal(cardLockReason(point, view, 'p0'), 'Already counts toward your victory points.');
});

test('Road Building and Year of Plenty explain unavailable inventory instead of advertising an illegal play', () => {
  const game = setup();
  const roads: Card = { id: 'old-roads', kind: 'roadBuilding', boughtTurn: 0 };
  const plenty: Card = { id: 'old-plenty', kind: 'yearOfPlenty', boughtTurn: 0 };
  game.players[0]!.cards = [roads, plenty];
  const available = gameView(game, 'p0');
  assert.equal(cardLockReason(roads, available, 'p0'), null);
  assert.equal(cardLockReason(plenty, available, 'p0'), null);
  const exhaustedPieces = structuredClone(available);
  exhaustedPieces.players[0]!.pieces.roads = 15;
  assert.match(cardLockReason(roads, exhaustedPieces, 'p0')!, /available road piece/);
  const noConnection = structuredClone(available);
  noConnection.buildings = {};
  noConnection.roads = {};
  assert.match(cardLockReason(roads, noConnection, 'p0')!, /legal road connection/);
  const emptyBank = structuredClone(available);
  emptyBank.bank = emptyHand();
  assert.equal(cardLockReason(plenty, emptyBank, 'p0'), 'The bank has no resource cards to take.');
  emptyBank.bank.ore = 1;
  assert.equal(cardLockReason(plenty, emptyBank, 'p0'), null, 'the last bank resource may still be taken');
});

test('resource cards keep accessible names without visible labels or hover popups; empty cards remain static', () => {
  const hand = { ...emptyHand(), wood: 2, wheat: 1 };
  const html = renderToStaticMarkup(
    createElement(ResourceHand, { hand, pulse: {}, reducedMotion: false, onHover: () => {} }),
  );
  assert.equal([...html.matchAll(/data-resource-card=/g)].length, 5);
  assert.equal([...html.matchAll(/class="[^"]*\bempty-card\b/g)].length, 3);
  assert.equal([...html.matchAll(/class="[^"]*\bstatic-card\b/g)].length, 3);
  assert.equal([...html.matchAll(/role="tooltip"/g)].length, 0);
  assert.equal([...html.matchAll(/aria-describedby=/g)].length, 0);
  for (const resource of RESOURCES) {
    assert.ok(html.includes(RESOURCE_NAMES[resource]));
    assert.ok(html.includes(`aria-label="${hand[resource]} ${RESOURCE_NAMES[resource]}"`));
    assert.ok(!html.includes(`>${RESOURCE_NAMES[resource]}<`));
  }
  assert.ok(!html.includes('opacity:0'));
});

test('development spread displays local card art, playable/held status and readable lore without opponent faces', () => {
  const game = setup();
  game.players[0]!.cards = [
    { id: 'old-knight', kind: 'knight', boughtTurn: 0 },
    { id: 'new-plenty', kind: 'yearOfPlenty', boughtTurn: 1 },
    { id: 'point', kind: 'victoryPoint', boughtTurn: 1 },
  ];
  game.players[1]!.cards = [{ id: 'private-other-card', kind: 'monopoly', boughtTurn: 0 }];
  const html = renderToStaticMarkup(
    createElement(DevelopmentCards, {
      game: gameView(game, 'p0'),
      me: 'p0',
      disabled: false,
      reducedMotion: true,
      onAction: () => {},
      onClose: () => {},
      onHover: () => {},
    }),
  );
  assert.equal([...html.matchAll(/class="development-card /g)].length, 3);
  assert.equal([...html.matchAll(/class="[^"]*\bplayable-card\b/g)].length, 1);
  assert.equal([...html.matchAll(/class="[^"]*\bresting-card\b/g)].length, 2);
  assert.ok(html.includes('You can play this on your next turn.'));
  assert.ok(html.includes('Already counts toward your victory points.'));
  assert.ok(html.includes('+1 point'));
  assert.ok(html.includes('/art/development-cards.png'));
  assert.ok(!html.includes('Monopoly') && !html.includes('private-other-card'));
  assert.equal(new Set(Object.values(DEVELOPMENT_ART_INDEX)).size, 5);
  for (const kind of Object.keys(DEVELOPMENT_DECK) as (keyof typeof DEVELOPMENT_DECK)[]) {
    assert.ok(CARD_LORE[kind].effect.length > 15);
    assert.ok(CARD_LORE[kind].story.length > 20);
    assert.ok(DEVELOPMENT_ART_INDEX[kind] >= 0 && DEVELOPMENT_ART_INDEX[kind] < 5);
  }
});

test('resource hover audio works with reduced motion and stays silent for empty cards and touch', () => {
  let sounds = 0;
  const hand = { ...emptyHand(), wood: 2 };
  for (const reducedMotion of [false, true]) {
    const cards = ResourceHand({ hand, pulse: {}, reducedMotion, onHover: () => sounds++ }).props
      .children as Array<
      ReactElement<{ children: ReactElement<{ onPointerEnter: (event: { pointerType: string }) => void }> }>
    >;
    const wood = cards[0]!.props.children.props.onPointerEnter;
    const clay = cards[1]!.props.children.props.onPointerEnter;
    const before = sounds;
    wood({ pointerType: 'mouse' });
    assert.equal(sounds, before + 1, 'positive resource cards keep audio independent of motion');
    clay({ pointerType: 'mouse' });
    wood({ pointerType: 'touch' });
    assert.equal(sounds, before + 1, 'empty cards and touch do not play a hover cue');
  }
});

test('development purchase is a separate buy slot with a visible three-resource price and legal disabled state', () => {
  const view = gameView(setup(), 'p0');
  const render = (canBuy: boolean) =>
    renderToStaticMarkup(
      createElement(DevelopmentCards, {
        game: view,
        me: 'p0',
        disabled: false,
        reducedMotion: false,
        onAction: () => {},
        onHover: () => {},
        onBuy: () => {},
        canBuy,
      }),
    );
  const enabled = render(true);
  assert.match(enabled, /aria-label="Buy development card · 1 Sheep, 1 Hay, 1 Rock"/);
  assert.match(enabled, /class="development-buy-label">Buy<\/span>/);
  for (const resource of ['sheep', 'wheat', 'ore'])
    assert.match(enabled, new RegExp(`data-cost-resource="${resource}"`));
  assert.ok(
    !enabled.includes('/art/development-cards.png'),
    'the purchase slot cannot masquerade as a held illustrated card',
  );
  assert.ok(!enabled.includes('class="development-card '));
  assert.ok(!/<button class="development-buy"[^>]*disabled/.test(enabled));
  assert.match(render(false), /<button class="development-buy"[^>]*disabled/);
});

test('identical cards share a stack that chooses an eligible old copy before a fresh copy', () => {
  const game = setup();
  game.players[0]!.cards = [
    { id: 'new-knight', kind: 'knight', boughtTurn: 1 },
    { id: 'old-knight-a', kind: 'knight', boughtTurn: 0 },
    { id: 'old-knight-b', kind: 'knight', boughtTurn: 0 },
    { id: 'new-plenty', kind: 'yearOfPlenty', boughtTurn: 1 },
    { id: 'point-a', kind: 'victoryPoint', boughtTurn: 1 },
    { id: 'point-b', kind: 'victoryPoint', boughtTurn: 0 },
  ];
  const view = gameView(game, 'p0'),
    before = structuredClone(view);
  const stacks = developmentStacks(ownCards(view), view, 'p0');
  assert.equal(stacks.length, 3);
  const knights = stacks.find((stack) => stack.card.kind === 'knight')!;
  assert.equal(knights.card.id, 'old-knight-a');
  assert.equal(knights.count, 3);
  assert.equal(knights.ready, 2);
  assert.equal(knights.fresh, 1);
  const points = stacks.find((stack) => stack.card.kind === 'victoryPoint')!;
  assert.equal(points.count, 2);
  assert.equal(points.ready, 0);
  assert.equal(points.fresh, 0, 'victory points count immediately, even when freshly bought');
  assert.deepEqual(view, before, 'grouping never changes the installed private hand');
  const afterPlay = applyAction(game, 'p0', { kind: 'playCard', cardId: knights.card.id }, () => 0.34);
  const afterView = gameView(afterPlay, 'p0');
  const held = developmentStacks(ownCards(afterView), afterView, 'p0').find(
    (stack) => stack.card.kind === 'knight',
  )!;
  assert.equal(held.count, 2);
  assert.equal(held.ready, 0, 'the other old copy cannot bypass one development play per turn');
  assert.equal(held.fresh, 1);
  assert.ok(!ownCards(afterView).some((card) => card.id === 'old-knight-a'));
  assert.ok(ownCards(afterView).some((card) => card.id === 'new-knight'));
});

test('a full development deck takes at most five visible slots, with truthful grouped counts and next-turn status', () => {
  const game = setup();
  game.players[0]!.cards = Object.entries(DEVELOPMENT_DECK).flatMap(([kind, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${kind}-${i}`,
      kind: kind as Card['kind'],
      boughtTurn: i === 0 ? game.turn : 0,
    })),
  );
  game.deck = [];
  const view = gameView(game, 'p0'),
    stacks = developmentStacks(ownCards(view), view, 'p0');
  assert.equal(ownCards(view).length, 25);
  assert.equal(stacks.length, 5);
  assert.equal(
    stacks.reduce((n, stack) => n + stack.count, 0),
    25,
  );
  const html = renderToStaticMarkup(
    createElement(DevelopmentCards, {
      game: view,
      me: 'p0',
      disabled: false,
      reducedMotion: true,
      onAction: () => {},
      onClose: () => {},
      onHover: () => {},
    }),
  );
  assert.equal([...html.matchAll(/class="development-card /g)].length, 5);
  assert.match(html, /Knight × 14/);
  assert.match(html, /14 cards · 13 playable · 1 next turn/);
  assert.match(html, /Victory Point × 5/);
});
