import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BIG_TABLE_BALANCED_V1,
  BIG_TABLE_SHAPE,
  BOARD_PRESETS,
  BALANCED_V2,
  boardPreset,
  dealBoard,
  fairnessIssues,
  generateBoard,
  hexDistance,
  pips,
  topology,
} from '../packages/rules/src/board.js';
import type { Board, Hex } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import {
  PRESET_FIXTURE,
  boardHash,
  coastOf,
  coastWalk,
  harbourProblems,
  harbourRotations,
  place,
  seaAcross,
  tally,
} from './board-presets.js';
import type { PresetFixture } from './board-presets.js';

const preset = BIG_TABLE_BALANCED_V1;
const deal = (seed: number) => generateBoard(seed, preset);
const timed = <T>(work: () => T): [T, number] => {
  const started = performance.now();
  const result = work();
  return [result, performance.now() - started];
};
/** The sea spaces off a board's coast, and how many coastal edges face each. */
const seaSpaces = (board: Board) => tally(coastOf(board), (e) => place(seaAcross(board, e)));

test('the Big Table island is the 30 hexes of the docs, numbered row by row', () => {
  // Every hex with −3 ≤ q ≤ 2, −3 ≤ r ≤ 3 and −2 ≤ s ≤ 3, listed row by row from the top, left to right.
  const expected: { q: number; r: number }[] = [];
  for (let r = -3; r <= 3; r++)
    for (let q = -3; q <= 2; q++) if (-q - r >= -2 && -q - r <= 3) expected.push({ q, r });
  assert.deepEqual(BIG_TABLE_SHAPE, expected);
  const graph = topology(preset.shape);
  assert.deepEqual(
    graph.hexes.map(({ q, r }) => ({ q, r })),
    expected,
  );
  assert.deepEqual([graph.hexes[0]!.q, graph.hexes[0]!.r], [0, -3]);
  assert.deepEqual([graph.hexes[29]!.q, graph.hexes[29]!.r], [-1, 3]);
  assert.deepEqual([...tally(graph.hexes, (h) => String(h.r)).values()], [3, 4, 5, 6, 5, 4, 3]);
  // A half turn about the point between (−1, 0) and (0, 0) maps the island onto itself.
  const places = new Set(graph.hexes.map(place));
  assert.ok(graph.hexes.every(({ q, r }) => places.has(place({ q: -1 - q, r: -r }))));

  const board = deal(1);
  const coast = coastOf(board);
  assert.deepEqual(
    [board.hexes.length, board.vertices.length, board.edges.length, coast.length],
    [30, 80, 109, 38],
  );
  assert.deepEqual(
    [1, 2, 3].map((n) => board.vertices.filter((v) => v.hexes.length === n).length),
    [22, 16, 42],
  );
  // 22 sea spaces border the coast. The six off the corner hexes, the tips, face one coastal edge each; the
  // other 16 face two.
  const facing = seaSpaces(board);
  assert.equal(facing.size, 22);
  assert.deepEqual(
    [...facing].filter(([, edges]) => edges === 1).map(([sea]) => sea),
    ['0,-4', '3,-4', '-4,0', '3,0', '-4,4', '-1,4'],
  );
  assert.equal([...facing.values()].filter((edges) => edges === 2).length, 16);
  assert.ok(coastWalk(coast), 'the coast is one loop');
});

test('a Big Table board deals exactly its tiles, tokens and harbours', () => {
  const board = deal(7);
  const count = (terrain: string) => board.hexes.filter((h) => h.terrain === terrain).length;
  assert.deepEqual(
    [...RESOURCES, 'desert'].map(count),
    [6, 5, 6, 6, 5, 2],
    'Timber, Clay, Sheep, Hay, Rock, desert',
  );
  const tokens = [2, 2, 12, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap((n) => [n, n, n])].sort(
    (a, b) => a - b,
  );
  assert.deepEqual(
    board.hexes
      .map((h) => h.number)
      .filter(Boolean)
      .sort((a, b) => a - b),
    tokens,
  );
  assert.equal(
    tokens.reduce((sum, n) => sum + pips(n), 0),
    88,
  );
  assert.ok(board.hexes.every((h) => (h.terrain === 'desert') === (h.number === 0)));
  assert.deepEqual(
    board.ports.map((p) => p.resource).sort(),
    ['any', 'any', 'any', 'any', 'any', 'sheep', ...RESOURCES].sort(),
  );
  // The fields only Open Sea deals stay off a Big Table board.
  assert.ok(board.hexes.every((h) => !('island' in h)));
  assert.ok(!('players' in board) && !('pirateStart' in board));
});

/** Every hex of one resource in groups of touching hexes, the largest group's size. */
const largestGroup = (board: Board, tiles: Hex[]) => {
  let largest = 0;
  const seen = new Set<number>();
  for (const tile of tiles) {
    if (seen.has(tile.id)) continue;
    const group = [tile.id];
    seen.add(tile.id);
    for (let i = 0; i < group.length; i++)
      for (const n of board.hexes[group[i]!]!.neighbors)
        if (!seen.has(n) && board.hexes[n]!.terrain === tile.terrain) {
          seen.add(n);
          group.push(n);
        }
    largest = Math.max(largest, group.length);
  }
  return largest;
};

test('500 Big Table boards keep every rule, harbour rule and robber start, quickly', () => {
  const rotations = harbourRotations(deal(0), coastWalk(coastOf(deal(0)))!, preset.harbours.slots);
  assert.ok(
    rotations.every((rotation) => rotation.corners),
    'the spacing alone keeps intersections apart',
  );
  const layouts = rotations.filter((rotation) => rotation.seas).map((rotation) => rotation.edges.join(','));
  assert.equal(layouts.length, 18, 'of the spacing’s 38 rotations, 18 meet both harbour rules');
  const tips = new Set([...seaSpaces(deal(0))].filter(([, edges]) => edges === 1).map(([sea]) => sea));
  const elapsed: number[] = [];
  const fingerprints = new Set<string>();
  const robber = { lower: 0, higher: 0 };
  for (let seed = 0; seed < 500; seed++) {
    const [board, ms] = timed(() => deal(seed));
    elapsed.push(ms);
    assert.deepEqual(fairnessIssues(board, preset.fairness), [], `seed ${seed}`);
    // The rules checked here as well, so loosening fairnessIssues cannot let a board through unnoticed.
    for (const resource of RESOURCES) {
      const tiles = board.hexes.filter((h) => h.terrain === resource);
      assert.ok(largestGroup(board, tiles) <= 2, `seed ${seed}: rule 1, ${resource}`);
      assert.ok(
        tiles.some((a) => tiles.some((b) => hexDistance(a, b) >= 4)),
        `seed ${seed}: rule 2, ${resource}`,
      );
      const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
      const [low, high] = tiles.length === 6 ? [15, 24] : [13, 20];
      assert.ok(production >= low && production <= high, `seed ${seed}: rule 3, ${resource}`);
    }
    for (const v of board.vertices)
      assert.ok(
        v.hexes.reduce((sum, h) => sum + pips(board.hexes[h]!.number), 0) <= 11,
        `seed ${seed}: rule 4`,
      );
    for (const h of board.hexes)
      for (const n of h.neighbors) {
        const [x, y] = [h.number, board.hexes[n]!.number];
        assert.ok(!([6, 8].includes(x) && [6, 8].includes(y)), `seed ${seed}: rule 5`);
        assert.ok(!x || x !== y, `seed ${seed}: rule 6`);
        assert.ok(!(x === 2 && y === 12), `seed ${seed}: rule 7`);
        assert.ok(!(h.terrain === 'desert' && board.hexes[n]!.terrain === 'desert'), `seed ${seed}: rule 8`);
      }
    // Harbours keep off the same and neighbouring intersections and sea spaces, so every other sea space
    // holds one and three of the six tips do; the layout is always one of the 18 rotations.
    assert.deepEqual(harbourProblems(board), [], `seed ${seed}`);
    const seas = board.ports.map((p) => place(seaAcross(board, board.edges[p.edge]!)));
    assert.equal(
      seas.filter((sea) => tips.has(sea)).length,
      3,
      `seed ${seed}: harbours off three of the six tips`,
    );
    const edges = board.ports.map((p) => p.edge).sort((a, b) => a - b);
    assert.ok(layouts.includes(edges.join(',')), `seed ${seed}: one of the 18 rotations`);
    // The robber starts on one of the two deserts, chosen with the seed.
    const deserts = board.hexes.filter((h) => h.terrain === 'desert').map((h) => h.id);
    assert.ok(deserts.includes(board.robberStart!), `seed ${seed}: the robber starts on a desert`);
    robber[board.robberStart === Math.min(...deserts) ? 'lower' : 'higher']++;
    fingerprints.add(JSON.stringify(board.hexes.map((h) => [h.terrain, h.number])));
  }
  assert.equal(fingerprints.size, 500);
  assert.ok(robber.lower >= 200 && robber.higher >= 200, JSON.stringify(robber));
  // Every board must deal quickly, not just the average one. A seed over budget is re-timed and keeps its
  // best of three runs, so a scheduling hiccup on a busy machine cannot fail the bound by itself.
  for (const [seed, ms] of elapsed.entries())
    if (ms > 100) {
      const best = Math.min(...[0, 1, 2].map(() => timed(() => deal(seed))[1]));
      assert.ok(best < 100, `seed ${seed} took ${best.toFixed(1)} ms to deal`);
    }
});

test('a Big Table board is reproduced by its seed, and pinned boards do not drift', () => {
  assert.deepEqual(deal(281), deal(281));
  assert.deepEqual(dealBoard(281, 'big-table-balanced-v1', 5), deal(281));
  assert.deepEqual(dealBoard(281, 'big-table-balanced-v1', 6), deal(281));
  assert.equal(deal(281).preset, 'big-table-balanced-v1');
  assert.equal(boardPreset('big-table-balanced-v1', 6), preset);
  assert.ok(BOARD_PRESETS.includes(preset));
  assert.equal(BOARD_PRESETS[0], BALANCED_V2);
  const pinned = (JSON.parse(readFileSync(PRESET_FIXTURE, 'utf8')) as PresetFixture)[
    'big-table-balanced-v1'
  ]!;
  assert.deepEqual(
    pinned.boards.filter(([seed, hash]) => boardHash(deal(seed)) !== hash).map(([seed]) => seed),
    [],
    'these seeds deal a different island than they did',
  );
  const board = deal(pinned.deal.seed);
  assert.deepEqual(
    board.hexes.map((h) => [h.terrain, h.number]),
    pinned.deal.hexes,
  );
  assert.deepEqual(board.ports, pinned.deal.ports);
  assert.equal(board.robberStart, pinned.deal.robberStart);
});

test('a rule no Big Table board can meet fails within the search limits instead of hanging', () => {
  const impossible = { ...preset, fairness: { ...preset.fairness, cornerPips: 5 } };
  assert.throws(() => generateBoard(1, impossible), /within the search limit/);
  // A preset that cannot be dealt says so before any search.
  assert.throws(
    () => generateBoard(1, { ...preset, terrain: { ...preset.terrain, desert: 3 } }),
    /31 tiles onto 30 hexes/,
  );
  assert.throws(() => generateBoard(1, { ...preset, numbers: preset.numbers.slice(1) }), /27 numbers for 28/);
  assert.throws(
    () =>
      generateBoard(1, {
        ...preset,
        harbours: { ...preset.harbours, trades: preset.harbours.trades.slice(1) },
      }),
    /10 trades for 11 harbours/,
  );
});
