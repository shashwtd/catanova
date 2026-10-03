/**
 * A game of each mode a few turns in, for its picture in the mode chooser: the mode's own board, dealt by the rules
 * from a fixed seed, with houses, roads and (in Open Sea) ships placed by the rules' own setup. It shows what
 * playing the mode looks like; it is not the island the room will play.
 *
 * The browser never runs this: it would bring the rules engine into the bundle every page loads. It makes
 * mode-samples.data.ts (`npx tsx scripts/mode-samples.ts`), which the chooser loads on its own when it opens, and a
 * test checks the two still agree.
 */
import { BIG_TABLE, CLASSIC, OPEN_SEA, findRuleset } from '../../../packages/rules/src/rulesets.js';
import { applyAction, createGame, gameView, roadSites } from '../../../packages/rules/src/game.js';
import type { Game, GameAction, GameView } from '../../../packages/rules/src/game.js';
import { pips } from '../../../packages/rules/src/board.js';

/** The seed each mode's sample is dealt from, and how many sit at it: chosen for a board that reads well small. */
const SAMPLES: Record<string, { seed: number; players: number }> = {
  [BIG_TABLE.id]: { seed: 7731, players: 6 },
  [OPEN_SEA.id]: { seed: 2209, players: 4 },
};
const CLASSIC_SAMPLE = { seed: 4812, players: 4 };
/** The modes with a sample, in the chooser's order. */
export const SAMPLE_MODES = [CLASSIC.id, BIG_TABLE.id, OPEN_SEA.id] as const;

/** What a corner is worth to a setup pick: its pips, and a little for every different terrain beside it. */
function worth(game: Game, vertex: number) {
  const hexes = game.board.vertices[vertex]!.hexes.map((h) => game.board.hexes[h]!);
  return (
    hexes.reduce((sum, hex) => sum + pips(hex.number), 0) + 0.3 * new Set(hexes.map((h) => h.terrain)).size
  );
}
const best = <T>(options: readonly T[], score: (option: T) => number) =>
  options.reduce((top, option) => (score(option) > score(top) ? option : top));

const made = new Map<string, GameView>();

/** The sample of a mode, made once: everyone's setup, then a road more each and two houses grown into cities. */
export function modeSample(mode: string): GameView {
  const cached = made.get(mode);
  if (cached) return cached;
  const rules = findRuleset(mode);
  const { seed, players } = SAMPLES[mode] ?? CLASSIC_SAMPLE;
  const seats = Array.from({ length: players }, (_, i) => ({ id: `sample-${i}`, name: `Player ${i + 1}` }));
  let game = createGame(seats, seed, () => 0.37, rules ? { ruleset: rules.id } : {});
  for (let step = 0; step < 100 && (game.phase === 'setupSettlement' || game.phase === 'setupRoad'); step++) {
    const player = game.players[game.active]!;
    const { settlements, roads, ships = [] } = gameView(game, player.id).legal;
    // Open Sea: two setups in three put to sea where they can, so the card shows ships as well as roads.
    const ship = ships.length > 0 && (roads.length === 0 || step % 3 !== 0);
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: best(settlements, (vertex) => worth(game, vertex)) }
        : ship
          ? { kind: 'ship', edge: ships[step % ships.length]! }
          : { kind: 'road', edge: roads[step % roads.length]! };
    game = applyAction(game, player.id, action, () => 0.37);
  }
  for (const player of game.players) {
    const sites = roadSites(game, player.id);
    if (sites.length) game.roads[sites[sites.length - 1]!] = player.id;
  }
  for (const [vertex, building] of Object.entries(game.buildings)
    .filter((_, i) => i % 3 === 0)
    .slice(0, 2))
    game.buildings[Number(vertex)] = { ...building, kind: 'city' };
  const sample = gameView(game, seats[0]!.id);
  made.set(mode, sample);
  return sample;
}
