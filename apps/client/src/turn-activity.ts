import type { GameView } from '../../../packages/rules/src/game.js';
import type { GameIconName } from './GameIcons.js';

export type TurnActivity = { icon: GameIconName; label: string };

/** Discard obligations belong to each player, independently of whose turn it is. */
export function playerTurnActivity(game: GameView, playerId: string): TurnActivity | null {
  if (game.winner || game.phase === 'finished') return null;
  const count = game.discards[playerId] ?? 0;
  if (game.phase === 'discard' && count > 0) {
    return { icon: 'discard', label: `Discard ${count} resource ${count === 1 ? 'card' : 'cards'}` };
  }
  if (game.players[game.active]?.id !== playerId) return null;
  switch (game.phase) {
    case 'setupSettlement':
      return { icon: 'settlement', label: 'Place a starting settlement' };
    case 'setupRoad':
      return { icon: 'road', label: 'Place a starting road' };
    case 'freeRoads':
      return { icon: 'road', label: 'Place a free road' };
    case 'roll':
      return { icon: 'dice', label: 'Roll the dice' };
    case 'robber':
      return { icon: 'robber', label: 'Move the robber' };
    case 'actions':
      return { icon: 'trade', label: 'Build, trade or play a development card' };
    case 'discard':
      return { icon: 'timer', label: 'Waiting for players to discard' };
  }
}
