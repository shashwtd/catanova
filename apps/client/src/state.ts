import type { RoomState } from '../../../packages/protocol/src/index.js';
/** Base-game roads are permanent; settlements may only upgrade to cities. */
export function snapshotProblem(current: RoomState | null, next: RoomState): string | null {
  if (!next || !Number.isSafeInteger(next.revision) || next.revision < 0 || !Array.isArray(next.players))
    return 'Invalid room snapshot';
  if (!current) return null;
  if (next.roomId !== current.roomId) return 'Snapshot belongs to another room';
  if (next.revision < current.revision) return 'stale';
  if (!current.game) return null;
  if (!next.game) return 'Started game missing from snapshot';
  if (next.game.board.seed !== current.game.board.seed) return 'The saved island changed';
  if (next.game.turn < current.game.turn) return 'Turn moved backwards';
  for (const [edge, owner] of Object.entries(current.game.roads))
    if (next.game.roads[Number(edge)] !== owner) return 'A committed road is missing';
  for (const [vertex, building] of Object.entries(current.game.buildings)) {
    const updated = next.game.buildings[Number(vertex)];
    if (
      !updated ||
      updated.player !== building.player ||
      (building.kind === 'city' && updated.kind !== 'city')
    )
      return 'A committed building is missing';
  }
  return null;
}
