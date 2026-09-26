import { RESOURCES } from './index.js';
import { isLand, pips } from './board.js';
import { emptyHand, roadSites, robberVictims, settlementSites } from './game.js';
import type { Game, GameAction, Phase } from './game.js';
import { owedBy } from './owed.js';
import { rulesetOf } from './rulesets.js';
import { roadSitesOpenSea, settlementSitesOpenSea, shipSites } from './sea.js';
import { defaultGoldPicks } from './gold.js';

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
  // Open Sea's defaults, docs/RULEBOOK-OPEN-SEA.md section 15.3: a road where one can go, else a ship.
  const sea = !!rulesetOf(game).sea;
  const roadOrShip = (roads: number[], ships: () => number[]): GameAction | undefined => {
    const road = pick(roads);
    if (road !== undefined) return { kind: 'road', edge: road };
    const ship = sea ? pick(ships()) : undefined;
    return ship === undefined ? undefined : { kind: 'ship', edge: ship };
  };
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
    // In Open Sea the clock always moves the robber, never the pirate, and only on land (section 15.3).
    case 'robber': {
      const hex = pick(game.board.hexes.filter((h) => h.id !== game.robber && isLand(h)))!;
      const victim = pick(robberVictims(game, playerId, hex.id));
      return { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) };
    }
    case 'freeRoads':
      return sea
        ? roadOrShip(roadSitesOpenSea(game, playerId), () => shipSites(game, playerId, 'roadBuilding'))
        : roadOrShip(roadSites(game, playerId), () => []);
    // The resource the player holds fewest of among those the bank still has, card by card (section 9.5).
    case 'goldPick': {
      const player = game.players.find((p) => p.id === playerId)!;
      return {
        kind: 'goldPick',
        resources: defaultGoldPicks(player.hand, game.bank, game.goldOwed![0]!.picks),
      };
    }
    // Setup is untimed. Only the absence rule of modes without bots places for a player, when they have been
    // gone too long: the corner with the most production pips, ties at random, then a road beside it.
    // In Open Sea, on the main island, and then a ship only if no road can go by it (section 15.5).
    case 'setupSettlement': {
      const production = (vertex: number) =>
        game.board.vertices[vertex]!.hexes.reduce((sum, hex) => sum + pips(game.board.hexes[hex]!.number), 0);
      const sites = sea
        ? settlementSitesOpenSea(game, playerId, true)
        : settlementSites(game, playerId, true);
      const most = Math.max(...sites.map(production));
      const vertex = pick(sites.filter((site) => production(site) === most));
      return vertex === undefined ? undefined : { kind: 'settlement', vertex };
    }
    case 'setupRoad':
      return sea
        ? roadOrShip(roadSitesOpenSea(game, playerId, game.setupVertex), () =>
            shipSites(game, playerId, { setup: game.setupVertex! }),
          )
        : roadOrShip(roadSites(game, playerId, game.setupVertex), () => []);
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
    case 'ship':
      return phase === 'setupRoad'
        ? 'starting ship placed automatically'
        : 'remaining free ship placed automatically';
    case 'goldPick':
      return 'gold picks made automatically';
    case 'endTurn':
      return 'turn ended automatically';
    default:
      return 'required choice resolved automatically';
  }
}
