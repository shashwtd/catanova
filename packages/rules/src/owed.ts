import type { Game } from './game.js';

/**
 * What the game is waiting for from one player. In Classic that is the phase itself: the setup placements,
 * the roll, the actions of a turn, the robber, free roads from Road Building and each discard after a seven.
 * Open Sea adds its gold picks ('goldPick'), owed by whoever is picking now, on turn or not.
 *
 * Later modes add their own kinds here, each owed by a player who may not be on turn: the Partner's phase in
 * Big Table ('partner') and a between-turns build window ('buildWindow'). A kind is added together with its
 * timeout move (timeout.ts), because the turn clock and the absence rule act on whatever this list says, and
 * a kind they cannot finish would halt automatic play in that room.
 */
export type OwedKind =
  'setupSettlement' | 'setupRoad' | 'roll' | 'actions' | 'robber' | 'freeRoads' | 'discard' | 'goldPick';
export type OwedMove = { player: string; kind: OwedKind };

/** The fields that say whom a game waits on. A saved game and a player's view of it both have them. */
export type Waiting = Pick<Game, 'phase' | 'active' | 'discards' | 'goldOwed'> & {
  players: readonly { id: string; resigned?: boolean }[];
};

/**
 * Whom the game is waiting on now, and for what. Several players at once where they may answer together
 * (discards); one at a time where the rules put them in order, with only the player whose turn it is to
 * answer listed. The turn clock, the absence rule, the bot driver and the client's "your move" all read it.
 *
 * A trade offer asks the other players too, but nothing waits for their answer: the offer lapses with the
 * turn. Trade replies are never owed, so no clock or absence rule answers one.
 */
export function owedMoves(game: Waiting): OwedMove[] {
  if (game.phase === 'finished') return [];
  const playing = (id: string) => game.players.some((p) => p.id === id && !p.resigned);
  if (game.phase === 'discard')
    return Object.keys(game.discards)
      .filter(playing)
      .map((player) => ({ player, kind: 'discard' }));
  // Gold picks go one player at a time, in turn order from the player on turn (Open Sea, section 9.2).
  if (game.phase === 'goldPick') {
    const next = game.goldOwed?.[0];
    return next && playing(next.player) ? [{ player: next.player, kind: 'goldPick' }] : [];
  }
  const active = game.players[game.active];
  return active && !active.resigned ? [{ player: active.id, kind: game.phase }] : [];
}

/** The move a player owes now, if the game is waiting on them. */
export const owedBy = (game: Waiting, player: string | undefined) =>
  owedMoves(game).find((move) => move.player === player);
