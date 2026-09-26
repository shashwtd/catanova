/**
 * Big Table's rules, one test per rule or decision, each named with the section of docs/RULEBOOK-BIG-TABLE.md
 * it checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePlayer,
  applyAction,
  createGame,
  gameView,
  parseGameAction,
  resignPlayers,
  score,
} from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { owedBy, owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction, timeoutDescription } from '../packages/rules/src/timeout.js';
import { BIG_TABLE_BALANCED_V1, generateBoard, seededRandom } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import {
  BIG_TABLE,
  CLASSIC,
  findRuleset,
  rulesetProblems,
  seatRange,
} from '../packages/rules/src/rulesets.js';
import {
  CARD,
  ROAD,
  SETTLEMENT,
  act,
  afterSetup,
  clearBoard,
  deal,
  edgeBetween,
  emptyInto,
  face,
  give,
  idAt,
  layRoads,
  line,
  openSite,
  pass,
  pointsTo,
  roll,
  scripted,
  seatOf,
  seats,
  untilTurn,
} from './big-table-helpers.js';

const random = seededRandom(5);
const pair = (g: Game) => g.pair && { lead: idAt(g, g.pair.lead), partner: idAt(g, g.pair.partner) };
const lastLines = (g: Game, n = 3) => g.log.slice(-n).map((line) => line.text);

test('§1.1 and §2: big-table-v1 seats five or six, with 24 of each resource, a 34-card deck and no bots', () => {
  assert.equal(findRuleset('big-table-v1'), BIG_TABLE);
  assert.deepEqual(rulesetProblems(BIG_TABLE), []);
  assert.equal(BIG_TABLE.name, 'Big Table');
  assert.equal(BIG_TABLE.summary, 'For five and six players.');
  assert.equal(BIG_TABLE.board, 'big-table-balanced-v1');
  assert.deepEqual(BIG_TABLE.seats, { min: 5, max: 6 });
  assert.equal(seatRange(BIG_TABLE), 'five or six');
  assert.deepEqual(BIG_TABLE.victoryPoints, { default: 10, min: 8, max: 15 });
  assert.equal(BIG_TABLE.supply.bank, 24);
  assert.deepEqual(BIG_TABLE.supply.deck, {
    knight: 20,
    roadBuilding: 3,
    yearOfPlenty: 3,
    monopoly: 3,
    victoryPoint: 5,
  });
  assert.deepEqual(BIG_TABLE.supply.pieces, { roads: 15, settlements: 5, cities: 4 });
  assert.deepEqual(BIG_TABLE.costs, CLASSIC.costs);
  assert.equal(BIG_TABLE.bots, false);
  assert.equal(BIG_TABLE.standIns, false);
  assert.deepEqual(BIG_TABLE.turns, ['paired', 'betweenTurnsBuild']);
  for (const table of [seats(4), [...seats(6), { id: 'p6', name: 'Gus' }]])
    assert.throws(
      () => createGame(table, 1, random, { ruleset: BIG_TABLE.id }),
      /Start with five or six players/,
    );
  for (const n of [5, 6]) {
    const g = createGame(seats(n), 1, random, { ruleset: BIG_TABLE.id });
    assert.equal(g.players.length, n);
    assert.deepEqual(g.bank, { wood: 24, brick: 24, sheep: 24, wheat: 24, ore: 24 });
    assert.equal(g.deck.length, 34);
    for (const [kind, count] of Object.entries(BIG_TABLE.supply.deck))
      assert.equal(g.deck.filter((card) => card === kind).length, count, kind);
    assert.equal(g.victoryPoints, 10);
  }
});

test('§4.2: every game deals the balanced 30-hex island, and the robber starts on the desert its seed chose', () => {
  const starts = { lower: 0, higher: 0 };
  for (let seed = 0; seed < 40; seed++) {
    const g = createGame(seats(5), seed, random, { ruleset: BIG_TABLE.id });
    assert.equal(g.board.preset, 'big-table-balanced-v1');
    assert.equal(g.board.hexes.length, 30);
    const deserts = g.board.hexes.filter((h) => h.terrain === 'desert').map((h) => h.id);
    assert.equal(deserts.length, 2);
    assert.equal(g.robber, g.board.robberStart, `seed ${seed}`);
    starts[g.robber === Math.min(...deserts) ? 'lower' : 'higher']++;
  }
  assert.ok(starts.lower > 5 && starts.higher > 5, 'either desert can start the robber');
  // A lobby's island is played as dealt, its robber start included.
  const board = generateBoard(77, BIG_TABLE_BALANCED_V1);
  const game = createGame(seats(6), 77, random, { ruleset: BIG_TABLE.id, board });
  assert.equal(game.robber, board.robberStart);
  // A Classic island has one desert and no recorded start: the robber starts there, as always.
  const classic = createGame(seats(4), 77, random);
  assert.equal(classic.board.robberStart, undefined);
  assert.equal(classic.board.hexes[classic.robber]!.terrain, 'desert');
});
test('§4.4: the setup draft runs 1…5, 5…1 and 1…6, 6…1, with no markers until the first paired turn', () => {
  for (const n of [5, 6]) {
    let g = createGame(seats(n), 9, random, { ruleset: BIG_TABLE.id });
    const order: number[] = [];
    while (g.turn === 0) {
      assert.equal(g.pair, undefined, 'the Lead and Partner markers play no part in setup');
      if (g.phase === 'setupSettlement') order.push(g.active);
      g = act(g, activePlayer(g).id, timeoutAction(g, activePlayer(g).id, random)!);
    }
    const forward = Array.from({ length: n }, (_, i) => i);
    assert.deepEqual(order, [...forward, ...forward.slice().reverse()]);
    // §6.1: the first paired turn begins after setup, with the starting player as Lead.
    assert.equal(g.phase, 'roll');
    assert.deepEqual(g.pair, { lead: 0, partner: 3 });
    assert.match(g.log.at(-1)!.text, /^Ann's turn, with Dan as Partner\.$/);
  }
});

test('§5: the turn structure is frozen at the start, Paired turns unless the host chose Between-turns build', () => {
  const paired = createGame(seats(5), 3, random, { ruleset: BIG_TABLE.id });
  assert.equal(paired.turns, 'paired');
  assert.ok(paired.log.some((line) => line.text === 'This game plays Paired turns.'));
  const build = createGame(seats(5), 3, random, { ruleset: BIG_TABLE.id, turns: 'betweenTurnsBuild' });
  assert.equal(build.turns, 'betweenTurnsBuild');
  assert.ok(build.log.some((line) => line.text === 'This game plays Between-turns build.'));
  // Classic has one way to take turns: its games carry no structure at all, and refuse one.
  const classic = createGame(seats(4), 3, random);
  assert.equal('turns' in classic, false);
  assert.throws(() => createGame(seats(4), 3, random, { turns: 'paired' }), /Classic has no turn structure/);
  // Under Between-turns build the starting player takes an ordinary first turn, with no window before it.
  const first = afterSetup(5, { turns: 'betweenTurnsBuild' });
  assert.equal(first.phase, 'roll');
  assert.equal(first.pair, undefined);
  assert.equal(first.windows, undefined);
});

test('§6.1: the Partner is the third player to the Lead’s left; over a round each is Lead once and Partner once', () => {
  for (const n of [5, 6]) {
    let g = afterSetup(n);
    const leads: number[] = [],
      partners: number[] = [];
    for (let turn = 1; turn <= n; turn++) {
      g = untilTurn(g, turn);
      leads.push(g.pair!.lead);
      partners.push(g.pair!.partner);
      assert.notEqual(g.pair!.lead, g.pair!.partner);
    }
    assert.deepEqual(
      leads,
      Array.from({ length: n }, (_, i) => i),
    );
    // With five, two seats to the Lead's right; with six, directly opposite.
    assert.deepEqual(
      partners,
      leads.map((lead) => (lead + 3) % n),
    );
    assert.deepEqual([...partners].sort(), [...leads].sort(), 'every player is Partner once in the round');
  }
});

test('§6.1 and §9.5: the Partner is counted among players still in the game, and recounted each paired turn', () => {
  let g = afterSetup(6);
  assert.deepEqual(pair(g), { lead: 'p0', partner: 'p3' });
  g = resignPlayers(g, ['p1'], { reason: 'leave' });
  // Nobody is recounted mid-turn: the markers stay where they reached.
  assert.deepEqual(pair(g), { lead: 'p0', partner: 'p3' });
  g = untilTurn(g, 2);
  // Ben is skipped: Cat leads, and the third player still in the game to her left is Fay.
  assert.deepEqual(pair(g), { lead: 'p2', partner: 'p5' });
  g = untilTurn(g, 3);
  assert.deepEqual(pair(g), { lead: 'p3', partner: 'p0' });
});

test('§6.2 and §6.4: the Lead plays a full Classic turn and may trade with the Partner', () => {
  let g = roll(afterSetup(5), 3, 5);
  assert.equal(g.phase, 'actions');
  give(g, 'p0', { wood: 1 });
  give(g, 'p3', { ore: 1 });
  g = act(g, 'p0', { kind: 'offerTrade', give: { ...zero(), wood: 1 }, want: { ...zero(), ore: 1 } });
  g = act(g, 'p3', { kind: 'acceptTrade', tradeId: g.trade!.id });
  g = act(g, 'p0', { kind: 'acceptProposal', tradeId: g.trade!.id, player: 'p3' });
  assert.match(g.log.at(-1)!.text, /^Ann traded 1 Timber to Dan for 1 Rock\.$/);
  // Offers still open when the Lead ends their part expire.
  give(g, 'p0', { wood: 1 });
  g = act(g, 'p0', { kind: 'openTrade', give: { ...zero(), wood: 1 } });
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.equal(g.trade, null);
  assert.equal(g.phase, 'partner');
});
const zero = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });

test('§6.3: the Partner never rolls; trades with the bank, builds, buys and plays one card, but never trades with players', () => {
  let g = roll(afterSetup(5), 3, 5);
  const knight = deal(g, 'p3', 'knight');
  deal(g, 'p3', 'monopoly');
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.equal(g.phase, 'partner');
  assert.equal(activePlayer(g).id, 'p3');
  assert.match(lastLines(g, 1)[0]!, /^Dan begins the Partner's phase\.$/);
  // Both markers stay where they are for the whole paired turn.
  assert.deepEqual(pair(g), { lead: 'p0', partner: 'p3' });
  assert.deepEqual(owedMoves(g), [{ player: 'p3', kind: 'partner' }]);
  assert.equal(owedBy(g, 'p0'), undefined, 'the Lead is owed nothing while the Partner acts');
  assert.throws(() => act(g, 'p3', { kind: 'roll' }), /already rolled/);
  give(g, 'p3', { wood: 4, brick: 1, sheep: 1, wheat: 1, ore: 1 });
  for (const action of [
    { kind: 'offerTrade', give: { ...zero(), wood: 1 }, want: { ...zero(), ore: 1 } },
    { kind: 'openTrade', give: { ...zero(), wood: 1 } },
    { kind: 'cancelTrade' },
  ] as const)
    assert.throws(() => act(g, 'p3', action), /No trades with players in the Partner’s phase/);
  assert.throws(() => act(g, 'p3', { kind: 'endTurn' }), /End your Partner’s phase instead/);
  // Bank trade, build and buy, in any order and as often as the cards allow.
  const rate = gameView(g, 'p3').legal.rates.wood;
  emptyInto(g, 'p3');
  give(g, 'p3', { wood: rate + 1, brick: 1, sheep: 1, wheat: 1, ore: 1 });
  g = act(g, 'p3', { kind: 'bankTrade', give: 'wood', receive: 'brick' });
  const view = gameView(g, 'p3').legal;
  assert.ok(view.roads.length, 'the Partner may build a road');
  assert.ok(view.canBuyCard);
  g = act(g, 'p3', { kind: 'road', edge: view.roads[0]! });
  g = act(g, 'p3', { kind: 'buyCard' });
  // One card, of any type, played in the phase: a Knight moves the robber and robs as usual.
  assert.deepEqual(
    gameView(g, 'p3').legal.playableCards.sort(),
    [knight.id, g.players[3]!.cards[1]!.id].sort(),
  );
  g = act(g, 'p3', { kind: 'playCard', cardId: knight.id });
  assert.equal(g.phase, 'robber');
  assert.equal(g.returnPhase, 'partner');
  g = act(g, 'p3', timeoutAction(g, 'p3', random)!);
  assert.equal(g.phase, 'partner', 'the robber returns the Partner to their phase');
  assert.equal(g.players[3]!.knights, 1, 'the Knight counts toward the Partner’s Largest Army');
  assert.deepEqual(gameView(g, 'p3').legal.playableCards, [], 'one card per phase');
  assert.throws(
    () => act(g, 'p3', { kind: 'playCard', cardId: g.players[3]!.cards[0]!.id, resource: 'ore' }),
    /Only one development card/,
  );
  // Nobody else may act, and the others see no legal moves.
  for (const id of ['p0', 'p1', 'p2', 'p4']) {
    assert.throws(() => act(g, id, { kind: 'buyCard' }), /Wait for your turn/);
    const other = gameView(g, id).legal;
    assert.deepEqual([other.roads, other.settlements, other.cities, other.playableCards], [[], [], [], []]);
  }
  // The Partner may end the phase at once; the markers pass one seat left.
  g = act(g, 'p3', { kind: 'endPhase' });
  assert.equal(g.turn, 2);
  assert.equal(g.phase, 'roll');
  assert.deepEqual(pair(g), { lead: 'p1', partner: 'p4' });
  assert.match(lastLines(g, 1)[0]!, /^Ben's turn, with Eve as Partner\.$/);
});

test('§6.3: the Partner plays no card before the Lead’s roll or during the Lead’s part', () => {
  let g = afterSetup(5);
  const knight = deal(g, 'p3', 'knight');
  assert.deepEqual(gameView(g, 'p3').legal.playableCards, []);
  assert.throws(() => act(g, 'p3', { kind: 'playCard', cardId: knight.id }), /Wait for your turn/);
  g = roll(g, 3, 5);
  assert.throws(() => act(g, 'p3', { kind: 'playCard', cardId: knight.id }), /Wait for your turn/);
  assert.throws(() => act(g, 'p3', { kind: 'endPhase' }), /Wait for your turn/);
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.deepEqual(gameView(g, 'p3').legal.playableCards, [knight.id]);
});

test('§6.4: the Partner’s Monopoly takes from the Lead too, and the Partner’s Knight may rob the Lead', () => {
  let g = roll(afterSetup(5), 3, 5);
  for (const p of g.players) emptyInto(g, p.id);
  give(g, 'p0', { ore: 3 });
  give(g, 'p1', { ore: 2 });
  deal(g, 'p3', 'monopoly');
  g = act(g, 'p0', { kind: 'endTurn' });
  g = act(g, 'p3', { kind: 'playCard', cardId: g.players[3]!.cards[0]!.id, resource: 'ore' });
  assert.equal(g.players[3]!.hand.ore, 5);
  assert.equal(g.players[0]!.hand.ore, 0, 'Monopoly takes the named resource from the Lead too');
  // The next Partner (Eve) plays a Knight onto a tile of the Lead's (Ben's), and robs him.
  g = roll(act(g, 'p3', { kind: 'endPhase' }), 3, 5);
  for (const p of g.players) emptyInto(g, p.id);
  give(g, 'p1', { brick: 1 });
  deal(g, 'p4', 'knight');
  g = act(g, 'p1', { kind: 'endTurn' });
  const hex = g.board.hexes.find(
    (h) => h.id !== g.robber && h.vertices.some((v) => g.buildings[v]?.player === 'p1'),
  )!;
  g = act(g, 'p4', { kind: 'playCard', cardId: g.players[4]!.cards[0]!.id });
  g = act(g, 'p4', { kind: 'robber', hex: hex.id, victim: 'p1' });
  assert.equal(g.players[4]!.hand.brick, 1);
  assert.match(g.log.at(-1)!.text, /^Eve moved the robber and stole a card from Ben\.$/);
});

test('§6.5: a seven comes only on the Lead’s roll; the Partner discards like everyone and can be robbed', () => {
  let g = afterSetup(5);
  for (const p of g.players) emptyInto(g, p.id);
  give(g, 'p3', { wood: 5, brick: 4 });
  give(g, 'p1', { ore: 3 });
  g = roll(g, 3, 4);
  assert.equal(g.phase, 'discard');
  assert.deepEqual(g.discards, { p3: 4 });
  g = act(g, 'p3', { kind: 'discard', resources: { ...zero(), wood: 4 } });
  assert.equal(g.phase, 'robber');
  assert.equal(activePlayer(g).id, 'p0', 'the Lead moves the robber');
  const hex = g.board.hexes.find(
    (h) => h.id !== g.robber && h.vertices.some((v) => g.buildings[v]?.player === 'p3'),
  )!;
  g = act(g, 'p0', { kind: 'robber', hex: hex.id, victim: 'p3' });
  assert.equal(g.phase, 'actions');
  assert.equal(g.players[0]!.hand.wood + g.players[0]!.hand.brick, 1, 'the Partner is a legal victim');
  // The Partner's phase has no roll, so it never causes discards.
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.equal(g.phase, 'partner');
  assert.throws(() => act(g, 'p3', { kind: 'roll' }));
});

test('§6.6: one card per part, never one bought in that part; bought as Lead, played as Partner in a later part', () => {
  let g = roll(afterSetup(5), 3, 5);
  // Ann, Lead of the first paired turn, buys a Knight and cannot play it in the part she bought it in.
  give(g, 'p0', CARD);
  g.deck.push('knight');
  g = act(g, 'p0', { kind: 'buyCard' });
  const bought = g.players[0]!.cards.at(-1)!;
  assert.equal(bought.boughtTurn, 1);
  assert.deepEqual(gameView(g, 'p0').legal.playableCards, []);
  // She is Partner three paired turns later (Cat leads, and Ann is the third player to her left).
  g = untilTurn(g, 3);
  assert.deepEqual(pair(g), { lead: 'p2', partner: 'p0' });
  // The Lead and the Partner may each play one card in the same paired turn.
  deal(g, 'p2', 'yearOfPlenty');
  g = act(g, 'p2', {
    kind: 'playCard',
    cardId: g.players[2]!.cards.at(-1)!.id,
    resources: { ...zero(), wood: 2 },
  });
  g = act(roll(g, 3, 5), 'p2', { kind: 'endTurn' });
  assert.deepEqual(gameView(g, 'p0').legal.playableCards, [bought.id]);
  // A card bought as Partner is not playable in the same phase, but is as Lead later.
  give(g, 'p0', CARD);
  g.deck.push('monopoly');
  g = act(g, 'p0', { kind: 'buyCard' });
  const partnerCard = g.players[0]!.cards.at(-1)!;
  assert.ok(!gameView(g, 'p0').legal.playableCards.includes(partnerCard.id));
  g = untilTurn(g, 6);
  assert.deepEqual(pair(g), { lead: 'p0', partner: 'p3' });
  assert.ok(gameView(g, 'p0').legal.playableCards.includes(partnerCard.id));
  // Victory point cards are never played: they count at once.
  deal(g, 'p0', 'victoryPoint');
  assert.ok(!gameView(g, 'p0').legal.playableCards.includes(g.players[0]!.cards.at(-1)!.id));
});

/**
 * The rulebook's award example (6.7, cases 3 and 4): `holder` has Longest Road on a line of six roads; `builder`
 * has a road to its middle corner and the cards for a settlement there; `runnerUp` has a line of five roads
 * elsewhere, so a settlement in the middle leaves them alone with the longest road. Returns the middle corner.
 */
function roadRace(g: Game, holder: string, builder: string, runnerUp: string) {
  clearBoard(g);
  const taken = new Set<number>();
  for (let attempt = 0; ; attempt++) {
    const long = line(g, 6, taken);
    const middle = long[3]!;
    const spur = g.board.vertices[middle]!.neighbors.find((n) => !long.includes(n));
    if (spur === undefined) continue;
    layRoads(g, holder, long);
    g.roads[edgeBetween(g, middle, spur)] = builder;
    taken.add(spur);
    for (const n of g.board.vertices[spur]!.neighbors) taken.add(n);
    layRoads(g, runnerUp, line(g, 5, taken));
    g.longestRoad = holder;
    give(g, builder, SETTLEMENT);
    return middle;
  }
}

test('§6.7 case 1: a Lead who reaches the target in their part wins at once, before any Partner’s phase', () => {
  let g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  pointsTo(g, 'p0', 7);
  give(g, 'p0', SETTLEMENT);
  g = act(g, 'p0', { kind: 'settlement', vertex: openSite(g, 'p0') });
  assert.equal(g.winner, 'p0');
  assert.equal(g.phase, 'finished');
  assert.match(g.log.at(-1)!.text, /^Ann wins with 8 points!$/);
});

test('§6.7 case 2: a Partner who reaches the target in their phase wins at once', () => {
  let g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  g = act(g, 'p0', { kind: 'endTurn' });
  pointsTo(g, 'p3', 7);
  give(g, 'p3', SETTLEMENT);
  g = act(g, 'p3', { kind: 'settlement', vertex: openSite(g, 'p3') });
  assert.equal(g.winner, 'p3');
  assert.match(g.log.at(-1)!.text, /^Dan wins as Partner with 8 points!$/);
});

test('§6.7 case 3: a Partner put at the target by the Lead’s action wins at once, unless the Lead has it too', () => {
  let g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  // Ann's settlement splits Ben's road, and Dan, the Partner, is left alone with the longest road.
  let middle = roadRace(g, 'p1', 'p0', 'p3');
  pointsTo(g, 'p3', 6);
  const won = act(g, 'p0', { kind: 'settlement', vertex: middle });
  assert.equal(won.longestRoad, 'p3');
  assert.equal(won.winner, 'p3', 'the Partner wins without acting');
  assert.match(won.log.at(-1)!.text, /^Dan wins as Partner with 8 points!$/);
  // Case 5: the same settlement brings Ann to the target too, and the Lead wins.
  g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  middle = roadRace(g, 'p1', 'p0', 'p3');
  pointsTo(g, 'p3', 6);
  pointsTo(g, 'p0', 7);
  const both = act(g, 'p0', { kind: 'settlement', vertex: middle });
  assert.ok(score(both, both.players[3]!) >= 8 && score(both, both.players[0]!) >= 8);
  assert.equal(both.winner, 'p0');
});

test('§6.7 case 4: a Lead put at the target during the Partner’s phase wins at once', () => {
  let g = act(roll(afterSetup(5, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  // Dan's settlement splits Ben's road, and Ann, the Lead, is left alone with the longest road.
  let middle = roadRace(g, 'p1', 'p3', 'p0');
  pointsTo(g, 'p0', 6);
  const won = act(g, 'p3', { kind: 'settlement', vertex: middle });
  assert.equal(won.winner, 'p0');
  assert.match(won.log.at(-1)!.text, /^Ann wins with 8 points!$/);
  // Case 5, in the Partner's phase: Dan's own settlement brings him to the target as well, and the Lead still
  // wins. The reference edition gives this to the Partner; Catanova applies the tie clause here too.
  g = act(roll(afterSetup(5, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  middle = roadRace(g, 'p1', 'p3', 'p0');
  pointsTo(g, 'p0', 6);
  pointsTo(g, 'p3', 7);
  const both = act(g, 'p3', { kind: 'settlement', vertex: middle });
  assert.equal(score(both, both.players[3]!), 8);
  assert.equal(both.winner, 'p0');
});

test('§6.7 case 6 and rule 4: a player holding neither marker waits for a paired turn in which they hold one', () => {
  // Ben (no marker in the first paired turn) is put at the target by Ann's settlement splitting Cat's road.
  let g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  const middle = roadRace(g, 'p2', 'p0', 'p1');
  pointsTo(g, 'p1', 6);
  g = act(g, 'p0', { kind: 'settlement', vertex: middle });
  assert.equal(g.longestRoad, 'p1');
  assert.equal(score(g, g.players[1]!), 8);
  assert.equal(g.winner, null, 'no win while holding neither marker');
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.equal(g.winner, null, 'nor when the Partner’s phase begins');
  // Ben leads the next paired turn, and wins as it begins, before rolling.
  g = act(g, 'p3', { kind: 'endPhase' });
  assert.equal(g.winner, 'p1');
  assert.equal(g.dice, null);
  // A new Partner wins before the Lead rolls, not when the Partner's phase begins: Eve is Partner of the second
  // paired turn.
  let h = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  const corner = roadRace(h, 'p2', 'p0', 'p4');
  pointsTo(h, 'p4', 6);
  h = act(act(h, 'p0', { kind: 'settlement', vertex: corner }), 'p0', { kind: 'endTurn' });
  assert.equal(h.winner, null);
  h = act(h, 'p3', { kind: 'endPhase' });
  assert.deepEqual(pair(h), { lead: 'p1', partner: 'p4' });
  assert.equal(h.winner, 'p4');
  assert.match(h.log.at(-1)!.text, /^Eve wins as Partner with 8 points!$/);
});

test('§6.7 rule 4: a player who dropped below the target before holding a marker does not win', () => {
  let g = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  const middle = roadRace(g, 'p2', 'p0', 'p1');
  pointsTo(g, 'p1', 6);
  g = act(g, 'p0', { kind: 'settlement', vertex: middle });
  assert.equal(score(g, g.players[1]!), 8);
  g = act(g, 'p0', { kind: 'endTurn' });
  // In his phase Dan lays a sixth road on a line of five and takes Longest Road from Ben.
  const taken = new Set(Object.keys(g.buildings).map(Number));
  for (const edge of Object.entries(g.roads)) {
    const e = g.board.edges[Number(edge[0])]!;
    taken.add(e.a).add(e.b);
  }
  const corners = line(g, 6, taken);
  layRoads(g, 'p3', corners.slice(0, 6));
  give(g, 'p3', ROAD);
  g = act(g, 'p3', { kind: 'road', edge: edgeBetween(g, corners[5]!, corners[6]!) });
  assert.equal(g.longestRoad, 'p3');
  assert.equal(score(g, g.players[1]!), 6);
  g = act(g, 'p3', { kind: 'endPhase' });
  assert.deepEqual(pair(g), { lead: 'p1', partner: 'p4' });
  assert.equal(g.winner, null);
  assert.equal(g.phase, 'roll');
});

test('§6.7 case 7: a marker holder already at the target when the paired turn begins wins at once, the Lead first', () => {
  for (const [atTarget, winner] of [
    [['p4'], 'p4'],
    [['p1', 'p4'], 'p1'],
  ] as const) {
    let g = act(roll(afterSetup(5, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
    for (const id of atTarget) pointsTo(g, id, 8);
    g = act(g, 'p3', { kind: 'endPhase' });
    assert.equal(g.winner, winner);
    assert.equal(g.dice, null, 'without rolling');
  }
});

test('§6.7 rule 2: a resignation that moves an award counts as an action, and may put both markers at the target', () => {
  // Cat holds Longest Road; when she leaves, Dan, the Partner, is left with the longest road and wins at once.
  let g = roll(afterSetup(6, { victoryPoints: 8 }), 3, 5);
  clearBoard(g);
  const taken = new Set<number>();
  layRoads(g, 'p2', line(g, 6, taken));
  layRoads(g, 'p3', line(g, 5, taken));
  g.longestRoad = 'p2';
  pointsTo(g, 'p3', 6);
  const left = resignPlayers(g, ['p2'], { reason: 'leave' });
  assert.equal(left.longestRoad, 'p3');
  assert.equal(left.winner, 'p3');
  // In the Partner's phase Cat holds both awards. Her leaving hands Longest Road to Ann, the Lead, and Largest
  // Army to Dan, the Partner: both reach the target at once, and the Lead wins.
  let h = act(roll(afterSetup(6, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  clearBoard(h);
  const room = new Set<number>();
  layRoads(h, 'p2', line(h, 6, room));
  layRoads(h, 'p0', line(h, 5, room));
  h.longestRoad = 'p2';
  h.largestArmy = 'p2';
  h.players[2]!.knights = 4;
  h.players[3]!.knights = 3;
  pointsTo(h, 'p0', 6);
  pointsTo(h, 'p3', 6);
  h = resignPlayers(h, ['p2'], { reason: 'leave' });
  assert.equal(h.longestRoad, 'p0');
  assert.equal(h.largestArmy, 'p3');
  assert.equal(h.winner, 'p0');
});

test('§6.7 rule 2: a marker holder who resigns hands the other the award, and the win, before the part ends', () => {
  // Dan, the Partner, holds Longest Road and leaves in his phase. Ann, the Lead, has the next longest road and
  // wins by it at once: the paired turn is still under way until his phase ends.
  let g = act(roll(afterSetup(6, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  clearBoard(g);
  const taken = new Set<number>();
  layRoads(g, 'p3', line(g, 7, taken));
  layRoads(g, 'p0', line(g, 6, taken));
  g.longestRoad = 'p3';
  pointsTo(g, 'p0', 6);
  g = resignPlayers(g, ['p3'], { reason: 'leave' });
  assert.equal(g.longestRoad, 'p0');
  assert.equal(g.winner, 'p0');
  assert.equal(g.turn, 1, 'in the paired turn Dan left');
  assert.equal(lastLines(g, 1)[0], 'Ann wins with 8 points!');
  // §6.8: Ann leads a table of five and leaves in her part, which leaves four, so no Partner's phase follows.
  // Dan, her Partner, holds the marker until her part ends, and the Longest Road she leaves him wins it.
  let h = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  clearBoard(h);
  const room = new Set<number>();
  layRoads(h, 'p0', line(h, 7, room));
  layRoads(h, 'p3', line(h, 6, room));
  h.longestRoad = 'p0';
  pointsTo(h, 'p3', 6);
  h = resignPlayers(h, ['p0'], { reason: 'leave' });
  assert.equal(h.longestRoad, 'p3');
  assert.equal(h.winner, 'p3');
  assert.equal(lastLines(h, 1)[0], 'Dan wins as Partner with 8 points!');
  // A player the room cannot declare the winner yet, being away, is not; the turn goes on without the pair.
  let away = roll(afterSetup(5, { victoryPoints: 8 }), 3, 5);
  clearBoard(away);
  const spare = new Set<number>();
  layRoads(away, 'p0', line(away, 7, spare));
  layRoads(away, 'p3', line(away, 6, spare));
  away.longestRoad = 'p0';
  pointsTo(away, 'p3', 6);
  away = resignPlayers(away, ['p0'], { reason: 'leave', winnerEligibleIds: ['p1', 'p2', 'p4'] });
  assert.equal(away.winner, null);
  assert.equal(away.pair, undefined);
  assert.equal(activePlayer(away).id, 'p1');
});

test('§6.7: a marker holder a resignation leaves at the target while away wins at the next move in their part', () => {
  /** Longest Road from `from` to `to`, who then has 8 points of 8 once `from` is gone. */
  const award = (g: Game, from: string, to: string) => {
    clearBoard(g);
    const taken = new Set<number>();
    layRoads(g, from, line(g, 7, taken));
    layRoads(g, to, line(g, 6, taken));
    g.longestRoad = from;
    pointsTo(g, to, 6);
  };
  const others = (g: Game, ...away: string[]) =>
    g.players.map((p) => p.id).filter((id) => !away.includes(id));
  // Dan leaves in his Partner's phase and hands the road to Ben, who is away: Ben's paired turn begins with
  // nobody declared the winner, and his first move, the roll, declares him.
  let lead = act(roll(afterSetup(6, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  award(lead, 'p3', 'p1');
  lead = resignPlayers(lead, ['p3'], { reason: 'leave', winnerEligibleIds: others(lead, 'p1', 'p3') });
  assert.equal(lead.winner, null);
  assert.deepEqual(pair(lead), { lead: 'p1', partner: 'p5' });
  lead = act(lead, 'p1', timeoutAction(lead, 'p1', random)!);
  assert.equal(lead.winner, 'p1');
  assert.ok(lead.dice, 'after the dice, which change no points');
  // The same road to Fay, the new Partner, who is away: Ben, here, rolls, and his roll declares her.
  let partner = act(roll(afterSetup(6, { victoryPoints: 8 }), 3, 5), 'p0', { kind: 'endTurn' });
  award(partner, 'p3', 'p5');
  partner = resignPlayers(partner, ['p3'], {
    reason: 'leave',
    winnerEligibleIds: others(partner, 'p3', 'p5'),
  });
  assert.equal(partner.winner, null);
  partner = roll(partner, 3, 5);
  assert.equal(partner.winner, 'p5');
  assert.equal(lastLines(partner, 1)[0], 'Fay wins as Partner with 8 points!');
  // Ann leaves in her part and hands it to Dan, her Partner, who is away: his phase follows, and the clock's end
  // of it declares him before the markers move on.
  let phase = roll(afterSetup(6, { victoryPoints: 8 }), 3, 5);
  award(phase, 'p0', 'p3');
  phase = resignPlayers(phase, ['p0'], { reason: 'leave', winnerEligibleIds: others(phase, 'p0', 'p3') });
  assert.equal(phase.winner, null);
  assert.equal(phase.phase, 'partner');
  phase = act(phase, 'p3', timeoutAction(phase, 'p3', random)!);
  assert.equal(phase.winner, 'p3');
  assert.equal(phase.turn, 1, 'in the paired turn he was Partner of');
  // Between-turns build: Ann, away, has rolled when Cat leaves and hands her the target. The clock's end of her
  // turn declares her there, before the windows, in which nobody wins.
  let windows = roll(afterSetup(5, { turns: 'betweenTurnsBuild', victoryPoints: 8 }), 3, 5);
  award(windows, 'p2', 'p0');
  windows = resignPlayers(windows, ['p2'], {
    reason: 'leave',
    winnerEligibleIds: others(windows, 'p0', 'p2'),
  });
  assert.equal(windows.winner, null);
  windows = act(windows, 'p0', timeoutAction(windows, 'p0', random)!);
  assert.equal(windows.winner, 'p0');
  assert.equal(windows.windows, undefined);
});

test('§6.8: with fewer than five players left, turns go one player at a time, and the log says so', () => {
  let g = afterSetup(5);
  g = resignPlayers(g, ['p2'], { reason: 'leave' });
  // The paired turn under way keeps its markers: the Partner's phase does not begin with four left, though.
  assert.deepEqual(pair(g), { lead: 'p0', partner: 'p3' });
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(g.turn, 2);
  assert.equal(g.pair, undefined);
  assert.equal(activePlayer(g).id, 'p1');
  assert.deepEqual(lastLines(g, 2), [
    'Fewer than five players remain, so turns go one player at a time from now on, with no Partner.',
    "Ben's turn.",
  ]);
  // Ordinary turns from then on, skipping the resigned; nobody but the player on turn acts or wins.
  g = act(roll(g, 3, 5), 'p1', { kind: 'endTurn' });
  assert.equal(activePlayer(g).id, 'p3');
  assert.equal(g.pair, undefined);
  assert.equal(g.log.filter((line) => line.text.startsWith('Fewer than five')).length, 1, 'announced once');
  // A Big Table game that starts its first turn with four left says so too.
  let h = createGame(seats(5), 12, random, { ruleset: BIG_TABLE.id });
  h = resignPlayers(h, ['p4'], { reason: 'leave' });
  while (h.turn === 0) h = act(h, activePlayer(h).id, timeoutAction(h, activePlayer(h).id, random)!);
  assert.equal(h.pair, undefined);
  assert.ok(h.log.some((line) => line.text.startsWith('Fewer than five players remain')));
});

test('§9.6 rule 1: a Lead who resigns in their part is still followed by the Partner’s phase while five remain', () => {
  let g = roll(afterSetup(6), 3, 5);
  g = resignPlayers(g, ['p0'], { reason: 'leave' });
  assert.equal(g.phase, 'partner');
  assert.equal(activePlayer(g).id, 'p3');
  g = act(g, 'p3', { kind: 'endPhase' });
  assert.deepEqual(pair(g), { lead: 'p1', partner: 'p4' });
  // With five at the table, the Lead's leaving drops it to four: the next turn is single.
  let h = roll(afterSetup(5), 3, 5);
  h = resignPlayers(h, ['p0'], { reason: 'leave' });
  assert.equal(h.phase, 'roll');
  assert.equal(activePlayer(h).id, 'p1');
  assert.equal(h.pair, undefined);
});

test('§9.6 rule 2: a Partner who resigns before their phase is not replaced that paired turn', () => {
  let g = roll(afterSetup(6), 3, 5);
  g = resignPlayers(g, ['p3'], { reason: 'leave' });
  g = act(g, 'p0', { kind: 'endTurn' });
  assert.equal(g.phase, 'roll', 'no Partner’s phase');
  // The next paired turn finds its Partner afresh, among the five still playing.
  assert.deepEqual(pair(g), { lead: 'p1', partner: 'p5' });
});

test('§9.6 rules 3 and 4: a Partner who resigns in their phase ends it; one under way finishes as others leave', () => {
  let g = act(roll(afterSetup(6), 3, 5), 'p0', { kind: 'endTurn' });
  g = resignPlayers(g, ['p3'], { reason: 'leave' });
  assert.equal(g.phase, 'roll');
  assert.deepEqual(pair(g), { lead: 'p1', partner: 'p5' });
  // Five at the table; Ben leaves during Dan's phase. The phase finishes, then single turns begin.
  let h = act(roll(afterSetup(5), 3, 5), 'p0', { kind: 'endTurn' });
  h = resignPlayers(h, ['p1'], { reason: 'leave' });
  assert.equal(h.phase, 'partner');
  assert.equal(activePlayer(h).id, 'p3');
  give(h, 'p3', ROAD);
  h = act(h, 'p3', { kind: 'road', edge: gameView(h, 'p3').legal.roads[0]! });
  h = act(h, 'p3', { kind: 'endPhase' });
  assert.equal(h.pair, undefined);
  assert.equal(activePlayer(h).id, 'p2');
});

test('§9.6 rule 5: a robber owed by a resigned Lead falls to the Partner; one owed by a resigned Partner to the next Lead', () => {
  let g = afterSetup(6);
  g = roll(g, 3, 4);
  if (g.phase === 'discard')
    for (const id of Object.keys(g.discards)) g = act(g, id, timeoutAction(g, id, random)!);
  assert.equal(g.phase, 'robber');
  g = resignPlayers(g, ['p0'], { reason: 'leave' });
  assert.equal(activePlayer(g).id, 'p3');
  assert.equal(g.phase, 'robber', 'the Partner moves it, at the start of their phase');
  assert.match(g.log.at(-1)!.text, /Dan begins the Partner's phase\. Move the robber first\.$/);
  g = act(g, 'p3', timeoutAction(g, 'p3', random)!);
  assert.equal(g.phase, 'partner');
  // The Partner plays a Knight and leaves before moving the robber: the next Lead moves it before rolling.
  deal(g, 'p3', 'knight');
  g = act(g, 'p3', { kind: 'playCard', cardId: g.players[3]!.cards.at(-1)!.id });
  g = resignPlayers(g, ['p3'], { reason: 'leave' });
  assert.equal(activePlayer(g).id, 'p1');
  assert.equal(g.phase, 'robber');
  assert.equal(g.returnPhase, 'roll');
  assert.match(g.log.at(-1)!.text, /Move the robber, then roll\.$/);
});

test('§9.6 rule 6: discards owed by a resigned player disappear; a resigned Lead’s robber waits for the others', () => {
  let g = afterSetup(6);
  for (const p of g.players) emptyInto(g, p.id);
  give(g, 'p0', { wood: 8 });
  give(g, 'p4', { ore: 8 });
  g = roll(g, 3, 4);
  assert.deepEqual(g.discards, { p0: 4, p4: 4 });
  g = resignPlayers(g, ['p0'], { reason: 'leave' });
  assert.deepEqual(g.discards, { p4: 4 });
  assert.equal(g.phase, 'discard');
  g = act(g, 'p4', { kind: 'discard', resources: { ...zero(), ore: 4 } });
  assert.equal(activePlayer(g).id, 'p3');
  assert.equal(g.phase, 'robber', 'then the Partner, at the start of their phase, moves the robber');
});

test('§7.2: after each turn every other player gets one build window, clockwise from the next player', () => {
  for (const n of [5, 6]) {
    let g = afterSetup(n, { turns: 'betweenTurnsBuild' });
    g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
    const windows: string[] = [];
    while (g.phase === 'buildWindow') {
      assert.equal(g.turn, 1);
      assert.equal(g.windows?.after, 0);
      windows.push(activePlayer(g).id);
      assert.deepEqual(owedMoves(g), [{ player: activePlayer(g).id, kind: 'buildWindow' }]);
      g = act(g, activePlayer(g).id, { kind: 'endWindow' });
    }
    assert.deepEqual(
      windows,
      seats(n)
        .slice(1)
        .map((p) => p.id),
    );
    assert.equal(g.turn, 2);
    assert.equal(activePlayer(g).id, 'p1', 'the first window went to the next player to take a turn');
    assert.equal(g.windows, undefined);
    // Windows follow every turn, whether or not anyone built during it, and never skip a player, even one who
    // holds no cards.
    for (const p of g.players) emptyInto(g, p.id);
    g = act(roll(g, 3, 5), 'p1', { kind: 'endTurn' });
    assert.equal(activePlayer(g).id, 'p2');
    assert.equal(g.phase, 'buildWindow');
    assert.match(g.log.at(-1)!.text, /^Cat's build window\.$/);
  }
});

test('§7.2: in a window a player builds and buys with the cards in hand, and neither trades nor plays a card', () => {
  let g = afterSetup(5, { turns: 'betweenTurnsBuild' });
  deal(g, 'p1', 'knight');
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(activePlayer(g).id, 'p1');
  give(g, 'p1', { wood: 5, brick: 2, sheep: 2, wheat: 2, ore: 2 });
  const view = gameView(g, 'p1').legal;
  assert.ok(view.roads.length && view.canBuyCard);
  assert.deepEqual(view.playableCards, []);
  assert.throws(
    () => act(g, 'p1', { kind: 'bankTrade', give: 'wood', receive: 'ore' }),
    /No trading in a build window/,
  );
  assert.throws(
    () => act(g, 'p1', { kind: 'offerTrade', give: { ...zero(), wood: 1 }, want: { ...zero(), ore: 1 } }),
    /No trading in a build window/,
  );
  assert.throws(
    () => act(g, 'p1', { kind: 'openTrade', give: { ...zero(), wood: 1 } }),
    /No trading in a build window/,
  );
  assert.throws(
    () => act(g, 'p1', { kind: 'playCard', cardId: g.players[1]!.cards[0]!.id }),
    /No development card is played in a build window/,
  );
  assert.throws(() => act(g, 'p1', { kind: 'roll' }));
  assert.throws(() => act(g, 'p1', { kind: 'endTurn' }), /Close your build window instead/);
  assert.throws(() => act(g, 'p1', { kind: 'endPhase' }), /Finish the current action first/);
  g = act(g, 'p1', { kind: 'road', edge: view.roads[0]! });
  g = act(g, 'p1', { kind: 'buyCard' });
  assert.equal(g.phase, 'buildWindow', 'building does not close the window');
  for (const id of ['p0', 'p2', 'p3', 'p4'])
    assert.throws(() => act(g, id, { kind: 'endWindow' }), /Wait for your turn/);
  g = act(g, 'p1', { kind: 'endWindow' });
  assert.equal(activePlayer(g).id, 'p2');
});

test('§7.4: a card bought in a window is playable from its buyer’s next turn, the one straight after included', () => {
  let g = afterSetup(5, { turns: 'betweenTurnsBuild' });
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  give(g, 'p1', CARD);
  g.deck.push('knight');
  g = act(g, 'p1', { kind: 'buyCard' });
  const card = g.players[1]!.cards.at(-1)!;
  for (let i = 0; i < 4; i++) g = act(g, activePlayer(g).id, { kind: 'endWindow' });
  assert.equal(activePlayer(g).id, 'p1');
  assert.equal(g.phase, 'roll');
  assert.deepEqual(gameView(g, 'p1').legal.playableCards, [card.id], 'before the roll of the next turn');
});

test('§7.5: nobody wins in a window; a player at the target wins as their next turn begins, if still there', () => {
  let g = afterSetup(5, { turns: 'betweenTurnsBuild', victoryPoints: 8 });
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  // Ben builds his way to the target in his window and does not win there.
  pointsTo(g, 'p1', 7);
  give(g, 'p1', SETTLEMENT);
  g = act(g, 'p1', { kind: 'settlement', vertex: openSite(g, 'p1') });
  assert.equal(score(g, g.players[1]!), 8);
  assert.equal(g.winner, null);
  assert.equal(g.phase, 'buildWindow');
  // He is also the next player on turn, and wins as it begins, before rolling.
  for (let i = 0; i < 4; i++) g = act(g, activePlayer(g).id, { kind: 'endWindow' });
  assert.equal(g.winner, 'p1');
  assert.equal(g.dice, null);
  // Cat reaches the target in her window after Ann's turn, but loses Longest Road before her turn comes round.
  let h = afterSetup(5, { turns: 'betweenTurnsBuild', victoryPoints: 8 });
  h = roll(h, 3, 5);
  clearBoard(h);
  const taken = new Set<number>();
  layRoads(h, 'p2', line(h, 5, taken));
  const ben = line(h, 6, taken);
  layRoads(h, 'p1', ben.slice(0, 6));
  h.longestRoad = 'p2';
  pointsTo(h, 'p2', 8);
  h = act(h, 'p0', { kind: 'endTurn' });
  give(h, 'p1', ROAD);
  h = act(h, 'p1', { kind: 'road', edge: edgeBetween(h, ben[5]!, ben[6]!) });
  assert.equal(h.longestRoad, 'p1', 'awards change hands in a window as the Classic rules say');
  assert.equal(h.winner, null);
  for (let i = 0; i < 4; i++) h = act(h, activePlayer(h).id, { kind: 'endWindow' });
  h = act(roll(h, 3, 5), 'p1', { kind: 'endTurn' });
  assert.equal(activePlayer(h).id, 'p2');
  assert.equal(h.winner, null, 'Cat dropped below the target, so the window win never comes');
});

test('§7.2 and §9.6 rule 7: windows go on at any count; a resigning window holder loses it; a resigned turn still has windows', () => {
  let g = afterSetup(5, { turns: 'betweenTurnsBuild' });
  g = resignPlayers(g, ['p3', 'p4'], { reason: 'leave' });
  g = act(roll(g, 3, 5), 'p0', { kind: 'endTurn' });
  assert.equal(g.phase, 'buildWindow', 'three players still have windows');
  assert.equal(activePlayer(g).id, 'p1');
  g = resignPlayers(g, ['p1'], { reason: 'leave' });
  assert.equal(activePlayer(g).id, 'p2', 'the next window begins');
  assert.equal(g.phase, 'buildWindow');
  g = act(g, 'p2', { kind: 'endWindow' });
  assert.equal(activePlayer(g).id, 'p2');
  assert.equal(g.phase, 'roll');
  // The player on turn leaves with a robber owed: windows follow as usual, and the next player on turn moves
  // the robber before rolling.
  let h = afterSetup(6, { turns: 'betweenTurnsBuild' });
  h = roll(h, 3, 4);
  if (h.phase === 'discard')
    for (const id of Object.keys(h.discards)) h = act(h, id, timeoutAction(h, id, random)!);
  assert.equal(h.phase, 'robber');
  h = resignPlayers(h, ['p0'], { reason: 'leave' });
  assert.equal(h.phase, 'buildWindow');
  assert.deepEqual(h.windows, { after: 0, robber: true });
  const robber = h.robber;
  for (let i = 0; i < 5; i++) h = act(h, activePlayer(h).id, { kind: 'endWindow' });
  assert.equal(h.robber, robber, 'the robber never moves in a window');
  assert.equal(activePlayer(h).id, 'p1');
  assert.equal(h.phase, 'robber');
  assert.equal(h.windows, undefined);
});

test('§9.3: a Partner’s phase that runs out ends with nothing bought; its free roads lapse and a Knight’s robber is moved', () => {
  let g = act(roll(afterSetup(5), 3, 5), 'p0', { kind: 'endTurn' });
  give(g, 'p3', { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 });
  assert.deepEqual(timeoutAction(g, 'p3', random), { kind: 'endPhase' });
  assert.equal(timeoutAction(g, 'p0', random), undefined, 'nothing is owed by the Lead');
  const ended = act(g, 'p3', timeoutAction(g, 'p3', random)!);
  assert.deepEqual(ended.players[3]!.hand, g.players[3]!.hand, 'nothing was bought or built');
  assert.equal(ended.turn, 2);
  assert.equal(timeoutDescription({ kind: 'endPhase' }, 'partner'), "Partner's phase ended automatically");
  // Road Building played in the phase: the clock ends it, and the roads still owed stay unplaced.
  deal(g, 'p3', 'roadBuilding');
  let roads = act(g, 'p3', { kind: 'playCard', cardId: g.players[3]!.cards.at(-1)!.id });
  roads = act(roads, 'p3', { kind: 'road', edge: gameView(roads, 'p3').legal.roads[0]! });
  assert.equal(roads.phase, 'freeRoads');
  const lapse = timeoutAction(roads, 'p3', random)!;
  assert.deepEqual(lapse, { kind: 'endPhase', expired: true });
  const before = Object.keys(roads.roads).length;
  const next = act(roads, 'p3', lapse);
  assert.equal(Object.keys(next.roads).length, before, 'no road was placed');
  assert.equal(next.turn, 2);
  assert.equal(next.freeRoads, 0);
  assert.equal(
    timeoutDescription(lapse, 'freeRoads'),
    "Partner's phase ended automatically, with its free roads unplaced",
  );
  // A Partner may not leave free roads unplaced themselves: only the clock ends the phase from there.
  assert.throws(() => act(roads, 'p3', { kind: 'endPhase' }), /Place your free roads first/);
  // A Knight played in the phase: the clock first moves the robber, as it must, then ends the phase.
  deal(g, 'p3', 'knight');
  let knight = act(g, 'p3', { kind: 'playCard', cardId: g.players[3]!.cards.at(-1)!.id });
  const robber = knight.robber;
  const move = timeoutAction(knight, 'p3', random)!;
  assert.equal(move.kind, 'robber');
  knight = act(knight, 'p3', move);
  assert.notEqual(knight.robber, robber);
  assert.equal(knight.phase, 'partner');
  assert.deepEqual(timeoutAction(knight, 'p3', random), { kind: 'endPhase' });
});

test('§9.3: a build window that runs out simply ends, and the next begins', () => {
  let g = act(roll(afterSetup(5, { turns: 'betweenTurnsBuild' }), 3, 5), 'p0', { kind: 'endTurn' });
  give(g, 'p1', { wood: 3, brick: 3, sheep: 3, wheat: 3, ore: 3 });
  assert.deepEqual(timeoutAction(g, 'p1', random), { kind: 'endWindow' });
  const next = act(g, 'p1', timeoutAction(g, 'p1', random)!);
  assert.deepEqual(next.players[1]!.hand, g.players[1]!.hand);
  assert.equal(activePlayer(next).id, 'p2');
  assert.equal(timeoutDescription({ kind: 'endWindow' }, 'buildWindow'), 'build window closed automatically');
});

test('the new moves are parsed like the others: endPhase, with the clock’s mark only as true, and endWindow', () => {
  assert.deepEqual(parseGameAction({ kind: 'endPhase', extra: 1 }), { kind: 'endPhase' });
  assert.deepEqual(parseGameAction({ kind: 'endPhase', expired: true }), { kind: 'endPhase', expired: true });
  for (const expired of [false, 'yes', 1, null])
    assert.throws(() => parseGameAction({ kind: 'endPhase', expired }), /Invalid action/);
  assert.deepEqual(parseGameAction({ kind: 'endWindow', seat: 3 }), { kind: 'endWindow' });
  // In Classic neither is ever legal.
  let classic = createGame(seats(3), 481, random);
  while (classic.turn === 0)
    classic = act(
      classic,
      activePlayer(classic).id,
      timeoutAction(classic, activePlayer(classic).id, random)!,
    );
  classic = roll(classic, 3, 5);
  assert.throws(() => act(classic, activePlayer(classic).id, { kind: 'endPhase' }));
  assert.throws(
    () => act(classic, activePlayer(classic).id, { kind: 'endWindow' }),
    /That action is unavailable/,
  );
});

test('a Big Table game keeps every card and piece accounted for through whole games of both structures', () => {
  for (const turns of ['paired', 'betweenTurnsBuild'] as const)
    for (const n of [5, 6]) {
      const rng = seededRandom(n * 31 + (turns === 'paired' ? 1 : 2));
      let g = createGame(seats(n), n * 7, rng, { ruleset: BIG_TABLE.id, turns });
      for (let step = 0; step < 6000 && g.phase !== 'finished'; step++) {
        const [owed] = owedMoves(g);
        assert.ok(owed, `someone is owed a move during ${g.phase}`);
        const legal = gameView(g, owed.player).legal;
        const building = ['actions', 'partner', 'buildWindow'].includes(owed.kind);
        const action =
          building && legal.settlements.length
            ? { kind: 'settlement' as const, vertex: legal.settlements[0]! }
            : building && legal.cities.length
              ? { kind: 'city' as const, vertex: legal.cities[0]! }
              : building && legal.canBuyCard && rng() < 0.5
                ? { kind: 'buyCard' as const }
                : building && legal.roads.length && rng() < 0.3
                  ? { kind: 'road' as const, edge: legal.roads[0]! }
                  : timeoutAction(g, owed.player, rng)!;
        g = applyAction(g, owed.player, action, rng);
        for (const r of RESOURCES)
          assert.equal(g.bank[r] + g.players.reduce((sum, p) => sum + p.hand[r], 0), 24, r);
        assert.equal(g.deck.length + g.nextCard, 34);
      }
      assert.equal(g.phase, 'finished', `${turns}, ${n} players`);
      assert.ok(g.winner);
    }
});

test('each player’s view shows the Lead, the Partner and the open window, with moves only for the one acting', () => {
  let g = roll(afterSetup(6), 3, 5);
  const view = gameView(g, 'p4');
  assert.deepEqual(view.pair, { lead: 0, partner: 3 });
  assert.equal(view.turns, 'paired');
  g = act(g, 'p0', { kind: 'endTurn' });
  give(g, 'p3', { wood: 1, brick: 1 });
  assert.ok(gameView(g, 'p3').legal.roads.length);
  assert.deepEqual(gameView(g, 'p0').legal.roads, []);
  let w = act(roll(afterSetup(6, { turns: 'betweenTurnsBuild' }), 3, 5), 'p0', { kind: 'endTurn' });
  give(w, 'p1', { wood: 1, brick: 1 });
  assert.deepEqual(gameView(w, 'p5').windows, { after: 0 });
  assert.equal(gameView(w, 'p5').active, 1);
  assert.ok(gameView(w, 'p1').legal.roads.length);
  assert.deepEqual(gameView(w, 'p0').legal.roads, []);
  w = act(w, 'p1', { kind: 'endWindow' });
  assert.equal(gameView(w, 'p5').active, 2);
  // Nothing new appears in a Classic player's view.
  const classic = gameView(createGame(seats(4), 5, random), 'p0');
  for (const key of ['turns', 'pair', 'windows']) assert.equal(key in classic, false, key);
});

test('the Partner’s marker and seat numbers are public, the hands are not', () => {
  const g = roll(afterSetup(5), 3, 5);
  const view = gameView(g, 'p1');
  assert.equal(view.players[3]!.hand, undefined);
  assert.equal(seatOf(g, 'p3'), view.pair!.partner);
});
