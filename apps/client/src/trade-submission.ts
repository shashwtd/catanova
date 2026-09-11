import type { GameAction } from '../../../packages/rules/src/game.js';

export type TradeSender = (action: GameAction) => boolean | void | Promise<unknown>;

/** Locks synchronously, before a second click can create another network command. */
export class TradeSubmission {
  pending = false;
  async run(action: GameAction, send: TradeSender): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    try {
      // A nested submitter can refuse a command without throwing (busy or disconnected).
      return (await send(action)) !== false;
    } finally {
      this.pending = false;
    }
  }
}
