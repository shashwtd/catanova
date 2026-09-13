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
