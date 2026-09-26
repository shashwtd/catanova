import type { GameView } from '../../../packages/rules/src/game.js';
import { findRuleset } from '../../../packages/rules/src/rulesets.js';
import { RESOURCES } from '../../../packages/rules/src/index.js';
import type { GameIconName } from './GameIcons.js';

export type TurnActivity = { icon: GameIconName; label: string };

/**
 * Discard obligations belong to each player, independently of whose turn it is, and so do Open Sea's gold
 * picks, which go one player at a time.
 */
export function playerTurnActivity(game: GameView, playerId: string): TurnActivity | null {
  if (game.winner || game.phase === 'finished' || game.players.find((p) => p.id === playerId)?.resigned)
    return null;
  const count = game.discards[playerId] ?? 0;
  if (game.phase === 'discard' && count > 0) {
    return { icon: 'discard', label: `Discard ${count} resource ${count === 1 ? 'card' : 'cards'}` };
  }
  const picking = game.phase === 'goldPick' ? game.goldOwed?.[0] : undefined;
  if (picking?.player === playerId) {
    const picks = Math.min(
      picking.picks,
      RESOURCES.reduce((n, r) => n + game.bank[r], 0),
    );
    return {
      icon: 'spark',
      label: `Pick ${picks} ${picks === 1 ? 'resource' : 'resources'} from a gold field`,
    };
  }
  if (game.players[game.active]?.id !== playerId) return null;
  const sea = !!findRuleset(game.ruleset)?.sea;
  switch (game.phase) {
    case 'setupSettlement':
      return { icon: 'settlement', label: 'Place a starting settlement' };
    case 'setupRoad':
      return { icon: 'road', label: sea ? 'Place a starting road or ship' : 'Place a starting road' };
    case 'freeRoads':
      return { icon: 'road', label: sea ? 'Place a free road or ship' : 'Place a free road' };
    case 'roll':
      return { icon: 'dice', label: 'Roll the dice' };
    case 'robber':
      return { icon: 'robber', label: sea ? 'Move the robber or the pirate' : 'Move the robber' };
    case 'goldPick':
      return { icon: 'timer', label: 'Waiting for gold picks' };
    case 'actions':
      return { icon: 'trade', label: 'Build, trade or play a development card' };
    case 'discard':
      return { icon: 'timer', label: 'Waiting for players to discard' };
  }
}
