import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, gameView } from '../packages/rules/src/game.js';
import {
  PLAY_STYLES,
  STYLE_ARCHETYPE,
  decide,
  initialPlan,
  observe,
  parseStandInStyle,
  profileStyle,
  styleFromRecord,
} from '../packages/bot/src/index.js';
import { JevUnavailable } from '../packages/bot/src/jev.js';
import type { Observation } from '../packages/bot/src/index.js';

const seats = [
  { id: 'gone', name: 'Gone' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];
function position() {
  const game = createGame(seats, 11, () => 0.34);
  game.phase = 'actions';
  game.active = 0;
  game.turn = 9;
  return game;
}

test('the record a stand-in reads is only what the player put on the board', () => {
  const game = position();
  game.buildings[0] = { player: 'gone', kind: 'settlement' };
  game.buildings[5] = { player: 'gone', kind: 'city' };
  game.buildings[9] = { player: 'b', kind: 'settlement' };
  game.players[0]!.knights = 3;
  game.players[0]!.cards = [{ id: 'x', kind: 'victoryPoint', boughtTurn: 2 }];
  const seen = observe(gameView(game, 'gone'), game.board, 'gone')!;
  assert.equal(seen.settlements, 1);
  assert.equal(seen.cities, 1);
  assert.equal(seen.knights_played, 3);
  // How many cards, never which: the count is on every portrait already.
  assert.equal(seen.development_cards_held, 1);
  assert.ok(!JSON.stringify(seen).includes('victoryPoint'));
  // And nothing about anybody's hand.
  assert.ok(!Object.keys(seen).some((key) => /hand|resource/.test(key)), Object.keys(seen).join(','));
  assert.equal(observe(gameView(game, 'gone'), game.board, 'nobody'), null);
});

test('the record alone answers the question when nothing else can', () => {
  const base: Observation = {
    settlements: 1,
    cities: 0,
    roads: 2,
    longest_run: 2,
    longest_run_on_the_board: 4,
    holds_longest_road: false,
    knights_played: 0,
    most_knights_played: 1,
    holds_largest_army: false,
    development_cards_held: 0,
    harbours: [],
    points: 2,
    turns_played: 9,
  };
  assert.equal(styleFromRecord({ ...base, holds_largest_army: true }), 'soldier');
  assert.equal(styleFromRecord({ ...base, knights_played: 3 }), 'soldier');
  assert.equal(styleFromRecord({ ...base, holds_longest_road: true }), 'roadwarden');
  assert.equal(styleFromRecord({ ...base, longest_run: 6 }), 'roadwarden');
  assert.equal(styleFromRecord({ ...base, harbours: ['ore', 'any'] }), 'trader');
  assert.equal(styleFromRecord({ ...base, cities: 2 }), 'opportunist');
  assert.equal(styleFromRecord({ ...base, settlements: 3 }), 'builder');
  assert.equal(styleFromRecord({ ...base, roads: 6 }), 'builder');
  assert.equal(styleFromRecord(base), 'opportunist');
});

test('the model picks from the five and can never invent a sixth', async () => {
  const game = position();
  game.buildings[0] = { player: 'gone', kind: 'settlement' };
  const ask = (answer: unknown, contesting = 0.9) =>
    profileStyle({
      view: gameView(game, 'gone'),
      board: game.board,
      playerId: 'gone',
      jev: {
        model: 'test',
        async evaluate() {
          return {
            answers: {
              ...(answer === undefined
                ? {}
                : { style: { type: 'choice', choice: answer, probabilities: {}, confidence: 1 } }),
              contesting: { type: 'noul', probability: contesting, confidence: 1 },
            },
            inputTokens: 120,
            costUsd: 0.004,
          };
        },
      } as never,
    });
  const chosen = await ask('roadwarden');
  assert.equal(chosen!.style.style, 'roadwarden');
  assert.equal(chosen!.style.contesting, true);
  assert.equal(chosen!.style.inferred, undefined);
  assert.equal(chosen!.calls, 1);
  assert.equal(chosen!.tokens, 120);
  // Anything that is not one of the five is not an answer, and the record's own
  // reading is used instead — said so, rather than passed off as a reading.
  for (const nonsense of ['aggressive', '', 'ROADWARDEN', 42, undefined])
    assert.equal((await ask(nonsense))!.style.inferred, true, String(nonsense));
  assert.equal((await ask('trader', 0.2))!.style.contesting, false);
});

test('an unreachable service still produces a stand-in, marked as a guess', async () => {
  const game = position();
  game.players[0]!.knights = 4;
  const profiled = await profileStyle({
    view: gameView(game, 'gone'),
    board: game.board,
    playerId: 'gone',
    jev: {
      model: 'test',
      async evaluate() {
        throw new JevUnavailable('offline');
      },
    } as never,
  });
  assert.deepEqual(profiled, {
    style: { style: 'soldier', contesting: false, inferred: true },
    calls: 0,
    tokens: 0,
    costUsd: 0,
  });
  // No service configured at all lands in exactly the same place.
  const none = await profileStyle({
    view: gameView(game, 'gone'),
    board: game.board,
    playerId: 'gone',
    jev: null,
  });
  assert.equal(none!.style.style, 'soldier');
  assert.equal(none!.calls, 0);
});

test('a stand-in is asked to finish the game it inherited, not to start a new one', async () => {
  const game = position();
  game.buildings[0] = { player: 'gone', kind: 'settlement' };
  game.players[0]!.hand = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
  let asked: Record<string, { instructions: unknown }> = {};
  let state: Record<string, unknown> = {};
  const run = (standIn?: { style: 'roadwarden'; contesting: boolean }) =>
    decide({
      view: gameView(game, 'gone'),
      board: game.board,
      meId: 'gone',
      plan: { ...initialPlan(game.turn), targetSite: 0, updatedTurn: 0 },
      level: 'sharp',
      ...(standIn ? { standIn } : {}),
      jev: {
        model: 'test',
        async evaluate(seen: unknown, questions: Record<string, { instructions: unknown }>) {
          asked = questions;
          state = seen as Record<string, unknown>;
          return { answers: {}, inputTokens: 0, costUsd: 0 };
        },
      } as never,
    });

  await run();
  assert.equal((state as { playing_for?: unknown }).playing_for, undefined);
  const ordinary = String(asked.plan_strategy?.instructions ?? '');

  await run({ style: 'roadwarden', contesting: true });
  const covering = state as { playing_for?: { their_style: string } };
  assert.equal(covering.playing_for?.their_style, PLAY_STYLES.roadwarden);
  const continued = String(asked.plan_strategy?.instructions);
  assert.notEqual(continued, ordinary);
  assert.match(continued, new RegExp(STYLE_ARCHETYPE.roadwarden));
  assert.match(continued, /finish the game they were playing/);
});

test('a stored style is read back, and anything else is treated as no style at all', () => {
  assert.deepEqual(parseStandInStyle({ style: 'trader', contesting: true }), {
    style: 'trader',
    contesting: true,
  });
  assert.deepEqual(parseStandInStyle({ style: 'builder', contesting: false, inferred: true }), {
    style: 'builder',
    contesting: false,
    inferred: true,
  });
  // Absent, corrupt or from a version that knew a style this one does not.
  for (const bad of [null, undefined, 'trader', {}, { style: 'wrecker' }, { style: 1 }])
    assert.equal(parseStandInStyle(bad), null, JSON.stringify(bad));
});
