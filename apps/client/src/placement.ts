import type { GameAction, GameView } from '../../../packages/rules/src/game.js';
/** What a player places by choosing its site and confirming it. Open Sea adds a ship, and a ship moved elsewhere. */
export type BuildAction = Extract<GameAction, { kind: 'road' | 'settlement' | 'city' | 'ship' | 'moveShip' }>;
export type PlacementDraft = {
  action: BuildAction;
  roomId: string;
  player: string;
  turn: number;
  phase: GameView['phase'];
  setupIndex: number;
};
export function isBuildAction(action: GameAction): action is BuildAction {
  return ['road', 'settlement', 'city', 'ship', 'moveShip'].includes(action.kind);
}
/**
 * What the viewer may put on an edge now: a road, a ship, or on an Open Sea coastal edge either one, when both
 * are legal there (docs/RULEBOOK-OPEN-SEA.md, section 2.4). The legal lists already count costs and supply.
 */
export function edgePieces(game: GameView, edge: number): ('road' | 'ship')[] {
  return [
    ...(game.legal.roads.includes(edge) ? (['road'] as const) : []),
    ...(game.legal.ships?.includes(edge) ? (['ship'] as const) : []),
  ];
}
/** Revalidate intent against the latest private legal sites; a preview is never a game piece. */
export function placementValid(
  draft: PlacementDraft | null,
  game: GameView | undefined,
  roomId: string | undefined,
  me: string | undefined,
): boolean {
  if (
    !draft ||
    !game ||
    game.winner ||
    draft.roomId !== roomId ||
    draft.player !== me ||
    game.players[game.active]?.id !== me ||
    draft.turn !== game.turn ||
    draft.phase !== game.phase ||
    draft.setupIndex !== game.setupIndex
  )
    return false;
  const a = draft.action;
  if ((a.kind === 'road' || a.kind === 'ship') && !['actions', 'setupRoad', 'freeRoads'].includes(game.phase))
    return false;
  if (a.kind === 'settlement' && !['actions', 'setupSettlement'].includes(game.phase)) return false;
  if ((a.kind === 'city' || a.kind === 'moveShip') && game.phase !== 'actions') return false;
  return a.kind === 'road'
    ? game.legal.roads.includes(a.edge)
    : a.kind === 'ship'
      ? !!game.legal.ships?.includes(a.edge)
      : a.kind === 'moveShip'
        ? !!game.legal.shipMoves?.[a.from]?.includes(a.to)
        : a.kind === 'city'
          ? game.legal.cities.includes(a.vertex)
          : game.legal.settlements.includes(a.vertex);
}
/** Whether a board already shows a confirmed build, so its preview can step aside. */
export function buildShown(
  game: Pick<GameView, 'roads' | 'buildings'> & Partial<Pick<GameView, 'ships'>>,
  action: BuildAction,
): boolean {
  return action.kind === 'road'
    ? game.roads[action.edge] !== undefined
    : action.kind === 'ship'
      ? game.ships?.[action.edge] !== undefined
      : action.kind === 'moveShip'
        ? game.ships?.[action.to] !== undefined
        : action.kind === 'city'
          ? game.buildings[action.vertex]?.kind === 'city'
          : game.buildings[action.vertex] !== undefined;
}
