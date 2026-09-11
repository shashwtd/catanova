export const DICE_MODES = ['classic', 'flat'] as const;
export type DiceMode = (typeof DICE_MODES)[number];
const RANDOM_SPACE = 2 ** 32;

/** The server supplies independent uniform 32-bit draws. Reject the tiny incomplete bucket. */
function sampleIndex(random: () => number, count: number): number {
  const bucket = Math.floor(RANDOM_SPACE / count),
    limit = bucket * count;
  for (let attempt = 0; attempt < 32; attempt++) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid dice randomness');
    const integer = Math.floor(value * RANDOM_SPACE);
    if (integer < limit) return Math.floor(integer / bucket);
  }
  throw new Error('Dice randomness unavailable');
}

/** Flat totals is a house rule: choose a total first, then a valid ordered pair for that total. */
export function rollDice(mode: DiceMode, random: () => number): [number, number] {
  if (mode === 'classic') return [sampleIndex(random, 6) + 1, sampleIndex(random, 6) + 1];
  if (mode !== 'flat') throw new Error('Unknown dice mode');
  const sum = sampleIndex(random, 11) + 2;
  const first = Math.max(1, sum - 6) + sampleIndex(random, 6 - Math.abs(7 - sum));
  return [first, sum - first];
}
