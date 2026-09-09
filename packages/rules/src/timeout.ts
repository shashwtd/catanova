import { RESOURCES } from './index.js';
import { activePlayer, emptyHand, roadSites, robberVictims } from './game.js';
import type { Game, GameAction } from './game.js';

/** Resolve only mandatory choices. Never spend resources or play an unchosen card. */
export function timeoutAction(game: Game, playerId: string, random: () => number): GameAction | undefined {
  const pick = <T>(choices: T[]) => choices[Math.floor(random() * choices.length)];
  if (game.phase === 'discard') {
    const count = game.discards[playerId];
    const player = game.players.find((p) => p.id === playerId);
    if (!count || !player) return undefined;
    const cards = RESOURCES.flatMap((resource) =>
      Array<typeof resource>(player.hand[resource]).fill(resource),
    );
    const resources = emptyHand();
    for (let i = 0; i < count; i++) {
      const index = Math.floor(random() * cards.length);
      const [resource] = cards.splice(index, 1);
      if (!resource) throw new Error('Cannot resolve an invalid discard inventory');
      resources[resource]++;
    }
    return { kind: 'discard', resources };
  }
  if (activePlayer(game).id !== playerId) return undefined;
  if (game.phase === 'roll') return { kind: 'roll' };
  if (game.phase === 'actions') return { kind: 'endTurn' };
  if (game.phase === 'robber') {
    const hex = pick(game.board.hexes.filter((h) => h.id !== game.robber))!;
    const victim = pick(robberVictims(game, playerId, hex.id));
    return { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
  }
  if (game.phase === 'freeRoads') {
    const edge = pick(roadSites(game, playerId));
    return edge === undefined ? undefined : { kind: 'road', edge };
  }
  return undefined;
}

export function timeoutDescription(action: GameAction): string {
  switch (action.kind) {
    case 'roll':
      return 'dice rolled automatically';
    case 'discard':
      return 'required cards discarded automatically';
    case 'robber':
      return 'robber moved automatically';
    case 'road':
      return 'remaining free road placed automatically';
    case 'endTurn':
      return 'turn ended automatically';
    default:
      return 'required choice resolved automatically';
  }
}
