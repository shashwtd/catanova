/**
 * The brain's hand-set numbers, in one place.
 *
 * Each one is a judgement about Catan that the arena can test: how much a
 * part-filled bank trade is worth, how much luck is left in a race, how risky a
 * big hand is. Keeping them together means self-play tuning can vary them without
 * touching the code that uses them, and a change of mind about one is a one-line
 * diff with a measured reason beside it.
 *
 * Production reads the defaults. Tooling (the arena, the tuner) may change the
 * object in place between decisions; nothing else should.
 */
export const TUNING = {
  /** How much a part-filled bank trade counts for (0: whole trades only, 1: fractions in full). */
  partialTrade: 0.4,
  /** Resources a Year of Plenty, Monopoly or Road Building card is worth in the race. */
  progressCardWorth: 2,
  /**
   * How a corner a rival can reach is treated. 'skip': gone if they are closer.
   * 'soft': kept, but only likely to be ours in proportion to who is closer,
   * which gives a road toward it value before it is too late.
   */
  contest: 'skip' as 'skip' | 'soft',
  /** Chance a corner is still ours when a rival is closer, level, or one road further. */
  contestBehind: 0.2,
  contestLevel: 0.55,
  contestAhead: 0.85,
  /** Corners weighed for the next settlement in each step of the race. */
  sitesConsidered: 3,
  /** How many new roads away a corner can be and still count as a place to settle. */
  reach: 3,
  /**
   * Whether the race prices the rest of the race after each purchase at the income
   * mix (and harbours) it leaves, rather than scaling by total income alone. With
   * the two below: 111–87 in self-play, and a tenth more settlements.
   */
  restPriced: true,
  /** Whether the race knows harbours: a harbour corner is weighed, and owning it changes the rates. */
  raceHarbours: true,
  /**
   * Whether the race checks, at every step, for finishing with one purchase (an
   * award is two points at once, so a greedy plan can overshoot).
   */
  raceFinish: true,
  /**
   * How much of the robber's tile counts as lost over a race (1: all of it, as if
   * the robber never moved; it moves on at the next seven or knight). Fitted to
   * who won self-play games, a quarter predicts the winner better, and makes the
   * race's spread of chances right at the temperature below. 113–85 in self-play.
   */
  robberBlock: 0.25,
  /** Share of development cards that are knights. */
  knightShare: 0.56,
  /** Development cards bought per point when cards are bought for points alone. */
  cardsPerPoint: 5,
  /** Purchases planned one by one before the rest of the race is costed in bulk. */
  raceSteps: 6,
  /** Rolls of head start per seat of turn order. */
  waitPerSeat: 0.5,
  /** How much luck is left in a race: temperature = base + perRound × the leader's rounds. */
  temperatureBase: 1.2,
  temperaturePerRound: 0.18,
  /** A hand bigger than this when a seven may come is at risk. */
  sevenThreshold: 7.5,
  /** Share of the income before the bot's next turn counted toward that hand. */
  sevenIncomeShare: 0.5,
  /**
   * The thresholds stated in chance of winning (a trade worth making, a knight worth
   * playing early) were set for the race's spread of chances at the default
   * temperature. A flatter spread makes every difference smaller; this scales the
   * thresholds with it.
   */
  gainScale: 1,
  /** A player with more than this chance of winning, and well ahead of the bot, gets no trades. */
  threatChance: 0.4,
  /** Chance of winning given up for each card held above `exposureFrom` at the end of a turn. */
  exposure: 2e-4,
  exposureFrom: 4,
  /** Chance of winning per roll of the bot's own race, to break ties when the chance is settled. */
  rollTieBreak: 1e-5,
  /** How much a purchase that fits the long plan is favoured in the race. */
  leanBias: 0.92,
  /**
   * Within this many points of the target, the turn search looks deeper and wider,
   * so a win that takes a trade, two builds and a card in one turn is not missed.
   * 0 turns it off.
   */
  endgameWithin: 0,
  endgameDepth: 6,
  endgameBeam: 14,
  /**
   * Looking past the bot's own turn: for its best few candidate turns, play the
   * dice and every opponent's turn forward to its next turn this many times, and
   * judge each candidate by where it stands then. 0 turns it off.
   */
  lookahead: 0,
  /** How many of the best candidate turns are looked past. */
  lookaheadTop: 3,
  /**
   * Whether players in a looked-ahead future work toward their own race's next
   * purchase, rather than only building what they can already afford.
   */
  lookaheadPlanned: false,
  /** How much the looked-ahead value counts against the end-of-turn value (1: entirely). */
  lookaheadWeight: 1,
  /**
   * The measured correction to the race (see `features` in race.ts): for each
   * public fact about a player, what one unit of it adds to their score in the
   * softmax that turns races into chances. Null: the race alone.
   */
  features: null as Partial<Record<import('./race.js').Feature, number>> | null,
  /** Whether the balanced dice deck is counted (in rooms that use it) for the risk of a seven. */
  countDice: true,
  /**
   * How the opening spends its effort, as rounds of [corners kept, imagined
   * placement rounds each]: e.g. [[30, 4], [8, 16], [3, 48]]. Null: the level's own
   * fixed number of corners and rounds, with no common futures.
   */
  openingRounds: null as [number, number][] | null,
  /** What an opening with no timber, clay or hay (each) or no rock or wool (each) costs. */
  starvedKey: 0.08,
  starvedOther: 0.03,
};

export type Tuning = typeof TUNING;

/** Replace some numbers, returning the previous values so they can be put back. */
export function retune(change: Partial<Tuning>): Partial<Tuning> {
  const previous: Partial<Tuning> = {};
  for (const key of Object.keys(change) as (keyof Tuning)[]) {
    (previous as Record<string, unknown>)[key] = TUNING[key];
    (TUNING as Record<string, unknown>)[key] = change[key];
  }
  return previous;
}
