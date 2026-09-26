import type { ResultGame, ResultPlayer } from '../../../packages/protocol/src/results.js';
import type { ScoreTermId } from '../../../packages/rules/src/game.js';

/** Rank the scores in this viewer's server projection: their own VP cards are
 * already counted once, while opponents' hidden points are still excluded. */
export function playerStandings<P extends ResultPlayer>(game: { players: P[]; winner: string | null }) {
  const players = game.players.map((player, seatIndex) => ({
    player,
    seatIndex,
    points: player.points,
  }));
  const highest = Math.max(0, ...players.filter(({ player }) => !player.resigned).map((p) => p.points));
  const enabled = highest >= 3 || !!game.winner;
  return players.map((p) => ({
    ...p,
    leading:
      enabled && !p.player.resigned && (game.winner ? game.winner === p.player.id : p.points === highest),
  }));
}

/** Final results rank revealed scores, without reordering the in-game seats.
 * The declared winner stays first, including a win by resignation. */
export function finalStandings(game: ResultGame) {
  const standings = playerStandings(game).sort(
    (a, b) =>
      Number(b.player.id === game.winner) - Number(a.player.id === game.winner) ||
      b.points - a.points ||
      a.seatIndex - b.seatIndex,
  );
  let place = 1;
  return standings.map((entry, index) => {
    const previous = standings[index - 1];
    if (previous && (previous.player.id === game.winner || previous.points !== entry.points)) {
      place = index + 1;
    }
    return { ...entry, place };
  });
}

/**
 * Where a score came from.
 *
 * A results screen that says "8 points" and nothing else is a number without a
 * reason, and the reason is the whole interest of the last ten minutes. The
 * server names every part of a score (scoreTerms in the rules), revealed at the
 * end, so each part is shown under its own name.
 *
 * Results saved before the server named them carry only the total. For those,
 * buildings are on the board, the two awards are declared, and whatever is left
 * over must have been victory point cards, the only points Classic keeps
 * hidden. Either way the parts always add up to the score.
 */
export type PointPart = { key: string; label: string; points: number; count?: number };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const TERM_LABELS: Record<ScoreTermId, (count: number) => string> = {
  settlements: (n) => plural(n, 'settlement', 'settlements'),
  cities: (n) => plural(n, 'city', 'cities'),
  longestRoad: () => 'Longest Road',
  largestArmy: () => 'Largest Army',
  cards: (n) => plural(n, 'victory point card', 'victory point cards'),
};
/** Terms whose count is worth reading beside the label: the awards are one each, and say so by name. */
const COUNTED = new Set<string>(['settlements', 'cities', 'cards']);
export function pointBreakdown(game: ResultGame, player: ResultPlayer): PointPart[] {
  if (player.terms)
    return player.terms.map(({ id, points, count }) => ({
      key: id,
      label:
        (TERM_LABELS as Partial<Record<string, (count: number) => string>>)[id]?.(count) ?? 'Other points',
      points,
      ...(COUNTED.has(id) ? { count } : {}),
    }));
  const parts: PointPart[] = [];
  const add = (key: string, label: string, points: number, count?: number) => {
    if (points > 0) parts.push({ key, label, points, ...(count === undefined ? {} : { count }) });
  };
  const { settlements, cities } = player.pieces;
  add('settlements', TERM_LABELS.settlements(settlements), settlements, settlements);
  add('cities', TERM_LABELS.cities(cities), cities * 2, cities);
  add('longestRoad', 'Longest Road', game.longestRoad === player.id ? 2 : 0);
  add('largestArmy', 'Largest Army', game.largestArmy === player.id ? 2 : 0);
  const hidden = player.points - parts.reduce((n, part) => n + part.points, 0);
  add('cards', TERM_LABELS.cards(hidden), hidden, hidden);
  return parts;
}
