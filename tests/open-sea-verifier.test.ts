/**
 * The restore verifier's Open Sea checks (scripts/verify-restored-games.ts): a legal game after setup passes, and
 * each state no legal game can reach is named for what is wrong with it. Every case changes one thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLand } from '../packages/rules/src/board.js';
import type { Game } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { MAIN_ISLAND, edgeKind, takesShip, vertexIsland } from '../packages/rules/src/sea.js';
import { continueGame, gameInvariantProblems } from '../scripts/verify-restored-games.js';
import { afterSetup, freeCorners } from './open-sea-game.js';

const base = afterSetup(3, 41);
const board = base.board;
/** A corner of a small island where a settlement may stand. */
const smallIslandCorner = (g: Game) => {
  const hex = board.hexes.find((h) => h.island && h.island !== MAIN_ISLAND && freeCorners(g, h.id).length)!;
  return { vertex: freeCorners(g, hex.id)[0]!, island: hex.island! };
};
const landEdge = board.edges.find((e) => edgeKind(board, e.id) === 'land')!.id;
const seaEdge = board.edges.find((e) => edgeKind(board, e.id) === 'sea')!.id;
const emptyShipEdges = board.edges.filter((e) => takesShip(edgeKind(board, e.id)) && !base.roads[e.id]);

const cases: [what: string, corrupt: (g: Game) => void, problem: RegExp][] = [
  [
    'a ship on an edge the board lacks',
    (g) => (g.ships![board.edges.length + 3] = 'blue'),
    /a ship lies on missing edge/,
  ],
  ['a ship nobody at the table owns', (g) => (g.ships![seaEdge] = 'nobody'), /belongs to no player/],
  ['a ship on a land edge', (g) => (g.ships![landEdge] = 'blue'), /is on an edge no ship takes/],
  [
    'a ship and a road on one edge',
    (g) => {
      const edge = board.edges.find((e) => edgeKind(board, e.id) === 'coastal' && !g.roads[e.id])!.id;
      g.roads[edge] = 'blue';
      g.ships![edge] = 'blue';
    },
    /holds a road and a ship/,
  ],
  [
    'sixteen ships',
    (g) => {
      for (const e of emptyShipEdges.slice(0, 16)) g.ships![e.id] = 'red';
    },
    /a player has 16 ships; the supply is 15/,
  ],
  ['a locked ship on an empty edge', (g) => (g.lockedShips = [seaEdge]), /a ship is locked on edge/],
  [
    'a closed ship end on an empty edge',
    (g) => (g.closedShipEnds = { [seaEdge]: [board.edges[seaEdge]!.a] }),
    /a closed ship end is recorded on edge/,
  ],
  [
    'a ship end closed where nobody else built',
    (g) => {
      g.ships![seaEdge] = 'blue';
      g.closedShipEnds = { [seaEdge]: [board.edges[seaEdge]!.a] };
    },
    /has an end recorded as closed at corner/,
  ],
  [
    'another player’s ship built this turn',
    (g) => {
      // Blue is on turn.
      g.ships![seaEdge] = 'red';
      g.shipsBuiltThisTurn = [seaEdge];
    },
    /the ship built this turn on edge \d+ is not a ship of the player on turn/,
  ],
  ['a road on open sea', (g) => (g.roads[seaEdge] = 'blue'), /is on an edge no road takes/],
  ['the pirate on land', (g) => (g.pirate = g.robber), /the pirate is not on a sea hex/],
  [
    'the robber at sea',
    (g) => (g.robber = board.hexes.find((h) => !isLand(h))!.id),
    /the robber stands on the sea/,
  ],
  [
    'a building at sea',
    (g) => {
      const vertex = board.vertices.find((v) => v.hexes.every((h) => !isLand(board.hexes[h]!)))!.id;
      g.buildings[vertex] = { player: 'blue', kind: 'settlement' };
    },
    /stands at sea/,
  ],
  [
    'a starting settlement on a small island',
    (g) => {
      Object.assign(g, { turn: 0, phase: 'setupSettlement', setupIndex: 5, active: 0 });
      g.buildings[smallIslandCorner(g).vertex] = { player: 'blue', kind: 'settlement' };
    },
    /the starting settlement at corner \d+ is off the main island/,
  ],
  [
    'a settlement on a small island without its bonus',
    (g) => (g.buildings[smallIslandCorner(g).vertex] = { player: 'red', kind: 'settlement' }),
    /is on island [a-z], whose bonus its player never earned/,
  ],
  [
    'an island bonus recorded twice',
    (g) => {
      const { vertex, island } = smallIslandCorner(g);
      g.buildings[vertex] = { player: 'red', kind: 'settlement' };
      g.islandBonuses = { red: [island, island] };
    },
    /an island bonus is recorded twice/,
  ],
  [
    'an island bonus with no building there',
    (g) => (g.islandBonuses = { red: ['a'] }),
    /has no building of its player there/,
  ],
  [
    'a bonus for the main island',
    (g) => (g.islandBonuses = { red: [MAIN_ISLAND] }),
    /bonus for main has no building/,
  ],
  [
    'gold owed outside the picks',
    (g) => (g.goldOwed = [{ player: 'red', picks: 1 }]),
    /gold picks are owed during roll/,
  ],
  ['the picks with nobody owed', (g) => (g.phase = 'goldPick'), /gold picks are not owed during goldPick/],
  [
    'gold owed to a resigned player',
    (g) => {
      Object.assign(g, { phase: 'goldPick', goldOwed: [{ player: 'red', picks: 1 }] });
      g.players[1]!.resigned = true;
      for (const r of RESOURCES) {
        g.bank[r] += g.players[1]!.hand[r];
        g.players[1]!.hand[r] = 0;
      }
    },
    /a gold pick is owed by a seat that is not playing/,
  ],
  [
    'a pick of none',
    (g) => Object.assign(g, { phase: 'goldPick', goldOwed: [{ player: 'red', picks: 0 }] }),
    /a gold pick of 0 is owed/,
  ],
  [
    'a player owed twice',
    (g) =>
      Object.assign(g, {
        phase: 'goldPick',
        goldOwed: [
          { player: 'red', picks: 1 },
          { player: 'red', picks: 1 },
        ],
      }),
    /a player is owed gold picks twice/,
  ],
  [
    'gold owed out of turn order',
    (g) =>
      Object.assign(g, {
        phase: 'goldPick',
        goldOwed: [
          { player: 'green', picks: 1 },
          { player: 'blue', picks: 1 },
        ],
      }),
    /gold picks are owed out of turn order/,
  ],
  [
    'gold owed from an empty bank',
    (g) => {
      Object.assign(g, { phase: 'goldPick', goldOwed: [{ player: 'blue', picks: 1 }] });
      for (const r of RESOURCES) {
        g.players[1]!.hand[r] += g.bank[r];
        g.bank[r] = 0;
      }
    },
    /gold picks are owed from an empty bank/,
  ],
];

test('the restore verifier passes a legal Open Sea game, and names each state no legal game can reach', () => {
  assert.deepEqual(gameInvariantProblems(base), []);
  for (const [what, corrupt, problem] of cases) {
    const g = structuredClone(base);
    corrupt(g);
    const problems = gameInvariantProblems(g);
    assert.ok(
      problems.some((text) => problem.test(text)),
      `${what}: expected ${problem}, got ${JSON.stringify(problems)}`,
    );
  }
});

test('the verifier takes a game waiting on gold picks as legal, and continues it with the picker’s move', () => {
  const g = structuredClone(base);
  // Red, not on turn, picks from a gold field whose settlement earned its island.
  const { vertex, island } = smallIslandCorner(g);
  g.buildings[vertex] = { player: 'red', kind: 'settlement' };
  Object.assign(g, {
    phase: 'goldPick',
    dice: [2, 3],
    goldOwed: [{ player: 'red', picks: 1 }],
    islandBonuses: { red: [island] },
  });
  assert.equal(vertexIsland(board, vertex), island);
  assert.deepEqual(gameInvariantProblems(g), []);
  assert.deepEqual(continueGame(g, 'gold'), { move: 'goldPick', problems: [] });
});
