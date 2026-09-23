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
  const game = inflateGame(compact);
  game.board = JSON.parse(board) as Game['board'];
  return game;
}

/** A compact row's game with its board left out (null): enough for everything but the map. */
export function inflateGame(compact: Uint8Array): Game {
  return JSON.parse(inflateRawSync(compact).toString('utf8')) as Game;
}

/** The columns a journal row keeps its game in. */
export type JournalRow = { state: string; state_z: Uint8Array | null; board_hash: string | null };

/** True for a row that keeps its game whole in `state`, as rows written before compaction do. */
export const wholeRow = (row: JournalRow) => row.state !== '{}' && row.state !== '';

/**
 * Reads journal rows in either form: the whole JSON older releases kept, or
 * the compact deflated game whose board is stored once in journal_boards (see
 * Store.journalState, which reads single rows the same way). Every row of a
 * match names the same board, so each board is looked up and parsed once and
 * shared by every game this reader returns: treat those games as read-only.
 * Undefined for a row whose game cannot be read.
 */
export function journalReader(
  board: (hash: string) => string | undefined,
): (row: JournalRow) => Game | undefined {
  const boards = new Map<string, Game['board'] | undefined>();
  return (row) => {
    if (wholeRow(row)) return JSON.parse(row.state) as Game;
    if (!row.state_z?.length || !row.board_hash) return undefined;
    if (!boards.has(row.board_hash)) {
      const text = board(row.board_hash);
      boards.set(row.board_hash, text === undefined ? undefined : (JSON.parse(text) as Game['board']));
    }
    const shared = boards.get(row.board_hash);
    if (!shared) return undefined;
    const game = inflateGame(row.state_z);
    game.board = shared;
    return game;
  };
}
