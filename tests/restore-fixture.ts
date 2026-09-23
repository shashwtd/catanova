/**
 * A game database with several really played matches, for restore-drill tests.
 *
 * Every move goes through Store.action, chosen by the offline bot decider for every seat (the
 * people's seats are recorded as human moves), so the journal, receipts, history and saved
 * games are exactly what production writes. Boards are random, so each target state is reached
 * by play within a generous bound rather than assumed.
 */
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { gameView, roadSites, settlementSites } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan } from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';

export type FixtureRooms = {
  /** Three seats (one bot), stopped mid-turn after a roll. */
  inProgress: string;
  /** Four people, stopped with the third settlement placed and its road due. */
  setup: string;
  /** Two people, stopped on a seven with the robber or discards due. */
  robber: string;
  /** Two people; one left, so the other won by resignation. */
  finished: string;
  /** A finished round archived by returning to the lobby, then a second game in progress. */
  rematch: string;
  /** Two people in a lobby that never started. */
  lobby: string;
};

const token = () => randomBytes(32).toString('hex');

async function playUntil(store: Store, roomId: string, stop: (game: Game) => boolean, limit: number) {
  const plans = new Map<string, BotPlan>();
  const bots = new Set(store.botSeatsIn(roomId).map((seat) => seat.id));
  for (let step = 0; step < limit; step++) {
    const game = store.loadGame(roomId)!;
    if (stop(game)) return game;
    if (game.phase === 'finished') break;
    const actor =
      game.phase === 'discard' ? Object.keys(game.discards).sort()[0]! : game.players[game.active]!.id;
    const seat: Seat = { id: actor, name: game.players.find((p) => p.id === actor)!.name, room_id: roomId };
    const kind = bots.has(actor) ? ('bot' as const) : false;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor) ?? initialPlan(game.turn),
      jev: null,
    });
    plans.set(actor, decision.plan);
    const revision = store.snapshot(roomId).revision;
    try {
      store.action(seat, `fixture-${step}`, revision, decision.action, kind);
    } catch {
      // As in scripts/bot-game.ts: a refused choice falls back to the mandatory move.
      const rescue: GameAction | undefined =
        timeoutAction(game, actor, Math.random) ??
        (game.phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: settlementSites(game, actor, true)[0]! }
          : { kind: 'road', edge: roadSites(game, actor, game.setupVertex)[0]! });
      store.action(seat, `fixture-rescue-${step}`, revision, rescue, kind);
    }
  }
  throw new Error(`fixture room ${roomId} did not reach its target state within ${limit} moves`);
}

function lobbyOf(store: Store, people: number, bots = 0) {
  const host = store.enter('create', token(), 'Host');
  const roomId = host.room_id;
  const guests = Array.from({ length: people - 1 }, (_, i) =>
    store.enter('join', token(), `Guest ${i + 1}`, roomId),
  );
  for (let i = 0; i < bots; i++)
    store.lobby(host, token(), store.snapshot(roomId).revision, false, undefined, undefined, true);
  return { host, guests, roomId };
}

function start(store: Store, host: Seat, guests: Seat[]) {
  for (const guest of guests) store.lobby(guest, token(), store.snapshot(host.room_id).revision, true);
  store.action(host, token(), store.snapshot(host.room_id).revision, { kind: 'start' });
}

/** Plays the fixture into a new database at `path` and returns the still-open Store. */
export async function buildPlayedDatabase(path: string): Promise<{ store: Store; rooms: FixtureRooms }> {
  const store = new Store(path);
  const room = (people: number, bots = 0) => {
    const seats = lobbyOf(store, people, bots);
    start(store, seats.host, seats.guests);
    return seats;
  };

  const inProgress = room(2, 1);
  await playUntil(store, inProgress.roomId, (g) => g.phase === 'actions' && g.turn >= 6, 2000);

  const setup = room(4);
  await playUntil(
    store,
    setup.roomId,
    (g) => g.phase === 'setupRoad' && Object.keys(g.buildings).length === 3,
    20,
  );

  const robber = room(2);
  await playUntil(store, robber.roomId, (g) => g.phase === 'robber' || g.phase === 'discard', 3000);

  const finished = room(2);
  await playUntil(store, finished.roomId, (g) => g.phase === 'roll' && g.turn >= 4, 2000);
  store.leave(finished.guests[0]!, token(), store.snapshot(finished.roomId).revision);

  const rematch = room(2);
  await playUntil(store, rematch.roomId, (g) => g.phase === 'roll' && g.turn >= 3, 2000);
  store.leave(rematch.guests[0]!, token(), store.snapshot(rematch.roomId).revision);
  store.action(rematch.host, token(), store.snapshot(rematch.roomId).revision, { kind: 'returnToLobby' });
  store.lobby(
    rematch.host,
    token(),
    store.snapshot(rematch.roomId).revision,
    false,
    undefined,
    undefined,
    true,
  );
  store.action(rematch.host, token(), store.snapshot(rematch.roomId).revision, { kind: 'start' });
  await playUntil(store, rematch.roomId, (g) => g.phase === 'actions' && g.turn >= 3, 2000);

  const lobby = lobbyOf(store, 2);
  return {
    store,
    rooms: {
      inProgress: inProgress.roomId,
      setup: setup.roomId,
      robber: robber.roomId,
      finished: finished.roomId,
      rematch: rematch.roomId,
      lobby: lobby.roomId,
    },
  };
}

/**
 * Turn a closed Store database into what backup.py produces: one self-contained file in
 * rollback-journal mode with no sidecars.
 */
export function makeStandalone(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();
}
