import type { GameView } from '../../../packages/rules/src/game.js';

/** Rank the scores in this viewer's server projection: their own VP cards are
 * already counted once, while opponents' hidden points are still excluded. */
export function playerStandings(game: GameView) {
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
export function finalStandings(game: GameView) {
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
 * reason, and the reason is the whole interest of the last ten minutes. Every
 * part is derived from the revealed final view rather than tracked during play:
 * buildings are on the board, the two awards are declared, and whatever is left
 * over must have been victory point cards, which are only revealed at the end.
 *
 * The parts always add up to the score. If a future rule adds points from
 * somewhere else, the remainder absorbs it rather than the total disagreeing
 * with the sum of its own breakdown.
 */
export type PointPart = { key: string; label: string; points: number; count?: number };
export function pointBreakdown(game: GameView, player: GameView['players'][number]): PointPart[] {
  const parts: PointPart[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const add = (key: string, label: string, points: number, count?: number) => {
    if (points > 0) parts.push({ key, label, points, ...(count === undefined ? {} : { count }) });
  };
  const { settlements, cities } = player.pieces;
  add('settlements', plural(settlements, 'settlement', 'settlements'), settlements, settlements);
  add('cities', plural(cities, 'city', 'cities'), cities * 2, cities);
  add('longestRoad', 'Longest Road', game.longestRoad === player.id ? 2 : 0);
  add('largestArmy', 'Largest Army', game.largestArmy === player.id ? 2 : 0);
  const hidden = player.points - parts.reduce((n, part) => n + part.points, 0);
  add('cards', plural(hidden, 'victory point card', 'victory point cards'), hidden, hidden);
  return parts;
}
