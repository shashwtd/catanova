import type { GameAction, GameView } from '../../../packages/rules/src/game.js';
export type BuildAction = Extract<GameAction, { kind: 'road' | 'settlement' | 'city' }>;
export type PlacementDraft = {
  action: BuildAction;
  roomId: string;
  player: string;
  turn: number;
  phase: GameView['phase'];
  setupIndex: number;
};
export function isBuildAction(action: GameAction): action is BuildAction {
  return ['road', 'settlement', 'city'].includes(action.kind);
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
  // Building goes on in a turn's actions, and in Big Table's Partner's phase and build windows.
  const building = ['actions', 'partner', 'buildWindow'].includes(game.phase);
  if (a.kind === 'road' && !building && !['setupRoad', 'freeRoads'].includes(game.phase)) return false;
  if (a.kind === 'settlement' && !building && game.phase !== 'setupSettlement') return false;
  if (a.kind === 'city' && !building) return false;
  return a.kind === 'road'
    ? game.legal.roads.includes(a.edge)
    : a.kind === 'city'
      ? game.legal.cities.includes(a.vertex)
      : game.legal.settlements.includes(a.vertex);
}
/** Whether a board already shows a confirmed build, so its preview can step aside. */
export function buildShown(game: Pick<GameView, 'roads' | 'buildings'>, action: BuildAction): boolean {
  return action.kind === 'road'
    ? game.roads[action.edge] !== undefined
    : action.kind === 'city'
      ? game.buildings[action.vertex]?.kind === 'city'
      : game.buildings[action.vertex] !== undefined;
}
