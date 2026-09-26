/**
 * Big Table on the server: the room's turn structure, the clocks of the Partner's phase and the build windows
 * (docs/TURN_CLOCK.md, "New clocks"), the absence rule acting in them, and turn times read back by whoever
 * acted. Section numbers are the Big Table rulebook's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { ABSENCE_AFTER_MS } from '../apps/server/src/store.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, gameView } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { parseRoomSettings, partnerSeconds } from '../packages/protocol/src/settings.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import { OPEN, bigTableRoom, throughSetup } from './big-table-room.js';
import type { Room } from './big-table-room.js';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const lines = (g: Game) => g.log.map((line) => line.text);
/** The Lead of the paired turn under way rolls an 8 (the store's dice come from its own random) and ends. */
function leadEnds(room: Room) {
  const g = room.game();
  const lead = activePlayer(g).id;
  if (g.phase === 'roll') room.act(lead, { kind: 'roll' });
  // A seven hands out discards and a robber move first.
  for (let guard = 0; guard < 12 && room.game().phase !== 'actions'; guard++) room.step();
  room.act(lead, { kind: 'endTurn' });
}

test('a room picks Big Table and its turns: kept when a tab leaves them out, reset with the mode, frozen at Start', () => {
  assert.deepEqual(
    parseRoomSettings({ turnTimerSeconds: 90, mode: BIG_TABLE.id, turns: 'betweenTurnsBuild' }),
    {
      turnTimerSeconds: 90,
      mode: BIG_TABLE.id,
      turns: 'betweenTurnsBuild',
    },
  );
  for (const turns of ['paired ', 'Paired turns', 1, null])
    assert.throws(() => parseRoomSettings({ turnTimerSeconds: 90, turns }), /Choose Paired turns or Between/);
  const store = new Store(':memory:', { modes: OPEN });
  try {
    const host = store.enter('create', newSession('Ann').token, 'Ann');
    const roomId = host.room_id;
    const revision = () => store.snapshot(roomId).revision;
    // Classic has no turn structure to choose.
    assert.throws(
      () =>
        store.configureSettings(host, 'classic-turns', revision(), { turnTimerSeconds: 90, turns: 'paired' }),
      (error: Error) =>
        code('INVALID_SETTINGS')(error) && /Classic has no turn structure/.test(error.message),
    );
    // Big Table with the older rule: saved, since it is not the default.
    store.configureSettings(host, 'big-table', revision(), {
      turnTimerSeconds: 90,
      mode: BIG_TABLE.id,
      turns: 'betweenTurnsBuild',
    });
    assert.equal(store.settings(roomId).turns, 'betweenTurnsBuild');
    assert.equal(store.board(roomId).preset, 'big-table-balanced-v1', 'the room deals a Big Table island');
    // A tab from before Big Table leaves the field out, and the room keeps its turns.
    store.configureSettings(host, 'older-tab', revision(), {
      turnTimerSeconds: 65,
      mode: BIG_TABLE.id,
    });
    assert.equal(store.settings(roomId).turns, 'betweenTurnsBuild');
    // Back to the default: saved as nothing, which reads as Paired turns.
    store.configureSettings(host, 'paired', revision(), {
      turnTimerSeconds: 65,
      mode: BIG_TABLE.id,
      turns: 'paired',
    });
    assert.equal('turns' in store.settings(roomId), false);
    store.configureSettings(host, 'again', revision(), {
      turnTimerSeconds: 65,
      mode: BIG_TABLE.id,
      turns: 'betweenTurnsBuild',
    });
    // A new mode starts from its own default: switching away drops the turns, and they cannot come along.
    assert.throws(
      () =>
        store.configureSettings(host, 'classic-with-turns', revision(), {
          turnTimerSeconds: 65,
          mode: CLASSIC.id,
          turns: 'betweenTurnsBuild',
        }),
      code('INVALID_SETTINGS'),
    );
    store.configureSettings(host, 'classic', revision(), { turnTimerSeconds: 65, mode: CLASSIC.id });
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 65 });
    assert.equal(store.board(roomId).preset, 'balanced-v2');
  } finally {
    store.close();
  }
  // Start freezes the room's choice into the game, and a rematch keeps it.
  const room = bigTableRoom({ players: 5, turns: 'betweenTurnsBuild' });
  try {
    assert.equal(room.game().ruleset, BIG_TABLE.id);
    assert.equal(room.game().turns, 'betweenTurnsBuild');
    assert.equal(room.game().players.length, 5);
    assert.equal(room.game().robber, room.game().board.robberStart);
  } finally {
    room.store.close();
  }
  const paired = bigTableRoom({ players: 6 });
  try {
    assert.equal(paired.game().turns, 'paired', 'Paired turns when the room left it at the default');
  } finally {
    paired.store.close();
  }
});

test('§9.2: the Partner’s phase has half the room’s time, rounded up to a whole second and at least 30', () => {
  assert.deepEqual(([40, 65, 90, 115, 140] as const).map(partnerSeconds), [30, 33, 45, 58, 70]);
  for (const timer of [40, 65, 115] as const) {
    const room = bigTableRoom({ timer });
    try {
      throughSetup(room);
      const lead = room.store.clock(room.roomId)!;
      assert.equal(lead.deadlineAt - lead.startedAt, timer * 1000, 'the Lead’s part has the room’s time');
      room.clock.now += 5_000;
      leadEnds(room);
      const g = room.game();
      assert.equal(g.phase, 'partner');
      const partner = room.store.clock(room.roomId)!;
      assert.equal(partner.playerId, activePlayer(g).id, 'the clock follows the Partner');
      assert.equal(partner.turn, g.turn);
      assert.equal(partner.deadlineAt - partner.startedAt, partnerSeconds(timer) * 1000);
      assert.equal(partner.startedAt, room.clock.now);
    } finally {
      room.store.close();
    }
  }
});

test('§9.3: when the Partner’s clock runs out the phase just ends, a Knight’s robber first, and free roads lapse', () => {
  const room = bigTableRoom({ timer: 65 });
  try {
    throughSetup(room);
    leadEnds(room);
    // Nothing is bought or built for the Partner: the phase simply ends.
    let partner = activePlayer(room.game());
    const hand = { ...partner.hand };
    room.clock.now += 33_000;
    assert.ok(room.store.dueRooms().includes(room.roomId));
    assert.ok(room.store.expireRoom(room.roomId));
    assert.equal(room.game().turn, 2);
    assert.equal(room.game().phase, 'roll');
    assert.deepEqual(room.game().players.find((p) => p.id === partner.id)!.hand, hand);
    assert.ok(
      lines(room.game()).includes(`${partner.name}'s timer expired; Partner's phase ended automatically.`),
    );
    // A Knight played and its robber not moved: the clock moves it, then ends the phase.
    leadEnds(room);
    partner = activePlayer(room.game());
    room.rig((g) => {
      const at = g.deck.lastIndexOf('knight');
      g.deck.splice(at, 1);
      g.players
        .find((p) => p.id === partner.id)!
        .cards.push({ id: `card-${g.nextCard++}`, kind: 'knight', boughtTurn: 0 });
    });
    const knight = room
      .game()
      .players.find((p) => p.id === partner.id)!
      .cards.at(-1)!;
    room.act(partner.id, { kind: 'playCard', cardId: knight.id });
    const robber = room.game().robber;
    room.clock.now += 33_000;
    room.store.expireRoom(room.roomId);
    let g = room.game();
    assert.notEqual(g.robber, robber, 'a played Knight must move the robber');
    assert.equal(g.turn, 3);
    assert.ok(lines(g).includes(`${partner.name}'s timer expired; robber moved automatically.`));
    assert.ok(lines(g).includes(`${partner.name}'s timer expired; Partner's phase ended automatically.`));
    // Road Building with a road still owed: the phase ends and the road is never placed.
    leadEnds(room);
    partner = activePlayer(room.game());
    room.rig((game) => {
      const at = game.deck.lastIndexOf('roadBuilding');
      game.deck.splice(at, 1);
      game.players
        .find((p) => p.id === partner.id)!
        .cards.push({ id: `card-${game.nextCard++}`, kind: 'roadBuilding', boughtTurn: 0 });
    });
    const card = room
      .game()
      .players.find((p) => p.id === partner.id)!
      .cards.at(-1)!;
    room.act(partner.id, { kind: 'playCard', cardId: card.id });
    room.act(partner.id, { kind: 'road', edge: gameView(room.game(), partner.id).legal.roads[0]! });
    assert.equal(room.game().phase, 'freeRoads');
    const roads = Object.keys(room.game().roads).length;
    // The Partner cannot let the road lapse; only the clock can.
    assert.throws(
      () => room.act(partner.id, { kind: 'endPhase', expired: true }),
      (error: Error) => code('ILLEGAL_ACTION')(error) && /Place your free roads first/.test(error.message),
    );
    room.clock.now += 33_000;
    room.store.expireRoom(room.roomId);
    g = room.game();
    assert.equal(Object.keys(g.roads).length, roads, 'the road still owed stays unplaced');
    assert.equal(g.turn, 4);
    assert.ok(
      lines(g).includes(
        `${partner.name}'s timer expired; Partner's phase ended automatically, with its free roads unplaced.`,
      ),
    );
  } finally {
    room.store.close();
  }
});

test('§9.4: without a turn timer the Partner gets a 45-second clock only once away, and it keeps running', () => {
  const room = bigTableRoom({ timer: null });
  try {
    throughSetup(room);
    assert.equal(room.store.clock(room.roomId), undefined, 'no clock on the Lead’s part');
    leadEnds(room);
    assert.equal(room.game().phase, 'partner');
    assert.equal(room.store.clock(room.roomId), undefined, 'none for a Partner who is here');
    const partner = room.seatOf(activePlayer(room.game()).id);
    // The Partner drops out: a 45-second clock starts now.
    room.clock.now += 10_000;
    room.store.setConnected(partner, false);
    const clock = room.store.clock(room.roomId)!;
    assert.equal(clock.playerId, partner.id);
    assert.equal(clock.deadlineAt, room.clock.now + 45_000);
    // Back in time: the clock keeps running, and never restarts within the phase.
    room.clock.now += 20_000;
    room.store.setConnected(partner, true);
    assert.deepEqual(room.store.clock(room.roomId), clock);
    room.store.setConnected(partner, false);
    assert.deepEqual(room.store.clock(room.roomId), clock);
    room.store.setConnected(partner, true);
    room.clock.now += 25_000;
    room.store.expireRoom(room.roomId);
    assert.equal(room.game().turn, 2, 'the phase ends at 45 seconds');
    assert.equal(room.store.clock(room.roomId), undefined, 'and the next Lead has no clock');
    // A Partner already away when the phase begins gets the clock at once.
    const next = room.seatOf(room.game().players[room.game().pair!.partner]!.id);
    room.store.setConnected(next, false);
    leadEnds(room);
    assert.equal(activePlayer(room.game()).id, next.id);
    assert.equal(room.store.clock(room.roomId)!.deadlineAt, room.clock.now + 45_000);
  } finally {
    room.store.close();
  }
});

test('§9.2 and §9.3: every build window has 20 seconds, with or without a turn timer, and one that runs out ends', () => {
  for (const timer of [null, 140] as const) {
    const room = bigTableRoom({ turns: 'betweenTurnsBuild', timer });
    try {
      throughSetup(room);
      leadEnds(room);
      let g = room.game();
      assert.equal(g.phase, 'buildWindow');
      const first = activePlayer(g);
      const clock = room.store.clock(room.roomId)!;
      assert.equal(clock.playerId, first.id);
      assert.equal(clock.deadlineAt - clock.startedAt, 20_000);
      // The player may pass at once; the next window has its own 20 seconds.
      room.clock.now += 3_000;
      room.act(first.id, { kind: 'endWindow' });
      g = room.game();
      const second = activePlayer(g);
      assert.equal(room.store.clock(room.roomId)!.deadlineAt, room.clock.now + 20_000);
      // One that runs out simply ends, and the next begins.
      room.clock.now += 20_000;
      room.store.expireRoom(room.roomId);
      g = room.game();
      assert.notEqual(activePlayer(g).id, second.id);
      assert.ok(lines(g).includes(`${second.name}'s timer expired; build window closed automatically.`));
      for (let i = 0; i < 2; i++) {
        room.clock.now += 20_000;
        room.store.expireRoom(room.roomId);
      }
      g = room.game();
      assert.equal(g.turn, 2);
      assert.equal(g.phase, 'roll');
      assert.equal(activePlayer(g).id, first.id, 'the next turn goes to the first window’s player');
      const turn = room.store.clock(room.roomId);
      if (timer === null) assert.equal(turn, undefined);
      else assert.equal(turn!.deadlineAt - turn!.startedAt, timer * 1000);
    } finally {
      room.store.close();
    }
  }
});

test('§9.4: after two minutes away, a Partner’s phase and a player’s build windows are ended for them at once', () => {
  const room = bigTableRoom({ timer: null });
  try {
    throughSetup(room);
    const g = room.game();
    const partner = room.seatOf(g.players[g.pair!.partner]!.id);
    room.store.setConnected(partner, false);
    room.clock.now += ABSENCE_AFTER_MS;
    leadEnds(room);
    // The phase began with the Partner away for two minutes already: the clock ends it straight away.
    room.store.expireRoom(room.roomId);
    assert.equal(room.game().turn, 2);
    assert.ok(lines(room.game()).includes(`${partner.name} is away; Partner's phase ended automatically.`));
  } finally {
    room.store.close();
  }
  const windows = bigTableRoom({ turns: 'betweenTurnsBuild', timer: null });
  try {
    throughSetup(windows);
    const away = windows.seatOf(windows.game().players[2]!.id);
    windows.store.setConnected(away, false);
    windows.clock.now += ABSENCE_AFTER_MS;
    leadEnds(windows);
    // The first window is someone else's; theirs is closed the moment it opens.
    windows.act(activePlayer(windows.game()).id, { kind: 'endWindow' });
    assert.equal(activePlayer(windows.game()).id, away.id);
    assert.deepEqual(owedMoves(windows.game()), [{ player: away.id, kind: 'buildWindow' }]);
    windows.store.expireRoom(windows.roomId);
    assert.notEqual(activePlayer(windows.game()).id, away.id);
    assert.ok(lines(windows.game()).includes(`${away.name} is away; build window closed automatically.`));
  } finally {
    windows.store.close();
  }
});

test('turn times go to whoever acted: a Partner’s phase is the Partner’s, and build windows are no one’s turn', () => {
  const room = bigTableRoom({ timer: null });
  try {
    throughSetup(room);
    const g = room.game();
    const lead = activePlayer(g),
      partner = g.players[g.pair!.partner]!;
    room.clock.now += 10_000;
    room.act(lead.id, { kind: 'roll' });
    for (let guard = 0; guard < 12 && room.game().phase !== 'actions'; guard++) room.step();
    room.clock.now += 20_000;
    room.act(lead.id, { kind: 'endTurn' });
    room.clock.now += 50_000;
    room.act(partner.id, { kind: 'endPhase' });
    room.clock.now += 5_000;
    const head = room.store.snapshot(room.roomId).historyRevision!;
    const analytics = computeGameAnalytics(room.store.db, {
      roomId: room.roomId,
      archiveId: null,
      toRevision: head,
    });
    const stats = (id: string) => analytics.players.find((p) => p.id === id)!;
    assert.equal(stats(lead.id).turnTime.turns, 1);
    assert.equal(stats(lead.id).turnTime.medianSeconds, 30, 'the Lead’s part, not the Partner’s phase');
    assert.equal(stats(partner.id).partnerTime!.phases, 1);
    assert.equal(stats(partner.id).partnerTime!.medianSeconds, 50);
    assert.equal(stats(partner.id).turnTime.turns, 0);
  } finally {
    room.store.close();
  }
});
