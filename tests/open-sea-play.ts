/**
 * Scripted players for Open Sea (docs/RULEBOOK-OPEN-SEA.md), for the full-game tests until the mode has bots. They
 * make only moves the game lists as legal in a player's view, with a little purpose so that games finish: build
 * where they can, sail ships towards the small islands and settle them, move a ship now and then, play their cards
 * and trade four for one with the bank when that buys a piece. Whatever the game owes and the script has no
 * opinion on, the clock's own move settles (timeoutAction).
 */
import { gameView, pieces, robberVictims, total } from '../packages/rules/src/game.js';
import type { Game, GameAction, GameView, Hand } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { edgeKind, pirateVictims, takesShip, vertexIsland, MAIN_ISLAND } from '../packages/rules/src/sea.js';

const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
  items[Math.floor(random() * items.length)];
const none = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });

/**
 * How many ship-going steps each intersection is from a small island the player has not settled: the edges a ship
 * may use, from any land intersection of such an island. Ships are built on the edge nearest one.
 */
function seaDistances(g: Game, player: string): number[] {
  const settled = new Set(g.islandBonuses?.[player] ?? []);
  const distance = g.board.vertices.map(() => Infinity);
  const queue: number[] = [];
  for (const v of g.board.vertices) {
    const island = vertexIsland(g.board, v.id);
    if (island && island !== MAIN_ISLAND && !settled.has(island)) {
      distance[v.id] = 0;
      queue.push(v.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]!;
    for (const e of g.board.vertices[v]!.edges) {
      if (!takesShip(edgeKind(g.board, e))) continue;
      const edge = g.board.edges[e]!;
      const w = edge.a === v ? edge.b : edge.a;
      if (distance[w] === Infinity) {
        distance[w] = distance[v]! + 1;
        queue.push(w);
      }
    }
  }
  return distance;
}
const edgeDistance = (g: Game, distance: number[], e: number) =>
  Math.min(distance[g.board.edges[e]!.a]!, distance[g.board.edges[e]!.b]!);

/** A card for a card: four of the resource held most, for one the player lacks, at the bank's best rate. */
function bankTrade(g: Game, view: GameView, player: string, want: Hand): GameAction | undefined {
  const hand = view.players.find((p) => p.id === player)!.hand!;
  const lacking = RESOURCES.find((r) => hand[r] < want[r] && g.bank[r] > 0);
  if (!lacking) return undefined;
  const spare = RESOURCES.filter((r) => r !== lacking && hand[r] - want[r] >= view.legal.rates[r]).sort(
    (a, b) => hand[b] - want[b] - (hand[a] - want[a]),
  )[0];
  return spare ? { kind: 'bankTrade', give: spare, receive: lacking } : undefined;
}

/**
 * The scripted move for whoever the game waits on first: the player and the action. `style` changes what they
 * like doing, so that different seeds see ship moves, the pirate and gold picks made by hand and by the clock.
 */
export function scriptedMove(
  g: Game,
  random: () => number,
  style: { shipMoves?: number; pirate?: number; clockPicks?: number } = {},
): { player: string; action: GameAction } | undefined {
  const [owed] = owedMoves(g);
  if (!owed) return undefined;
  const player = owed.player;
  const view = gameView(g, player);
  const legal = view.legal;
  const me = g.players.find((p) => p.id === player)!;
  switch (owed.kind) {
    case 'setupSettlement': {
      const vertex = pick(legal.settlements, random)!;
      return { player, action: { kind: 'settlement', vertex } };
    }
    case 'setupRoad': {
      // A starting ship where one may go, now and then, pointed at the small islands.
      const distance = seaDistances(g, player);
      const ships = [...(legal.ships ?? [])].sort(
        (a, b) => edgeDistance(g, distance, a) - edgeDistance(g, distance, b),
      );
      if (ships.length && (random() < 0.4 || !legal.roads.length))
        return { player, action: { kind: 'ship', edge: ships[0]! } };
      return { player, action: { kind: 'road', edge: pick(legal.roads, random)! } };
    }
    case 'goldPick': {
      if (random() < (style.clockPicks ?? 0.3)) return { player, action: timeoutAction(g, player, random)! };
      const { count, types } = legal.goldPick!;
      const resources = none();
      for (let i = 0; i < count; i++) {
        const available = types.filter((r) => resources[r] < g.bank[r]);
        resources[pick(available, random)!]++;
      }
      return { player, action: { kind: 'goldPick', resources } };
    }
    case 'robber': {
      // The pirate, where someone else's ship is, or the robber on the best tile touching someone else.
      const pirateHex = (legal.pirateHexes ?? []).find((hex) => pirateVictims(g, player, hex).length);
      if (pirateHex !== undefined && random() < (style.pirate ?? 0.5)) {
        const victim = pick(pirateVictims(g, player, pirateHex), random);
        return { player, action: { kind: 'pirate', hex: pirateHex, ...(victim ? { victim } : {}) } };
      }
      if (random() < 0.15 && legal.pirateHexes?.length) {
        const hex = pick(legal.pirateHexes, random)!;
        const victim = pick(pirateVictims(g, player, hex), random);
        return { player, action: { kind: 'pirate', hex, ...(victim ? { victim } : {}) } };
      }
      const hexes = (legal.robberHexes ?? []).filter((hex) => robberVictims(g, player, hex).length);
      const hex = pick(hexes.length ? hexes : (legal.robberHexes ?? []), random)!;
      const victim = pick(robberVictims(g, player, hex), random);
      return { player, action: { kind: 'robber', hex, ...(victim ? { victim } : {}) } };
    }
    case 'freeRoads': {
      const distance = seaDistances(g, player);
      const ships = [...(legal.ships ?? [])].sort(
        (a, b) => edgeDistance(g, distance, a) - edgeDistance(g, distance, b),
      );
      if (ships.length && (random() < 0.6 || !legal.roads.length))
        return { player, action: { kind: 'ship', edge: ships[0]! } };
      return { player, action: { kind: 'road', edge: pick(legal.roads, random)! } };
    }
    case 'roll': {
      const knight = me.cards.find((c) => c.kind === 'knight' && legal.playableCards.includes(c.id));
      if (knight && random() < 0.5) return { player, action: { kind: 'playCard', cardId: knight.id } };
      return { player, action: { kind: 'roll' } };
    }
    case 'actions':
      return { player, action: turnAction(g, view, player, random, style) };
    default:
      return { player, action: timeoutAction(g, player, random)! };
  }
}

/** One action of a turn: the most useful build the player can make, else a trade towards one, else the end. */
function turnAction(
  g: Game,
  view: GameView,
  player: string,
  random: () => number,
  style: { shipMoves?: number },
): GameAction {
  const legal = view.legal;
  const me = g.players.find((p) => p.id === player)!;
  const distance = seaDistances(g, player);
  // A settlement on a small island first, then anywhere, beside a gold field where one can; then a city.
  const gold = (v: number) =>
    g.board.vertices[v]!.hexes.filter((h) => g.board.hexes[h]!.terrain === 'gold').length;
  const islands = legal.settlements.filter((v) => {
    const island = vertexIsland(g.board, v);
    return island && island !== MAIN_ISLAND && !g.islandBonuses?.[player]?.includes(island);
  });
  if (islands.length)
    return { kind: 'settlement', vertex: [...islands].sort((a, b) => gold(b) - gold(a))[0]! };
  const golden = legal.settlements.filter((v) => gold(v) > 0);
  if (legal.settlements.length)
    return { kind: 'settlement', vertex: pick(golden.length ? golden : legal.settlements, random)! };
  if (legal.cities.length) return { kind: 'city', vertex: pick(legal.cities, random)! };
  // A ship move, now and then, to the edge nearest an island the player has not settled.
  const moves = Object.entries(legal.shipMoves ?? {});
  if (moves.length && random() < (style.shipMoves ?? 0.3)) {
    const [from, destinations] = pick(moves, random)!;
    const to = [...destinations].sort(
      (a, b) => edgeDistance(g, distance, a) - edgeDistance(g, distance, b),
    )[0]!;
    return { kind: 'moveShip', from: Number(from), to };
  }
  // Cards: play one when it helps, buy one when there is nothing to build.
  const playable = me.cards.filter((c) => legal.playableCards.includes(c.id));
  const card = pick(playable, random);
  if (card && random() < 0.5) {
    if (card.kind === 'yearOfPlenty') {
      const resources = none();
      const types = RESOURCES.filter((r) => g.bank[r] > 0);
      for (let i = 0; i < Math.min(2, total(g.bank)); i++) {
        const r = pick(
          types.filter((t) => resources[t] < g.bank[t]),
          random,
        )!;
        resources[r]++;
      }
      return { kind: 'playCard', cardId: card.id, resources };
    }
    if (card.kind === 'monopoly')
      return { kind: 'playCard', cardId: card.id, resource: pick(RESOURCES, random)! };
    if (card.kind === 'roadBuilding' && !(legal.roads.length || legal.ships?.length)) {
      // Worth playing only with somewhere to put a piece: the game refuses it otherwise, so ask it first.
    } else return { kind: 'playCard', cardId: card.id };
  }
  // A ship towards an island, when the fleet is not yet there.
  const ships = [...(legal.ships ?? [])].sort(
    (a, b) => edgeDistance(g, distance, a) - edgeDistance(g, distance, b),
  );
  const nearest = ships[0];
  if (nearest !== undefined && edgeDistance(g, distance, nearest) < Infinity && random() < 0.8)
    return { kind: 'ship', edge: nearest };
  if (legal.canBuyCard && random() < 0.5) return { kind: 'buyCard' };
  if (legal.roads.length && pieces(g, player).roads < 13 && random() < 0.4)
    return { kind: 'road', edge: pick(legal.roads, random)! };
  // Trade towards a settlement, a city or a ship.
  for (const want of [OPEN_SEA.costs.settlement, OPEN_SEA.costs.city, OPEN_SEA.costs.ship!]) {
    const trade = bankTrade(g, view, player, want as Hand);
    if (trade && total(me.hand) > 5) return trade;
  }
  return { kind: 'endTurn' };
}
