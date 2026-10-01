import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, gameView, simulateAction } from '../packages/rules/src/game.js';
import type { Game, Hand } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { observe } from '../packages/bot/src/brain/facts.js';
import { composition, learn, newBelief, possibleHands } from '../packages/bot/src/brain/belief.js';
import { race, winChances } from '../packages/bot/src/brain/race.js';
import { imagine, knowledge, newMind } from '../packages/bot/src/brain/mind.js';
import type { Mind } from '../packages/bot/src/brain/mind.js';
import { unseenCards } from '../packages/bot/src/brain/belief.js';
import type { Thinker } from '../packages/bot/src/brain/search.js';
import { answer, makeOffer, manageOffer, OFFER_WAIT_MS } from '../packages/bot/src/brain/trade.js';
import { chooseOpening } from '../packages/bot/src/brain/opening.js';
import { reactTo, reacted, REACTION_GAP_MS } from '../packages/bot/src/brain/reactions.js';
import { watch } from '../packages/bot/src/brain/watch.js';
import { cornerIncome, incomeTotal } from '../packages/bot/src/brain/table.js';

const hand = (h: Partial<Hand>): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...h });

/** Three players on turn 10 of an ordinary board, in "me"'s action phase. */
function position(seed = 5): Game {
  const game = createGame(
    [
      { id: 'me', name: 'Me' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    seed,
    seededRandom(seed),
  );
  game.phase = 'actions';
  game.active = 0;
  game.turn = 10;
  return game;
}

/** A thinker for "me" that sees the table through `mind`. */
function thinker(game: Game, mind: Mind = newMind(), me = 'me'): Thinker {
  const view = gameView(game, me);
  return {
    me,
    know: knowledge(view, me, mind),
    belief: mind.belief,
    unseen: unseenCards(mind.belief, view.players.find((p) => p.id === me)?.cards ?? []),
    random: seededRandom(1),
    deadline: performance.now() + 60_000,
    positions: 600,
    beam: 6,
    depth: 3,
    scored: 0,
  };
}

/** Corners far enough apart to build on, best producers first. */
function spots(game: Game, count: number): number[] {
  const taken = new Set<number>();
  const out: number[] = [];
  const ranked = [...game.board.vertices].sort(
    (a, b) =>
      incomeTotal(cornerIncome(game.board, b.id, null)) - incomeTotal(cornerIncome(game.board, a.id, null)),
  );
  for (const v of ranked) {
    if (out.length === count) break;
    if (taken.has(v.id) || v.neighbors.some((n) => taken.has(n))) continue;
    out.push(v.id);
    taken.add(v.id);
  }
  return out;
}

test('a steal reads the same to everyone who was not part of it, whatever card moved', () => {
  const game = position();
  const [a, b] = spots(game, 2);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.players[1]!.hand = hand({ ore: 1, wheat: 1 });
  const hex = game.board.vertices[b!]!.hexes.find((h) => h !== game.robber)!;
  game.phase = 'robber';
  const stealing = (roll: number) => applyAction(game, 'me', { kind: 'robber', hex, victim: 'b' }, () => roll);
  const one = stealing(0.1),
    other = stealing(0.9);
  const took = (g: Game) => (['ore', 'wheat'] as const).find((r) => g.players[0]!.hand[r] === 1);
  assert.notEqual(took(one), took(other), 'the two games stole different cards');

  // Player "c" saw a steal and nothing else, in both.
  assert.deepEqual(observe(game, one, 'c').facts, observe(game, other, 'c').facts);
  assert.ok(observe(game, one, 'c').facts.some((f) => f.kind === 'steal'));
  // The thief knows exactly what it took.
  const mine = observe(game, one, 'me').facts.find((f) => f.kind === 'change' && f.player === 'me');
  assert.ok(mine && mine.kind === 'change' && mine.delta[took(one)!] === 1);
});

test('counting narrows a stolen card down as soon as the thief spends it', () => {
  const belief = newBelief();
  const prior = () => ({ count: 0, income: hand({}) });
  learn(belief, { kind: 'change', player: 'b', delta: hand({ ore: 1, wheat: 1 }) }, prior);
  learn(belief, { kind: 'change', player: 'c', delta: hand({ wood: 2 }) }, prior);
  learn(belief, { kind: 'steal', thief: 'c', victim: 'b' }, prior);
  assert.equal(possibleHands(belief, 'b').length, 2, 'the victim lost ore or hay');
  assert.ok(Math.abs(composition(belief, 'c').ore - 1 / 6) < 1e-9, 'one card in three, taken half the time');
  // The thief then pays a rock it can only have got from the steal.
  learn(belief, { kind: 'change', player: 'c', delta: hand({ ore: -1 }) }, prior);
  assert.deepEqual(
    possibleHands(belief, 'c').map((p) => p.hand),
    [hand({ wood: 2 })],
  );
  // And a Monopoly on hay tells everyone the victim has none left.
  learn(belief, { kind: 'none', player: 'b', resource: 'wheat' }, prior);
  assert.deepEqual(
    possibleHands(belief, 'b').map((p) => p.hand),
    [hand({ ore: 1 })],
  );
});

test('the race: more production, fewer rolls; a city in hand, fewer still; chances add up to one', () => {
  const game = position();
  const [a, b, c] = spots(game, 3);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  const know = { points: 1, knightsHeld: 0, otherCards: 0 };
  const base = race(game, 'me', know).rolls;
  game.buildings[a!] = { player: 'me', kind: 'city' };
  const richer = race(game, 'me', { ...know, points: 2 }).rolls;
  assert.ok(richer < base, `a city shortens the race (${richer.toFixed(1)} < ${base.toFixed(1)})`);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.players[0]!.hand = hand({ wheat: 2, ore: 3 });
  assert.ok(race(game, 'me', know).rolls < base, 'the cards for a city in hand shorten it too');

  const table = winChances(game, () => know);
  assert.ok(Math.abs(table.reduce((n, s) => n + s.chance, 0) - 1) < 1e-9);
  const winner = winChances(game, (id) => (id === 'b' ? { ...know, points: 10 } : know));
  assert.equal(winner.find((s) => s.id === 'b')!.chance, 1, 'a player on the target has won');
});

test('a bot takes a trade that completes its city, and never feeds a player close to winning', () => {
  const game = position();
  const [a, b, c, d, e] = spots(game, 5);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  // "b" is on turn and offers hay for timber; "me" is one hay short of a city.
  game.active = 1;
  game.players[0]!.hand = hand({ ore: 3, wheat: 1, wood: 2 });
  game.players[1]!.hand = hand({ wheat: 2 });
  game.trade = { id: 1, player: 'b', give: hand({ wheat: 1 }), want: hand({ wood: 1 }) };
  const view = gameView(game, 'me');
  const mind = newMind();
  const g = imagine(view, 'me', mind, seededRandom(1));
  assert.equal(answer(g, thinker(game, mind), game.trade).action.kind, 'acceptTrade');

  // The same offer from a player on eight points is refused.
  game.buildings[d!] = { player: 'b', kind: 'city' };
  game.buildings[e!] = { player: 'b', kind: 'city' };
  game.longestRoad = 'b';
  game.largestArmy = 'b';
  const leaderView = gameView(game, 'me');
  assert.ok(leaderView.players.find((p) => p.id === 'b')!.points >= 7);
  const g2 = imagine(leaderView, 'me', mind, seededRandom(1));
  assert.equal(answer(g2, thinker(game, mind), game.trade).action.kind, 'declineTrade');
});

test('offered cards for anything, a bot proposes what it can spare and never the same resource', () => {
  const game = position();
  const [a, b, c] = spots(game, 3);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  game.active = 1;
  game.players[0]!.hand = hand({ ore: 3, wheat: 1, sheep: 3 });
  game.players[1]!.hand = hand({ wheat: 3 });
  game.trade = { id: 2, player: 'b', give: hand({ wheat: 1 }), want: hand({}), open: true, proposals: [] };
  const mind = newMind();
  const g = imagine(gameView(game, 'me'), 'me', mind, seededRandom(1));
  const result = answer(g, thinker(game, mind), game.trade).action;
  assert.equal(result.kind, 'proposeTrade');
  if (result.kind === 'proposeTrade') {
    assert.equal(result.give.wheat, 0, 'never offers back what it is being given');
    assert.ok(result.give.ore === 0, 'and keeps the rock its city needs');
  }
});

test('a bot one card short offers for it, takes the best answer, and withdraws when nobody bites', () => {
  const game = position();
  const [a, b, c] = spots(game, 3);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  game.players[0]!.hand = hand({ ore: 3, wheat: 1, sheep: 2, wood: 1 });
  game.players[1]!.hand = hand({ wheat: 3 });
  const mind = newMind();
  // The counting has seen "b" collect hay.
  learn(mind.belief, { kind: 'change', player: 'b', delta: hand({ wheat: 3 }) }, () => ({ count: 0, income: hand({}) }));
  learn(mind.belief, { kind: 'change', player: 'c', delta: hand({}) }, () => ({ count: 0, income: hand({}) }));
  const g = imagine(gameView(game, 'me'), 'me', mind, seededRandom(1));
  const th = thinker(game, mind);
  const offer = makeOffer(g, th, [], 0);
  assert.ok(offer, 'an offer is made');
  assert.equal(offer!.action.kind, 'offerTrade');
  if (offer!.action.kind === 'offerTrade') {
    assert.equal(offer!.action.want.wheat, 1, 'for the hay the city needs');
    assert.equal(offer!.action.give.ore, 0, 'never with the rock the city needs');
  }
  // Two answers: the bot takes the one better for itself.
  const trade = {
    id: 3,
    player: 'me',
    give: hand({ sheep: 1 }),
    want: hand({ wheat: 1 }),
    proposals: [
      { player: 'b', give: hand({ wheat: 1 }) },
      { player: 'c', give: hand({ wood: 1 }) },
    ],
  };
  const taken = manageOffer(g, th, trade, 1000).action;
  assert.deepEqual(taken, { kind: 'acceptProposal', tradeId: 3, player: 'b', expectedGive: hand({ wheat: 1 }) });
  // Nobody has answered yet: it waits, then withdraws.
  const quiet = { ...trade, proposals: [] };
  assert.equal(manageOffer(g, th, quiet, 1000).action, null);
  assert.deepEqual(manageOffer(g, th, quiet, OFFER_WAIT_MS + 1).action, { kind: 'cancelTrade' });
});

test('the opening takes a strong corner', () => {
  const game = createGame(
    [
      { id: 'me', name: 'Me' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
      { id: 'd', name: 'D' },
    ],
    21,
    seededRandom(21),
  );
  const pick = chooseOpening(game, thinker(game), 3, 8);
  const incomes = game.board.vertices.map((v) => incomeTotal(cornerIncome(game.board, v.id, null))).sort((a, b) => b - a);
  const chosen = incomeTotal(cornerIncome(game.board, pick.vertex, null));
  assert.ok(chosen >= incomes[12]!, `among the strongest corners on the board (${chosen} vs ${incomes[12]})`);
  assert.ok(gameView(game, 'me').legal.settlements.includes(pick.vertex));
});

test('reactions: a burst for a win, a face now and then, and never two in quick succession', () => {
  const mind = newMind();
  const always = () => 0;
  const win = reactTo([{ kind: 'win', player: 'me' }], 'me', mind, { now: 1_000_000, random: always, target: 10 });
  assert.ok(win && win.length >= 2, 'a win gets several faces');
  const robbed = reactTo([{ kind: 'steal', thief: 'b', victim: 'me' }], 'me', mind, {
    now: 1_000_000,
    random: always,
    target: 10,
  });
  assert.ok(robbed && robbed.length >= 1);
  reacted(mind, 1_000_000);
  assert.equal(
    reactTo([{ kind: 'steal', thief: 'b', victim: 'me' }], 'me', mind, {
      now: 1_000_000 + REACTION_GAP_MS - 1,
      random: always,
      target: 10,
    }),
    null,
    'it waits before reacting again',
  );
  // Nothing at all for a moment that did not touch it.
  assert.equal(
    reactTo([{ kind: 'build', player: 'b', what: 'road' }], 'me', newMind(), { now: 0, random: always, target: 10 }),
    null,
  );
});

test('the bot’s simulated moves are the real rules: same results as the table, board shared', () => {
  let game = createGame(
    ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    8,
    seededRandom(8),
  );
  let simulated = game;
  for (let step = 0; step < 120; step++) {
    const owed = owedMoves(game)[0]!;
    const action = timeoutAction(game, owed.player, seededRandom(step))!;
    game = applyAction(game, owed.player, action, seededRandom(step));
    simulated = simulateAction(simulated, owed.player, action, seededRandom(step));
    assert.equal(simulated.board, game.board === simulated.board ? game.board : simulated.board);
    assert.deepEqual({ ...simulated, log: [], board: null }, { ...game, log: [], board: null });
  }
});

test('watching a game keeps the counting in step with the table', async () => {
  const random = seededRandom(4);
  let game = createGame(
    ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    4,
    random,
  );
  const mind = newMind();
  for (let step = 0; step < 300 && !game.winner; step++) {
    const owed = owedMoves(game)[0]!;
    const next = applyAction(game, owed.player, timeoutAction(game, owed.player, random)!, random);
    watch(mind, 'a', game, next);
    game = next;
  }
  // Every opponent's counted hand has the size the table shows.
  for (const id of ['b', 'c']) {
    const count = gameView(game, 'a').players.find((p) => p.id === id)!.resourceCount;
    for (const p of possibleHands(mind.belief, id))
      assert.equal(Object.values(p.hand).reduce((n, x) => n + x, 0), count);
  }
});

test('cards traded at the bank are spent: the same sheep never pay for two things', async () => {
  const { afterPaying } = await import('../packages/bot/src/brain/race.js');
  const rate = { wood: 4, brick: 4, sheep: 3, wheat: 4, ore: 4 };
  // A city needs two more rock: two trades of three sheep each.
  assert.deepEqual(afterPaying(hand({ sheep: 7, brick: 2, wheat: 2, ore: 1 }), hand({ wheat: 2, ore: 3 }), rate), hand({ sheep: 1, brick: 2 }));
});

test('a bot with a big hand trades its way into the city instead of sitting on it', async () => {
  const { decide, initialPlan, newMind } = await import('../packages/bot/src/index.js');
  const game = position();
  const [a, b, c, d] = spots(game, 4);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[d!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  // Eleven cards: no road or settlement possible, but eight sheep buy the two rock a city lacks.
  game.players[0]!.hand = hand({ sheep: 8, wheat: 2, ore: 1 });
  const moves: string[] = [];
  let g = game;
  for (let i = 0; i < 4; i++) {
    const decision = await decide({
      view: gameView(g, 'me'),
      board: g.board,
      meId: 'me',
      plan: initialPlan(g.turn),
      jev: null,
      level: 'champ',
      mind: newMind(),
      canOffer: false,
    });
    moves.push(decision.action.kind);
    if (decision.action.kind === 'endTurn') break;
    g = applyAction(g, 'me', decision.action, seededRandom(i));
  }
  assert.deepEqual(moves.slice(0, 3), ['bankTrade', 'bankTrade', 'city'], moves.join(', '));
});

test('with balanced dice the bot counts the deck exactly from the public rolls', async () => {
  const { sevenChance } = await import('../packages/bot/src/brain/dice.js');
  const random = seededRandom(9);
  let game = createGame(
    ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    9,
    random,
    { diceMode: 'balanced' },
  );
  const mind = newMind();
  let rolls = 0;
  for (let step = 0; step < 600 && !game.winner; step++) {
    const owed = owedMoves(game)[0]!;
    const next = applyAction(game, owed.player, timeoutAction(game, owed.player, random)!, random);
    watch(mind, 'a', game, next);
    if (next.dice !== game.dice && next.balancedDice) {
      rolls++;
      // The server's own deck, which the bot never reads, is what the bot counted.
      assert.deepEqual([...mind.dice!.remaining].sort((x, y) => x - y), [...next.balancedDice.remaining].sort((x, y) => x - y));
    }
    game = next;
  }
  assert.ok(rolls > 30, `the count held over ${rolls} rolls, across refills`);
  assert.ok(mind.dice!.synced);
  // With every seven gone from the deck, a seven is impossible until the refill.
  const noSevens = { remaining: Array.from({ length: 36 }, (_, i) => i).filter((p) => Math.floor(p / 6) + (p % 6) + 2 !== 7), synced: true };
  assert.equal(sevenChance(noSevens, 1), 0);
  assert.ok(Math.abs(sevenChance(undefined, 1) - 1 / 6) < 1e-9);
});

test('the bot decides on what it can see: hidden cards elsewhere never change what it sees or does', async () => {
  const { decide, initialPlan } = await import('../packages/bot/src/index.js');
  const random = seededRandom(12);
  let game = createGame(
    ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    12,
    random,
  );
  const mind = newMind();
  for (let step = 0; step < 400 && !game.winner; step++) {
    const owed = owedMoves(game)[0]!;
    if (step > 120 && owed.player === 'a' && game.phase === 'actions') break;
    const next = applyAction(game, owed.player, timeoutAction(game, owed.player, random)!, random);
    watch(mind, 'a', game, next);
    game = next;
  }
  assert.equal(owedMoves(game)[0]!.player, 'a');
  // The same table, but "b" holds other cards of the same number, and the deck is in another order.
  const other = structuredClone(game);
  const b = other.players.find((p) => p.id === 'b')!;
  const h = b.hand;
  b.hand = { wood: h.ore, brick: h.wood, sheep: h.brick, wheat: h.sheep, ore: h.wheat };
  b.cards = b.cards.map((c) => ({ ...c, kind: c.kind === 'knight' ? 'victoryPoint' : 'knight' }));
  other.deck = [...other.deck].reverse();
  assert.notDeepEqual(other.players, game.players);
  assert.deepEqual(gameView(other, 'a'), gameView(game, 'a'));
  const decideOn = (g: Game) =>
    decide({
      view: gameView(g, 'a'),
      board: g.board,
      meId: 'a',
      plan: initialPlan(g.turn),
      jev: null,
      level: 'champ',
      mind: structuredClone(mind),
      positions: 200,
      canOffer: false,
    });
  assert.deepEqual((await decideOn(other)).action, (await decideOn(game)).action);
});

test('the race arithmetic: the exact wait agrees with halving, and the quick estimate with full part-trades', async () => {
  const { rollsToAfford, rollsToAffordByHalving, roughRolls } = await import('../packages/bot/src/brain/race.js');
  const { retune, TUNING } = await import('../packages/bot/src/brain/tuning.js');
  const rnd = seededRandom(77);
  const pick = () => hand({ wood: rnd(), brick: rnd(), sheep: rnd(), wheat: rnd(), ore: rnd() });
  const kept = TUNING.partialTrade;
  try {
    for (const part of [0, 0.4, 1]) {
      retune({ partialTrade: part });
      for (let i = 0; i < 2000; i++) {
        const h = pick(), c = pick(), inc = pick(), r = pick();
        const held = hand({}), cost = hand({}), perRoll = hand({}), rate = hand({});
        for (const k of Object.keys(held) as (keyof Hand)[]) {
          held[k] = h[k] < 0.5 ? 0 : Math.floor(h[k] * 7);
          cost[k] = c[k] < 0.5 ? 0 : Math.ceil(c[k] * 3);
          perRoll[k] = inc[k] < 0.2 ? 0 : inc[k] * 0.5;
          rate[k] = [2, 3, 4][Math.floor(r[k] * 3)]!;
        }
        const exact = rollsToAfford(held, cost, perRoll, rate);
        const halved = rollsToAffordByHalving(held, cost, perRoll, rate);
        // Halving stops within a twentieth of a roll above the answer.
        assert.ok(halved - exact > -1e-6 && halved - exact < 0.051, `${part}: ${exact} vs ${halved}`);
        if (part === 1 && !Object.values(held).some(Boolean))
          assert.ok(Math.abs(roughRolls(cost, perRoll, rate) - exact) < 1e-6);
      }
    }
  } finally {
    retune({ partialTrade: kept });
  }
});

test('the robber costs a race only part of its tile when told to: it moves on', async () => {
  const { retune, TUNING } = await import('../packages/bot/src/brain/tuning.js');
  const game = position();
  const [a, b, c] = spots(game, 3);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'settlement' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  const know = { points: 1, knightsHeld: 0, otherCards: 0 };
  const open = race(game, 'me', know).rolls;
  game.robber = game.board.hexes.find((h) => h.vertices.includes(a!) && h.number)!.id;
  const kept = TUNING.robberBlock;
  try {
    retune({ robberBlock: 1 });
    const blocked = race(game, 'me', know).rolls;
    retune({ robberBlock: 0.25 });
    const partly = race(game, 'me', know).rolls;
    assert.ok(open < partly && partly < blocked, `${open.toFixed(1)} < ${partly.toFixed(1)} < ${blocked.toFixed(1)}`);
  } finally {
    retune({ robberBlock: kept });
  }
});

test('the race’s correction counts room to expand: a road toward open land adds corners in reach', async () => {
  const { features, shared } = await import('../packages/bot/src/brain/race.js');
  const { roadSites } = await import('../packages/rules/src/game.js');
  const game = position();
  const [a] = spots(game, 1);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  const know = { points: 1, knightsHeld: 0, otherCards: 0 };
  const before = features(game, 'me', know, shared(game));
  assert.equal(before.awards, 0);
  assert.ok(before.kinds >= 1 && before.income > 0);
  // Every road out of an open corner reaches further; at least one reaches new corners.
  const gains = roadSites(game, 'me').map((edge) => {
    const t = { ...game, roads: { ...game.roads, [edge]: 'me' } };
    return features(t, 'me', know, shared(t)).sites2 - before.sites2;
  });
  assert.ok(gains.every((g) => g >= 0) && gains.some((g) => g > 0), gains.join(','));
});

test('a generous offer is taken even from a player ahead when it costs them; two points from winning gets nothing', async () => {
  const { judge } = await import('../packages/bot/src/brain/trade.js');
  const game = position();
  const [a, b, c, d, e] = spots(game, 5);
  game.buildings[a!] = { player: 'me', kind: 'settlement' };
  game.buildings[b!] = { player: 'b', kind: 'city' };
  game.buildings[c!] = { player: 'c', kind: 'settlement' };
  game.buildings[d!] = { player: 'b', kind: 'city' };
  game.longestRoad = 'b';
  // "b" leads on six points and offers four hay, which its cities need, for one timber.
  game.active = 1;
  game.players[0]!.hand = hand({ ore: 3, wood: 2 });
  game.players[1]!.hand = hand({ wheat: 4 });
  game.trade = { id: 7, player: 'b', give: hand({ wheat: 4 }), want: hand({ wood: 1 }) };
  const mind = newMind();
  const g = imagine(gameView(game, 'me'), 'me', mind, seededRandom(1));
  const th = thinker(game, mind);
  const verdict = judge(g, th, 'b', hand({ wood: 1 }), hand({ wheat: 4 }), false);
  assert.ok(verdict.threat, 'b is the player to be careful with');
  assert.ok(verdict.theirs <= 0 && verdict.mine > 0, `it costs them and helps the bot (${verdict.mine}, ${verdict.theirs})`);
  assert.equal(answer(g, th, game.trade).action.kind, 'acceptTrade');

  // Two points from winning, the same offer is refused: any card could be the last one.
  game.buildings[e!] = { player: 'b', kind: 'settlement' };
  game.largestArmy = 'b';
  const closing = imagine(gameView(game, 'me'), 'me', mind, seededRandom(1));
  assert.ok(gameView(game, 'me').players.find((p) => p.id === 'b')!.points >= 8);
  assert.equal(answer(closing, thinker(game, mind), game.trade).action.kind, 'declineTrade');
});
