/**
 * Classic, Big Table and Open Sea in one build, through the rules and the Store: every move each mode can owe has
 * a timeout move, a room moves between the modes in its lobby, each mode's clocks run only in that mode, the
 * absence rule acts in both modes without bots, and one database holding a game of each mode passes the restore
 * verifier and reads in the admin's game analytics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABSENCE_AFTER_MS, Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { newSession } from '../apps/client/src/connection.js';
import { verifyStore } from '../scripts/verify-restored-games.js';
import { dealBoard, pips, seededRandom } from '../packages/rules/src/board.js';
import {
  activePlayer,
  applyAction,
  createGame,
  gameView,
  partnerActing,
  pieces,
  roadSites,
} from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { COSTS, RESOURCES } from '../packages/rules/src/index.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import type { OwedKind } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { BIG_TABLE, CLASSIC, OPEN_SEA, rulesetOf } from '../packages/rules/src/rulesets.js';
import type { Ruleset, TurnStructure } from '../packages/rules/src/rulesets.js';
import { BUILD_WINDOW_SECONDS, partnerSeconds } from '../packages/protocol/src/settings.js';
import type { TurnTimerSeconds } from '../packages/protocol/src/settings.js';
import { GOLD_PICK_SECONDS } from '../packages/rules/src/gold.js';
import { scriptedMove } from './open-sea-play.js';

const ALL: ModeSwitches = { open: [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id], testers: new Set() };
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay'];
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const pick = <T>(items: readonly T[], random: () => number) => items[Math.floor(random() * items.length)]!;

/**
 * A careful table's move in Classic or Big Table, for whoever the game waits on first: build where it can, play a
 * Knight or Road Building now and then, buy cards, and otherwise end its part. Anything else is the clock's move.
 */
function tableMove(g: Game, random: () => number): { player: string; action: GameAction } {
  const [owed] = owedMoves(g);
  const player = owed!.player;
  const legal = gameView(g, player).legal;
  const me = g.players.find((p) => p.id === player)!;
  const playable = (kind: string) =>
    me.cards.find((card) => card.kind === kind && legal.playableCards.includes(card.id));
  const move = (action: GameAction) => ({ player, action });
  switch (owed!.kind) {
    case 'setupSettlement':
      return move({ kind: 'settlement', vertex: pick(legal.settlements, random) });
    case 'setupRoad':
      return move({ kind: 'road', edge: pick(legal.roads, random) });
    // Placed by the player: only the clock leaves a Partner's free roads unplaced.
    case 'freeRoads':
      return move({ kind: 'road', edge: pick(roadSites(g, player), random) });
    case 'roll': {
      const knight = playable('knight');
      return move(knight && random() < 0.3 ? { kind: 'playCard', cardId: knight.id } : { kind: 'roll' });
    }
    case 'actions':
    case 'partner':
    case 'buildWindow': {
      if (legal.settlements.length)
        return move({ kind: 'settlement', vertex: pick(legal.settlements, random) });
      if (legal.cities.length) return move({ kind: 'city', vertex: pick(legal.cities, random) });
      // Road Building only with somewhere to put a road, as the rules ask.
      const roads = playable('roadBuilding');
      if (
        roads &&
        pieces(g, player).roads < rulesetOf(g).supply.pieces.roads &&
        roadSites(g, player).length > 1 &&
        random() < 0.7
      )
        return move({ kind: 'playCard', cardId: roads.id });
      const knight = playable('knight');
      if (knight && random() < 0.5) return move({ kind: 'playCard', cardId: knight.id });
      if (legal.canBuyCard) return move({ kind: 'buyCard' });
      if (legal.roads.length && random() < 0.3)
        return move({ kind: 'road', edge: pick(legal.roads, random) });
      // A card for a card at the bank, towards a settlement or a city, where trading is allowed.
      if (owed!.kind !== 'buildWindow')
        for (const cost of [COSTS.settlement, COSTS.city]) {
          const lacking = RESOURCES.find((r) => me.hand[r] < cost[r] && g.bank[r] > 0);
          const spare = RESOURCES.find((r) => me.hand[r] - cost[r] >= legal.rates[r]);
          if (lacking && spare && lacking !== spare)
            return move({ kind: 'bankTrade', give: spare, receive: lacking });
        }
      return move(
        owed!.kind === 'partner'
          ? { kind: 'endPhase' }
          : owed!.kind === 'buildWindow'
            ? { kind: 'endWindow' }
            : { kind: 'endTurn' },
      );
    }
    default:
      return move(timeoutAction(g, player, random)!);
  }
}

/** The move for the first player owed one, in any mode: Open Sea's scripted players, or a careful table. */
function nextMove(g: Game, random: () => number, actions: { turn: number; count: number }) {
  if (g.turn !== actions.turn) Object.assign(actions, { turn: g.turn, count: 0 });
  if (g.ruleset !== OPEN_SEA.id) return tableMove(g, random);
  const next = scriptedMove(g, random)!;
  // A turn of Open Sea ends after a few actions, so that every game finishes.
  return g.phase === 'actions' && ++actions.count > 14
    ? { player: next.player, action: { kind: 'endTurn' as const } }
    : next;
}

/** Every move each mode can owe; Classic's are every mode's. */
const CLASSIC_OWED: OwedKind[] = [
  'setupSettlement',
  'setupRoad',
  'roll',
  'actions',
  'robber',
  'freeRoads',
  'discard',
];
const GAMES: { name: string; ruleset: Ruleset; players: number; turns?: TurnStructure; seed: number }[] = [
  { name: 'Classic', ruleset: CLASSIC, players: 4, seed: 11 },
  { name: 'Big Table, paired turns', ruleset: BIG_TABLE, players: 5, turns: 'paired', seed: 12 },
  { name: 'Big Table, build windows', ruleset: BIG_TABLE, players: 6, turns: 'betweenTurnsBuild', seed: 13 },
  { name: 'Open Sea', ruleset: OPEN_SEA, players: 4, seed: 14 },
];
const OWN: Record<string, OwedKind[]> = {
  Classic: [],
  'Big Table, paired turns': ['partner'],
  'Big Table, build windows': ['buildWindow'],
  'Open Sea': ['goldPick'],
};

test('every move each mode owes has a timeout move the rules accept, and no mode owes another’s', () => {
  for (const { name, ruleset, players, turns, seed } of GAMES) {
    // The game's own randomness, and another for trying the clock's moves, so that trying them changes nothing.
    const random = seededRandom(seed),
      trial = seededRandom(seed + 1);
    const seats = NAMES.slice(0, players).map((player, i) => ({ id: `p${i}`, name: player }));
    let game = createGame(seats, seed, random, { ruleset: ruleset.id, ...(turns ? { turns } : {}) });
    const kinds = new Set<OwedKind>();
    const actions = { turn: 0, count: 0 };
    for (let step = 0; step < 12_000 && game.phase !== 'finished'; step++) {
      const owed = owedMoves(game);
      assert.ok(owed.length, `${name}: the game waits on nobody during ${game.phase}`);
      for (const move of owed) {
        kinds.add(move.kind);
        const action = timeoutAction(game, move.player, trial);
        assert.ok(action, `${name}: no timeout move for ${move.kind}`);
        assert.doesNotThrow(
          () => applyAction(game, move.player, action, trial),
          `${name}: ${move.kind}: ${action.kind}`,
        );
      }
      const next = nextMove(game, random, actions);
      game = applyAction(game, next.player, next.action, random);
    }
    assert.equal(game.phase, 'finished', `${name}: the game finishes`);
    assert.deepEqual([...kinds].sort(), [...CLASSIC_OWED, ...OWN[name]!].sort(), name);
  }
});

/** A room in one store, dealt a fixed board, started once its players are ready. */
function openRoom(
  store: Store,
  ruleset: Ruleset,
  players: number,
  options: { timer?: TurnTimerSeconds | null; turns?: TurnStructure; goldOnMain?: boolean } = {},
) {
  const sessions = NAMES.slice(0, players).map((name) => newSession(name));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const roomId = host.room_id;
  store.setConnected(host, true);
  const revision = () => store.snapshot(roomId).revision;
  let commands = 0;
  store.configureSettings(host, `settings-${roomId}`, revision(), {
    turnTimerSeconds: options.timer ?? null,
    diceMode: 'classic',
    ...(ruleset === CLASSIC ? {} : { mode: ruleset.id }),
    ...(options.turns ? { turns: options.turns } : {}),
  });
  const seats: Seat[] = [host];
  for (const session of sessions.slice(1)) {
    const seat = store.enter('join', session.token, session.name, roomId);
    store.setConnected(seat, true);
    seats.push(seat);
  }
  // The same board every run. With `goldOnMain`, the main island's richest tile is a gold field, so that gold
  // picks come early, in setup too, as the rules allow though Outer Isles never deals it.
  const board = dealBoard(2026, ruleset.board, players);
  if (options.goldOnMain)
    board.hexes
      .filter((h) => h.island === 'main' && h.terrain !== 'desert')
      .sort((a, b) => pips(b.number) - pips(a.number))[0]!.terrain = 'gold';
  store.db.prepare('UPDATE room_boards SET board = ? WHERE room_id = ?').run(JSON.stringify(board), roomId);
  for (const seat of seats.slice(1)) store.lobby(seat, `ready-${seat.id}`, revision(), true);
  store.action(host, `start-${roomId}`, revision(), { kind: 'start' });
  const game = () => store.loadGame(roomId)!;
  const seatOf = (id: string) => seats.find((seat) => seat.id === id)!;
  const act = (player: string, action: GameAction) =>
    store.action(seatOf(player), `move-${roomId}-${++commands}`, revision(), action);
  return { store, roomId, seats, game, seatOf, act };
}

test('a room moves from Classic to Big Table to Open Sea and back, each time with its own board, target, turns and seats', () => {
  const store = new Store(':memory:', { now: () => 1_000_000, modes: ALL, random: seededRandom(7) });
  try {
    const sessions = NAMES.map((name) => newSession(name));
    const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
    const roomId = host.room_id;
    const revision = () => store.snapshot(roomId).revision;
    let commands = 0;
    const configure = (settings: Parameters<Store['configureSettings']>[3]) =>
      store.configureSettings(host, `settings-${++commands}`, revision(), settings);
    const join = (i: number) => store.enter('join', sessions[i]!.token, sessions[i]!.name, roomId);
    join(1);
    join(2);
    const state = () => {
      const board = store.board(roomId);
      return {
        settings: store.settings(roomId),
        preset: board.preset,
        players: board.players,
        seed: board.seed,
        seats: store.seatLimit(roomId),
      };
    };
    const classic = state();
    assert.deepEqual(
      { ...classic, seed: 0 },
      {
        settings: { turnTimerSeconds: 90, diceMode: 'balanced' },
        preset: 'balanced-v2',
        players: undefined,
        seed: 0,
        seats: 4,
      },
    );
    configure({ turnTimerSeconds: 65, diceMode: 'classic', victoryPoints: 12 });
    assert.equal(store.settings(roomId).victoryPoints, 12);

    // Big Table, with the older rule: the target goes back to the mode's default, and the island is Big Table's.
    configure({
      turnTimerSeconds: 65,
      diceMode: 'classic',
      victoryPoints: 12,
      mode: BIG_TABLE.id,
      turns: 'betweenTurnsBuild',
    });
    const big = state();
    assert.deepEqual(big.settings, {
      turnTimerSeconds: 65,
      diceMode: 'classic',
      mode: BIG_TABLE.id,
      turns: 'betweenTurnsBuild',
    });
    assert.deepEqual([big.preset, big.players, big.seats], ['big-table-balanced-v1', undefined, 6]);
    // A tab from before Big Table leaves the turns out: the room keeps its own, and its island.
    configure({ turnTimerSeconds: 65, diceMode: 'classic', victoryPoints: 11, mode: BIG_TABLE.id });
    assert.deepEqual(state(), {
      ...big,
      settings: { ...big.settings, victoryPoints: 11 },
    });

    // Open Sea has no turns to choose, so a change that names one is refused.
    assert.throws(
      () => configure({ turnTimerSeconds: 65, mode: OPEN_SEA.id, turns: 'paired' }),
      code('INVALID_SETTINGS'),
    );
    configure({ turnTimerSeconds: 65, diceMode: 'classic', victoryPoints: 11, mode: OPEN_SEA.id });
    const sea = state();
    assert.deepEqual(sea.settings, { turnTimerSeconds: 65, diceMode: 'classic', mode: OPEN_SEA.id });
    assert.deepEqual([sea.preset, sea.players, sea.seats], ['outer-isles-v1', 3, 4]);
    // A fourth player: the same seed on the four-player template.
    join(3);
    assert.deepEqual([state().preset, state().players, state().seed], ['outer-isles-v1', 4, sea.seed]);

    // Back to Classic: no mode, no turns, Classic's target and island, four seats.
    configure({ turnTimerSeconds: 65, diceMode: 'classic', mode: CLASSIC.id });
    const back = state();
    assert.deepEqual(back.settings, { turnTimerSeconds: 65, diceMode: 'classic' });
    assert.deepEqual([back.preset, back.players, back.seats], ['balanced-v2', undefined, 4]);

    // Six seated in Big Table cannot go to a mode for four, and its turns default to paired, saved as nothing.
    configure({ turnTimerSeconds: 65, diceMode: 'classic', mode: BIG_TABLE.id });
    assert.equal(store.settings(roomId).turns, undefined);
    join(4);
    join(5);
    for (const mode of [OPEN_SEA.id, CLASSIC.id])
      assert.throws(() => configure({ turnTimerSeconds: 65, mode }), code('MODE_SEATS'));
    assert.equal(store.settings(roomId).mode, BIG_TABLE.id);
  } finally {
    store.close();
  }
});

/**
 * What the saved turn clock may be at this moment in each mode, with the fake clock standing still: a turn's
 * deadline is the room's time from its start, and only the mode's own clocks appear.
 */
function clockProblems(
  g: Game,
  clock: ReturnType<Store['clock']>,
  timer: TurnTimerSeconds | null,
  now: number,
): string[] {
  const problems: string[] = [];
  const sea = g.ruleset === OPEN_SEA.id;
  const picking = g.phase === 'goldPick';
  const window = g.phase === 'buildWindow';
  if (g.phase === 'finished') return clock ? ['a finished game keeps a clock'] : [];
  if (!clock) {
    if (picking) problems.push('gold picks run without their clock');
    else if (g.turn > 0 && (timer !== null || window)) problems.push(`${g.phase} runs without a clock`);
    return problems;
  }
  if (clock.goldDeadlines && !(sea && picking)) problems.push(`gold deadlines in ${g.ruleset} ${g.phase}`);
  if (clock.discardDeadlines && g.phase !== 'discard') problems.push(`discard deadlines in ${g.phase}`);
  if (g.turn === 0 && !picking) problems.push('a clock in setup');
  if (picking) {
    const picker = g.goldOwed![0]!.player;
    if (clock.pausedAt === undefined) problems.push('the turn runs on while gold is picked');
    if (JSON.stringify(clock.goldDeadlines) !== JSON.stringify({ [picker]: now + GOLD_PICK_SECONDS * 1000 }))
      problems.push(`gold deadlines ${JSON.stringify(clock.goldDeadlines)}`);
  }
  const expected =
    g.turn === 0
      ? undefined
      : window
        ? BUILD_WINDOW_SECONDS
        : partnerActing(g)
          ? timer === null
            ? undefined
            : partnerSeconds(timer)
          : (timer ?? undefined);
  const seconds = clock.deadlineAt === undefined ? undefined : (clock.deadlineAt - clock.startedAt) / 1000;
  if (seconds !== expected)
    problems.push(`a ${seconds ?? 'missing'}-second deadline where ${expected ?? 'none'} is due`);
  if (clock.playerId !== activePlayer(g).id) problems.push('the clock is not the acting player’s');
  return problems;
}

test('each mode’s clocks run only in that mode, with a turn timer and without one', () => {
  const now = 1_000_000;
  for (const timer of [null, 65] as const) {
    const store = new Store(':memory:', {
      now: () => now,
      trackPresence: true,
      modes: ALL,
      random: seededRandom(31),
    });
    try {
      const rooms = [
        openRoom(store, CLASSIC, 3, { timer }),
        openRoom(store, BIG_TABLE, 5, { timer, turns: 'paired' }),
        openRoom(store, BIG_TABLE, 5, { timer, turns: 'betweenTurnsBuild' }),
        openRoom(store, OPEN_SEA, 3, { timer, goldOnMain: true }),
      ];
      for (const room of rooms) {
        const random = seededRandom(room.seats.length * 7 + (timer ?? 0));
        const actions = { turn: 0, count: 0 };
        const seen = new Set<string>();
        for (let step = 0; step < 220 && room.game().phase !== 'finished'; step++) {
          const g = room.game();
          const problems = clockProblems(g, store.clock(room.roomId), timer, now);
          assert.deepEqual(problems, [], `${g.ruleset} ${g.turns ?? ''}, timer ${timer}, turn ${g.turn}`);
          if (store.clock(room.roomId)) seen.add(g.phase);
          const next = nextMove(g, random, actions);
          room.act(next.player, next.action);
        }
        // Each mode's own clock was seen running, and nothing else was timed in a room without a timer.
        const g = room.game();
        const own =
          g.ruleset === OPEN_SEA.id
            ? 'goldPick'
            : g.turns === 'betweenTurnsBuild'
              ? 'buildWindow'
              : undefined;
        if (own) assert.ok(seen.has(own), `${g.ruleset} ${g.turns ?? ''}: its clock never ran`);
        if (timer === null)
          assert.deepEqual(
            [...seen].filter((phase) => phase !== own),
            [],
            `${g.ruleset} ${g.turns ?? ''}: timed without a timer`,
          );
        else if (g.turns === 'paired') assert.ok(seen.has('partner'), 'the Partner’s clock never ran');
      }
    } finally {
      store.close();
    }
  }
});

test('the absence rule makes an absent player’s moves in both modes without bots', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', {
    now: () => now,
    trackPresence: true,
    modes: ALL,
    random: seededRandom(41),
  });
  try {
    for (const room of [openRoom(store, BIG_TABLE, 5), openRoom(store, OPEN_SEA, 3)]) {
      const random = seededRandom(43);
      const actions = { turn: 0, count: 0 };
      // Through setup by the table's own moves, then the player on turn drops out before rolling.
      while (room.game().turn === 0) {
        const next = nextMove(room.game(), random, actions);
        room.act(next.player, next.action);
      }
      const away = room.seatOf(activePlayer(room.game()).id);
      store.setConnected(away, false);
      now += ABSENCE_AFTER_MS - 1_000;
      store.expireRoom(room.roomId);
      assert.equal(room.game().dice, null, 'the game waits for the first two minutes');
      now += 1_000;
      store.expireRoom(room.roomId);
      const lines = room.game().log.map((entry) => entry.text);
      assert.ok(lines.includes(`${away.name} is away; dice rolled automatically.`), room.game().ruleset);
      assert.ok(!store.snapshot(room.roomId).players.some((seat) => seat.standIn), 'no stand-in');
      store.setConnected(away, true);
    }
  } finally {
    store.close();
  }
});

test('one database with a game of each mode passes the restore verifier and reads in game analytics', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', {
    now: () => now,
    trackPresence: true,
    modes: ALL,
    random: seededRandom(51),
  });
  try {
    const rooms = [
      openRoom(store, CLASSIC, 3),
      openRoom(store, BIG_TABLE, 5, { turns: 'paired' }),
      openRoom(store, BIG_TABLE, 6, { turns: 'betweenTurnsBuild' }),
      openRoom(store, OPEN_SEA, 4, { goldOnMain: true }),
    ];
    for (const room of rooms) {
      const random = seededRandom(53);
      const actions = { turn: 0, count: 0 };
      for (let step = 0; step < 400 && room.game().phase !== 'finished'; step++) {
        const next = nextMove(room.game(), random, actions);
        now += 1_000;
        room.act(next.player, next.action);
      }
      assert.ok(room.game().turn > 5, `${room.game().ruleset} played several turns`);
    }
    const report = verifyStore(store);
    assert.equal(report.result, 'pass', JSON.stringify(report.failures));
    assert.deepEqual([report.games, report.verified, report.failed], [4, 4, 0]);
    assert.deepEqual(
      report.details.map((room) => room.ruleset ?? CLASSIC.id).sort(),
      [CLASSIC.id, BIG_TABLE.id, BIG_TABLE.id, OPEN_SEA.id].sort(),
    );
    for (const room of rooms) {
      const g = room.game();
      const analytics = computeGameAnalytics(store.db, {
        roomId: room.roomId,
        archiveId: null,
        toRevision: store.snapshot(room.roomId).historyRevision!,
      });
      assert.equal(analytics.players.length, g.players.length);
      assert.ok(analytics.moves > 100, `${g.ruleset}: ${analytics.moves} moves read`);
      const sea = g.ruleset === OPEN_SEA.id;
      for (const player of analytics.players) {
        // Ships only in Open Sea, a Partner's time only under paired turns.
        assert.equal(player.pieces.ships !== undefined, sea, `${g.ruleset}: ships`);
        assert.equal(player.resources.spent.ships !== undefined, sea, `${g.ruleset}: ships bought`);
        if (g.turns !== 'paired')
          assert.equal(player.partnerTime, undefined, `${g.ruleset}: a Partner's time`);
        assert.ok(player.turnTime.turns > 0, `${g.ruleset}: ${player.name}'s turns are timed`);
      }
      if (g.turns === 'paired')
        assert.ok(analytics.players.some((player) => player.partnerTime && player.partnerTime.phases > 0));
      if (sea) assert.ok(analytics.players.some((player) => player.resources.gained.production > 0));
    }
  } finally {
    store.close();
  }
});
