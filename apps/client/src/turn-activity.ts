import type { GameView } from '../../../packages/rules/src/game.js';
import type { GameIconName } from './GameIcons.js';

/**
 * What a player on the rail is doing now. `marker`, in a paired turn, is the marker they hold: both the Lead
 * and the Partner are on turn for the whole paired turn, whichever of them is acting.
 */
export type TurnActivity = { icon: GameIconName; label: string; marker?: 'Lead' | 'Partner' };

/** Which of a paired turn's markers a player holds, if either. */
export function turnMarker(game: GameView, playerId: string): TurnActivity['marker'] {
  if (!game.pair) return undefined;
  const seat = game.players.findIndex((p) => p.id === playerId);
  return seat === game.pair.lead ? 'Lead' : seat === game.pair.partner ? 'Partner' : undefined;
}

/** Discard obligations belong to each player, independently of whose turn it is. */
export function playerTurnActivity(game: GameView, playerId: string): TurnActivity | null {
  if (game.winner || game.phase === 'finished' || game.players.find((p) => p.id === playerId)?.resigned)
    return null;
  const marker = turnMarker(game, playerId),
    held = marker ? { marker } : {};
  const count = game.discards[playerId] ?? 0;
  if (game.phase === 'discard' && count > 0) {
    return { icon: 'discard', label: `Discard ${count} resource ${count === 1 ? 'card' : 'cards'}`, ...held };
  }
  if (game.players[game.active]?.id !== playerId) {
    // The marker holder who is not acting still holds the turn, and may still win in it.
    if (marker === 'Lead') return { icon: 'timer', label: 'Lead: the Partner is taking their phase', marker };
    if (marker === 'Partner') return { icon: 'timer', label: 'Partner: acts after the Lead', marker };
    return null;
  }
  switch (game.phase) {
    case 'setupSettlement':
      return { icon: 'settlement', label: 'Place a starting settlement' };
    case 'setupRoad':
      return { icon: 'road', label: 'Place a starting road' };
    case 'freeRoads':
      return { icon: 'road', label: 'Place a free road', ...held };
    case 'roll':
      return { icon: 'dice', label: 'Roll the dice', ...held };
    case 'robber':
      return { icon: 'robber', label: 'Move the robber', ...held };
    case 'actions':
      return { icon: 'trade', label: 'Build, trade or play a development card', ...held };
    case 'discard':
      return { icon: 'timer', label: 'Waiting for players to discard', ...held };
    case 'partner':
      return {
        icon: 'trade',
        label: 'Partner’s phase: build, buy, trade with the bank, play one card',
        ...held,
      };
    case 'buildWindow':
      return { icon: 'settlement', label: 'Build window: build or buy, no trading' };
  }
}
