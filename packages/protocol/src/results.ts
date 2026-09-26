import type { GameView, ScoreTerm } from '../../rules/src/game.js';
import { CLASSIC } from '../../rules/src/rulesets.js';
import type { RoomState } from './index.js';
import { parseProfile } from './profile.js';
import type { Profile } from './profile.js';
import type { PlayerColor } from './colors.js';

export type ResultPlayer = Pick<
  GameView['players'][number],
  'id' | 'name' | 'points' | 'resigned' | 'pieces' | 'roadLength' | 'knights'
> & {
  /** Where the points came from, term by term. Results saved before terms existed have none. */
  terms?: ScoreTerm[];
};
export type ResultGame = Pick<
  GameView,
  'winner' | 'finishReason' | 'turn' | 'longestRoad' | 'largestArmy'
> & {
  players: ResultPlayer[];
  /**
   * The mode played, when it was not Classic, and its turn structure where it had a choice. Results name some
   * parts by the mode, such as Open Sea's Longest Route.
   */
  ruleset?: string;
  turns?: GameView['turns'];
};
/** Public final results only. Never a saved Game or a private GameView. */
export type MatchResults = {
  id: string;
  roomId: string;
  round: number;
  game: ResultGame;
  players: { id: string; name: string; profile?: Profile; color?: PlayerColor }[];
};
export function resultsFromRoom(room: RoomState, id = `${room.roomId}:${room.round ?? 0}`): MatchResults {
  const game = room.game;
  if (!game || game.phase !== 'finished') throw new Error('Results require a finished match');
  return {
    id,
    roomId: room.roomId,
    round: room.round ?? 0,
    game: {
      winner: game.winner,
      ...(game.finishReason ? { finishReason: game.finishReason } : {}),
      ...(game.ruleset && game.ruleset !== CLASSIC.id ? { ruleset: game.ruleset } : {}),
      ...(game.turns ? { turns: game.turns } : {}),
      turn: game.turn,
      longestRoad: game.longestRoad,
      largestArmy: game.largestArmy,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        points: p.points,
        ...(p.terms ? { terms: p.terms } : {}),
        ...(p.resigned ? { resigned: p.resigned } : {}),
        pieces: { roads: p.pieces.roads, settlements: p.pieces.settlements, cities: p.pieces.cities },
        roadLength: p.roadLength,
        knights: p.knights,
      })),
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.profile ? { profile: parseProfile(p.profile) } : {}),
      ...(p.color ? { color: p.color } : {}),
    })),
  };
}
export const resultsKey = (result: MatchResults) => `${result.roomId}:${result.round}`;
