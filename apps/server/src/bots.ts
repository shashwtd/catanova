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
} from '../../../packages/bot/src/index.js';
import type { BotPlan, BotUsage, JevClient } from '../../../packages/bot/src/index.js';
import type { BotLevel } from '../../../packages/protocol/src/bots.js';
import { gameView } from '../../../packages/rules/src/game.js';
import type { Game } from '../../../packages/rules/src/game.js';
import type { Store } from './store.js';

/** How often the scheduler looks for work. Small, because each room decides for
 *  itself when it is ready to move again. */
const TICK_MS = 250;

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

export type BotSeat = { id: string; name: string; level: BotLevel };

export type BotDriverDependencies = {
  store: Store;
  changed: (roomId: string) => void;
  jev?: JevClient | null;
  now?: () => number;
  /** Injectable so tests can make think time deterministic. */
  random?: () => number;
  log?: (event: string, detail: Record<string, unknown>) => void;
};

/**
 * Plans are the bot's memory between turns, so they are kept per seat and
 * survive for the life of the process. A restart loses them, which costs one
 * turn of re-planning and nothing else.
 */
export class BotDriver {
  private readonly plans = new Map<string, BotPlan>();
  private readonly usage = new Map<string, BotUsage>();
  private readonly busy = new Set<string>();
  private readonly readyAt = new Map<string, number>();
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
    const rooms = this.dependencies.store.botRooms();
    for (const roomId of this.pending.keys()) if (!rooms.includes(roomId)) this.pending.delete(roomId);
    for (const roomId of this.readyAt.keys()) if (!rooms.includes(roomId)) this.readyAt.delete(roomId);
    for (const roomId of rooms) {
      if (this.busy.has(roomId)) continue;
      this.busy.add(roomId);
      try {
        await this.playRoom(roomId);
      } catch (error) {
        this.dependencies.log?.('bot_room_failed', { roomId, error: (error as Error).message });
      } finally {
        this.busy.delete(roomId);
      }
    }
  }

  private async playRoom(roomId: string): Promise<void> {
    const { store } = this.dependencies;
    const now = this.dependencies.now?.() ?? Date.now();
    const game = store.loadGame(roomId);
    const state = store.snapshot(roomId);
    const seat = game && this.owedBy(roomId, game);
    if (!game || game.phase === 'finished' || state.paused || !seat) {
      this.pending.delete(roomId);
      this.readyAt.delete(roomId);
      return;
    }
    const waiting = this.pending.get(roomId);
    if (waiting && waiting.revision === state.revision && waiting.seat.id === seat.id) {
      if (waiting.readyAt > now) return;
      this.pending.delete(roomId);
      this.commit(roomId, waiting);
      return;
    }
    // A player action, disconnect or timeout invalidates any queued decision.
    this.pending.delete(roomId);
    if ((this.readyAt.get(roomId) ?? 0) > now) return;
    const startedAt = now;
    const decision = await decide({
      view: gameView(game, seat.id),
      board: game.board,
      meId: seat.id,
      plan: this.plans.get(seat.id) ?? initialPlan(game.turn),
      jev: this.jev,
      level: seat.level,
    });
    this.plans.set(seat.id, decision.plan);
    addUsage(this.usage.get(roomId) ?? this.usage.set(roomId, emptyUsage()).get(roomId)!, decision);
    // Wait before committing, including the very first bot move. Keep the
    // decision so scheduler ticks during the pause never spend more API tokens.
    this.pending.set(roomId, {
      revision: state.revision,
      game,
      seat,
      decision,
      readyAt:
        (this.dependencies.now?.() ?? Date.now()) +
        this.thinkTime(game.phase, decision.action.kind, startedAt),
    });
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
      this.readyAt.set(roomId, (this.dependencies.now?.() ?? Date.now()) + 1000);
      this.dependencies.log?.('bot_move_rejected', {
        roomId,
        seat: seat.name,
        action: decision.action.kind,
        error: (error as Error).message,
      });
      return;
    }
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
    const spent = (this.dependencies.now?.() ?? Date.now()) - startedAt;
    return Math.max(120, Math.round(target - spent));
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

export const newBotCommandId = () => 'bot-' + randomUUID();
