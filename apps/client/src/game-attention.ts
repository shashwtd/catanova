import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { GameIconName } from './GameIcons.js';

export type GameStatus = {
  title: string;
  prompt: string;
  icon: GameIconName;
  favicon: 'dice' | 'robber' | null;
};
export const HOME_TITLE = 'Catanova — Build. Trade. Settle.';

/** A tab and a small on-board prompt describe the same authoritative phase. */
export function gameStatus(game: GameView, me?: string, room?: RoomState): GameStatus {
  const active = game.players[game.active];
  const mine = active?.id === me;
  const name = active?.name ?? 'A player';
  let prompt = '',
    icon: GameIconName = 'timer',
    favicon: GameStatus['favicon'] = null;
  if (game.winner || game.phase === 'finished') {
    prompt = `${game.players.find((p) => p.id === game.winner)?.name ?? 'A player'} wins${game.finishReason === 'resignation' ? ' by resignation' : ''}!`;
    icon = 'trophy';
  } else if (room?.paused) {
    prompt = 'Game paused — waiting for players';
  } else if (game.players.find((p) => p.id === me)?.resigned) {
    prompt = 'You resigned — watching the game';
  } else
    switch (game.phase) {
      case 'setupSettlement':
        prompt = mine ? 'Place a settlement on a highlighted corner' : `${name} is placing a settlement`;
        icon = 'settlement';
        break;
      case 'setupRoad':
        prompt = mine ? 'Place a road on a highlighted path' : `${name} is placing a road`;
        icon = 'road';
        break;
      case 'freeRoads':
        prompt = mine
          ? `Place ${game.freeRoads} free road${game.freeRoads === 1 ? '' : 's'} on the highlighted paths`
          : `${name} is placing free roads`;
        icon = 'road';
        break;
      case 'roll':
        prompt = mine ? 'Your turn — roll the dice' : `${name} is rolling the dice`;
        icon = 'dice';
        favicon = mine ? 'dice' : null;
        break;
      case 'actions':
        prompt = mine ? 'Your turn — build or trade' : `${name} is building or trading`;
        icon = 'trade';
        break;
      case 'discard': {
        const count = game.discards[me ?? ''] ?? 0;
        const waiting = game.players.filter((p) => (game.discards[p.id] ?? 0) > 0).map((p) => p.name);
        prompt = count
          ? `Choose ${count} cards to discard`
          : `Waiting for ${waiting.join(', ') || 'players'} to discard`;
        icon = 'discard';
        break;
      }
      case 'robber':
        prompt = mine ? 'Move the robber to a highlighted tile' : `${name} is moving the robber`;
        icon = 'robber';
        favicon = mine ? 'robber' : null;
        break;
    }
  if (
    !game.winner &&
    !room?.paused &&
    !mine &&
    !game.players.find((p) => p.id === me)?.resigned &&
    !((game.discards[me ?? ''] ?? 0) > 0)
  ) {
    const seat = room?.players.find((p) => p.id === active?.id);
    if (seat && !seat.connected && seat.resignAt !== undefined) {
      prompt = `Waiting for ${name} to reconnect`;
      icon = 'connection';
      favicon = null;
    }
  }
  return { prompt, icon, favicon, title: `${prompt} — Catanova` };
}

export function requiredAction(game: GameView, me?: string) {
  if (!me || game.winner || game.phase === 'finished' || game.players.find((p) => p.id === me)?.resigned)
    return null;
  if (game.phase === 'discard' && (game.discards[me] ?? 0) > 0) return 'discard';
  if (game.players[game.active]?.id !== me) return null;
  return ['roll', 'setupSettlement', 'setupRoad', 'freeRoads', 'robber'].includes(game.phase)
    ? game.phase
    : null;
}

/** Do not repeat a cue for presence updates, re-syncs, or a reconnect to the same obligation. */
export class AttentionTracker {
  private key: string | null = null;
  private action: ReturnType<typeof requiredAction> = null;
  update(
    room: RoomState | null,
    me: string | undefined,
    connected: boolean,
    presenting = false,
  ): 'turn' | 'warning' | null {
    if (!room?.game) {
      this.key = null;
      this.action = null;
      return null;
    }
    if (!connected || presenting || room.paused) return null;
    const g = room.game,
      action = requiredAction(g, me);
    if (!action) {
      this.key = null;
      this.action = null;
      return null;
    }
    const key = `${room.roomId}:${me}:${g.turn}:${g.setupIndex}:${action}`;
    if (this.key === key) return null;
    const previousAction = this.action;
    this.key = key;
    this.action = action;
    // The house's construction sound already leads straight into its adjacent road.
    if (action === 'setupRoad' && previousAction === 'setupSettlement') return null;
    return action === 'roll' || action === 'setupSettlement' || action === 'setupRoad' ? 'turn' : 'warning';
  }
}
