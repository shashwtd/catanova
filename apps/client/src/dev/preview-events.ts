import { applyAction, emptyHand, longestTrail, roadSites } from '../../../../packages/rules/src/game.js';
import type { Game, GameAction, Hand } from '../../../../packages/rules/src/game.js';
export const PREVIEW_EVENTS = {
  dice: 'Roll dice',
  buy: 'Buy development card',
  knight: 'Knight',
  monopoly: 'Monopoly',
  yearOfPlenty: 'Year of Plenty',
  roadBuilding: 'Road Building',
  longestRoad: 'Longest Road award',
  largestArmy: 'Largest Army award',
  win: 'Win game',
} as const;
export type PreviewEvent = keyof typeof PREVIEW_EVENTS;
export type RobberPreview = 'off' | 'discard' | 'waiting' | 'robber';

function fund(game: Game, player: string, amounts: Partial<Hand>) {
  const hand = game.players.find((p) => p.id === player)!.hand;
  for (const resource of Object.keys(amounts) as (keyof Hand)[]) {
    const delta = Math.max(0, amounts[resource]! - hand[resource]);
    hand[resource] += delta;
    game.bank[resource] -= delta;
  }
}
function ready(base: Game, me: string) {
  const game = structuredClone(base);
  game.active = game.players.findIndex((p) => p.id === me);
  game.phase = 'actions';
  game.trade = null;
  game.winner = null;
  game.discards = {};
  game.playedCard = false;
  game.freeRoads = 0;
  game.longestRoad = null;
  game.largestArmy = null;
  return game;
}
/** A short unblocked route supplies a repeatable award fixture, independent of the board seed. */
function route(game: Game, me: string): number[] {
  const visit = (vertex: number, path: number[]): number[] | null => {
    if (path.length === 5) return path;
    if (game.buildings[vertex] && game.buildings[vertex]!.player !== me) return null;
    for (const edge of game.board.edges.filter((e) => e.a === vertex || e.b === vertex)) {
      if (path.includes(edge.id) || (game.roads[edge.id] && game.roads[edge.id] !== me)) continue;
      const found = visit(edge.a === vertex ? edge.b : edge.a, [...path, edge.id]);
      if (found) return found;
    }
    return null;
  };
  for (const vertex of game.board.vertices) {
    const found = visit(vertex.id, []);
    if (found) return found;
  }
  throw new Error('No preview route available');
}
export function previewEvent(base: Game, me: string, event: PreviewEvent) {
  const before = ready(base, me);
  const player = before.players.find((p) => p.id === me)!;
  let action: GameAction;
  if (event === 'dice') {
    before.phase = 'roll';
    before.dice = null;
    action = { kind: 'roll' };
  } else if (event === 'buy') {
    fund(before, me, { sheep: 1, wheat: 1, ore: 1 });
    action = { kind: 'buyCard' };
  } else if (event === 'longestRoad' || event === 'win') {
    const path = route(before, me);
    for (const edge of Object.keys(before.roads).map(Number))
      if (before.roads[edge] === me) delete before.roads[edge];
    for (const edge of path.slice(0, event === 'win' ? 5 : 4)) before.roads[edge] = me;
    if (event === 'longestRoad') {
      delete before.roads[path[4]!];
      fund(before, me, { wood: 1, brick: 1 });
      action = { kind: 'road', edge: path[4]! };
    } else {
      before.longestRoad = me;
      before.victoryPoints = 10;
      player.cards = Array.from({ length: 5 }, (_, i) => ({
        id: `preview-vp-${i}`,
        kind: 'victoryPoint',
        boughtTurn: 0,
      }));
      fund(before, me, { wheat: 2, ore: 3 });
      const vertex = Object.entries(before.buildings).find(
        ([, b]) => b.player === me && b.kind === 'settlement',
      )![0];
      action = { kind: 'city', vertex: Number(vertex) };
    }
  } else {
    const kind = event === 'largestArmy' ? 'knight' : event;
    player.cards = [{ id: 'preview-event-card', kind, boughtTurn: 0 }];
    if (event === 'largestArmy') player.knights = 2;
    if (event === 'monopoly')
      for (const other of before.players) if (other.id !== me) fund(before, other.id, { sheep: 2 });
    action = {
      kind: 'playCard',
      cardId: 'preview-event-card',
      ...(kind === 'monopoly'
        ? { resource: 'sheep' }
        : kind === 'yearOfPlenty'
          ? { resources: { ...emptyHand(), wood: 1, brick: 1 } }
          : {}),
    };
    if (kind === 'roadBuilding' && !roadSites(before, me).length)
      throw new Error('No free road sites in preview');
  }
  const after = applyAction(before, me, action, () => 0.34);
  if (event === 'longestRoad' && longestTrail(after, me) < 5)
    throw new Error('Preview award route is blocked');
  return { before, after };
}
export function previewRobber(base: Game, me: string, mode: Exclude<RobberPreview, 'off'>) {
  const game = ready(base, me);
  if (mode === 'robber') {
    game.phase = 'robber';
    return game;
  }
  const target = mode === 'discard' ? me : game.players.find((p) => p.id !== me)!.id;
  fund(game, target, { wood: 3, brick: 3, wheat: 3 });
  game.phase = 'discard';
  game.dice = [3, 4];
  game.discards = {
    [target]: Math.floor(
      Object.values(game.players.find((p) => p.id === target)!.hand).reduce((a, b) => a + b, 0) / 2,
    ),
  };
  return game;
}
export function previewTrade(base: Game, me: string, incoming: boolean) {
  let game = ready(base, me);
  const maker = incoming ? game.players.find((p) => p.id !== me)!.id : me;
  game.active = game.players.findIndex((p) => p.id === maker);
  fund(game, maker, { wood: 1 });
  for (const player of game.players) if (player.id !== maker) fund(game, player.id, { sheep: 1 });
  game = applyAction(
    game,
    maker,
    { kind: 'offerTrade', give: { ...emptyHand(), wood: 1 }, want: { ...emptyHand(), sheep: 1 } },
    () => 0.34,
  );
  if (!incoming)
    for (const player of game.players.filter((p) => p.id !== me).slice(0, 2))
      game = applyAction(game, player.id, { kind: 'acceptTrade', tradeId: game.trade!.id }, () => 0.34);
  return game;
}
