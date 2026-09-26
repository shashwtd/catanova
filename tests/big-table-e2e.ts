/**
 * Big Table end to end, through the Store as the server plays it: whole games of five and six players, driven by
 * scripted legal moves, with a player who leaves, a player who drops out long enough for the clock to act for
 * them, and (under paired turns with a timer) Partners whose clock runs out with free roads or a Knight's robber
 * still owed. Then each game's journal replays move by move, every row keeps every card, the restore verifier
 * passes it and the admin's game analytics reads it. The two turn structures have a test file each, so that
 * their games play at the same time.
 */
import assert from 'node:assert/strict';
import { ABSENCE_AFTER_MS } from '../apps/server/src/store.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { gameInvariantProblems, verifyStore } from '../scripts/verify-restored-games.js';
import {
  activePlayer,
  applyAction,
  emptyHand,
  gameView,
  resignPlayers,
  score,
  total,
} from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import type { OwedMove } from '../packages/rules/src/owed.js';
import { timeoutAction, timeoutDescription } from '../packages/rules/src/timeout.js';
import { BIG_TABLE } from '../packages/rules/src/rulesets.js';
import type { TurnStructure } from '../packages/rules/src/rulesets.js';
import { partnerSeconds } from '../packages/protocol/src/settings.js';
import { bigTableRoom } from './big-table-room.js';
import type { Room } from './big-table-room.js';

const die = (face: number) => (face - 0.5) / 6;

/** Every card in the bank or a hand, and every development card in the deck or bought: Big Table's counts. */
function accounted(game: Game, where: string) {
  for (const r of RESOURCES)
    assert.equal(
      game.bank[r] + game.players.reduce((n, p) => n + p.hand[r], 0),
      BIG_TABLE.supply.bank,
      `${where}: ${r}`,
    );
  assert.equal(game.deck.length + game.nextCard, 34, `${where}: the deck`);
}

/** A random source that reproduces a recorded move: its dice, and for a steal the card that moved. */
function oracle(before: Game, after: Game, action: GameAction, actor: string): () => number {
  const values: number[] = [];
  if (action.kind === 'roll') values.push(die(after.dice![0]), die(after.dice![1]));
  if (action.kind === 'robber' && action.victim) {
    const victim = before.players.find((p) => p.id === action.victim)!;
    const cards = RESOURCES.flatMap((r) => Array<string>(victim.hand[r]).fill(r));
    const gained = RESOURCES.find(
      (r) =>
        after.players.find((p) => p.id === actor)!.hand[r] >
        before.players.find((p) => p.id === actor)!.hand[r],
    );
    if (cards.length) values.push((cards.indexOf(gained!) + 0.5) / cards.length);
  }
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error(`${action.kind} drew randomness the journal cannot account for`);
    return value;
  };
}

export type Events = {
  partnerRoadsLapsed: number;
  partnerKnightExpired: number;
  resigned: number;
  away: number;
};

/**
 * The move a careful table makes: build where it can, buy, trade with the bank, play a card now and then, and
 * otherwise end its part. The Lead sometimes trades with another player first.
 */
function choose(room: Room, owed: OwedMove, rng: () => number): GameAction[] {
  const g = room.game(),
    me = g.players.find((p) => p.id === owed.player)!,
    legal = gameView(g, owed.player).legal;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
  switch (owed.kind) {
    case 'setupSettlement':
      return [{ kind: 'settlement', vertex: pick(legal.settlements) }];
    case 'setupRoad':
    case 'freeRoads':
      return legal.roads.length
        ? [{ kind: 'road', edge: pick(legal.roads) }]
        : [timeoutAction(g, me.id, rng)!];
    case 'roll':
    case 'discard':
    case 'robber':
      return [timeoutAction(g, me.id, rng)!];
    default: {
      const end: GameAction =
        owed.kind === 'partner'
          ? { kind: 'endPhase' }
          : owed.kind === 'buildWindow'
            ? { kind: 'endWindow' }
            : { kind: 'endTurn' };
      if (legal.settlements.length) return [{ kind: 'settlement', vertex: pick(legal.settlements) }];
      if (legal.cities.length) return [{ kind: 'city', vertex: pick(legal.cities) }];
      if (legal.canBuyCard && rng() < 0.7) return [{ kind: 'buyCard' }];
      const card = me.cards.find((c) => legal.playableCards.includes(c.id));
      if (card && rng() < 0.6) {
        if (card.kind === 'yearOfPlenty') {
          // Two cards the bank still has, or the one it has left.
          const resources = emptyHand();
          for (let n = 0; n < Math.min(2, total(g.bank)); n++)
            resources[pick(RESOURCES.filter((r) => g.bank[r] > resources[r]))]++;
          return total(resources) ? [{ kind: 'playCard', cardId: card.id, resources }] : [end];
        }
        if (card.kind === 'monopoly')
          return [{ kind: 'playCard', cardId: card.id, resource: pick(RESOURCES) }];
        // Road Building is kept for a Partner's phase, where the clock may leave its roads unplaced.
        if (card.kind === 'roadBuilding')
          return legal.roads.length > 1 && owed.kind === 'actions' && rng() < 0.2
            ? [{ kind: 'playCard', cardId: card.id }]
            : [end];
        return [{ kind: 'playCard', cardId: card.id }];
      }
      if (legal.roads.length && rng() < 0.4) return [{ kind: 'road', edge: pick(legal.roads) }];
      if (owed.kind !== 'buildWindow') {
        const give = RESOURCES.find((r) => me.hand[r] >= legal.rates[r] + 1);
        const receive = RESOURCES.filter((r) => r !== give && g.bank[r] > 0 && me.hand[r] === 0);
        if (give && receive.length && rng() < 0.7)
          return [{ kind: 'bankTrade', give, receive: pick(receive) }];
      }
      return [end];
    }
  }
}

/** A Lead's trade with another player: an offer of one card for one, accepted, then confirmed. */
function tradeWithPlayer(room: Room, lead: string, away: string | null, rng: () => number): boolean {
  const g = room.game(),
    me = g.players.find((p) => p.id === lead)!;
  const give = RESOURCES.find((r) => me.hand[r] > 0);
  const other = g.players.find(
    (p) =>
      p.id !== lead && p.id !== away && !p.resigned && RESOURCES.some((r) => r !== give && p.hand[r] > 0),
  );
  if (!give || !other || rng() > 0.15) return false;
  const want = RESOURCES.find((r) => r !== give && other.hand[r] > 0)!;
  room.act(lead, {
    kind: 'offerTrade',
    give: { ...emptyHand(), [give]: 1 },
    want: { ...emptyHand(), [want]: 1 },
  });
  const trade = room.game().trade!;
  room.act(other.id, { kind: 'acceptTrade', tradeId: trade.id });
  room.act(lead, { kind: 'acceptProposal', tradeId: trade.id, player: other.id });
  return true;
}

/** Play one game to its end, with the events the header promises. */
function playGame(
  options: { players: number; turns: TurnStructure; timer: 65 | null; seed: number },
  events: Events,
) {
  const room = bigTableRoom({
    players: options.players,
    turns: options.turns,
    timer: options.timer,
    victoryPoints: 8,
    random: seededRandom(options.seed),
  });
  const rng = seededRandom(options.seed * 7 + 1);
  const leaves: { revision: number; player: string; eligible: string[] }[] = [];
  const connected = new Set(room.seats.map((seat) => seat.id));
  const lapsed = new Set<string>();
  let away: string | null = null,
    awayUntil = 0,
    left = false,
    wentAway = false;
  for (let step = 0; step < 20000 && room.game().phase !== 'finished'; step++) {
    room.clock.now += 1_500;
    const g = room.game();
    accounted(g, `step ${step}`);
    // One player leaves partway: at six, the pairs are recounted; at five, turns go single.
    if (!left && g.turn === 8) {
      const leaving = g.players.find((p) => !p.resigned && p.id !== activePlayer(g).id && p.id !== away)!;
      const eligible = g.players.filter((p) => !p.resigned && p.id !== leaving.id && connected.has(p.id));
      room.store.leave(room.seatOf(leaving.id), `leave-${step}`, room.revision());
      leaves.push({ revision: room.revision(), player: leaving.id, eligible: eligible.map((p) => p.id) });
      connected.delete(leaving.id);
      left = true;
      events.resigned++;
      continue;
    }
    // One player drops out for three minutes of the game: after two, the clock makes their forced moves.
    if (!wentAway && g.turn === 4) {
      const player = g.players.find((p) => !p.resigned && p.id !== activePlayer(g).id)!;
      room.store.setConnected(room.seatOf(player.id), false);
      connected.delete(player.id);
      away = player.id;
      awayUntil = room.clock.now + ABSENCE_AFTER_MS + 60_000;
      wentAway = true;
      events.away++;
    }
    if (away && room.clock.now >= awayUntil) {
      room.store.setConnected(room.seatOf(away), true);
      connected.add(away);
      away = null;
    }
    const owed = owedMoves(g)[0];
    assert.ok(owed, `step ${step}: someone is owed a move during ${g.phase}`);
    if (owed.player === away) {
      // They are gone: wait for the absence rule, which acts for them once two minutes have passed.
      room.clock.now += 10_000;
      room.store.expireRoom(room.roomId);
      continue;
    }
    // A Partner with a timer who plays Road Building or a Knight and then lets the clock run out: once each
    // a game, Road Building first when they hold one.
    if (options.turns === 'paired' && options.timer && owed.kind === 'partner') {
      const legal = gameView(g, owed.player).legal;
      const playable = g.players[g.active]!.cards.filter((c) => legal.playableCards.includes(c.id));
      const card =
        playable.find((c) => c.kind === 'roadBuilding' && !lapsed.has(c.kind) && legal.roads.length > 1) ??
        playable.find((c) => c.kind === 'knight' && !lapsed.has(c.kind));
      if (card) {
        room.act(owed.player, { kind: 'playCard', cardId: card.id });
        if (card.kind === 'roadBuilding') {
          room.act(owed.player, { kind: 'road', edge: gameView(room.game(), owed.player).legal.roads[0]! });
          if (room.game().phase === 'freeRoads') events.partnerRoadsLapsed++;
        } else events.partnerKnightExpired++;
        room.clock.now += partnerSeconds(options.timer) * 1000;
        room.store.expireRoom(room.roomId);
        lapsed.add(card.kind);
        continue;
      }
    }
    if (owed.kind === 'actions' && tradeWithPlayer(room, owed.player, away, rng)) continue;
    for (const action of choose(room, owed, rng)) room.act(owed.player, action);
  }
  const final = room.game();
  assert.equal(final.phase, 'finished', `${options.turns}, ${options.players} players, seed ${options.seed}`);
  accounted(final, 'the end');
  return { room, leaves };
}

/** Replay a room's journal: every row follows from the one before, by its action or its resignation. */
function replay(room: Room, leaves: { revision: number; player: string; eligible: string[] }[]) {
  const rows = room.store.db
    .prepare(
      'SELECT revision, actor, action, public_entry, command_id FROM game_events WHERE room_id = ? ORDER BY revision',
    )
    .all(room.roomId) as {
    revision: number;
    actor: string;
    action: string;
    public_entry: string;
    command_id: string;
  }[];
  let previous: Game | undefined,
    replayed = 0;
  for (const row of rows) {
    const state = room.store.journalState(room.roomId, row.revision)!;
    assert.deepEqual(gameInvariantProblems(state), [], `revision ${row.revision}`);
    accounted(state, `revision ${row.revision}`);
    const kind = (JSON.parse(row.public_entry) as { kind: string }).kind;
    if (previous && kind === 'leave') {
      const leave = leaves.find((l) => l.revision === row.revision)!;
      assert.deepEqual(
        resignPlayers(previous, [leave.player], {
          reason: 'leave',
          botIds: [],
          winnerEligibleIds: leave.eligible,
        }),
        state,
        `revision ${row.revision}: leave`,
      );
      replayed++;
    } else if (previous && kind !== 'start') {
      const action = JSON.parse(row.action) as GameAction;
      const next = applyAction(previous, row.actor, action, oracle(previous, state, action, row.actor));
      // The clock's moves, and the absence rule's, carry a line saying so, which the server adds.
      if ((JSON.parse(row.public_entry) as { automatic?: boolean }).automatic) {
        const name = previous.players.find((p) => p.id === row.actor)!.name;
        const description = timeoutDescription(action, previous.phase);
        next.log.push({
          id: next.nextLog++,
          text: row.command_id.startsWith('away-')
            ? `${name} is away; ${description}.`
            : `${name}'s timer expired; ${description}.`,
        });
        if (next.log.length > 80) next.log.shift();
      }
      assert.deepEqual(next, state, `revision ${row.revision}: ${action.kind}`);
      replayed++;
    }
    previous = state;
  }
  assert.equal(replayed, rows.length - 1);
  assert.deepEqual(room.store.verifyJournal(room.roomId).problems, []);
  return rows;
}

/** Play each game to its end and check it every way the header says; returns what happened along the way. */
export function playAndCheck(
  turns: TurnStructure,
  games: { players: number; seed: number; timer: 65 | null }[],
) {
  const events: Events = { partnerRoadsLapsed: 0, partnerKnightExpired: 0, resigned: 0, away: 0 };
  const seen = { partnerPhases: 0, windows: 0, singleTurns: 0, windowsWithoutTimer: 0 };
  for (const { players, seed, timer } of games) {
    const { room, leaves } = playGame({ players, turns, timer, seed }, events);
    try {
      const rows = replay(room, leaves);
      const final = room.game();
      const history = rows.map((row) => JSON.parse(row.public_entry) as { kind: string; lines: string[] });
      seen.partnerPhases += history.filter((entry) => entry.kind === 'endPhase').length;
      seen.windows += history.filter((entry) => entry.kind === 'endWindow').length;
      if (timer === null)
        seen.windowsWithoutTimer += history.filter((entry) => entry.kind === 'endWindow').length;
      if (history.some((entry) => entry.lines.some((line) => line.startsWith('Fewer than five'))))
        seen.singleTurns++;
      // The restore verifier passes it, and the admin's analytics reads it all.
      const report = verifyStore(room.store);
      const detail = report.details.find((other) => other.roomId === room.roomId)!;
      assert.equal(detail.status, 'verified', detail.problems.join('; '));
      assert.equal(detail.ruleset, BIG_TABLE.id);
      const analytics = computeGameAnalytics(room.store.db, {
        roomId: room.roomId,
        archiveId: null,
        toRevision: rows.at(-1)!.revision,
      });
      assert.equal(analytics.players.length, players);
      assert.equal(analytics.dice.sevens, room.store.statistics(room.roomId).diceCounts[5]);
      for (const player of final.players) {
        const stats = analytics.players.find((p) => p.id === player.id)!;
        assert.equal(stats.points, score(final, player, !!final.winner));
        if (turns === 'paired') assert.ok(stats.partnerTime, 'Partner’s phases are timed for the Partner');
        else assert.equal(stats.partnerTime, undefined);
      }
      assert.ok(
        analytics.players.some((p) => p.resigned),
        'the player who left is recorded',
      );
    } finally {
      room.store.close();
    }
  }
  assert.equal(events.resigned, games.length);
  assert.equal(events.away, games.length);
  return { events, seen };
}
