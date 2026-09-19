/**
 * Reading how somebody plays, so a stand-in can keep playing like them.
 *
 * When a seat drops out mid-game a bot takes it over. A bot with its own ideas
 * would spend the next four turns undoing whatever that player was building,
 * which is worse for the table than the empty chair was. So before it starts,
 * it looks at what the player has actually done — corners, cities, roads,
 * knights, the harbours they took — and picks the style that fits.
 *
 * The division of labour is the same as everywhere else in this package: the
 * code does the counting, and the model does the judgement. `observe` is pure
 * arithmetic over the seat's own view, and every number in it comes from what
 * the player put on the board, so a stand-in learns nothing a spectator could
 * not have worked out. The model is then asked one question, from a fixed set
 * of answers, and cannot invent a sixth style or write a sentence.
 *
 * Jev being unreachable is not a failure here: `styleFromRecord` answers the
 * same question from the same numbers, just less well.
 */

import type { Board } from '../../rules/src/board.js';
import type { GameView } from '../../rules/src/game.js';
import { choice, noul, JevUnavailable } from './jev.js';
import type { JevClient } from './jev.js';
import type { Archetype } from './plan.js';

/** The five ways people actually play, as a stand-in can act on them. */
export const PLAY_STYLES = {
  builder: 'Expands early and often: new settlements first, cities when the corners run out',
  roadwarden: 'Builds long connected roads and contests longest road',
  soldier: 'Buys development cards, plays knights, and goes for largest army',
  trader: 'Works the harbours and the bank, turning a surplus into whatever is missing',
  opportunist: 'Takes whatever the dice give and buys whatever is affordable that turn',
} as const;
export type PlayStyle = keyof typeof PLAY_STYLES;
export const PLAY_STYLE_LIST = Object.keys(PLAY_STYLES) as PlayStyle[];
export const isPlayStyle = (value: unknown): value is PlayStyle =>
  typeof value === 'string' && Object.hasOwn(PLAY_STYLES, value);

/** What a stand-in is told about the player whose seat it is taking. */
export type StandInStyle = {
  style: PlayStyle;
  /** Whether they played against whoever was in front rather than just for
   *  themselves: robbers aimed at the leader, roads run into their path. */
  contesting: boolean;
  /** True when this came from the record alone because the model was not
   *  reachable. Recorded so a game's log never overstates what was asked. */
  inferred?: boolean;
};

/** Which long game each style corresponds to, so the stand-in's first plan is
 *  a continuation rather than a fresh idea. */
export const STYLE_ARCHETYPE: Record<PlayStyle, Archetype> = {
  builder: 'expansion',
  roadwarden: 'road',
  soldier: 'development',
  trader: 'trading',
  opportunist: 'cities',
};

export const STYLE_LABEL: Record<PlayStyle, string> = {
  builder: 'building out',
  roadwarden: 'chasing the long road',
  soldier: 'playing knights',
  trader: 'working the harbours',
  opportunist: 'taking what comes',
};

/**
 * The record, counted rather than guessed.
 *
 * Every field is something the other players can see: pieces on the board,
 * knights played, the length of the longest run, which harbours the player's
 * corners touch. Card *contents* are never read, only how many were bought,
 * which is public.
 */
export function observe(view: GameView, board: Board, playerId: string) {
  const me = view.players.find((p) => p.id === playerId);
  if (!me) return null;
  const ports = board.ports
    .filter((port) => {
      const edge = board.edges[port.edge];
      return (
        !!edge && (view.buildings[edge.a]?.player === playerId || view.buildings[edge.b]?.player === playerId)
      );
    })
    .map((port) => port.resource);
  const best = (field: 'roadLength' | 'knights') =>
    view.players.reduce((n, p) => Math.max(n, p[field] ?? 0), 0);
  return {
    settlements: me.pieces.settlements,
    cities: me.pieces.cities,
    roads: me.pieces.roads,
    longest_run: me.roadLength,
    longest_run_on_the_board: best('roadLength'),
    holds_longest_road: view.longestRoad === playerId,
    knights_played: me.knights,
    most_knights_played: best('knights'),
    holds_largest_army: view.largestArmy === playerId,
    development_cards_held: me.cardCount,
    harbours: [...new Set(ports)],
    points: me.points,
    turns_played: view.turn,
  };
}
export type Observation = NonNullable<ReturnType<typeof observe>>;

/**
 * The same question answered from the numbers alone.
 *
 * Used when the decision service is unreachable, and as the shortlist's
 * sanity check: a player holding largest army is a soldier whatever else is
 * true of them.
 */
export function styleFromRecord(seen: Observation): PlayStyle {
  if (seen.holds_largest_army || seen.knights_played >= 3) return 'soldier';
  if (seen.holds_longest_road || seen.longest_run >= 5) return 'roadwarden';
  if (seen.harbours.length >= 2) return 'trader';
  if (seen.cities >= 2) return 'opportunist';
  if (seen.settlements >= 3 || seen.roads >= 5) return 'builder';
  return 'opportunist';
}

/**
 * Ask the model which of the five fits, with the record in front of it.
 *
 * One request, two questions, and both come back as an option from a fixed
 * list or a probability. A refusal to answer, a timeout or an unknown option
 * all end in the same place as no service at all: the record's own answer.
 */
export async function profileStyle(context: {
  view: GameView;
  board: Board;
  playerId: string;
  jev: JevClient | null;
}): Promise<{ style: StandInStyle; calls: number; tokens: number; costUsd: number } | null> {
  const seen = observe(context.view, context.board, context.playerId);
  if (!seen) return null;
  const fallback = (inferred: boolean): StandInStyle => ({
    style: styleFromRecord(seen),
    contesting: seen.holds_longest_road || seen.holds_largest_army,
    ...(inferred ? { inferred: true } : {}),
  });
  if (!context.jev) return { style: fallback(true), calls: 0, tokens: 0, costUsd: 0 };
  try {
    const evaluation = await context.jev.evaluate(
      {
        question: 'A player has dropped out of a game of Catan and a bot is taking their seat.',
        their_record: seen,
        others: context.view.players
          .filter((p) => p.id !== context.playerId)
          .map((p) => ({ name: p.name, points: p.points, knights: p.knights, roads: p.roadLength })),
      },
      {
        style: choice(
          'Which of these best describes how this player has been playing, judging only by what they have built and played?',
          PLAY_STYLES,
        ),
        contesting: noul(
          'Were they playing against whoever is in front — taking awards off them, blocking their roads — rather than only building for themselves?',
          {
            true: 'They have taken or contested longest road or largest army, or built into a rival’s path',
            false: 'They have built for themselves and left the others alone',
          },
        ),
      },
    );
    const answer = evaluation.answers.style;
    const contesting = evaluation.answers.contesting;
    const picked = answer?.type === 'choice' && isPlayStyle(answer.choice) ? answer.choice : null;
    return {
      style: picked
        ? {
            style: picked,
            contesting:
              contesting?.type === 'noul' ? contesting.probability > 0.5 : fallback(false).contesting,
          }
        : fallback(true),
      calls: 1,
      tokens: evaluation.inputTokens,
      costUsd: evaluation.costUsd,
    };
  } catch (error) {
    if (!(error instanceof JevUnavailable)) throw error;
    return { style: fallback(true), calls: 0, tokens: 0, costUsd: 0 };
  }
}

export function parseStandInStyle(value: unknown): StandInStyle | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isPlayStyle(v.style)) return null;
  return {
    style: v.style,
    contesting: v.contesting === true,
    ...(v.inferred === true ? { inferred: true } : {}),
  };
}
