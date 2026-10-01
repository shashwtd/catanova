/**
 * Counting the balanced dice.
 *
 * In a room with balanced dice the rolls come from a deck of the 36 ordered
 * pairs, refilled whenever twelve or fewer are left (`packages/rules/src/dice.ts`),
 * and every roll is public. So anyone who has watched every roll since the start
 * knows exactly which pairs are still in the deck, and so how likely a seven is
 * before their next turn. A person with a notepad could do the same; the bot just
 * never loses count.
 *
 * Only public rolls go in. A bot that started watching partway through a game
 * (after a server restart) cannot know where the deck stands, and falls back to
 * ordinary dice odds until the game ends.
 */

export type DiceDeck = {
  /** The pairs still in the deck, as (first − 1) × 6 + (second − 1). */
  remaining: number[];
  /** The last total rolled: a pair with the same total is less likely next. */
  lastTotal?: number;
  /** False once the count is lost: everything is then ordinary odds. */
  synced: boolean;
};

const REFILL_AT = 12;
const fresh = () => Array.from({ length: 36 }, (_, i) => i);
const total = (pair: number) => Math.floor(pair / 6) + 1 + (pair % 6) + 1;

/** Record one public roll. `first` is true for the first roll of the game, when the deck is dealt. */
export function drew(deck: DiceDeck | undefined, dice: readonly [number, number], first: boolean): DiceDeck {
  if (!deck) {
    if (!first) return { remaining: [], synced: false };
    deck = { remaining: [], synced: true };
  }
  if (!deck.synced) return deck;
  let remaining = deck.remaining.length <= REFILL_AT ? fresh() : [...deck.remaining];
  const pair = (dice[0] - 1) * 6 + (dice[1] - 1);
  const at = remaining.indexOf(pair);
  if (at === -1) return { remaining: [], synced: false };
  remaining.splice(at, 1);
  return { remaining, lastTotal: dice[0] + dice[1], synced: true };
}

/**
 * The chance of at least one seven in the next `rolls` rolls, from what is left
 * in the deck: each roll that is not a seven takes a non-seven pair out, and the
 * deck refills at twelve. Pairs repeating the last total are drawn at seven
 * tenths of the weight of the others, as the rules deal them.
 */
export function sevenChance(deck: DiceDeck | undefined, rolls: number): number {
  if (rolls <= 0) return 0;
  if (!deck?.synced) return 1 - (5 / 6) ** rolls;
  let sevens = deck.remaining.filter((p) => total(p) === 7).length;
  let others = deck.remaining.length - sevens;
  let last = deck.lastTotal;
  let none = 1;
  for (let r = 0; r < rolls; r++) {
    if (sevens + others <= REFILL_AT) {
      sevens = 6;
      others = 30;
    }
    const w7 = last === 7 ? 7 : 10;
    const p = (w7 * sevens) / (w7 * sevens + 10 * others);
    none *= 1 - p;
    others = Math.max(0, others - 1);
    last = undefined;
  }
  return 1 - none;
}
