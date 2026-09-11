import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAwardCelebrations, deriveFeedback, publicProduction } from '../apps/client/src/feedback.js';
import { PresentationBuffer, presentationHold } from '../apps/client/src/useFeedback.js';
import { nextDicePresentation } from '../apps/client/src/GameEffects.js';
import { DEFAULT_PREFERENCES, parsePreferences } from '../apps/client/src/preferences.js';
import { SoundEngine, soundScore } from '../apps/client/src/sound.js';
import type { SoundCue } from '../apps/client/src/sound.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { activePlayer, applyAction, createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../packages/rules/src/game.js';
import { COSTS, RESOURCES } from '../packages/rules/src/index.js';
import type { Resource } from '../packages/rules/src/index.js';

const seats = ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name }));
function setup(): Game {
  let game = createGame(seats, 82, () => 0.34);
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
function clearHands(game: Game) {
  for (const p of game.players)
    for (const resource of RESOURCES) {
      game.bank[resource] += p.hand[resource];
      p.hand[resource] = 0;
    }
}
function fund(game: Game, id: string, hand: Partial<Hand>) {
  const player = game.players.find((p) => p.id === id)!;
  for (const resource of RESOURCES) {
    const amount = hand[resource] ?? 0;
    assert.ok(game.bank[resource] >= amount);
    game.bank[resource] -= amount;
    player.hand[resource] += amount;
  }
}
function snapshot(game: Game, revision: number, viewer = 'p0'): RoomState {
  return {
    roomId: 'ABCDEFG2',
    revision,
    counter: 0,
    players: seats.map((s) => ({ ...s, connected: true })),
    game: gameView(game, viewer),
  };
}
function move(
  game: Game,
  action: GameAction,
  actor = activePlayer(game).id,
  viewer = 'p0',
  random = () => 0.34,
) {
  const before = snapshot(game, 20, viewer);
  const nextGame = applyAction(game, actor, action, random);
  const after = snapshot(nextGame, 21, viewer);
  return { before, after, game: nextGame, event: deriveFeedback(before, after, viewer)! };
}

test('feedback begins only with a newer committed game snapshot and never changes authoritative input', () => {
  const game = setup(),
    before = snapshot(game, 7),
    saved = structuredClone(before);
  assert.equal(deriveFeedback(null, before, 'p0'), null, 'initial snapshots do not replay the journal');
  assert.equal(deriveFeedback({ ...before, game: undefined }, before, 'p0'), null);
  assert.equal(deriveFeedback(before, { ...before, revision: 8, game: undefined }, 'p0'), null);
  assert.equal(
    deriveFeedback(before, before, 'p0'),
    null,
    'duplicate and presence-only frames do not replay effects',
  );
  assert.equal(deriveFeedback(before, { ...before, revision: 6 }, 'p0'), null);
  assert.equal(deriveFeedback(before, { ...before, roomId: 'HIJKLMN2', revision: 8 }, 'p0'), null);
  assert.throws(() => applyAction(game, 'p1', { kind: 'roll' }, () => 0.34), /Wait for your turn/);
  assert.equal(deriveFeedback(before, before, 'p0'), null, 'a rejected move leaves no presentation event');
  const accepted = move(game, { kind: 'roll' });
  assert.equal(accepted.event.id, 'ABCDEFG2:21');
  assert.deepEqual(before, saved);
  assert.deepEqual(game, setup());
});

test('dice feedback uses the exact committed faces and does not reroll during later actions', () => {
  const game = setup();
  let call = 0;
  const rolled = move(game, { kind: 'roll' }, 'p0', 'p0', () => (call++ ? 0.84 : 0.17));
  assert.deepEqual(rolled.event.dice, [2, 6]);
  assert.equal(rolled.event.sounds.filter((s) => s === 'dice').length, 1);
  assert.ok(!rolled.event.notices.some((s) => s.includes('2 + 6 = 8')), 'faces replace visible arithmetic');
  assert.ok(
    rolled.after.game!.log.some((line) => line.text.includes('2 + 6 = 8')),
    'history keeps the exact result',
  );
  const ended = move(rolled.game, { kind: 'endTurn' });
  assert.equal(ended.event.dice, undefined);
  assert.ok(!ended.event.sounds.includes('dice'));
});

test('a combined automatic roll and end-turn still displays committed faces, and player names cannot forge a roll', () => {
  const game = setup();
  game.players[0]!.name = 'Alice rolled 6 + 6 = 12.';
  const before = snapshot(game, 20);
  const rolled = applyAction(game, 'p0', { kind: 'roll' }, () => 0.17);
  const ended = applyAction(rolled, 'p0', { kind: 'endTurn' }, () => 0.34);
  const event = deriveFeedback(before, snapshot(ended, 22), 'p0')!;
  assert.equal(ended.dice, null);
  assert.deepEqual(event.dice, [2, 2]);
  assert.equal(event.sounds.filter((cue) => cue === 'dice').length, 1);
  assert.equal(
    deriveFeedback(snapshot(rolled, 21), snapshot(ended, 22), 'p0')!.dice,
    undefined,
    'a previously displayed roll is not replayed',
  );
  game.phase = 'actions';
  clearHands(game);
  fund(game, 'p0', COSTS.road);
  const built = move(game, { kind: 'road', edge: gameView(game, 'p0').legal.roads[0]! });
  assert.equal(built.event.dice, undefined, 'roll-like words inside an actor name are not dice evidence');
  const discard = setup();
  clearHands(discard);
  fund(discard, 'p1', { wood: 2 });
  discard.players[1]!.name = 'Alice rolled 6 + 6 = 12.';
  discard.phase = 'discard';
  discard.discards = { p1: 1 };
  discard.dice = [3, 4];
  const discarded = move(discard, { kind: 'discard', resources: { ...emptyHand(), wood: 1 } }, 'p1');
  assert.equal(
    discarded.event.dice,
    undefined,
    'a different name with a valid roll prefix must still match the full canonical roll line',
  );
});

test('resource production flies from its paying tile to the local hand, including two resources for a city', () => {
  const game = setup();
  clearHands(game);
  game.buildings = {};
  const hex = game.board.hexes.find((h) => h.number === 6 && h.terrain !== 'desert')!;
  const resource = hex.terrain as Resource;
  game.buildings[hex.vertices[0]!] = { player: 'p0', kind: 'city' };
  game.buildings[hex.vertices[2]!] = { player: 'p1', kind: 'settlement' };
  const { event, before, after } = move(game, { kind: 'roll' });
  assert.deepEqual(event.glowHexes, [hex.id]);
  assert.deepEqual(
    event.flights.find((f) => f.resource === resource),
    {
      resource,
      amount: 2,
      from: `[data-effect-hex="${hex.id}"]`,
      to: `[data-resource-card="${resource}"]`,
    },
  );
  assert.deepEqual(
    event.flights.find((f) => f.to === '[data-player-profile="p1"]'),
    { resource, amount: 1, from: `[data-effect-hex="${hex.id}"]`, to: '[data-player-profile="p1"]' },
  );
  assert.deepEqual(event.gains, [
    { playerId: 'p0', resource, amount: 2 },
    { playerId: 'p1', resource, amount: 1 },
  ]);
  assert.equal(event.hand[resource], 2);
  assert.deepEqual(event.changed, [resource]);
  assert.ok(event.sounds.includes('gain'));
  assert.equal(before.game!.players[1]!.hand, undefined);
  assert.equal(after.game!.players[1]!.hand, undefined);
});

test('production feedback respects blocked tiles and the bank shortage rules instead of inventing resource gains', () => {
  for (const mode of ['robber', 'shared-shortage', 'sole-shortage'] as const) {
    const game = setup();
    clearHands(game);
    game.buildings = {};
    const hex = game.board.hexes.find((h) => h.number === 6 && h.terrain !== 'desert')!,
      resource = hex.terrain as Resource;
    game.buildings[hex.vertices[0]!] = { player: 'p0', kind: 'city' };
    if (mode === 'robber') game.robber = hex.id;
    else {
      fund(game, 'p2', { [resource]: 18 });
      if (mode === 'shared-shortage') game.buildings[hex.vertices[2]!] = { player: 'p1', kind: 'settlement' };
    }
    const { event } = move(game, { kind: 'roll' });
    const own = event.flights.filter((f) => f.resource !== 'any' && !f.spending);
    assert.equal(
      own.reduce((n, f) => n + f.amount, 0),
      mode === 'sole-shortage' ? 1 : 0,
    );
    assert.deepEqual(event.glowHexes, mode === 'sole-shortage' ? [hex.id] : []);
    assert.equal(event.sounds.includes('gain'), mode === 'sole-shortage');
  }
});

test('public production labels require complete bank and player-count conservation', () => {
  const game = setup();
  clearHands(game);
  game.buildings = {};
  const hex = game.board.hexes.find((h) => h.number === 6 && h.terrain !== 'desert')!,
    resource = hex.terrain as Resource;
  game.buildings[hex.vertices[0]!] = { player: 'p1', kind: 'city' };
  const rolled = move(game, { kind: 'roll' });
  assert.equal(publicProduction(rolled.before.game!, rolled.after.game!, [3, 3])!.get('p1')![resource], 2);
  for (const mode of ['bank', 'count'] as const) {
    const combined = structuredClone(rolled.after);
    if (mode === 'bank') combined.game!.bank[resource]--;
    else combined.game!.players[1]!.resourceCount++;
    assert.equal(publicProduction(rolled.before.game!, combined.game!, [3, 3]), null);
    const event = deriveFeedback(rolled.before, combined, 'p0')!;
    assert.deepEqual(event.glowHexes, [], 'unverified net changes must not claim a producing tile');
    assert.ok(event.gains.filter((gain) => gain.playerId !== 'p0').every((gain) => gain.resource === 'any'));
    assert.ok(
      event.flights
        .filter((flight) => flight.to.includes('player-profile'))
        .every((flight) => flight.resource === 'any'),
    );
    assert.equal(combined.game!.players[1]!.hand, undefined);
  }
});

test('a burst preserves the readable roll then coalesces later moves without changing authoritative snapshots', () => {
  const game = setup();
  clearHands(game);
  fund(game, 'p0', { wood: 4, brick: 4 });
  const roll = move(game, { kind: 'roll' });
  const buffer = new PresentationBuffer();
  const hold = presentationHold(roll.event);
  buffer.begin(roll.after, hold);
  const first = applyAction(
    roll.game,
    'p0',
    {
      kind: 'road',
      edge: gameView(roll.game, 'p0').legal.roads[0]!,
    },
    () => 0.34,
  );
  const one = snapshot(first, 22);
  const second = applyAction(
    first,
    'p0',
    { kind: 'road', edge: gameView(first, 'p0').legal.roads[0]! },
    () => 0.34,
  );
  const two = snapshot(second, 23);
  assert.equal(buffer.offer(roll.after, one, 'p0', 100), null);
  assert.equal(buffer.offer(one, two, 'p0', 200), null);
  const queued = buffer.take()!;
  assert.equal(queued.previous, roll.after);
  assert.equal(queued.next, two);
  const presentation = deriveFeedback(queued.previous, queued.next, queued.me)!;
  assert.equal(presentation.dice, undefined, 'the displayed roll does not replay');
  assert.equal(presentation.sites.length, 2);
  for (const resource of ['wood', 'brick'])
    assert.equal(
      presentation.flights.find((flight) => flight.resource === resource && flight.spending)!.amount,
      2,
    );
  assert.deepEqual(presentation.hand, two.game!.players[0]!.hand);
  assert.equal(buffer.take(), null, 'the bounded range drains once');
  buffer.begin(one, hold);
  buffer.offer(one, two, 'p0', 0);
  buffer.reset();
  assert.equal(buffer.take(), null, 'welcome, hidden tabs and room changes discard queued presentation');
});

test('resync restores dice directly in the dock while a following accepted move preserves the active throw', () => {
  const rolled = move(setup(), { kind: 'roll' });
  const active = nextDicePresentation(null, rolled.event, rolled.game.dice)!;
  assert.equal(active.initiallyDocked, false);
  const ended = move(rolled.game, { kind: 'endTurn' });
  assert.equal(nextDicePresentation(active, ended.event, null), active);
  const restored = nextDicePresentation(active, null, rolled.game.dice)!;
  assert.equal(restored.initiallyDocked, true);
  assert.deepEqual(restored.faces, rolled.event.dice);
  assert.notEqual(restored.id, active.id, 'restoring unmounts any unfinished throw and its timers');
  assert.equal(nextDicePresentation(active, null, null), null);
});

test('construction feedback spends the exact local cards toward the committed road or city and signals the distinct piece', () => {
  for (const kind of ['road', 'city'] as const) {
    const game = setup();
    clearHands(game);
    game.phase = 'actions';
    fund(game, 'p0', COSTS[kind]);
    const legal = gameView(game, 'p0').legal;
    const id = kind === 'road' ? legal.roads[0]! : legal.cities[0]!;
    const action: GameAction = kind === 'road' ? { kind, edge: id } : { kind, vertex: id };
    const { event } = move(game, action);
    const site = kind === 'road' ? `[data-road-id="${id}"]` : `[data-building-id="${id}"]`;
    assert.deepEqual(event.sites, [site]);
    assert.ok(event.sounds.includes(kind));
    assert.ok(event.sounds.includes('spend'));
    const costs = RESOURCES.filter((r) => COSTS[kind][r]).map((resource) => ({
      resource,
      amount: COSTS[kind][resource],
      from: `[data-resource-card="${resource}"]`,
      to: site,
      spending: true,
    }));
    assert.deepEqual(event.flights, costs);
    assert.deepEqual(event.hand, emptyHand());
    assert.ok(!event.notices.some((line) => /on edge \d+|at corner \d+/.test(line)));
  }
});

test('other players see construction and public development play without seeing a purchased development face', () => {
  const game = setup();
  clearHands(game);
  game.phase = 'actions';
  game.active = 1;
  fund(game, 'p1', COSTS.city);
  const upgraded = move(game, { kind: 'city', vertex: gameView(game, 'p1').legal.cities[0]! }, 'p1');
  assert.ok(upgraded.event.sounds.includes('city'));
  assert.ok(upgraded.event.notices.some((line) => line.includes('Bob built a city')));
  assert.equal(upgraded.event.flights.length, 0, 'opponent spending never displays that private hand');
  fund(upgraded.game, 'p1', COSTS.developmentCard);
  upgraded.game.deck = ['knight'];
  const purchased = move(upgraded.game, { kind: 'buyCard' }, 'p1');
  assert.ok(purchased.event.sounds.includes('development'));
  assert.ok(!JSON.stringify(purchased.event).includes('knight'));
  assert.equal(purchased.after.game!.players[1]!.cards, undefined);
  purchased.game.players[1]!.cards[0]!.boughtTurn = 0;
  const played = move(
    purchased.game,
    { kind: 'playCard', cardId: purchased.game.players[1]!.cards[0]!.id },
    'p1',
  );
  assert.ok(played.event.sounds.includes('knight'));
  assert.ok(played.event.notices.some((line) => line.includes('played Knight')));
});

test('a robber loss travels from the local hand toward the robber while the beneficiary still receives only a card back', () => {
  const game = setup();
  clearHands(game);
  fund(game, 'p0', { ore: 3 });
  game.phase = 'robber';
  game.returnPhase = 'actions';
  game.active = 1;
  const hex = game.board.hexes.find(
    (h) => h.id !== game.robber && h.vertices.some((v) => game.buildings[v]?.player === 'p0'),
  )!;
  const { event, after } = move(game, { kind: 'robber', hex: hex.id, victim: 'p0' }, 'p1');
  assert.deepEqual(
    event.flights.find((flight) => flight.spending),
    {
      resource: 'ore',
      amount: 1,
      from: '[data-resource-card="ore"]',
      to: `[data-effect-hex="${hex.id}"]`,
      spending: true,
    },
  );
  const received = event.flights.find((flight) => flight.to === '[data-player-profile="p1"]')!;
  assert.equal(received.resource, 'any');
  assert.equal(after.game!.players[1]!.hand, undefined);
  assert.ok(event.sounds.includes('robber'));
  assert.ok(!event.sounds.includes('trade'));
});

test('actual trades have a public sound for observers, while Monopoly and suggestive player names do not masquerade as trading', () => {
  const game = setup();
  clearHands(game);
  game.phase = 'actions';
  game.active = 1;
  fund(game, 'p1', { wood: 1 });
  fund(game, 'p2', { sheep: 1 });
  const offered = applyAction(
    game,
    'p1',
    { kind: 'offerTrade', give: { ...emptyHand(), wood: 1 }, want: { ...emptyHand(), sheep: 1 } },
    () => 0.34,
  );
  const traded = move(offered, { kind: 'acceptTrade', tradeId: offered.trade!.id }, 'p2');
  assert.ok(
    traded.event.sounds.includes('trade'),
    'observers hear a trade even when their own hand stays unchanged',
  );
  const maritime = setup();
  clearHands(maritime);
  maritime.phase = 'actions';
  maritime.active = 1;
  fund(maritime, 'p1', { wood: 4 });
  const bankTrade = move(maritime, { kind: 'bankTrade', give: 'wood', receive: 'sheep' }, 'p1');
  assert.ok(
    bankTrade.event.sounds.includes('trade'),
    'public bank deltas identify an observer’s maritime trade',
  );
  assert.deepEqual(bankTrade.event.hand, emptyHand());
  const monopoly = setup();
  clearHands(monopoly);
  monopoly.phase = 'actions';
  monopoly.active = 1;
  fund(monopoly, 'p0', { wood: 3 });
  monopoly.players[1]!.cards = [{ id: 'old-monopoly', kind: 'monopoly', boughtTurn: 0 }];
  const seized = move(monopoly, { kind: 'playCard', cardId: 'old-monopoly', resource: 'wood' }, 'p1');
  assert.ok(seized.event.sounds.includes('development'));
  assert.ok(!seized.event.sounds.includes('trade'), 'Monopoly is a development action, not an agreed trade');
  const misleading = setup();
  misleading.players[0]!.name = 'Alice played Knight traded';
  misleading.phase = 'actions';
  clearHands(misleading);
  fund(misleading, 'p0', COSTS.road);
  const built = move(misleading, { kind: 'road', edge: gameView(misleading, 'p0').legal.roads[0]! });
  assert.ok(!built.event.sounds.includes('trade') && !built.event.sounds.includes('knight'));
});

test('award celebrations and win cues follow the committed state without duplicate award or turn sounds', () => {
  const game = setup(),
    before = snapshot(game, 10),
    after = structuredClone(before);
  after.revision++;
  after.game!.longestRoad = 'p0';
  assert.equal(deriveAwardCelebrations(before, after)[0]!.name, 'Longest Road');
  assert.ok(
    !deriveFeedback(before, after, 'p0')!.sounds.includes('award'),
    'the displayed award toast owns its cue',
  );
  const won = structuredClone(after);
  won.revision++;
  won.game!.winner = 'p0';
  won.game!.phase = 'finished';
  assert.ok(deriveFeedback(after, won, 'p0')!.sounds.includes('win'));
  assert.ok(!deriveFeedback(after, won, 'p0')!.sounds.includes('award'));
  game.phase = 'actions';
  const ended = move(game, { kind: 'endTurn' });
  assert.ok(!ended.event.sounds.includes('turn'));
  assert.ok(ended.event.notices.some((line) => line.includes('Bob')));
});

test('all original sound cues are short, finite, non-silent, and safely bounded', async () => {
  const cues: Record<SoundCue, true> = {
    ui: true,
    hover: true,
    road: true,
    settlement: true,
    city: true,
    dice: true,
    gain: true,
    spend: true,
    trade: true,
    development: true,
    knight: true,
    robber: true,
    turn: true,
    award: true,
    win: true,
    warning: true,
    error: true,
    join: true,
  };
  for (const cue of Object.keys(cues) as SoundCue[]) {
    const notes = soundScore(cue);
    assert.ok(notes.length > 0 && notes.length <= 32, cue);
    for (const note of notes) {
      for (const value of [note.at, note.duration, note.gain, note.frequency])
        assert.ok(Number.isFinite(value), cue);
      assert.ok(note.at >= 0 && note.duration > 0.006 && note.at + note.duration < 1.5, cue);
      assert.ok(note.gain > 0 && note.gain <= 0.25, cue);
      assert.ok(note.frequency >= 0 && note.frequency < 20000, cue);
      if (note.wave !== 'noise') assert.ok(note.frequency > 0, cue);
      if (note.endFrequency !== undefined)
        assert.ok(Number.isFinite(note.endFrequency) && note.endFrequency > 0 && note.endFrequency < 20000);
      if (note.filter !== undefined)
        assert.ok(Number.isFinite(note.filter) && note.filter > 0 && note.filter <= 20000);
    }
  }
  const engine = new SoundEngine(() => ({ ...DEFAULT_PREFERENCES, sound: false }));
  await engine.unlock();
  assert.doesNotThrow(() => {
    engine.play('dice');
    engine.refresh();
    engine.silence();
    engine.dispose();
  });
});

test('saved preferences accept only known booleans and a finite clamped volume', () => {
  for (const value of [
    null,
    undefined,
    true,
    'malformed',
    [],
    { sound: 'yes', volume: NaN },
    { volume: Infinity },
  ])
    assert.deepEqual(parsePreferences(value), DEFAULT_PREFERENCES);
  assert.deepEqual(
    parsePreferences({
      sound: false,
      volume: 4,
      motion: false,
      depth: false,
      boardTilt: false,
      activity: false,
      extra: true,
    }),
    { sound: false, volume: 1, music: false, musicVolume: 0.3 },
  );
  assert.equal(parsePreferences({ volume: -0.5 }).volume, 0);
  assert.equal(parsePreferences({ volume: 0.37 }).volume, 0.37);
});
