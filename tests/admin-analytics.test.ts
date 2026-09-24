import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Store } from '../apps/server/src/store.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { Analysis, GAME_REFRESH_MS } from '../apps/server/src/admin/analysis-runner.js';
import type { AuditPage, Cached, GameAnalytics } from '../apps/server/src/admin/types.js';
import { score } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { buildPlayedDatabase } from './restore-fixture.js';
import type { FixtureRooms } from './restore-fixture.js';
import { API, raw } from './admin-fixture.js';

let played: Promise<{ store: Store; rooms: FixtureRooms; path: string; dir: string }> | undefined;
/** One really-played database for the whole file: building it takes a few seconds. */
function fixture(t: TestContext) {
  played ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catanova-analytics-'));
    const path = join(dir, 'game.sqlite');
    const { store, rooms } = await buildPlayedDatabase(path);
    return { store, rooms, path, dir };
  })();
  t.after(() => undefined);
  return played;
}
test.after(async () => {
  if (!played) return;
  const { store, dir } = await played;
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const head = (store: Store, roomId: string) =>
  (
    store.db
      .prepare('SELECT max(revision) AS revision FROM game_events WHERE room_id = ? AND revision > ?')
      .get(roomId, store.round(roomId)) as { revision: number }
  ).revision;
const current = (store: Store, roomId: string) =>
  computeGameAnalytics(store.db, { roomId, archiveId: null, toRevision: head(store, roomId) });
const rowsOf = (store: Store, roomId: string, from: number, to: number, kind?: string) =>
  (
    store.db
      .prepare(
        `SELECT count(*) AS n FROM game_events WHERE room_id = ? AND revision BETWEEN ? AND ?
         AND (? IS NULL OR json_extract(public_entry, '$.kind') = ?)`,
      )
      .get(roomId, from, to, kind ?? null, kind ?? null) as { n: number }
  ).n;

test('a finished game reads back from its journal: result, standings, points by turn, dice and the robber', async (t) => {
  const { store, rooms } = await fixture(t);
  const game = store.loadGame(rooms.finished)!;
  const analytics = current(store, rooms.finished);
  assert.equal(analytics.status, 'finished');
  assert.equal(analytics.archiveId, null);
  assert.equal(analytics.legacy, false);
  assert.equal(analytics.unreadable, 0);
  // The guest left, so the host won by resignation.
  assert.equal(analytics.end!.reason, 'resignation');
  assert.equal(analytics.end!.winnerId, game.winner);
  assert.match(analytics.end!.text, /wins by resignation/);
  const winner = analytics.players.find((player) => player.winner)!;
  const leaver = analytics.players.find((player) => !player.winner)!;
  assert.equal(winner.rank, 1);
  assert.equal(leaver.rank, 2, 'whoever resigned comes after those still at the table');
  assert.deepEqual(leaver.resigned, { turn: game.turn, how: 'left' });
  // Every move is counted, and each seat's moves are its own here (nobody was a bot).
  assert.equal(analytics.moves, rowsOf(store, rooms.finished, analytics.fromRevision, analytics.toRevision));
  assert.ok(analytics.players.every((player) => !player.bot && player.moves.bot === 0));
  const seated = store.db
    .prepare(
      `SELECT count(*) AS n FROM game_events WHERE room_id = ? AND revision BETWEEN ? AND ?
       AND actor IS NOT NULL AND actor_kind IN ('human', 'bot', 'timer')`,
    )
    .get(rooms.finished, analytics.fromRevision, analytics.toRevision) as { n: number };
  assert.equal(
    analytics.players.reduce(
      (sum, player) => sum + player.moves.own + player.moves.bot + player.moves.timer,
      0,
    ),
    seated.n,
    'every move a seat made, starting the game and leaving it included',
  );
  // Points: one value per turn from setup on, ending with what the table saw at the end.
  assert.equal(analytics.points.turns[0], 0);
  assert.equal(analytics.points.turns.at(-1), game.turn);
  for (const [index, player] of game.players.entries()) {
    assert.equal(analytics.points.byPlayer[index]!.length, analytics.points.turns.length);
    assert.equal(analytics.points.byPlayer[index]!.at(-1), score(game, player, true));
    assert.equal(analytics.players[index]!.points, score(game, player, true));
  }
  // Dice: every roll, judged by the mode this game was played with.
  const rolls = rowsOf(store, rooms.finished, analytics.fromRevision, analytics.toRevision, 'roll');
  assert.equal(analytics.dice.rolls, rolls);
  assert.equal(
    analytics.dice.counts.reduce((a, b) => a + b, 0),
    rolls,
  );
  assert.equal(analytics.diceMode, game.diceMode);
  assert.equal(analytics.dice.model, game.diceMode === 'balanced' ? 'deck' : 'two-dice');
  assert.equal(analytics.dice.sevens, analytics.dice.counts[5]);
  // Which two dice made each roll, from the saved game after it: every roll has its pair.
  const pairs = Array<number>(36).fill(0);
  for (const { revision } of store.db
    .prepare(
      `SELECT revision FROM game_events WHERE room_id = ? AND revision BETWEEN ? AND ?
       AND json_extract(public_entry, '$.kind') = 'roll'`,
    )
    .all(rooms.finished, analytics.fromRevision, analytics.toRevision) as { revision: number }[]) {
    const [first, second] = store.journalState(rooms.finished, revision)!.dice!;
    pairs[(first - 1) * 6 + (second - 1)]!++;
  }
  assert.deepEqual(analytics.dice.pairs, pairs);
  assert.equal(analytics.dice.unpaired, 0);
  // Each total is the sum along its diagonal of pairs.
  for (let total = 2; total <= 12; total++)
    assert.equal(
      pairs.reduce((sum, n, i) => sum + (Math.floor(i / 6) + (i % 6) + 2 === total ? n : 0), 0),
      analytics.dice.counts[total - 2],
    );
  // A pair's expectation is only given where the dice mode says it exactly: not for the balanced deck.
  assert.equal(analytics.dice.pairExpected === null, game.diceMode === 'balanced');
  assert.equal(
    analytics.robberMoves.length,
    rowsOf(store, rooms.finished, analytics.fromRevision, analytics.toRevision, 'robber'),
  );
  assert.ok(analytics.startedAt! <= analytics.endedAt!);
  for (const player of analytics.players) {
    assert.ok(player.turnTime.turns > 0);
    assert.ok(player.turnTime.medianSeconds! >= 0 && player.turnTime.meanSeconds! >= 0);
  }
});

test('resources add up: everything gained less everything spent or lost is what is left in hand', async (t) => {
  const { store, rooms } = await fixture(t);
  for (const room of [rooms.inProgress, rooms.robber, rooms.finished, rooms.rematch]) {
    const game = store.loadGame(room)!;
    const analytics = current(store, room);
    for (const stats of analytics.players) {
      const player = game.players.find((candidate) => candidate.id === stats.id)!;
      // A seat that resigned handed its cards back to the bank, which is not a spend.
      if (player.resigned) continue;
      const { gained, spent, lost, produced } = stats.resources;
      const inHand = RESOURCES.reduce((sum, resource) => sum + player.hand[resource], 0);
      const net =
        Object.values(gained).reduce((a, b) => a + b, 0) -
        Object.values(spent).reduce((a, b) => a + b, 0) -
        Object.values(lost).reduce((a, b) => a + b, 0);
      assert.equal(net, inHand, `${room} ${stats.name}`);
      assert.equal(
        RESOURCES.reduce((sum, resource) => sum + produced[resource], 0),
        gained.production,
      );
      assert.equal(stats.devCards.bought, stats.resources.spent.devCards / 3);
    }
  }
});

test('only what the table saw: no hands or decks, and no hidden victory points in a game in progress', async (t) => {
  const { store, rooms } = await fixture(t);
  const game = store.loadGame(rooms.inProgress)!;
  const analytics = current(store, rooms.inProgress);
  assert.equal(analytics.status, 'playing');
  assert.equal(analytics.end, null);
  const text = JSON.stringify(analytics);
  // No saved game or player object leaks through: nothing keyed the way their private parts are.
  for (const secret of ['"hand":', '"deck":', '"cards":', '"balancedDice":', '"nextCard":', '"discards":'])
    assert.ok(!text.includes(secret), `no ${secret}`);
  for (const [index, player] of game.players.entries())
    assert.equal(analytics.points.byPlayer[index]!.at(-1), score(game, player, false));
  // The bot's seat is a bot, and its moves are the bot's.
  const bot = analytics.players.find((player) => player.bot)!;
  assert.ok(bot.botLevel);
  assert.equal(bot.moves.own, 0);
  assert.ok(bot.moves.bot > 0);
});

test('a room that played again keeps each round apart, and a game in setup has only turn 0', async (t) => {
  const { store, rooms } = await fixture(t);
  const round = store.db
    .prepare('SELECT room_id AS id, revision FROM archived_matches WHERE source_room_id = ?')
    .get(rooms.rematch) as { id: string; revision: number };
  const earlier = computeGameAnalytics(store.db, {
    roomId: rooms.rematch,
    archiveId: round.id,
    toRevision: round.revision,
  });
  const now = current(store, rooms.rematch);
  assert.equal(earlier.status, 'finished');
  assert.equal(earlier.end!.reason, 'resignation');
  assert.equal(earlier.toRevision, round.revision);
  assert.equal(now.status, 'playing');
  assert.ok(now.fromRevision > earlier.toRevision, 'the second game starts after the first ended');
  assert.equal(now.players.length, 2);
  assert.ok(
    now.players.some((player) => player.bot),
    'the second game added a bot',
  );
  assert.ok(!earlier.players.some((player) => player.bot));
  const setup = current(store, rooms.setup);
  assert.equal(setup.status, 'setup');
  assert.equal(setup.turns, 0);
  assert.deepEqual(setup.points.turns, [0]);
  assert.equal(setup.dice.rolls, 0);
});

test('a game still being played is read again only once it has moved on and the last answer is 20 s old', async (t) => {
  const { store, rooms, path } = await fixture(t);
  let clock = Date.now();
  const analysis = new Analysis({ databasePath: path, db: store.db, now: () => clock });
  const room = rooms.inProgress;
  const to = head(store, room);
  const first = await analysis.game({ roomId: room, archiveId: null, toRevision: to - 2 });
  assert.equal(first.fresh, true);
  assert.equal(first.value.toRevision, to - 2);
  // Moves later, but within the refresh time: the same answer, saying what it is as of.
  const soon = await analysis.game({ roomId: room, archiveId: null, toRevision: to });
  assert.deepEqual([soon.fresh, soon.value.toRevision], [false, to - 2]);
  clock += GAME_REFRESH_MS;
  const later = await analysis.game({ roomId: room, archiveId: null, toRevision: to });
  assert.deepEqual([later.fresh, later.value.toRevision], [true, to]);
  // Nothing new since: kept however long it has been.
  clock += 10 * GAME_REFRESH_MS;
  assert.equal((await analysis.game({ roomId: room, archiveId: null, toRevision: to })).fresh, false);
  // Several games at once all get their answer, a couple of threads at a time.
  const all = await Promise.all(
    [rooms.robber, rooms.setup, rooms.finished, rooms.rematch].map((id) =>
      analysis.game({ roomId: id, archiveId: null, toRevision: head(store, id) }),
    ),
  );
  assert.ok(all.every((answer) => answer.fresh && answer.value.roomId));
});

test('the analytics endpoint works from the worker, keeps its answer, and finds rounds by id', async (t) => {
  const { store, rooms, path, dir } = await fixture(t);
  const admin = await startAdminServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      auth: { mode: 'local-dev' },
      origin: 'http://127.0.0.1:3100',
      statusDir: join(dir, 'status'),
      revision: null,
    },
    store,
    runtime: { sockets: () => ({ total: 0, players: 0, spectators: 0, seats: [] }), broadcast: () => {} },
    databasePath: path,
    assetsDirectory: join(dir, 'no-build'),
    log: () => {},
  });
  t.after(() => admin.close());
  const get = async <T>(url: string, status = 200) => {
    const response = await raw(admin.port, url, { headers: API });
    assert.equal(response.status, status, `${url}: ${response.body}`);
    return JSON.parse(response.body) as T;
  };
  const code = store.roomCode(rooms.finished)!;
  const first = await get<Cached<GameAnalytics>>(`/api/admin/games/${code}/analytics`);
  assert.equal(first.fresh, true);
  assert.deepEqual(
    first.value,
    current(store, rooms.finished),
    'the worker reads what the game’s thread would',
  );
  const again = await get<Cached<GameAnalytics>>(`/api/admin/games/${rooms.finished}/analytics`);
  assert.equal(again.fresh, false, 'a finished game is analysed once');
  const round = store.db
    .prepare('SELECT room_id AS id FROM archived_matches WHERE source_room_id = ?')
    .get(rooms.rematch) as { id: string };
  const earlier = await get<Cached<GameAnalytics>>(
    `/api/admin/games/${rooms.rematch}/analytics?round=${round.id}`,
  );
  assert.equal(earlier.value.archiveId, round.id);
  assert.equal(earlier.value.status, 'finished');
  await get(`/api/admin/games/${rooms.rematch}/analytics?round=${rooms.finished}`, 404);
  await get(`/api/admin/games/${rooms.rematch}/analytics?round=not-a-round`, 400);
  await get(`/api/admin/games/${rooms.lobby}/analytics`, 404);
  // Public information: nothing is written to the audit log.
  assert.equal((await get<AuditPage>('/api/admin/audit')).entries.length, 0);
});
