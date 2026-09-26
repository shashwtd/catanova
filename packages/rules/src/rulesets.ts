import { COSTS, DEVELOPMENT_DECK, RESOURCES, RULESET, SUPPLY } from './index.js';
import type { Resource } from './index.js';
import { BOARD_PRESETS } from './board.js';
import type { Board, BoardPreset } from './board.js';
import { DEFAULT_VICTORY_POINTS, MAX_VICTORY_POINTS, MIN_VICTORY_POINTS } from './victory.js';
import { LONGEST_ROUTE, OPEN_SEA_RULESET, SEA_COSTS, SEA_SUPPLY } from './sea.js';

type CardKind = keyof typeof DEVELOPMENT_DECK;
/** What a player pays for: a piece, or a development card. */
export type Purchase = keyof typeof COSTS;

/**
 * How a mode's turns run, where its host may choose (docs/RULEBOOK-BIG-TABLE.md, section 5). 'paired': after the
 * Lead's turn, the Partner three seats on has an action phase of their own. 'betweenTurnsBuild': after each
 * turn, every other player in order has a short window to build.
 */
export type TurnStructure = 'paired' | 'betweenTurnsBuild';
/** Every turn structure there is, with the names players see: `short` where space is tight, as on a chip. */
export const TURN_STRUCTURES: Readonly<
  Record<TurnStructure, { name: string; short: string; summary: string }>
> = {
  paired: {
    name: 'Paired turns',
    short: 'Paired',
    summary: 'After each turn, the Partner gets a full action phase, with no roll and no player trades.',
  },
  betweenTurnsBuild: {
    name: 'Between-turns build',
    short: 'Build windows',
    summary: 'The older rule: after each turn, everyone else in turn may build and buy, with no trading.',
  },
};
export const isTurnStructure = (value: unknown): value is TurnStructure =>
  typeof value === 'string' && Object.hasOwn(TURN_STRUCTURES, value);

/**
 * One mode's rules, as data: everything Classic, Big Table and Open Sea set differently that can be written
 * down as numbers. A game keeps only the id (`Game.ruleset`), frozen when it starts, and this is what the id
 * means. An id is never reused for different rules: changed rules get a new id, so a saved game always plays
 * by the rules it started with. See docs/GAME-MODES.md, "What a mode is, in the code".
 *
 * A later mode adds its own fields here (the Big Table turn style, the Open Sea scenario) when it needs them,
 * and its module reads them only from a game whose ruleset turns them on.
 */
export type Ruleset = {
  /** Saved on every game. 'base-3-4-v1' is Classic. */
  id: string;
  /** What players call the mode: Classic, Big Table, Open Sea. */
  name: string;
  /** The line under the name in Room setup. */
  summary: string;
  /** The preset that deals this mode's boards. */
  board: Board['preset'];
  /** Presets that dealt this mode's boards before, which a lobby may still hold: Start accepts them too. */
  earlierBoards?: readonly Board['preset'][];
  /** How many players a game seats, bots included. */
  seats: { min: number; max: number };
  /** The points target: the host's slider runs from min to max and starts at the default. */
  victoryPoints: { default: number; min: number; max: number };
  supply: {
    /** Cards of each resource in the bank at the start. */
    bank: number;
    /** The development deck, in the order it is laid out before it is shuffled. */
    deck: Readonly<Record<CardKind, number>>;
    /** The pieces each player has. Ships only in a mode with the sea. */
    pieces: { roads: number; settlements: number; cities: number; ships?: number };
  };
  /**
   * What each purchase costs. Per mode, so that a piece only one mode has is never offered in another: only a
   * mode with the sea prices a ship.
   */
  costs: Readonly<Record<Purchase, Readonly<Record<Resource, number>>>> & {
    readonly ship?: Readonly<Record<Resource, number>>;
  };
  /** Whether the host may seat bots. */
  bots: boolean;
  /**
   * Whether a stand-in bot plays the seat of a player who dropped out. Without stand-ins, the turn clock
   * makes an absent player's forced moves after two minutes (docs/TURN_CLOCK.md, "Modes without bots").
   */
  standIns: boolean;
  /**
   * The turn structures the host may choose between, the default first. Absent: one player at a time, as in
   * Classic. The one chosen is frozen into the game when it starts.
   */
  turns?: readonly TurnStructure[];
  /**
   * Open Sea: the scenario whose board the mode deals. It turns on the sea's rules, which sea.ts and gold.ts
   * hold and game.ts applies: ships, gold fields, the pirate, Longest Route and island bonuses.
   */
  sea?: { scenario: 'outer-isles' };
};

/** The base game, as Catanova has always played it. Its numbers are the constants in index.ts. */
export const CLASSIC: Ruleset = {
  id: RULESET,
  name: 'Classic',
  summary: 'The base game, for two to four players.',
  board: 'balanced-v2',
  earlierBoards: ['balanced-v1'],
  seats: { min: 2, max: 4 },
  victoryPoints: { default: DEFAULT_VICTORY_POINTS, min: MIN_VICTORY_POINTS, max: MAX_VICTORY_POINTS },
  supply: {
    bank: SUPPLY.resourcesPerType,
    deck: DEVELOPMENT_DECK,
    pieces: { roads: SUPPLY.roads, settlements: SUPPLY.settlements, cities: SUPPLY.cities },
  },
  costs: COSTS,
  bots: true,
  standIns: true,
};

/**
 * Big Table, for five and six players: Classic's rules on the 30-hex island, with a larger bank and deck, and
 * a second player acting in every turn. docs/RULEBOOK-BIG-TABLE.md is its rulebook.
 */
export const BIG_TABLE: Ruleset = {
  id: 'big-table-v1',
  name: 'Big Table',
  summary: 'For five and six players.',
  board: 'big-table-balanced-v1',
  seats: { min: 5, max: 6 },
  victoryPoints: { default: DEFAULT_VICTORY_POINTS, min: MIN_VICTORY_POINTS, max: MAX_VICTORY_POINTS },
  supply: {
    bank: 24,
    deck: { knight: 20, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3, victoryPoint: 5 },
    pieces: { roads: SUPPLY.roads, settlements: SUPPLY.settlements, cities: SUPPLY.cities },
  },
  costs: COSTS,
  bots: false,
  standIns: false,
  turns: ['paired', 'betweenTurnsBuild'],
};

/**
 * Open Sea, for three or four players: ships, gold fields, the pirate and small islands, on Outer Isles
 * (docs/RULEBOOK-OPEN-SEA.md). Classic's bank, deck and costs, a ship for 1 Timber and 1 Sheep, and 15 ships
 * each. No bots, and no stand-ins: an absent player's forced moves are the clock's.
 */
export const OPEN_SEA: Ruleset = {
  id: OPEN_SEA_RULESET,
  name: 'Open Sea',
  summary: 'Ships, gold and small islands, for three or four players.',
  board: 'outer-isles-v1',
  seats: { min: 3, max: 4 },
  victoryPoints: { default: 14, min: 10, max: 18 },
  supply: {
    bank: SUPPLY.resourcesPerType,
    deck: DEVELOPMENT_DECK,
    pieces: {
      roads: SEA_SUPPLY.roads,
      settlements: SEA_SUPPLY.settlements,
      cities: SEA_SUPPLY.cities,
      ships: SEA_SUPPLY.ships,
    },
  },
  costs: SEA_COSTS,
  bots: false,
  standIns: false,
  sea: { scenario: 'outer-isles' },
};

/** The rulesets this build can play, by id. Classic is always one of them, and always first. */
const registry = new Map<string, Ruleset>([
  [CLASSIC.id, CLASSIC],
  [BIG_TABLE.id, BIG_TABLE],
  [OPEN_SEA.id, OPEN_SEA],
]);

/** Every ruleset this build plays, Classic first. A client lists these as the rulesets it can draw. */
export const rulesets = (): Ruleset[] => [...registry.values()];

/** The ruleset a saved id names, or undefined for one this build does not know. No id means Classic. */
export const findRuleset = (id: string | undefined): Ruleset | undefined => registry.get(id ?? CLASSIC.id);

/**
 * A game's ruleset. The server refuses to load a game whose ruleset it does not know (Store.loadGame), so
 * reaching the error here means a game was read without that check.
 */
export function rulesetOf(game: { ruleset?: string }): Ruleset {
  const found = findRuleset(game.ruleset);
  if (!found) throw new Error(`This game plays ruleset ${game.ruleset}, which this version cannot play`);
  return found;
}

/** The preset that deals a ruleset's boards. */
export function boardPresetOf(ruleset: Ruleset): BoardPreset {
  const preset = BOARD_PRESETS.find((p) => p.id === ruleset.board);
  if (!preset) throw new Error(`${ruleset.id} deals boards with ${ruleset.board}, which no preset deals`);
  return preset;
}

/** Whether a board, from the lobby or a saved game, is one this ruleset plays on. */
export const playsBoard = (ruleset: Ruleset, board: Pick<Board, 'preset'>) =>
  board.preset === ruleset.board || !!ruleset.earlierBoards?.includes(board.preset);

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A small number as players read it in a sentence: "four". */
export const numberWord = (n: number) => WORDS[n] ?? String(n);
/** How many a ruleset seats, in words: "two to four", "five or six", or "four" when there is only one count. */
export const seatRange = (ruleset: Ruleset) =>
  ruleset.seats.min === ruleset.seats.max
    ? numberWord(ruleset.seats.min)
    : `${numberWord(ruleset.seats.min)} ${ruleset.seats.max === ruleset.seats.min + 1 ? 'or' : 'to'} ${numberWord(ruleset.seats.max)}`;

/**
 * What a mode calls the award for the longest line of pieces: Longest Road, or Longest Route where ships count
 * (docs/RULEBOOK-OPEN-SEA.md, section 11.1). The award keeps its Classic key, `longestRoad`, in every mode.
 */
export const routeAwardName = (ruleset: Ruleset | undefined) =>
  ruleset?.sea ? LONGEST_ROUTE.name : 'Longest Road';

/** Which modes seat bots, as the host is told when a mode has none: "Bots play Classic only". */
export const botsPlayIn = () =>
  `Bots play ${rulesets()
    .filter((ruleset) => ruleset.bots)
    .map((ruleset) => ruleset.name)
    .join(' and ')} only`;

/**
 * Why a lobby cannot switch to a mode now, or undefined when it can: more players seated than the mode seats,
 * or a bot seated in a mode without bots. Too few players never blocks a switch: the lobby waits for more.
 * The server refuses the change for the same reason that marks the mode's card in Room setup.
 */
export function switchBlock(
  ruleset: Ruleset,
  seated: readonly { bot?: boolean }[],
): { code: 'MODE_SEATS' | 'MODE_BOTS'; reason: string } | undefined {
  if (seated.length > ruleset.seats.max)
    return { code: 'MODE_SEATS', reason: `For up to ${numberWord(ruleset.seats.max)} players` };
  if (!ruleset.bots && seated.some((player) => player.bot))
    return { code: 'MODE_BOTS', reason: botsPlayIn() };
  return undefined;
}

/** Whether a points target is one the host may set in this ruleset. */
export const validTarget = (ruleset: Ruleset, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= ruleset.victoryPoints.min &&
  value <= ruleset.victoryPoints.max;
export const targetRangeText = (ruleset: Ruleset) =>
  `Choose a victory target from ${ruleset.victoryPoints.min} to ${ruleset.victoryPoints.max} points`;

/** The bank a game in this ruleset starts with: the same count of every resource. */
export const fullBank = (ruleset: Ruleset) =>
  Object.fromEntries(RESOURCES.map((resource) => [resource, ruleset.supply.bank])) as Record<
    Resource,
    number
  >;

/**
 * The most cards of one resource an action may name before the rules see which game it is for: the largest
 * bank of any ruleset this build plays. The rules then hold it to its own game's bank.
 */
export const handLimit = () => Math.max(...rulesets().map((ruleset) => ruleset.supply.bank));

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A string shaped like a ruleset id, known or not: what a message may carry. */
export const isRulesetId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** Every way a ruleset could make a game impossible to set up or play, as sentences. */
export function rulesetProblems(ruleset: Ruleset): string[] {
  const problems: string[] = [];
  const whole = (n: unknown, low = 0) => Number.isInteger(n) && (n as number) >= low;
  if (!isRulesetId(ruleset.id)) problems.push('the id must be lowercase letters, digits and dashes');
  if (!ruleset.name.trim()) problems.push('the mode needs a name');
  const { seats, victoryPoints: target, supply } = ruleset;
  // Eight seats at most: that is how many colours a table has (packages/protocol/src/colors.ts).
  if (!whole(seats.min, 2) || !whole(seats.max, seats.min) || seats.max > 8)
    problems.push('seats must run from at least two to at most eight');
  if (!whole(target.min, 1) || !whole(target.max, target.min) || !validTarget(ruleset, target.default))
    problems.push('the default target must lie within its range');
  if (!whole(supply.bank, 1)) problems.push('the bank needs at least one card of each resource');
  const kinds = Object.keys(DEVELOPMENT_DECK);
  if (
    Object.keys(supply.deck).length !== kinds.length ||
    !kinds.every((kind) => whole(supply.deck[kind as CardKind]))
  )
    problems.push('the deck must give a count for each kind of development card');
  if (!Object.values(supply.pieces).every((count) => whole(count, 1)))
    problems.push('every player needs pieces of each kind');
  if (!Object.values(ruleset.costs).every((cost) => RESOURCES.every((r) => whole(cost[r]))))
    problems.push('every cost must count each resource');
  if (!BOARD_PRESETS.some((preset) => preset.id === ruleset.board))
    problems.push(`no preset deals ${ruleset.board} boards`);
  if (ruleset.standIns && !ruleset.bots) problems.push('stand-ins are bots, so they need bots');
  if (
    ruleset.turns &&
    (!ruleset.turns.length ||
      !ruleset.turns.every(isTurnStructure) ||
      new Set(ruleset.turns).size !== ruleset.turns.length)
  )
    problems.push('the turn structures must be known ones, each listed once');
  if (ruleset.sea && !(whole(supply.pieces.ships, 1) && ruleset.costs.ship))
    problems.push('a mode with the sea needs ships and a price for them');
  return problems;
}

/**
 * Add a ruleset this build can play, and return a function that takes it away again. Tests register their
 * own; a mode that ships is added to the registry above instead, so that no environment setting or request
 * can ever add one.
 */
export function registerRuleset(ruleset: Ruleset): () => void {
  const problems = rulesetProblems(ruleset);
  if (problems.length) throw new Error(`${ruleset.id} is not a playable ruleset: ${problems.join('; ')}`);
  if (registry.has(ruleset.id)) throw new Error(`${ruleset.id} is already registered`);
  registry.set(ruleset.id, ruleset);
  return () => {
    if (registry.get(ruleset.id) === ruleset) registry.delete(ruleset.id);
  };
}
