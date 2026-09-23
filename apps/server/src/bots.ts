/**
 * Takes turns for bot seats.
 *
 * This is the same shape as the turn clock next door: a timer wakes up, finds
 * rooms that owe a move, commits one action through the ordinary rules path,
 * and broadcasts. Nothing here bypasses `Store.action`, so a bot is bound by
 * every rule, receipt and revision check a person is.
 *
 * Two properties matter more than cleverness. A bot must never stall a table,
 * so the decision layer always returns a move even when the decision service is
 * unreachable. And a bot must never think twice about the same position, so
 * each action carries a command id derived from the room, seat and revision:
 * a retry after a crash replays as a duplicate instead of moving again.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  decide,
  createJevClient,
  initialPlan,
  addUsage,
  emptyUsage,
  describe,
  profileStyle,
  rankCorners,
  STYLE_ARCHETYPE,
  STYLE_LABEL,
} from '../../../packages/bot/src/index.js';
import type { BotPlan, BotUsage, JevClient, StandInStyle } from '../../../packages/bot/src/index.js';
import type { BotLevel } from '../../../packages/protocol/src/bots.js';
import { gameView } from '../../../packages/rules/src/game.js';
import type { Game, GameAction } from '../../../packages/rules/src/game.js';
import { timeoutAction } from '../../../packages/rules/src/timeout.js';
import type { Store } from './store.js';

/** How often the scheduler looks for work. Small, because each room decides for
 *  itself when it is ready to move again. */
const TICK_MS = 250;

/** A room whose bot could not move waits this long before the next attempt,
 *  doubling each time, rather than trying again on every tick. */
const RETRY_MS = { first: 1000, longest: 60_000 } as const;
/** Failed attempts at one position before the bot stops thinking about it and
 *  makes the move the turn clock would have made. */
const RESCUE_AFTER = 3;

/**
 * How long a bot appears to think before each kind of move.
 *
 * Without this a bot answers the instant the rules allow, which is the single
 * thing that makes it read as a machine: real players pause, and they pause
 * longer over decisions that matter. The ranges below are deliberately uneven,
 * and the time already spent deciding counts towards them, so a slow model call
 * does not stack on top of the pause.
 */
const THINK_MS: Record<string, [number, number]> = {
  roll: [450, 900],
  endTurn: [700, 1400],
  discard: [900, 1800],
  bankTrade: [800, 1600],
  buyCard: [700, 1400],
  playCard: [1100, 2100],
  road: [900, 1900],
  settlement: [1300, 2600],
  city: [1300, 2600],
  robber: [1400, 2800],
};
const THINK_DEFAULT: [number, number] = [800, 1600];
/** The opening is the longest decision in a real game, so it reads wrong if it
 *  is quick. */
const OPENING_MS: [number, number] = [1900, 3600];
/** Occasionally a player is simply distracted. Rare enough not to annoy. */
const DISTRACTED_CHANCE = 0.06;
const DISTRACTED_MS: [number, number] = [900, 2200];

export type BotSeat = {
  id: string;
  name: string;
  level: BotLevel;
  /** Present when this is somebody's seat being kept warm rather than a bot
   *  the host added. `style` is null until it has been read, once. */
  standIn?: { since: number; style: StandInStyle | null };
};

export type BotDriverDependencies = {
  store: Store;
  changed: (roomId: string) => void;
  jev?: JevClient | null;
  now?: () => number;
  /** Injectable so tests can make think time deterministic. */
  random?: () => number;
  /** Injectable so tests can hand the driver a decision that fails. */
  decide?: typeof decide;
  log?: (event: string, detail: Record<string, unknown>) => void;
};

/**
 * Plans are the bot's memory between turns, so they are kept per seat and
 * survive for the life of the process. A restart loses them, which costs one
 * turn of re-planning and nothing else.
 */
export class BotDriver {
  private readonly plans = new Map<string, BotPlan>();
  /** Seats currently held for an absent player, so a plan built for a handover
   *  is dropped when the seat goes back to its owner. */
  private readonly standInPlans = new Map<string, number>();
  private readonly usage = new Map<string, BotUsage>();
  private readonly busy = new Set<string>();
  /** When a room that failed to move may be tried again. */
  private readonly retryAt = new Map<string, number>();
  /** How many attempts in a row have failed in a room, at which revision. */
  private readonly failures = new Map<string, { revision: number | null; count: number }>();
  private readonly pending = new Map<
    string,
    {
      revision: number;
      readyAt: number;
      game: Game;
      seat: BotSeat;
      decision: Awaited<ReturnType<typeof decide>>;
    }
  >();
  private readonly random: () => number;
  private timer: NodeJS.Timeout | null = null;
  private readonly jev: JevClient | null;

  constructor(private readonly dependencies: BotDriverDependencies) {
    this.jev = dependencies.jev === undefined ? createJevClient() : dependencies.jev;
    this.random = dependencies.random ?? Math.random;
  }

  /** Whether a decision service is configured. Without one the bots still play,
   *  from the deterministic fallbacks alone. */
  get thinking(): boolean {
    return !!this.jev;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  usageFor(roomId: string): BotUsage {
    return this.usage.get(roomId) ?? emptyUsage();
  }

  /** One pass over every room that currently owes a bot move. */
  async tick(): Promise<void> {
    const rooms = new Set(this.dependencies.store.botRooms());
    for (const roomId of [...this.pending.keys(), ...this.retryAt.keys(), ...this.failures.keys()])
      if (!rooms.has(roomId)) this.forget(roomId);
    for (const roomId of rooms) {
      if (this.busy.has(roomId) || (this.retryAt.get(roomId) ?? 0) > this.now()) continue;
      this.busy.add(roomId);
      try {
        const live = this.live(roomId);
        if (live) await this.playRoom(roomId, live.game, live.revision);
        else this.forget(roomId);
      } catch (error) {
        // Whatever broke, the room is tried again later rather than on every
        // tick, and a room that cannot even be read backs off to once a minute.
        this.failed(roomId, this.failures.get(roomId)?.revision ?? null, 'bot_room_failed', {
          error: (error as Error).message,
        });
      } finally {
        this.busy.delete(roomId);
      }
    }
  }

  /**
   * The game and revision of a room that could owe a bot a move, or null for
   * one that cannot: a finished game, or a table the store has paused because
   * nobody is sitting at it. This runs before any other work for the room, and
   * as cheaply as the store allows: the game alone shows it is finished, and
   * only a running game pays for the snapshot that says whether it is paused.
   * So a dead room costs a read or two a tick, whatever lists it, and never a
   * seat lookup, a decision or a queued move.
   */
  private live(roomId: string): { game: Game; revision: number } | null {
    const { store } = this.dependencies;
    const game = store.loadGame(roomId);
    if (!game || game.phase === 'finished') return null;
    const state = store.snapshot(roomId);
    return state.paused ? null : { game, revision: state.revision };
  }

  /** Drop everything held for a room that owes no move. */
  private forget(roomId: string): void {
    this.pending.delete(roomId);
    this.retryAt.delete(roomId);
    this.failures.delete(roomId);
  }

  private async playRoom(roomId: string, game: Game, revision: number): Promise<void> {
    const now = this.now();
    const seat = this.owedBy(roomId, game);
    if (!seat) {
      this.forget(roomId);
      return;
    }
    // Failures only count against one position: once anybody has moved, the
    // next attempt starts from a clean slate.
    if (this.failures.get(roomId)?.revision !== revision) this.failures.delete(roomId);
    // A seat that has gone back to its owner and been dropped again starts
    // from a clean plan: the one the last stand-in was following belonged to a
    // position several turns old.
    if (this.standInPlans.get(seat.id) !== seat.standIn?.since) {
      this.plans.delete(seat.id);
      this.standInPlans.delete(seat.id);
    }
    const waiting = this.pending.get(roomId);
    if (waiting && waiting.revision === revision && waiting.seat.id === seat.id) {
      if (waiting.readyAt > now) return;
      this.pending.delete(roomId);
      this.commit(roomId, waiting);
      return;
    }
    // A player action, disconnect or timeout invalidates any queued decision.
    this.pending.delete(roomId);
    if ((this.failures.get(roomId)?.count ?? 0) >= RESCUE_AFTER) {
      this.rescue(roomId, revision, game, seat);
      return;
    }
    const startedAt = now;
    let decision: Awaited<ReturnType<typeof decide>>;
    try {
      // A seat taken over from a person is read once, before the first move:
      // what were they building, and were they playing against the leader?
      // Everything the question is built from is what they put on the board,
      // so a stand-in knows no more about the table than the people still at it.
      const style = seat.standIn ? await this.styleFor(roomId, seat, game) : undefined;
      decision = await (this.dependencies.decide ?? decide)({
        view: gameView(game, seat.id),
        board: game.board,
        meId: seat.id,
        plan: this.plans.get(seat.id) ?? this.openingPlan(game.turn, style),
        jev: this.jev,
        level: seat.level,
        ...(style ? { standIn: style } : {}),
      });
    } catch (error) {
      this.failed(roomId, revision, 'bot_decision_failed', {
        seat: seat.name,
        error: (error as Error).message,
      });
      return;
    }
    this.plans.set(seat.id, decision.plan);
    if (seat.standIn) this.standInPlans.set(seat.id, seat.standIn.since);
    addUsage(this.usage.get(roomId) ?? this.usage.set(roomId, emptyUsage()).get(roomId)!, decision);
    // Wait before committing, including the very first bot move. Keep the
    // decision so scheduler ticks during the pause never spend more API tokens.
    this.pending.set(roomId, {
      revision,
      game,
      seat,
      decision,
      readyAt: this.now() + this.thinkTime(game.phase, decision.action.kind, startedAt),
    });
  }

  /**
   * The move the turn clock would have made, once thinking has failed three
   * times at the same position.
   *
   * Retrying alone cannot get a table unstuck: a bot deciding without the
   * service decides the same way every time, so a move the rules refuse once
   * is refused forever, and the turn clock that would otherwise step in is off
   * by default. This goes through the same commit path as every other bot
   * move, so it is bound by the same rules, receipts and revision checks.
   */
  private rescue(roomId: string, revision: number, game: Game, seat: BotSeat): void {
    const action = safeMove(game, seat.id, this.random);
    if (!action) {
      this.failed(roomId, revision, 'bot_rescue_unavailable', { seat: seat.name, phase: game.phase });
      return;
    }
    this.dependencies.log?.('bot_move_rescued', {
      roomId,
      seat: seat.name,
      action: action.kind,
      failures: this.failures.get(roomId)?.count ?? 0,
    });
    this.commit(roomId, {
      revision,
      game,
      seat,
      decision: {
        action,
        plan: this.plans.get(seat.id) ?? this.openingPlan(game.turn),
        calls: 0,
        tokens: 0,
        costUsd: 0,
        explain: 'Making the required move.',
        degraded: true,
      },
    });
  }

  /**
   * Hold a room back after a failed attempt. Each failure in a row at the same
   * position doubles the wait, from a second up to a minute, so a room that
   * keeps failing costs next to nothing instead of an attempt every tick.
   */
  private failed(roomId: string, revision: number | null, event: string, detail: Record<string, unknown>) {
    const previous = this.failures.get(roomId);
    const count = previous && previous.revision === revision ? previous.count + 1 : 1;
    const wait = Math.min(RETRY_MS.longest, RETRY_MS.first * 2 ** (count - 1));
    this.failures.set(roomId, { revision, count });
    this.retryAt.set(roomId, this.now() + wait);
    this.dependencies.log?.(event, { roomId, ...detail, failures: count, retryInMs: wait });
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private commit(
    roomId: string,
    move: {
      revision: number;
      game: Game;
      seat: BotSeat;
      decision: Awaited<ReturnType<typeof decide>>;
    },
  ) {
    const { revision, game, seat, decision } = move;
    const commandId =
      'bot-' +
      createHash('sha256')
        .update(JSON.stringify({ roomId, seat: seat.id, revision, turn: game.turn, phase: game.phase }))
        .digest('hex')
        .slice(0, 48);
    try {
      this.dependencies.store.action(
        { id: seat.id, room_id: roomId, name: seat.name },
        commandId,
        revision,
        decision.action,
        'bot',
      );
    } catch (error) {
      this.failed(roomId, revision, 'bot_move_rejected', {
        seat: seat.name,
        action: decision.action.kind,
        error: (error as Error).message,
      });
      return;
    }
    this.failures.delete(roomId);
    this.retryAt.delete(roomId);
    this.dependencies.log?.('bot_move', {
      roomId,
      seat: seat.name,
      action: decision.action.kind,
      calls: decision.calls,
      tokens: decision.tokens,
      plan: describe(decision.plan, game.board),
      ...(decision.degraded ? { degraded: true } : {}),
    });
    this.dependencies.changed(roomId);
  }

  /**
   * The pause before a move reaches the table, measured from when this bot
   * started deciding. Time already spent deciding counts towards it, so the
   * model's own latency is absorbed rather than added.
   */
  private thinkTime(phase: string, kind: string, startedAt: number): number {
    const pick = ([low, high]: [number, number]) => low + this.random() * (high - low);
    const base =
      phase === 'setupSettlement' || phase === 'setupRoad' ? OPENING_MS : (THINK_MS[kind] ?? THINK_DEFAULT);
    let target = pick(base);
    if (this.random() < DISTRACTED_CHANCE) target += pick(DISTRACTED_MS);
    const spent = this.now() - startedAt;
    return Math.max(120, Math.round(target - spent));
  }

  /**
   * How the absent player was playing, read once per handover and kept.
   *
   * The read costs one decision, not one per turn: it is stored with the
   * stand-in row, so a server restart mid-handover re-reads it and nothing
   * else does. If it cannot be read at all the stand-in still plays, from the
   * record alone.
   */
  private async styleFor(roomId: string, seat: BotSeat, game: Game): Promise<StandInStyle | undefined> {
    if (seat.standIn?.style) return seat.standIn.style;
    let profiled;
    try {
      profiled = await profileStyle({
        view: gameView(game, seat.id),
        board: game.board,
        playerId: seat.id,
        jev: this.jev,
      });
    } catch (error) {
      this.dependencies.log?.('bot_style_failed', {
        roomId,
        seat: seat.name,
        error: (error as Error).message,
      });
      return undefined;
    }
    if (!profiled) return undefined;
    this.dependencies.store.saveStandInStyle(roomId, seat.id, profiled.style, seat.standIn!.since);
    addUsage(this.usage.get(roomId) ?? this.usage.set(roomId, emptyUsage()).get(roomId)!, {
      ...profiled,
      degraded: !!profiled.style.inferred,
    });
    this.dependencies.log?.('bot_standin_style', {
      roomId,
      seat: seat.name,
      style: profiled.style.style,
      playing: STYLE_LABEL[profiled.style.style],
      contesting: profiled.style.contesting,
      ...(profiled.style.inferred ? { inferred: true } : {}),
    });
    return profiled.style;
  }

  /** A stand-in's first plan continues the game it inherited rather than
   *  starting a different one in somebody else's chair. */
  private openingPlan(turn: number, style?: StandInStyle): BotPlan {
    const plan = initialPlan(turn);
    return style ? { ...plan, archetype: STYLE_ARCHETYPE[style.style] } : plan;
  }

  /** The bot that owes a move: whoever must discard first, otherwise the active
   *  seat. Mirrors how the turn clock decides who it is waiting for. */
  private owedBy(roomId: string, game: Game): BotSeat | null {
    const bots = this.dependencies.store.botSeatsIn(roomId);
    if (!bots.length) return null;
    const byId = new Map(bots.map((b) => [b.id, b]));
    if (game.phase === 'discard') {
      const owing = Object.keys(game.discards).find((id) => byId.has(id));
      if (owing) return byId.get(owing)!;
      return null;
    }
    const active = game.players[game.active];
    if (!active || active.resigned) return null;
    return byId.get(active.id) ?? null;
  }
}

/**
 * Only what the rules require of this seat, never spending anything: the turn
 * clock's own choice wherever it has one. The opening has no clock, so there it
 * is the corner with the most production and a road beside it, which is also
 * all the opening asks of anybody.
 */
function safeMove(game: Game, seatId: string, random: () => number): GameAction | undefined {
  const forced = timeoutAction(game, seatId, random);
  if (forced) return forced;
  const legal = gameView(game, seatId).legal;
  const corner = rankCorners(game.board, legal.settlements, 1)[0];
  if (game.phase === 'setupSettlement' && corner !== undefined) return { kind: 'settlement', vertex: corner };
  if (game.phase === 'setupRoad' && legal.roads.length) return { kind: 'road', edge: legal.roads[0]! };
  return undefined;
}

export const newBotCommandId = () => 'bot-' + randomUUID();
