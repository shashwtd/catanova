import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BALANCED_V2,
  OUTER_ISLES_V1,
  boardPreset,
  dealBoard,
  fairnessIssues,
  generateBoard,
  hexDistance,
  isLand,
  pips,
} from '../packages/rules/src/board.js';
import type { Board } from '../packages/rules/src/board.js';
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
  shipEdges,
  shipSteps,
  startingRoom,
} from './board-presets.js';
import type { PresetFixture } from './board-presets.js';

/**
 * The sketches in docs/MAP_GENERATION.md, copied exactly: `M` the main island, letters the small islands, `.`
 * sea inside the ring, `~` the ring and `P` the pirate's start. Each row sits half a hex from the next, so a
 * character's column counts half hexes from the board's left edge, the column 2q + r of `left`.
 */
const SKETCHES = {
  3: {
    left: -7,
    text: `
r=-4  ~ ~ ~ ~ ~ ~ ~ ~
r=-3 ~ . . a a a . ~
r=-2  ~ . . . . . P ~
r=-1 ~ M M M M M . ~
r= 0  ~ . M M M M M ~
r= 1 ~ b . M M M . ~
r= 2  ~ b . M M . c ~
r= 3 ~ . b . M . c ~
r= 4  ~ ~ ~ ~ ~ ~ ~ ~`,
  },
  4: {
    left: -8,
    text: `
r=-4 ~ ~ ~ ~ ~ ~ ~ ~ ~
r=-3  ~ a . . . b b ~
r=-2 ~ a . M M . . b ~
r=-1  ~ . M M M M . ~
r= 0 ~ M M M M M M M ~
r= 1  ~ . M M M M . ~
r= 2 ~ d . . M M . c ~
r= 3  ~ d d . M . c ~
r= 4 ~ ~ ~ ~ ~ ~ ~ ~ P`,
  },
} as const;
/** Every hex of a sketch, row by row and left to right, with the character drawn for it. */
function sketched(players: 3 | 4) {
  const { left, text } = SKETCHES[players];
  return text
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [, row, cells] = /^r=\s*(-?\d+) (.*)$/.exec(line)!;
      const r = Number(row);
      return [...cells!].flatMap((mark, i) => (mark === ' ' ? [] : [{ q: (left + i - r) / 2, r, mark }]));
    });
}

/**
 * What the docs promise of each template: its table in docs/MAP_GENERATION.md, and its measures of the map.
 */
const TEMPLATES = {
  3: {
    rows: [8, 8, 8, 8, 8, 8, 8, 8, 8],
    ring: 30,
    insideSea: 18,
    islands: { main: 16, a: 3, b: 3, c: 2 },
    main: { wood: 3, brick: 3, sheep: 4, wheat: 3, ore: 2, desert: 1, gold: 0 },
    small: { wood: 1, brick: 1, sheep: 0, wheat: 2, ore: 2, desert: 0, gold: 2 },
    land: { wood: 4, brick: 4, sheep: 4, wheat: 5, ore: 4, desert: 1, gold: 2 },
    mainTokens: [2, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12],
    smallTokens: [2, 4, 5, 6, 8, 9, 10, 12],
    pips: [48, 26],
    harbours: ['any', 'any', 'any', ...RESOURCES],
    mainCoast: [36, 21],
    board: { intersections: 178, edges: 249, rim: 66, ship: 148 },
    // Rule 3's range for each resource on the main island, and rule 10's for each small island.
    production: { wood: [8, 12], brick: [8, 12], sheep: [10, 16], wheat: [8, 12], ore: [5, 8] },
    islandProduction: { a: [8, 12], b: [8, 12], c: [5, 8] },
    room: { good: 30, left: 11 },
    // Rotations of the harbour spacing that meet the sea-hex rule, those that meet both harbour rules, and
    // the layouts those make: every qualifying rotation is a layout of its own.
    rotations: { seas: 28, both: 16, layouts: 16 },
    pirate: { q: 4, r: -2 },
  },
  4: {
    rows: [9, 8, 9, 8, 9, 8, 9, 8, 9],
    ring: 32,
    insideSea: 15,
    islands: { main: 20, a: 2, b: 3, c: 2, d: 3 },
    main: { wood: 4, brick: 4, sheep: 5, wheat: 3, ore: 3, desert: 1, gold: 0 },
    small: { wood: 1, brick: 1, sheep: 0, wheat: 3, ore: 3, desert: 0, gold: 2 },
    land: { wood: 5, brick: 5, sheep: 5, wheat: 6, ore: 6, desert: 1, gold: 2 },
    mainTokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12],
    smallTokens: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    pips: [61, 30],
    harbours: ['any', 'any', 'any', 'any', ...RESOURCES],
    mainCoast: [40, 23],
    board: { intersections: 190, edges: 266, rim: 70, ship: 150 },
    production: { wood: [10, 16], brick: [10, 16], sheep: [13, 20], wheat: [8, 12], ore: [8, 12] },
    islandProduction: { a: [5, 8], b: [8, 12], c: [5, 8], d: [8, 12] },
    room: { good: 38, left: 11 },
    rotations: { seas: 27, both: 18, layouts: 18 },
    pirate: { q: 2, r: 4 },
  },
} as const;

const sorted = (numbers: readonly number[]) => [...numbers].sort((a, b) => a - b);
const sum = (numbers: readonly number[]) => numbers.reduce((total, n) => total + n, 0);
const counts = (hexes: Board['hexes'], keys: readonly string[]) =>
  Object.fromEntries(keys.map((t) => [t, hexes.filter((h) => h.terrain === t).length]));
const TERRAINS = [...RESOURCES, 'desert', 'gold'] as const;
const timed = <T>(work: () => T): [T, number] => {
  const started = performance.now();
  const result = work();
  return [result, performance.now() - started];
};

for (const players of [3, 4] as const) {
  const preset = OUTER_ISLES_V1[players],
    expected = TEMPLATES[players];
  const deal = (seed: number) => generateBoard(seed, preset);
  const islandHexes = (board: Board, island: string) => board.hexes.filter((h) => h.island === island);
  const letters = Object.keys(expected.islands).filter((island) => island !== 'main');

  test(`the ${players}-player template is the sketch in the docs, with every count in its table`, () => {
    const board = deal(1);
    const drawn = sketched(players);
    assert.deepEqual(
      board.hexes.map(({ q, r }) => ({ q, r })),
      drawn.map(({ q, r }) => ({ q, r })),
      'the board is every hex of the sketch, numbered row by row and left to right',
    );
    const ring = (h: Board['hexes'][number]) => h.neighbors.length < 6;
    for (const [id, { mark }] of drawn.entries()) {
      const hex = board.hexes[id]!;
      if (mark === 'M') assert.equal(hex.island, 'main');
      else if (/[a-d]/.test(mark)) assert.equal(hex.island, mark);
      else assert.ok(!isLand(hex) && !('island' in hex), `${hex.q},${hex.r} is sea`);
      if (mark === '~') assert.ok(ring(hex), `${hex.q},${hex.r} is on the ring`);
      if (mark === '.') assert.ok(!ring(hex), `${hex.q},${hex.r} is inside the ring`);
      if (mark === 'P') assert.equal(board.pirateStart, id);
    }
    const pirate = board.hexes[board.pirateStart!]!;
    assert.deepEqual({ q: pirate.q, r: pirate.r }, expected.pirate);

    // Hex counts: rows, ring, sea inside it, and each island.
    const rows = board.hexes.reduce<number[]>(
      (row, h) => ((row[h.r + 4] = (row[h.r + 4] ?? 0) + 1), row),
      [],
    );
    assert.deepEqual(rows, expected.rows);
    const sea = board.hexes.filter((h) => !isLand(h));
    assert.equal(sea.filter(ring).length, expected.ring);
    assert.equal(sea.filter((h) => !ring(h)).length, expected.insideSea);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(expected.islands).map((island) => [island, islandHexes(board, island).length]),
      ),
      expected.islands,
    );
    // Land by terrain, on the main island, on the small islands and in all; one token per producing hex.
    const small = board.hexes.filter((h) => h.island && h.island !== 'main');
    assert.deepEqual(counts(islandHexes(board, 'main'), TERRAINS), expected.main);
    assert.deepEqual(counts(small, TERRAINS), expected.small);
    assert.deepEqual(counts(board.hexes, TERRAINS), expected.land);
    assert.ok(board.hexes.every((h) => h.number > 0 === (isLand(h) && h.terrain !== 'desert')));
    const tokens = (hexes: Board['hexes']) => sorted(hexes.map((h) => h.number).filter(Boolean));
    assert.deepEqual(tokens(islandHexes(board, 'main')), expected.mainTokens);
    assert.deepEqual(tokens(small), expected.smallTokens);
    assert.deepEqual(
      [expected.mainTokens, expected.smallTokens].map((set) => set.reduce((sum, n) => sum + pips(n), 0)),
      expected.pips,
    );
    assert.deepEqual(board.ports.map((p) => p.resource).sort(), [...expected.harbours].sort());
    // The board's intersections and edges, and the main island's coast.
    const main = new Set(islandHexes(board, 'main').map((h) => h.id));
    const mainCoast = coastOf(board, main);
    assert.deepEqual(
      [mainCoast.length, new Set(mainCoast.map((e) => place(seaAcross(board, e)))).size],
      expected.mainCoast,
    );
    assert.deepEqual(
      {
        intersections: board.vertices.length,
        edges: board.edges.length,
        rim: board.edges.filter((e) => e.hexes.length === 1).length,
        ship: shipEdges(board).length,
      },
      expected.board,
    );
    assert.equal(board.players, players);
    assert.equal(boardPreset('outer-isles-v1', players), preset);
  });

  test(`the ${players}-player ring is sea, its islands whole and apart, its coast one loop`, () => {
    const board = deal(2);
    for (const h of board.hexes)
      if (h.neighbors.length < 6) assert.ok(!isLand(h), `${h.q},${h.r} on the ring`);
    // No lake: every sea hex is joined to the ring by sea.
    const sea = board.hexes.filter((h) => !isLand(h));
    const reached = new Set(sea.filter((h) => h.neighbors.length < 6).map((h) => h.id));
    for (const id of reached)
      for (const n of board.hexes[id]!.neighbors) if (!isLand(board.hexes[n]!)) reached.add(n);
    assert.equal(reached.size, sea.length);
    // The main island's coast is one loop, each island is whole, and no two islands share a corner.
    const main = new Set(board.hexes.filter((h) => h.island === 'main').map((h) => h.id));
    assert.ok(coastWalk(board, coastOf(board, main)), 'the main island’s coast is one loop');
    for (const island of Object.keys(expected.islands)) {
      const hexes = board.hexes.filter((h) => h.island === island);
      const joined = new Set([hexes[0]!.id]);
      for (const id of joined)
        for (const n of board.hexes[id]!.neighbors) if (board.hexes[n]!.island === island) joined.add(n);
      assert.equal(joined.size, hexes.length, `island ${island} is connected`);
    }
    for (const v of board.vertices)
      assert.ok(new Set(v.hexes.map((h) => board.hexes[h]!.island).filter(Boolean)).size <= 1);
    // So each small island is one sea hex from the main island, and at least three steps from any other.
    const land = board.hexes.filter(isLand);
    const apart = (a: string, b: string) =>
      Math.min(
        ...land
          .filter((h) => h.island === a)
          .flatMap((x) => land.filter((h) => h.island === b).map((y) => hexDistance(x, y))),
      );
    for (const island of letters) {
      assert.equal(apart('main', island), 2, `island ${island} is one sea hex from the main island`);
      for (const other of letters) if (other > island) assert.ok(apart(island, other) >= 3);
    }
  });

  test(`every small island of the ${players}-player template stays in reach by ship, pirate or not`, () => {
    const board = deal(3);
    const main = new Set(board.hexes.filter((h) => h.island === 'main').map((h) => h.id));
    const shore = new Set(coastOf(board, main).flatMap((e) => [e.a, e.b]));
    const corners = (island: string) =>
      board.vertices.filter((v) => v.hexes.some((h) => board.hexes[h]!.island === island)).map((v) => v.id);
    const nextToMain = (v: number) =>
      board.vertices[v]!.neighbors.some((n) => board.vertices[n]!.hexes.some((h) => main.has(h)));
    const steps = shipSteps(board, shore);
    for (const island of letters) {
      // Two ships from the nearest point of the main island's coast reach an intersection on each small
      // island that is not next to the main island.
      const nearest = Math.min(
        ...corners(island)
          .filter((v) => !nextToMain(v))
          .map((v) => steps.get(v) ?? Infinity),
      );
      assert.equal(nearest, 2, `island ${island}`);
      for (const pirate of board.hexes.filter((h) => !isLand(h)))
        assert.ok(
          corners(island).some((v) => shipSteps(board, shore, pirate.id).has(v)),
          `island ${island} is cut off with the pirate on ${pirate.q},${pirate.r}`,
        );
    }
    // The pirate starts where it touches no land, so no starting ship can go next to it.
    const pirate = board.hexes[board.pirateStart!]!;
    assert.ok(!isLand(pirate) && pirate.neighbors.every((n) => !isLand(board.hexes[n]!)));
  });

  test(`the ${players}-player main island leaves room for every starting settlement`, () => {
    const board = deal(4);
    const main = new Set(board.hexes.filter((h) => h.island === 'main').map((h) => h.id));
    const room = startingRoom(board, main, 2 * players - 1);
    assert.deepEqual(room, expected.room);
    assert.ok(room.left >= 9);
  });

  test(`the ${players}-player harbour spacing gives the most layouts an even spacing can`, () => {
    const board = deal(5);
    const main = new Set(board.hexes.filter((h) => h.island === 'main').map((h) => h.id));
    const loop = coastWalk(board, coastOf(board, main))!;
    const layouts = (slots: readonly number[]) =>
      new Set(
        harbourRotations(board, loop, slots)
          .filter((rotation) => rotation.seas && rotation.corners)
          .map((rotation) => rotation.edges.join(',')),
      ).size;
    const rotations = harbourRotations(board, loop, preset.harbours.slots);
    assert.deepEqual(
      {
        seas: rotations.filter((rotation) => rotation.seas).length,
        both: rotations.filter((rotation) => rotation.seas && rotation.corners).length,
        layouts: layouts(preset.harbours.slots),
      },
      expected.rotations,
    );
    // Every spacing whose gaps are all 4 or 5 edges, as even as this coast allows. None gives more layouts
    // under both rules, and none of those that give as many spreads its 5-edge gaps more evenly.
    const slotsOf = (gaps: readonly number[]) => gaps.map((_, i) => sum(gaps.slice(0, i)));
    const gapsOf = (slots: readonly number[]) =>
      slots.map((slot, i) => (slots[i + 1] ?? loop.length + slots[0]!) - slot);
    const unevenness = (gaps: readonly number[]) => {
      const fives = gaps.flatMap((gap, i) => (gap === 5 ? [i] : []));
      const apart = fives.map((at, i) => (fives[i + 1] ?? fives[0]! + gaps.length) - at);
      return sum(apart.map((d) => (d - gaps.length / fives.length) ** 2));
    };
    // Every list of `count` gaps of 4 or 5 edges that adds up to `total`.
    const spacings = (count: number, total: number): number[][] => {
      if (!count) return total ? [] : [[]];
      return [4, 5].flatMap((gap) => spacings(count - 1, total - gap).map((rest) => [gap, ...rest]));
    };
    const even = spacings(preset.harbours.slots.length, loop.length).map((gaps) => ({
      gaps,
      layouts: layouts(slotsOf(gaps)),
      unevenness: unevenness(gaps),
    }));
    const most = Math.max(...even.map((spacing) => spacing.layouts));
    assert.equal(layouts(preset.harbours.slots), most);
    assert.equal(
      unevenness(gapsOf(preset.harbours.slots)),
      Math.min(...even.filter((spacing) => spacing.layouts === most).map((spacing) => spacing.unevenness)),
    );
  });

  test(`500 ${players}-player Outer Isles boards keep every fairness rule, quickly`, () => {
    const board0 = deal(0);
    const main = new Set(board0.hexes.filter((h) => h.island === 'main').map((h) => h.id));
    const mainCoast = new Set(coastOf(board0, main).map((e) => e.id));
    const layouts = harbourRotations(board0, coastWalk(board0, coastOf(board0, main))!, preset.harbours.slots)
      .filter((rotation) => rotation.seas && rotation.corners)
      .map((rotation) => rotation.edges.join(','));
    const elapsed: number[] = [];
    const fingerprints = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const [board, ms] = timed(() => deal(seed));
      elapsed.push(ms);
      assert.deepEqual(fairnessIssues(board, preset.fairness), [], `seed ${seed}`);
      // The rules checked here as well, so loosening fairnessIssues cannot let a board through unnoticed.
      const mainHexes = board.hexes.filter((h) => h.island === 'main');
      for (const [resource, [low, high]] of Object.entries(expected.production)) {
        const tiles = mainHexes.filter((h) => h.terrain === resource);
        assert.ok(
          tiles.some((a) => tiles.some((b) => hexDistance(a, b) >= 3)),
          `seed ${seed}: rule 2`,
        );
        const production = tiles.reduce((sum, h) => sum + pips(h.number), 0);
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
        }
      // Rule 1: a group of three touching tiles of one resource would give one of them two such neighbours.
      for (const h of board.hexes.filter((h) => (RESOURCES as readonly string[]).includes(h.terrain)))
        assert.ok(
          h.neighbors.filter((n) => board.hexes[n]!.terrain === h.terrain).length <= 1,
          `seed ${seed}: rule 1`,
        );
      for (const [island, [low, high]] of Object.entries(expected.islandProduction)) {
        const hexes = islandHexes(board, island);
        assert.ok(hexes.filter((h) => h.terrain === 'gold').length <= 1, `seed ${seed}: rule 9`);
        const production = hexes.reduce((sum, h) => sum + pips(h.number), 0);
        assert.ok(production >= low && production <= high, `seed ${seed}: rule 10, island ${island}`);
      }
      for (const h of board.hexes.filter((h) => h.terrain === 'gold'))
        assert.ok(h.island !== 'main' && ![6, 8].includes(h.number), `seed ${seed}: rule 8`);
      // Rule 11: harbours on the main island's coast only, spaced and apart, in a qualifying rotation.
      assert.ok(
        board.ports.every((p) => mainCoast.has(p.edge)),
        `seed ${seed}: rule 11`,
      );
      assert.deepEqual(harbourProblems(board), [], `seed ${seed}`);
      const edges = board.ports.map((p) => p.edge).sort((a, b) => a - b);
      assert.ok(layouts.includes(edges.join(',')), `seed ${seed}: a qualifying rotation`);
      // The robber starts on the desert, the pirate on the template's start, and the ring stays sea.
      assert.equal(board.hexes[board.robberStart!]!.terrain, 'desert', `seed ${seed}`);
      assert.equal(board.hexes[board.robberStart!]!.island, 'main');
      assert.equal(board.pirateStart, board0.pirateStart);
      assert.ok(board.hexes.every((h) => h.neighbors.length === 6 || !isLand(h)));
      fingerprints.add(JSON.stringify(board.hexes.map((h) => [h.terrain, h.number])));
    }
    assert.equal(fingerprints.size, 500);
    for (const [seed, ms] of elapsed.entries())
      if (ms > 100) {
        const best = Math.min(...[0, 1, 2].map(() => timed(() => deal(seed))[1]));
        assert.ok(best < 100, `seed ${seed} took ${best.toFixed(1)} ms to deal`);
      }
  });

  test(`a ${players}-player board is reproduced by its seed, and pinned boards do not drift`, () => {
    assert.deepEqual(deal(281), deal(281));
    assert.deepEqual(dealBoard(281, 'outer-isles-v1', players), deal(281));
    assert.equal(deal(281).preset, 'outer-isles-v1');
    const pinned = (JSON.parse(readFileSync(PRESET_FIXTURE, 'utf8')) as PresetFixture)[
      `outer-isles-v1/${players}`
    ]!;
    assert.deepEqual(
      pinned.boards.filter(([seed, hash]) => boardHash(deal(seed)) !== hash).map(([seed]) => seed),
      [],
      'these seeds deal a different board than they did',
    );
    const board = deal(pinned.deal.seed);
    assert.deepEqual(
      board.hexes.map((h) => [h.terrain, h.number]),
      pinned.deal.hexes,
    );
    assert.deepEqual(board.ports, pinned.deal.ports);
    assert.deepEqual(
      [board.robberStart, board.pirateStart],
      [pinned.deal.robberStart, pinned.deal.pirateStart],
    );
  });
}

test('Outer Isles deals a template for three or four players and no other count', () => {
  assert.throws(() => boardPreset('outer-isles-v1', 5), /no board for 5 players/);
  assert.throws(() => dealBoard(1, 'outer-isles-v1', 2), /no board for 2 players/);
  assert.throws(() => boardPreset('balanced-v1', 4), /deals no new boards/);
  assert.equal(boardPreset('balanced-v2', 4), BALANCED_V2);
  // A starting room measured the same way leaves 9 on the Classic island for a four-player game's eighth
  // settlement, as the docs say: the yardstick the templates are held to.
  const classic = generateBoard(1);
  assert.deepEqual(startingRoom(classic, new Set(classic.hexes.map((h) => h.id)), 7).left, 9);
  // A template that cannot be dealt says so before any search.
  const three = OUTER_ISLES_V1[3];
  const islands = three.islands!;
  const variant = (change: Partial<typeof islands>) => ({ ...three, islands: { ...islands, ...change } });
  assert.throws(() => generateBoard(1, variant({ pirate: { q: 0, r: 0 } })), /starts its pirate on land/);
  assert.throws(
    () => generateBoard(1, variant({ main: { ...islands.main, numbers: islands.main.numbers.slice(1) } })),
    /14 numbers for 15 hexes/,
  );
  assert.throws(
    () =>
      generateBoard(
        1,
        variant({ small: { ...islands.small, terrain: { ...islands.small.terrain, gold: 3 } } }),
      ),
    /9 tiles onto 8 hexes/,
  );
  assert.throws(() => generateBoard(1, variant({ pirate: { q: 9, r: 9 } })), /puts 9,9 off its board/);
});
