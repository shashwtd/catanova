export const DICE_MODES = ['classic', 'balanced'] as const;
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
export type BalancedDiceState = { remaining: number[]; lastTotal?: number };

/** A server-only weighted deck. Refresh before the last twelve pairs become predictable. */
export function balancedRoll(random: () => number, state: BalancedDiceState): [number, number] {
  if (state.remaining.length <= 12) state.remaining = Array.from({ length: 36 }, (_, i) => i);
  const pair = (id: number): [number, number] => [Math.floor(id / 6) + 1, (id % 6) + 1];
  const weights = state.remaining.map((id) => {
    const [a, b] = pair(id);
    return a + b === state.lastTotal ? 7 : 10;
  });
  let ticket = sampleIndex(
    random,
    weights.reduce((sum, weight) => sum + weight, 0),
  );
  let index = 0;
  while (ticket >= weights[index]!) ticket -= weights[index++]!;
  const result = pair(state.remaining.splice(index, 1)[0]!);
  state.lastTotal = result[0] + result[1];
  return result;
}

// 'flat' is read-only compatibility for matches already started under the retired rule.
export function rollDice(
  mode: DiceMode | 'flat',
  random: () => number,
  state?: BalancedDiceState,
): [number, number] {
  if (mode === 'balanced') {
    if (!state) throw new Error('Balanced dice require persisted deck state');
    return balancedRoll(random, state);
  }
  if (mode === 'classic') return [sampleIndex(random, 6) + 1, sampleIndex(random, 6) + 1];
  if (mode !== 'flat') throw new Error('Unknown dice mode');
  const sum = sampleIndex(random, 11) + 2;
  const first = Math.max(1, sum - 6) + sampleIndex(random, 6 - Math.abs(7 - sum));
  return [first, sum - first];
}
