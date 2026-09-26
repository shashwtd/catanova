import { RESOURCES } from './index.js';
import { pips } from './board.js';
import { emptyHand, partnerActing, roadSites, robberVictims, settlementSites } from './game.js';
import type { Game, GameAction, Phase } from './game.js';
import { owedBy } from './owed.js';

/**
 * Resolve only mandatory choices. Never spend resources or play an unchosen card.
 *
 * Every kind of move a game can owe (owed.ts) has its default here, because the turn clock and the absence
 * rule act on whatever is owed: a kind with no default would stop automatic play in its room (CLOCK_STATE).
 */
export function timeoutAction(game: Game, playerId: string, random: () => number): GameAction | undefined {
  const pick = <T>(choices: T[]) => choices[Math.floor(random() * choices.length)];
  const owed = owedBy(game, playerId);
  if (!owed) return undefined;
  switch (owed.kind) {
    case 'discard': {
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
    case 'roll':
      return { kind: 'roll' };
    case 'actions':
      return { kind: 'endTurn' };
    // Big Table: a Partner's phase or a build window that runs out simply ends, with nothing bought or built.
    case 'partner':
      return { kind: 'endPhase' };
    case 'buildWindow':
      return { kind: 'endWindow' };
    case 'robber': {
      const hex = pick(game.board.hexes.filter((h) => h.id !== game.robber))!;
      const victim = pick(robberVictims(game, playerId, hex.id));
      return { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
    }
    case 'freeRoads': {
      // Free roads still owed when a Partner's phase runs out stay unplaced (docs/RULEBOOK-BIG-TABLE.md, 9.3).
      if (partnerActing(game)) return { kind: 'endPhase', expired: true };
      const edge = pick(roadSites(game, playerId));
      return edge === undefined ? undefined : { kind: 'road', edge };
    }
    // Setup is untimed. Only the absence rule of modes without bots places for a player, when they have been
    // gone too long: the corner with the most production pips, ties at random, then a road beside it.
    case 'setupSettlement': {
      const production = (vertex: number) =>
        game.board.vertices[vertex]!.hexes.reduce((sum, hex) => sum + pips(game.board.hexes[hex]!.number), 0);
      const sites = settlementSites(game, playerId, true);
      const most = Math.max(...sites.map(production));
      const vertex = pick(sites.filter((site) => production(site) === most));
      return vertex === undefined ? undefined : { kind: 'settlement', vertex };
    }
    case 'setupRoad': {
      const edge = pick(roadSites(game, playerId, game.setupVertex));
      return edge === undefined ? undefined : { kind: 'road', edge };
    }
  }
}

/** What an automatic move did, for the game's log. The phase tells a starting road from a free one. */
export function timeoutDescription(action: GameAction, phase?: Phase): string {
  switch (action.kind) {
    case 'roll':
      return 'dice rolled automatically';
    case 'discard':
      return 'required cards discarded automatically';
    case 'robber':
      return 'robber moved automatically';
    case 'settlement':
      return 'starting settlement placed automatically';
    case 'road':
      return phase === 'setupRoad'
        ? 'starting road placed automatically'
        : 'remaining free road placed automatically';
    case 'endTurn':
      return 'turn ended automatically';
    case 'endPhase':
      return action.expired
        ? "Partner's phase ended automatically, with its free roads unplaced"
        : "Partner's phase ended automatically";
    case 'endWindow':
      return 'build window closed automatically';
    default:
      return 'required choice resolved automatically';
  }
}
