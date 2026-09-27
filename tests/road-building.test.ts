/**
 * Road Building in Classic: a free road is logged before the award and the win it brings, as a bought road is, so
 * the history reads in the order things happened. Open Sea's free ships are tested the same way in
 * open-sea-reducer.test.ts (section 13.2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../packages/rules/src/board.js';
import {
  activePlayer,
  applyAction,
  createGame,
  gameView,
  longestTrail,
  roadSites,
} from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';

const seats = ['Ann', 'Ben', 'Cat', 'Dan'].map((name, i) => ({ id: `p${i}`, name }));

/** A Classic game after setup, placed on the first legal sites; Ann on turn in her action phase. */
function afterSetup(): Game {
  const random = seededRandom(82);
  let g = createGame(seats, 82, random);
  while (g.turn === 0) {
    const legal = gameView(g, activePlayer(g).id).legal;
    g = applyAction(
      g,
      activePlayer(g).id,
      g.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      random,
    );
  }
  return { ...g, phase: 'actions', dice: [2, 3] };
}

/**
 * Ann's roads replaced by a line of four from one of her settlements, through corners nobody has built on, and the
 * free edge at its end that would make it five: found by a depth-first search along the board.
 */
function lineOfFour(g: Game): { game: Game; fifth: number } {
  const other = (e: number, v: number) =>
    g.board.edges[e]!.a === v ? g.board.edges[e]!.b : g.board.edges[e]!.a;
  const open = (e: number, v: number, visited: number[]) =>
    !g.roads[e] && !visited.includes(other(e, v)) && !g.buildings[other(e, v)];
  const extend = (line: number[], visited: number[]): { line: number[]; fifth: number } | undefined => {
    const tip = visited.at(-1)!;
    if (line.length === 4) {
      const fifth = g.board.vertices[tip]!.edges.find((e) => open(e, tip, visited));
      return fifth === undefined ? undefined : { line, fifth };
    }
    for (const e of g.board.vertices[tip]!.edges)
      if (open(e, tip, visited)) {
        const found = extend([...line, e], [...visited, other(e, tip)]);
        if (found) return found;
      }
    return undefined;
  };
  for (const [start, building] of Object.entries(g.buildings)) {
    if (building.player !== 'p0') continue;
    const found = extend([], [Number(start)]);
    if (!found) continue;
    const game = structuredClone(g);
    for (const [edge, owner] of Object.entries(game.roads))
      if (owner === 'p0') delete game.roads[Number(edge)];
    for (const edge of found.line) game.roads[edge] = 'p0';
    assert.equal(longestTrail(game, 'p0'), 4);
    assert.ok(roadSites(game, 'p0').includes(found.fifth));
    return { game, fifth: found.fifth };
  }
  throw new Error('No line of four roads fits');
}

test('a free road that makes the longest road is logged first, then the award, then the win', () => {
  const { game, fifth } = lineOfFour(afterSetup());
  // Ann: two cities and four hidden Victory Point cards, 8 of 10, and a Road Building card.
  for (const [v, building] of Object.entries(game.buildings))
    if (building.player === 'p0') game.buildings[Number(v)] = { player: 'p0', kind: 'city' };
  const cards = ['roadBuilding', 'victoryPoint', 'victoryPoint', 'victoryPoint', 'victoryPoint'] as const;
  for (const kind of cards) {
    game.deck.splice(game.deck.indexOf(kind), 1);
    game.players[0]!.cards.push({ id: `card-${game.nextCard++}`, kind, boughtTurn: 0 });
  }
  const played = applyAction(
    game,
    'p0',
    { kind: 'playCard', cardId: game.players[0]!.cards[0]!.id },
    () => 0.5,
  );
  assert.equal(played.phase, 'freeRoads');
  const won = applyAction(played, 'p0', { kind: 'road', edge: fifth }, () => 0.5);
  assert.deepEqual([won.phase, won.winner, won.longestRoad], ['finished', 'p0', 'p0']);
  assert.deepEqual(
    won.log.filter((line) => line.id >= played.nextLog).map((line) => line.text),
    [
      `Ann built a free road on edge ${fifth + 1}.`,
      'Ann claimed Longest Road (+2 points).',
      'Ann wins with 10 points!',
    ],
  );
});
