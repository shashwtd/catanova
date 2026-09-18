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

const TICK_MS = 700;
/** A ceiling per wake-up, so one busy room cannot hold the loop. */
const MOVES_PER_TICK = 4;

export type BotSeat = { id: string; name: string; level: BotLevel };

export type BotDriverDependencies = {
  store: Store;
  changed: (roomId: string) => void;
  jev?: JevClient | null;
  now?: () => number;
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
  private timer: NodeJS.Timeout | null = null;
  private readonly jev: JevClient | null;

  constructor(private readonly dependencies: BotDriverDependencies) {
    this.jev = dependencies.jev === undefined ? createJevClient() : dependencies.jev;
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
  }

  usageFor(roomId: string): BotUsage {
    return this.usage.get(roomId) ?? emptyUsage();
  }

  /** One pass over every room that currently owes a bot move. */
  async tick(): Promise<void> {
    for (const roomId of this.dependencies.store.botRooms()) {
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
    for (let step = 0; step < MOVES_PER_TICK; step++) {
      const game = store.loadGame(roomId);
      if (!game || game.phase === 'finished') return;
      // A paused room has nobody watching; bots wait rather than play it out.
      if (store.snapshot(roomId).paused) return;

      const seat = this.owedBy(roomId, game);
      if (!seat) return;

      const revision = store.snapshot(roomId).revision;
      const view = gameView(game, seat.id);
      const plan = this.plans.get(seat.id) ?? initialPlan(game.turn);

      const decision = await decide({
        view,
        board: game.board,
        meId: seat.id,
        plan,
        jev: this.jev,
        level: seat.level,
      });
      this.plans.set(seat.id, decision.plan);
      addUsage(this.usage.get(roomId) ?? this.usage.set(roomId, emptyUsage()).get(roomId)!, decision);

      // Derived from the position, so a replay after a crash is a duplicate
      // rather than a second move.
      const commandId =
        'bot-' +
        createHash('sha256')
          .update(JSON.stringify({ roomId, seat: seat.id, revision, turn: game.turn, phase: game.phase }))
          .digest('hex')
          .slice(0, 48);

      try {
        store.action(
          { id: seat.id, room_id: roomId, name: seat.name },
          commandId,
          revision,
          decision.action,
          'bot',
        );
      } catch (error) {
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
