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
