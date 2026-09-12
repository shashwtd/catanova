/** Lobby house-rule range. Legacy games retain the standard ten-point goal. */
export const DEFAULT_VICTORY_POINTS = 10;
export const MIN_VICTORY_POINTS = 8;
export const MAX_VICTORY_POINTS = 15;
export function validVictoryPoints(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_VICTORY_POINTS &&
    value <= MAX_VICTORY_POINTS
  );
}
