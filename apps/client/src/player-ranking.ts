import type { GameView, PlayerView } from '../../../packages/rules/src/game.js';

/** The private VP cards in your own projection must never change the public leaderboard. */
export function publicPlayerPoints(game: GameView, player: PlayerView) {
  if (game.winner) return player.points; // Finished games reveal their final scores.
  return (
    player.pieces.settlements +
    player.pieces.cities * 2 +
    (game.longestRoad === player.id ? 2 : 0) +
    (game.largestArmy === player.id ? 2 : 0)
  );
}
export function rankedPlayers(game: GameView) {
  const players = game.players.map((player, seatIndex) => ({
    player,
    seatIndex,
    publicPoints: publicPlayerPoints(game, player),
  }));
  const highest = Math.max(0, ...players.filter(({ player }) => !player.resigned).map((p) => p.publicPoints));
  const enabled = highest >= 3 || !!game.winner;
  if (enabled)
    players.sort(
      (a, b) =>
        Number(b.player.id === game.winner) - Number(a.player.id === game.winner) ||
        Number(!!a.player.resigned) - Number(!!b.player.resigned) ||
        b.publicPoints - a.publicPoints ||
        a.seatIndex - b.seatIndex,
    );
  return players.map((p) => ({
    ...p,
    leading:
      enabled &&
      !p.player.resigned &&
      (game.winner ? game.winner === p.player.id : p.publicPoints === highest),
  }));
}
