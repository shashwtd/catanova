import test from 'node:test';
import assert from 'node:assert/strict';
import { COSTS, DEVELOPMENT_DECK, RESOURCES, RULESET, SUPPLY } from '../packages/rules/src/index.js';
import {
  CLASSIC,
  findRuleset,
  handLimit,
  registerRuleset,
  rulesetOf,
  rulesetProblems,
  rulesets,
  seatRange,
} from '../packages/rules/src/rulesets.js';
import type { Ruleset } from '../packages/rules/src/rulesets.js';
import {
  applyAction,
  createGame,
  emptyHand,
  gameView,
  parseGameAction,
  pieces,
  roadSites,
  score,
  settlementSites,
  total,
} from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { generateBoard } from '../packages/rules/src/board.js';
import { TEST_DECK_SIZE, TEST_TABLE, useTestTable } from './test-ruleset.js';

const seats = (n: number) =>
  ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn'].slice(0, n).map((name, i) => ({ id: `p${i}`, name }));
/** Every card of each resource is in the bank or a hand, and every development card is somewhere. */
function conserved(game: Game, ruleset: Ruleset) {
  for (const r of RESOURCES)
    assert.equal(game.bank[r] + game.players.reduce((n, p) => n + p.hand[r], 0), ruleset.supply.bank, r);
  const deck = Object.values(ruleset.supply.deck).reduce((a, b) => a + b, 0);
  assert.equal(game.deck.length + game.nextCard, deck);
}

test('Classic is described in full by its ruleset, from the constants it has always used', () => {
  assert.equal(CLASSIC.id, RULESET);
  assert.equal(CLASSIC.id, 'base-3-4-v1');
  assert.equal(CLASSIC.name, 'Classic');
  assert.equal(CLASSIC.board, 'balanced-v2');
  assert.deepEqual(CLASSIC.earlierBoards, ['balanced-v1']);
  assert.deepEqual(CLASSIC.seats, { min: 2, max: 4 });
  assert.deepEqual(CLASSIC.victoryPoints, { default: 10, min: 8, max: 15 });
  assert.equal(CLASSIC.supply.bank, 19);
  assert.equal(CLASSIC.supply.bank, SUPPLY.resourcesPerType);
  assert.deepEqual(CLASSIC.supply.deck, DEVELOPMENT_DECK);
  assert.equal(
    Object.values(CLASSIC.supply.deck).reduce((a, b) => a + b, 0),
    25,
  );
  assert.deepEqual(CLASSIC.supply.pieces, { roads: 15, settlements: 5, cities: 4 });
  assert.equal(CLASSIC.costs, COSTS);
  assert.equal(CLASSIC.bots, true);
  assert.equal(CLASSIC.standIns, true);
  assert.deepEqual(rulesetProblems(CLASSIC), []);
  assert.equal(seatRange(CLASSIC), 'two to four');
});

test('a saved id finds its ruleset; no id is Classic, and an id this build does not know is refused', () => {
  assert.equal(findRuleset(undefined), CLASSIC);
  assert.equal(findRuleset('base-3-4-v1'), CLASSIC);
  assert.equal(findRuleset('big-table-v1'), undefined);
  assert.equal(rulesetOf({}), CLASSIC);
  assert.throws(() => rulesetOf({ ruleset: 'open-sea-v1' }), /open-sea-v1, which this version cannot play/);
  // Only Classic ships in this release: nothing else is registered until a test registers it, so the
  // largest count of one resource any action may name is still Classic's 19.
  assert.deepEqual(
    rulesets().map((ruleset) => ruleset.id),
    ['base-3-4-v1'],
  );
  assert.equal(handLimit(), 19);
  assert.throws(
    () => parseGameAction({ kind: 'discard', resources: { ...emptyHand(), wood: 20 } }),
    /from 0 to 19/,
  );
});

test('only a playable ruleset registers, once, and taking it away leaves Classic alone', () => {
  const broken = (patch: Partial<Ruleset>) => () =>
    registerRuleset({ ...TEST_TABLE, id: 'broken-v1', ...patch });
  assert.throws(broken({ seats: { min: 1, max: 4 } }), /seats must run/);
  assert.throws(broken({ seats: { min: 3, max: 9 } }), /seats must run/);
  assert.throws(broken({ victoryPoints: { default: 20, min: 9, max: 13 } }), /default target/);
  assert.throws(broken({ standIns: true, bots: false }), /stand-ins are bots/);
  assert.throws(broken({ id: 'Big Table' }), /lowercase/);
  assert.throws(broken({ board: 'balanced-v1' }), /no preset deals balanced-v1/);
  assert.throws(
    broken({ supply: { ...TEST_TABLE.supply, pieces: { roads: 0, settlements: 4, cities: 3 } } }),
    /pieces/,
  );
  const forget = registerRuleset({ ...TEST_TABLE, id: 'passing-v1' });
  assert.throws(() => registerRuleset({ ...TEST_TABLE, id: 'passing-v1' }), /already registered/);
  assert.equal(findRuleset('passing-v1')?.name, 'Test Table');
  forget();
  assert.equal(findRuleset('passing-v1'), undefined);
  assert.throws(() => registerRuleset({ ...CLASSIC }), /already registered/);
  assert.equal(findRuleset(CLASSIC.id), CLASSIC);
});

test('a game frozen in the test mode seats, supplies and targets from its ruleset, not from Classic', () => {
  useTestTable();
  const random = () => 0.34;
  const game = createGame(seats(5), 481, random, { ruleset: TEST_TABLE.id });
  assert.equal(game.ruleset, 'test-table-v1');
  assert.deepEqual(game.bank, { wood: 24, brick: 24, sheep: 24, wheat: 24, ore: 24 });
  assert.equal(game.deck.length, TEST_DECK_SIZE);
  for (const [kind, count] of Object.entries(TEST_TABLE.supply.deck))
    assert.equal(game.deck.filter((card) => card === kind).length, count, kind);
  assert.equal(game.victoryPoints, 11);
  assert.equal(game.board.preset, 'balanced-v2');
  conserved(game, TEST_TABLE);
  // Seat limits and the target range are the mode's own, in the mode's own words.
  assert.throws(() => createGame(seats(2), 1, random, { ruleset: TEST_TABLE.id }), /three to five players/);
  assert.throws(() => createGame(seats(6), 1, random, { ruleset: TEST_TABLE.id }), /three to five players/);
  assert.throws(
    () => createGame(seats(3), 1, random, { ruleset: TEST_TABLE.id, victoryPoints: 14 }),
    /from 9 to 13 points/,
  );
  assert.equal(
    createGame(seats(3), 1, random, { ruleset: TEST_TABLE.id, victoryPoints: 13 }).victoryPoints,
    13,
  );
  assert.throws(() => createGame(seats(3), 1, random, { ruleset: 'big-table-v1' }), /not available/);
  // Classic keeps its exact wording and its numbers.
  assert.throws(() => createGame(seats(1), 1, random), /^Error: Start with two to four players$|two to four/);
  assert.throws(() => createGame(seats(5), 1, random), /Start with two to four players/);
  assert.throws(() => createGame(seats(2), 1, random, { victoryPoints: 16 }), /from 8 to 15 points/);
  const classic = createGame(seats(4), 481, random);
  assert.equal(classic.ruleset, 'base-3-4-v1');
  assert.deepEqual(classic.bank, { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 });
  assert.equal(classic.deck.length, 25);
  // A lobby's board must be one the mode plays: the test mode deals balanced-v2 and nothing older.
  const older = { ...generateBoard(1234), preset: 'balanced-v1' as const };
  assert.throws(
    () => createGame(seats(3), 1234, random, { ruleset: TEST_TABLE.id, board: older }),
    /dealt for another mode/,
  );
  assert.equal(createGame(seats(3), 1234, random, { board: older }).board.preset, 'balanced-v1');
});

/** A game in the test mode on turn 1, with the first player able to afford anything. */
function playing(ruleset = TEST_TABLE.id, each = 9) {
  const game = createGame(seats(3), 481, () => 0.34, { ruleset });
  game.phase = 'actions';
  game.turn = 1;
  game.players[0]!.hand = { wood: each, brick: each, sheep: each, wheat: each, ore: each };
  for (const r of RESOURCES) game.bank[r] -= each;
  return game;
}

test('the pieces each player has come from the ruleset: the build, the legal sites and Road Building', () => {
  useTestTable();
  const game = playing();
  // Four settlements are the test mode's whole supply: a fifth site is never offered, nor accepted.
  const vertices = [0, 8, 13, 16];
  for (const v of vertices) game.buildings[v] = { player: 'p0', kind: 'settlement' };
  const next = game.board.edges.find((e) => e.a === 0 || e.b === 0)!;
  game.roads[next.id] = 'p0';
  const far = game.board.edges.find((e) => (e.a === next.a || e.a === next.b) && e.id !== next.id)!;
  game.roads[far.id] = 'p0';
  assert.equal(pieces(game, 'p0').settlements, 4);
  assert.deepEqual(gameView(game, 'p0').legal.settlements, []);
  assert.ok(settlementSites(game, 'p0').length, 'the roads reach a site the fifth settlement could take');
  for (const vertex of settlementSites(game, 'p0'))
    assert.throws(
      () => applyAction(game, 'p0', { kind: 'settlement', vertex }, () => 0.34),
      /legal settlement site/,
    );
  // Three cities, then no more.
  let built = game;
  for (const vertex of vertices.slice(0, 3))
    built = applyAction(built, 'p0', { kind: 'city', vertex }, () => 0.34);
  assert.equal(pieces(built, 'p0').cities, 3);
  assert.deepEqual(gameView(built, 'p0').legal.cities, []);
  assert.throws(() => applyAction(built, 'p0', { kind: 'city', vertex: 16 }, () => 0.34), /Upgrade/);
  // Twelve roads, then none; Road Building gives only what is left.
  const roads = playing(TEST_TABLE.id, 12);
  roads.buildings[0] = { player: 'p0', kind: 'settlement' };
  let road = roads;
  while (pieces(road, 'p0').roads < 11)
    road = applyAction(road, 'p0', { kind: 'road', edge: roadSites(road, 'p0')[0]! }, () => 0.34);
  road.players[0]!.cards = [{ id: 'rb', kind: 'roadBuilding', boughtTurn: 0 }];
  const card = applyAction(road, 'p0', { kind: 'playCard', cardId: 'rb' }, () => 0.34);
  assert.equal(card.freeRoads, 1);
  const last = applyAction(card, 'p0', { kind: 'road', edge: roadSites(card, 'p0')[0]! }, () => 0.34);
  assert.equal(pieces(last, 'p0').roads, 12);
  assert.equal(last.phase, 'actions');
  assert.deepEqual(gameView(last, 'p0').legal.roads, []);
  assert.throws(
    () => applyAction(last, 'p0', { kind: 'road', edge: roadSites(last, 'p0')[0]! }, () => 0.34),
    /legal road site/,
  );
});

test('costs come from the ruleset, so a piece one mode prices differently costs that there alone', () => {
  const forget = registerRuleset({
    ...TEST_TABLE,
    id: 'dear-roads-v1',
    costs: { ...COSTS, road: { wood: 2, brick: 1, sheep: 1, wheat: 0, ore: 0 } },
  });
  try {
    const game = playing('dear-roads-v1');
    game.buildings[0] = { player: 'p0', kind: 'settlement' };
    const edge = roadSites(game, 'p0')[0]!;
    const paid = applyAction(game, 'p0', { kind: 'road', edge }, () => 0.34);
    assert.deepEqual(paid.players[0]!.hand, { wood: 7, brick: 8, sheep: 8, wheat: 9, ore: 9 });
    game.players[0]!.hand = { ...emptyHand(), wood: 1, brick: 1 };
    game.bank.wood += 8;
    game.bank.brick += 8;
    game.bank.sheep += 9;
    game.bank.wheat += 9;
    game.bank.ore += 9;
    assert.deepEqual(gameView(game, 'p0').legal.roads, []);
    assert.throws(() => applyAction(game, 'p0', { kind: 'road', edge }, () => 0.34), /Not enough resources/);
    const classic = playing(CLASSIC.id);
    classic.buildings[0] = { player: 'p0', kind: 'settlement' };
    const cheap = applyAction(
      classic,
      'p0',
      { kind: 'road', edge: roadSites(classic, 'p0')[0]! },
      () => 0.34,
    );
    assert.equal(cheap.players[0]!.hand.wood, 8);
  } finally {
    forget();
  }
});

test('one resource is capped at the bank: the largest bank for the parser, the game’s own in the rules', () => {
  const twenty = { kind: 'discard', resources: { ...emptyHand(), wood: 20 } };
  useTestTable();
  assert.equal(handLimit(), 24);
  const forget = registerRuleset({
    ...TEST_TABLE,
    id: 'deep-bank-v1',
    supply: { ...TEST_TABLE.supply, bank: 30 },
  });
  assert.equal(handLimit(), 30);
  forget();
  assert.deepEqual(parseGameAction(twenty), twenty);
  assert.throws(
    () => parseGameAction({ ...twenty, resources: { ...emptyHand(), wood: 25 } }),
    /from 0 to 24/,
  );
  // A Classic game still holds every count to its 19-card bank, whatever the parser allowed.
  const classic = playing(CLASSIC.id);
  classic.players[0]!.hand = { ...emptyHand(), wood: 20 };
  for (const action of [
    twenty,
    { kind: 'offerTrade', give: { ...emptyHand(), wood: 20 }, want: { ...emptyHand(), ore: 1 } },
    { kind: 'offerTrade', give: { ...emptyHand(), wood: 1 }, want: { ...emptyHand(), ore: 20 } },
    { kind: 'openTrade', give: { ...emptyHand(), wood: 20 } },
  ] as GameAction[])
    assert.throws(() => applyAction(classic, 'p0', action, () => 0.34), /from 0 to 19/, action.kind);
  // The test mode's bank holds 24, so an offer of 20 is a question for its rules, not the parser.
  const test = playing();
  test.players[0]!.hand = { ...emptyHand(), wood: 20 };
  test.bank.wood -= 11;
  const offer = applyAction(
    test,
    'p0',
    { kind: 'openTrade', give: { ...emptyHand(), wood: 20 } },
    () => 0.34,
  );
  assert.equal(offer.trade?.give.wood, 20);
});

test('a whole test-mode game plays to a winner on its own supply, conserving every card', () => {
  useTestTable();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let game = createGame(seats(4), 2026, random, { ruleset: TEST_TABLE.id });
  for (let step = 0; step < 6000 && game.phase !== 'finished'; step++) {
    const actor = game.phase === 'discard' ? Object.keys(game.discards)[0]! : game.players[game.active]!.id;
    const legal = gameView(game, actor).legal;
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : game.phase === 'setupRoad' || game.phase === 'freeRoads'
          ? { kind: 'road', edge: legal.roads[0]! }
          : game.phase === 'discard'
            ? {
                kind: 'discard',
                resources: (() => {
                  const hand = { ...game.players.find((p) => p.id === actor)!.hand };
                  let owed = game.discards[actor]!;
                  const out = emptyHand();
                  for (const r of RESOURCES) {
                    const n = Math.min(owed, hand[r]);
                    out[r] = n;
                    owed -= n;
                  }
                  return out;
                })(),
              }
            : game.phase === 'robber'
              ? { kind: 'robber', hex: (game.robber + 1) % game.board.hexes.length }
              : game.phase === 'roll'
                ? { kind: 'roll' }
                : legal.cities.length
                  ? { kind: 'city', vertex: legal.cities[0]! }
                  : legal.settlements.length
                    ? { kind: 'settlement', vertex: legal.settlements[0]! }
                    : legal.canBuyCard
                      ? { kind: 'buyCard' }
                      : legal.roads.length && pieces(game, actor).roads < 12
                        ? { kind: 'road', edge: legal.roads[0]! }
                        : { kind: 'endTurn' };
    try {
      game = applyAction(game, actor, action, random);
    } catch {
      // A robber move that must name a victim: take the first one.
      if (action.kind !== 'robber') throw new Error(`step ${step}: ${action.kind} refused in ${game.phase}`);
      const hex = action.hex;
      const victim = game.board.hexes[hex]!.vertices.map((v) => game.buildings[v]?.player).find(
        (p) => p && p !== actor,
      );
      game = applyAction(game, actor, { kind: 'robber', hex, ...(victim ? { victim } : {}) }, random);
    }
    conserved(game, TEST_TABLE);
    for (const player of game.players) {
      const owned = pieces(game, player.id);
      assert.ok(owned.roads <= 12 && owned.settlements <= 4 && owned.cities <= 3);
      assert.ok(total(player.hand) >= 0);
    }
  }
  assert.equal(game.phase, 'finished');
  assert.ok(game.winner);
  assert.ok(
    score(
      game,
      game.players.find((p) => p.id === game.winner)!,
    ) >= 11,
  );
});
