import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateBoard, topology } from '../packages/rules/src/board.js';
import type { Board, Port, Terrain } from '../packages/rules/src/board.js';
import { BOARD_FIXTURE, boardHash, selfPlay } from './board-fixtures.js';
import type { SelfPlay } from './board-fixtures.js';

/** Written by board-fixtures.ts. Rewrite it only as that file describes, never just to make these tests pass. */
const pinned = JSON.parse(readFileSync(BOARD_FIXTURE, 'utf8')) as {
  preset: Board['preset'];
  topology: Omit<Board, 'seed' | 'preset' | 'ports'>;
  boards: [seed: number, hash: string][];
  deals: { seed: number; hexes: [Terrain, number][]; ports: Port[] }[];
  games: SelfPlay[];
};

test('the Classic island keeps every hex, corner and edge id, position and neighbour it had', () => {
  const graph = topology();
  assert.deepEqual(graph, pinned.topology);
  // Key and list order too: saved games store this JSON, and the rules walk these lists in order.
  assert.equal(JSON.stringify(graph), JSON.stringify(pinned.topology));
});

test('every pinned seed deals the same Classic island, byte for byte', () => {
  assert.ok(pinned.boards.length >= 600);
  const drifted = pinned.boards.filter(([seed, hash]) => boardHash(generateBoard(seed)) !== hash);
  assert.deepEqual(
    drifted.map(([seed]) => seed),
    [],
    'these seeds deal a different island than they did; the next test shows what moved for the written-out seeds',
  );
});

test('the written-out seeds deal exactly their pinned tiles, numbers and harbours on the pinned topology', () => {
  for (const { seed, hexes, ports } of pinned.deals) {
    const expected: Board = { seed, preset: pinned.preset, ...structuredClone(pinned.topology), ports };
    for (const [id, [terrain, number]] of hexes.entries())
      Object.assign(expected.hexes[id]!, { terrain, number });
    const board = generateBoard(seed);
    assert.deepEqual(board, expected, `seed ${seed}`);
    assert.equal(JSON.stringify(board), JSON.stringify(expected), `seed ${seed}: key order`);
  }
});

test('whole offline bot games replay to the same final state on the Classic island', async () => {
  for (const game of pinned.games) assert.deepEqual(await selfPlay(game.seed, game.players), game);
});
