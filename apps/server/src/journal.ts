import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Game } from '../../../packages/rules/src/game.js';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * How one move is kept in the journal.
 *
 * Every row used to hold the whole game as JSON: about 18 KB late in a match,
 * 11 KB of which is the board — the same hexes, corners and harbours on every
 * row of the game. A row now holds the game without its board, deflated (about
 * 1.4 KB), and names the board by its hash; each board is stored once.
 *
 * Decoding gives back exactly the JSON that was hashed when the move was saved.
 * The board keeps its place in the object (it is replaced by null, not removed,
 * and put back in the same slot), so every state hash and the chain linking
 * them, written since the first game, still verify.
 */
export type EncodedState = { stateHash: string; boardHash: string; board: string; compact: Uint8Array };

export function encodeState(game: Game, full = JSON.stringify(game)): EncodedState {
  const board = JSON.stringify(game.board);
  return {
    stateHash: sha256(full),
    boardHash: sha256(board),
    board,
    compact: deflateRawSync(JSON.stringify({ ...game, board: null })),
  };
}

export function decodeState(compact: Uint8Array, board: string): Game {
  const game = JSON.parse(inflateRawSync(compact).toString('utf8')) as Game;
  game.board = JSON.parse(board) as Game['board'];
  return game;
}
