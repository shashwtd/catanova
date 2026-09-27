/**
 * Whole Open Sea games through the reducer, for three and four players across seeds, played by the scripted
 * players of open-sea-play.ts (docs/GAME-MODES.md, "Tests": full games driven by scripted legal moves until the
 * mode has bots). After every move every resource card, development card and piece is accounted for, the
 * restore verifier's invariants hold, and nothing on the board is ever lost; between them the games use every
 * part of the mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../packages/rules/src/board.js';
import { applyAction, createGame, score, scoreTerms } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { continueGame, gameInvariantProblems } from '../scripts/verify-restored-games.js';
import { accountedFor, SEATS } from './open-sea-game.js';
import { scriptedMove } from './open-sea-play.js';

/** How many of each piece a player has on the board. */
function pieceCounts(g: Game, player: string) {
  const built = Object.values(g.buildings).filter((b) => b.player === player);
  return {
    roads: Object.values(g.roads).filter((id) => id === player).length,
    ships: Object.values(g.ships ?? {}).filter((id) => id === player).length,
    buildings: built.length,
    cities: built.filter((b) => b.kind === 'city').length,
  };
}

/** Plays one game to its end and returns it with the moves made, checking every step on the way. */
function playGame(players: number, seed: number) {
  const random = seededRandom(seed * 7919 + players);
  let g = createGame(SEATS.slice(0, players), seed, random, { ruleset: OPEN_SEA.id });
  // Each move, and for a gold pick whether it was the one the clock would have made (section 9.5); and every
  // line the game logged, which keeps only its latest 80 itself.
  const moves: { player: string; action: GameAction; asTheClock?: boolean }[] = [];
  const history: string[] = [];
  for (let step = 0, turn = 0, actions = 0; g.phase !== 'finished'; step++) {
    assert.ok(step < 3000, `seed ${seed}: the game should end`);
    if (g.turn !== turn) [turn, actions] = [g.turn, 0];
    const move = scriptedMove(g, random, { clockPicks: 0.4 })!;
    // Fourteen actions a turn at most, so that a turn of trades cannot go round in circles.
    const action = g.phase === 'actions' && ++actions > 14 ? ({ kind: 'endTurn' } as const) : move.action;
    const before = g;
    g = applyAction(g, move.player, action, random);
    history.push(...g.log.filter((line) => line.id >= before.nextLog).map((line) => line.text));
    const clock = action.kind === 'goldPick' ? timeoutAction(before, move.player, () => 0.5) : undefined;
    moves.push({
      player: move.player,
      action,
      ...(clock ? { asTheClock: JSON.stringify(clock) === JSON.stringify(action) } : {}),
    });
    const where = `seed ${seed}, ${players} players, step ${step}, ${action.kind}`;
    assert.deepEqual(accountedFor(g), [], where);
    assert.deepEqual(gameInvariantProblems(g), [], where);
    // Nothing on the board is ever lost: a move takes a ship from one edge to another, a city replaces a
    // settlement, and everything else only adds.
    for (const p of g.players) {
      const was = pieceCounts(before, p.id),
        now = pieceCounts(g, p.id);
      assert.ok(now.roads >= was.roads && now.ships >= was.ships && now.buildings >= was.buildings, where);
      assert.ok(now.cities >= was.cities, where);
    }
    if (action.kind === 'moveShip') {
      assert.equal(g.ships![action.to], move.player, where);
      assert.equal(g.ships![action.from], undefined, where);
    }
    if (step % 40 === 0) assert.deepEqual(continueGame(g, `seed-${seed}`).problems, [], where);
  }
  return { g, moves, history };
}

test('three and four players play Open Sea to the end across seeds, every card and piece accounted for', () => {
  const games = [3, 4].flatMap((players) =>
    [1, 2, 3, 4].map((seed) => ({ players, seed, ...playGame(players, seed) })),
  );
  const count = (kind: GameAction['kind']) =>
    games.reduce((n, game) => n + game.moves.filter((move) => move.action.kind === kind).length, 0);
  for (const { g, players, seed } of games) {
    const winner = g.players.find((p) => p.id === g.winner)!;
    assert.ok(winner, `seed ${seed} with ${players} players has a winner`);
    assert.ok(score(g, winner) >= g.victoryPoints!, `seed ${seed}: the winner has the target`);
    assert.equal(g.log.at(-1)!.text, `${winner.name} wins with ${score(g, winner)} points!`);
  }
  // Between them the games use every part of the mode.
  assert.ok(count('ship') > 20, 'ships are built');
  assert.ok(count('moveShip') > 20, 'ships are moved');
  assert.ok(count('goldPick') > 3, 'gold is picked');
  const picks = games.flatMap((game) => game.moves.filter((move) => move.action.kind === 'goldPick'));
  assert.ok(
    picks.some((move) => move.asTheClock) && picks.some((move) => !move.asTheClock),
    'by hand and by the clock',
  );
  assert.ok(count('pirate') > 10, 'the pirate moves');
  assert.ok(count('robber') > 10, 'and so does the robber');
  const logged = (pattern: RegExp) => games.some(({ history }) => history.some((line) => pattern.test(line)));
  assert.ok(logged(/ moved the pirate and stole a card from /), 'the pirate robs');
  assert.ok(logged(/ moved a ship from edge \d+ to edge \d+\./), 'ship moves are logged');
  assert.ok(logged(/ built a free ship on edge /), 'Road Building places ships');
  assert.ok(logged(/ settled a new island \(\+2 points\)\./), 'islands are settled');
  assert.ok(logged(/ claimed Longest Route \(\+2 points\)\./), 'Longest Route changes hands');
  assert.ok(logged(/ took .* from the bank for gold\./), 'gold picks are logged');
  // Island bonuses carry a winner past the target.
  assert.ok(
    games.some(({ g }) => {
      const winner = g.players.find((p) => p.id === g.winner)!;
      const bonus = scoreTerms(g, winner).find((term) => term.id === 'islandBonus')?.points ?? 0;
      return bonus > 0 && score(g, winner) - bonus < g.victoryPoints!;
    }),
    'an island bonus wins a game',
  );
});
