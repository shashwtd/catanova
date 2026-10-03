/**
 * Big Table on the server: the room's turn structure, the clocks of the Partner's phase and the build windows
 * (docs/TURN_CLOCK.md, "New clocks"), the absence rule acting in them, and turn times read back by whoever
 * acted. Section numbers are the Big Table rulebook's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { ABSENCE_AFTER_MS } from '../apps/server/src/store.js';
import { GameLaunch } from '../apps/server/src/game-launch.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, gameView, resignPlayers } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { parseRoomSettings, partnerSeconds } from '../packages/protocol/src/settings.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import { continueGame, gameInvariantProblems, verifyStore } from '../scripts/verify-restored-games.js';
import { OPEN, bigTableRoom, throughSetup } from './big-table-room.js';
import { NAMES, act, afterSetup, clearBoard, layRoads, line, pointsTo, roll } from './big-table-helpers.js';
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

test('Big Table always plays Paired turns: the older build windows are refused, and a room that saved them starts paired', () => {
  // The protocol still knows both structures, so a game played with build windows reads back.
  assert.deepEqual(parseRoomSettings({ turnTimerSeconds: 90, mode: BIG_TABLE.id, turns: 'paired' }), {
    turnTimerSeconds: 90,
    mode: BIG_TABLE.id,
    turns: 'paired',
  });
  for (const turns of ['paired ', 'Paired turns', 1, null])
    assert.throws(() => parseRoomSettings({ turnTimerSeconds: 90, turns }), /Choose a turn style/);
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
    store.configureSettings(host, 'big-table', revision(), { turnTimerSeconds: 90, mode: BIG_TABLE.id });
    assert.equal(store.board(roomId).preset, 'big-table-balanced-v1', 'the room deals a Big Table island');
    assert.equal('turns' in store.settings(roomId), false, 'Paired turns, the only structure, is saved as nothing');
    // Between-turns build, retired on 2 October 2026, is refused with the reason.
    assert.throws(
      () =>
        store.configureSettings(host, 'older-rule', revision(), {
          turnTimerSeconds: 90,
          mode: BIG_TABLE.id,
          turns: 'betweenTurnsBuild',
        }),
      (error: Error) => code('INVALID_SETTINGS')(error) && /Big World plays Paired turns only/.test(error.message),
    );
    // A room saved with it before then reads as Paired turns, and changing another setting keeps working.
    store.db
      .prepare('UPDATE room_settings SET settings = ? WHERE room_id = ?')
      .run(JSON.stringify({ turnTimerSeconds: 90, mode: BIG_TABLE.id, turns: 'betweenTurnsBuild' }), roomId);
    assert.equal('turns' in store.settings(roomId), false);
    store.configureSettings(host, 'timer', revision(), { turnTimerSeconds: 65, mode: BIG_TABLE.id });
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 65, mode: BIG_TABLE.id });
    // A new mode starts from its own default: switching away drops the turns, and they cannot come along.
    assert.throws(
      () =>
        store.configureSettings(host, 'classic-with-turns', revision(), {
          turnTimerSeconds: 65,
          mode: CLASSIC.id,
          turns: 'paired',
        }),
      code('INVALID_SETTINGS'),
    );
    store.configureSettings(host, 'classic', revision(), { turnTimerSeconds: 65, mode: CLASSIC.id });
    assert.deepEqual(store.settings(roomId), { turnTimerSeconds: 65 });
    assert.equal(store.board(roomId).preset, 'balanced-v2');
  } finally {
    store.close();
  }
  // Start freezes Paired turns into the game, and a rematch keeps it.
  for (const players of [5, 6]) {
    const room = bigTableRoom({ players });
    try {
      assert.equal(room.game().ruleset, BIG_TABLE.id);
      assert.equal(room.game().turns, 'paired');
      assert.equal(room.game().players.length, players);
      assert.equal(room.game().robber, room.game().board.robberStart);
    } finally {
      room.store.close();
    }
  }
});

test('§1.2: a full Classic room of four switches to Big World and starts at once; three wait for a fourth', () => {
  const store = new Store(':memory:', { modes: OPEN, trackPresence: true });
  try {
    const table = (players: number) => {
      const sessions = NAMES.slice(0, players).map((name) => newSession(name));
      const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
      const roomId = host.room_id;
      const seats = [host, ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, roomId))];
      for (const seat of seats) store.setConnected(seat, true);
      const revision = () => store.snapshot(roomId).revision;
      // The room is Classic until the host switches: four fill it, and the switch keeps them all.
      assert.equal(store.seatLimit(roomId), 4);
      store.configureSettings(host, 'big-world', revision(), { turnTimerSeconds: 90, mode: BIG_TABLE.id });
      assert.equal(store.seatLimit(roomId), 6);
      for (const seat of seats.slice(1)) store.lobby(seat, `ready-${seat.id}`, revision(), true);
      return { host, roomId, revision };
    };
    // The loading screen's own check, on the room as the server shows it, everyone connected.
    const launch = new GameLaunch({
      now: () => 0,
      state: (roomId) => {
        const state = store.snapshot(roomId);
        return { ...state, players: state.players.map((player) => ({ ...player, connected: true })) };
      },
      commit: () => {},
      changed: () => {},
      failed: () => {},
    });
    const three = table(3);
    assert.throws(
      () => store.action(three.host, 'start-three', three.revision(), { kind: 'start' }),
      /Start with four to six players/,
    );
    assert.throws(
      () =>
        launch.begin({
          roomId: three.roomId,
          hostId: three.host.id,
          commandId: 'go',
          revision: three.revision(),
        }),
      (error: Error) =>
        code('NOT_ENOUGH_PLAYERS')(error) && /^Big World needs at least four players$/.test(error.message),
    );
    const four = table(4);
    launch.begin({ roomId: four.roomId, hostId: four.host.id, commandId: 'go', revision: four.revision() });
    store.action(four.host, 'start-four', four.revision(), { kind: 'start' });
    const g = store.loadGame(four.roomId)!;
    assert.equal(g.ruleset, BIG_TABLE.id);
    assert.equal(g.players.length, 4);
    assert.equal(g.board.preset, 'big-table-balanced-v1');
    assert.equal(g.board.hexes.length, 30);
    assert.ok(lines(g).includes('With four players, turns go one player at a time, with no Partner.'));
  } finally {
    store.close();
  }
});

test('§9.2: the Partner’s phase has half the room’s time, rounded up to a whole second and at least 30', () => {
  assert.deepEqual(([40, 65, 90, 115, 140] as const).map(partnerSeconds), [30, 33, 45, 58, 70]);
  for (const timer of [40, 65, 115] as const) {
    const room = bigTableRoom({ timer });
    try {
      throughSetup(room);
      const lead = room.store.clock(room.roomId)!;
      assert.equal(lead.deadlineAt! - lead.startedAt, timer * 1000, 'the Lead’s part has the room’s time');
      room.clock.now += 5_000;
      leadEnds(room);
      const g = room.game();
      assert.equal(g.phase, 'partner');
      const partner = room.store.clock(room.roomId)!;
      assert.equal(partner.playerId, activePlayer(g).id, 'the clock follows the Partner');
      assert.equal(partner.turn, g.turn);
      assert.equal(partner.deadlineAt! - partner.startedAt, partnerSeconds(timer) * 1000);
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

test('§9.4 and §9.5: after a pause an absent Partner’s clock starts again in full, whoever is first back', () => {
  for (const partnerFirst of [true, false]) {
    const room = bigTableRoom({ timer: null });
    try {
      throughSetup(room);
      leadEnds(room);
      const partner = room.seatOf(activePlayer(room.game()).id);
      room.store.setConnected(partner, false);
      assert.equal(room.store.clock(room.roomId)!.deadlineAt, room.clock.now + 45_000);
      // Ten seconds in, the rest of the table goes too: the room pauses with the clock under way.
      room.clock.now += 10_000;
      for (const seat of room.seats) if (seat.id !== partner.id) room.store.setConnected(seat, false);
      room.clock.now += 20_000;
      const back = partnerFirst ? partner : room.seats.find((seat) => seat.id !== partner.id)!;
      room.store.setConnected(back, true);
      const clock = room.store.clock(room.roomId);
      assert.equal(
        clock?.playerId,
        partner.id,
        partnerFirst ? 'the Partner is back first' : 'another is back',
      );
      assert.equal(clock.startedAt, room.clock.now);
      assert.equal(clock.deadlineAt, room.clock.now + 45_000, 'with its full time');
      room.clock.now += 45_000;
      room.store.expireRoom(room.roomId);
      assert.equal(room.game().turn, 2, 'and it ends the phase');
    } finally {
      room.store.close();
    }
  }
});

test('§6.7 and §9.4: a marker holder left at the target by a leaver while away wins at the clock’s first move', () => {
  // The Lead: the Partner leaves in their phase and hands Longest Road to the next Lead, who is away and so is not
  // declared the winner as their turn begins. The absence rule's roll, two minutes on, declares them.
  // The Partner: the Lead leaves in their part and hands it to their Partner, who is away; the Partner's phase
  // follows, and the 45-second clock a room without a timer gives an absent Partner declares them as it ends.
  for (const holder of ['Lead', 'Partner'] as const) {
    const room = bigTableRoom({ players: 6, timer: null, victoryPoints: 8 });
    try {
      throughSetup(room);
      if (holder === 'Lead') leadEnds(room);
      else {
        room.act(activePlayer(room.game()).id, { kind: 'roll' });
        for (let guard = 0; guard < 12 && room.game().phase !== 'actions'; guard++) room.step();
      }
      const g = room.game();
      const leaver = holder === 'Lead' ? g.players[g.pair!.partner]!.id : g.players[g.pair!.lead]!.id;
      const winner =
        holder === 'Lead' ? g.players[(g.pair!.lead + 1) % 6]!.id : g.players[g.pair!.partner]!.id;
      room.rig((game) => {
        clearBoard(game);
        const taken = new Set<number>();
        layRoads(game, leaver, line(game, 7, taken));
        layRoads(game, winner, line(game, 6, taken));
        game.longestRoad = leaver;
        pointsTo(game, winner, 6);
      });
      room.store.setConnected(room.seatOf(winner), false);
      room.store.leave(room.seatOf(leaver), `leave-${leaver}`, room.revision());
      let after = room.game();
      assert.equal(after.longestRoad, winner);
      assert.equal(activePlayer(after).id, winner);
      assert.equal(after.phase, holder === 'Lead' ? 'roll' : 'partner');
      assert.equal(after.winner, null, 'not declared while away');
      room.clock.now += holder === 'Lead' ? ABSENCE_AFTER_MS : 45_000;
      room.store.expireRoom(room.roomId);
      after = room.game();
      assert.equal(after.winner, winner, holder);
      const name = after.players.find((p) => p.id === winner)!.name;
      assert.deepEqual(
        lines(after).slice(-2),
        holder === 'Lead'
          ? [`${name} wins with 8 points!`, `${name} is away; dice rolled automatically.`]
          : [
              `${name} wins as Partner with 8 points!`,
              `${name}'s timer expired; Partner's phase ended automatically.`,
            ],
      );
    } finally {
      room.store.close();
    }
  }
});

test('§9.4: after two minutes away, a Partner’s phase is ended for them at once', () => {
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

test('the new moves come over the wire like the others, and the restore verifier checks the new phases', () => {
  for (const action of [{ kind: 'endPhase' }, { kind: 'endWindow' }, { kind: 'endPhase', expired: true }])
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({ type: 'action', commandId: 'big-table-1', expectedRevision: 3, action }),
      ),
      { type: 'action', commandId: 'big-table-1', expectedRevision: 3, action },
    );
  assert.throws(() =>
    parseClientMessage(
      JSON.stringify({
        type: 'action',
        commandId: 'big-table-2',
        expectedRevision: 3,
        action: { kind: 'endPhase', expired: 'yes' },
      }),
    ),
  );
  // A sound game passes; each way of breaking the markers or the windows is named.
  const partner = act(roll(afterSetup(5), 3, 5), 'p0', { kind: 'endTurn' });
  assert.deepEqual(gameInvariantProblems(partner), []);
  const broken = (edit: (g: Game) => void) => {
    const g = structuredClone(partner);
    edit(g);
    return gameInvariantProblems(g);
  };
  assert.match(
    broken((g) => (g.pair = { lead: 0, partner: 0 })).join(),
    /Lead and Partner markers are not on two seats/,
  );
  assert.match(broken((g) => (g.active = 1)).join(), /holding neither marker is acting/);
  assert.match(broken((g) => delete g.turns).join(), /turn structure undefined is not one this mode offers/);
  assert.match(
    broken((g) => (g.windows = { after: 0 })).join(),
    /build windows are open outside Between-turns build/,
  );
  const windows = act(roll(afterSetup(5, { turns: 'betweenTurnsBuild' }), 3, 5), 'p0', { kind: 'endTurn' });
  assert.deepEqual(gameInvariantProblems(windows), []);
  const rigged = structuredClone(windows);
  delete rigged.windows;
  assert.match(gameInvariantProblems(rigged).join(), /a build window is open with no turn before it/);
  // The verifier's own mandatory move finishes a Partner's phase and a build window.
  assert.deepEqual(continueGame(partner, 'room'), { move: 'endPhase', problems: [] });
  assert.deepEqual(continueGame(windows, 'room'), { move: 'endWindow', problems: [] });
});

test('a table left with one absent player in a Partner’s phase waits at the roll, and passes the verifier', () => {
  // Everyone but Dan, the Partner, runs out of grace while nobody is there: nobody may be declared the winner,
  // so Dan waits as a turn begins, with no pair, no phase of his own left over and no card played.
  const partner = act(roll(afterSetup(5), 3, 5), 'p0', { kind: 'endTurn' });
  partner.playedCard = true;
  const left = resignPlayers(partner, ['p0', 'p1', 'p2', 'p4'], {
    reason: 'disconnect',
    winnerEligibleIds: [],
  });
  assert.equal(left.winner, null);
  assert.equal(activePlayer(left).id, 'p3');
  assert.equal(left.phase, 'roll');
  assert.equal(left.returnPhase, 'roll');
  assert.equal(left.playedCard, false);
  assert.equal(left.pair, undefined);
  assert.deepEqual(gameInvariantProblems(left), []);
  assert.deepEqual(continueGame(left, 'room'), { move: 'roll', problems: [] });
  // The same through the store: three leave in the Partner's phase, the fifth drops, then the Partner leaves.
  const room = bigTableRoom({ timer: 90 });
  try {
    throughSetup(room);
    leadEnds(room);
    const g = room.game();
    assert.equal(g.phase, 'partner');
    const dan = activePlayer(g).id;
    const others = g.players.map((p) => p.id).filter((id) => id !== dan);
    for (const id of others.slice(0, 3)) room.store.leave(room.seatOf(id), `leave-${id}`, room.revision());
    room.store.setConnected(room.seatOf(others[3]!), false);
    room.store.leave(room.seatOf(dan), `leave-${dan}`, room.revision());
    const after = room.game();
    assert.equal(activePlayer(after).id, others[3]);
    assert.equal(after.phase, 'roll');
    assert.equal(after.returnPhase, 'roll');
    assert.equal(after.winner, null);
    const report = verifyStore(room.store);
    assert.deepEqual(
      report.details.map((detail) => [detail.status, detail.problems]),
      [['verified', []]],
    );
  } finally {
    room.store.close();
  }
});
