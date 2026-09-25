/**
 * The Classic island as it is dealt and played today, pinned so that making the board data
 * (docs/BIGGER-MAPS-AND-MODES.md, Phase 0) can prove it changed nothing a player could see.
 *
 *   npx tsx tests/board-fixtures.ts    rewrite tests/fixtures/classic-board.json from this checkout
 *
 * The committed files are the reference, and board-fixtures.test.ts compares this checkout against them.
 * Rewrite them only for a deliberate change, such as a new preset.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { generateBoard, seededRandom, topology } from '../packages/rules/src/board.js';
import type { Board as Island } from '../packages/rules/src/board.js';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan } from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';

export const BOARD_FIXTURE = new URL('./fixtures/classic-board.json', import.meta.url);

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Byte for byte, key order included: the JSON a saved game or a lobby stores. */
export const boardHash = (board: Island) => sha256(JSON.stringify(board));

/**
 * Every seed from 0 to 499, then a spread across the whole 32-bit range, its edges, the seeds other tests and
 * the design preview use, and a negative seed that generateBoard wraps round to 2³² − 1.
 */
function boardSeeds() {
  const random = seededRandom(0x0c1a551c);
  return [
    ...Array.from({ length: 500 }, (_, seed) => seed),
    ...Array.from({ length: 100 }, () => Math.floor(random() * 2 ** 32)),
    1234,
    2026,
    98765,
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
    -1,
  ];
}
/** Written out in full, so a drifted seed shows which tiles, numbers or harbours moved. */
const DEALT_SEEDS = [0, 42, 281, 481];
/** Whole offline games: seed and seat count. Every move is a bot's, so a change in any rule shows up. */
const SELF_PLAY = [
  [7, 3],
  [481, 4],
  [2026, 2],
] as const;

export type SelfPlay = {
  seed: number;
  players: number;
  steps: number;
  turn: number;
  winner: string | null;
  rejected: number;
  game: string;
};
/**
 * The offline bot game from bots.test.ts, with every random draw seeded so that it replays exactly: the same
 * island, the same seat order, the same dice and the same decisions, to the same final state.
 */
export async function selfPlay(seed: number, players: number): Promise<SelfPlay> {
  const seats = ['Anchor', 'Beacon', 'Compass', 'Drift']
    .slice(0, players)
    .map((name) => ({ id: name.toLowerCase(), name }));
  const random = seededRandom(seed);
  let game = createGame(seats, seed, random);
  const plans = new Map<string, BotPlan>(seats.map((s) => [s.id, initialPlan(0)]));
  let rejected = 0,
    steps = 0;
  for (; steps < 1500 && !game.winner; steps++) {
    const actor =
      game.phase === 'discard'
        ? (Object.keys(game.discards)[0] ?? game.players[game.active]!.id)
        : game.players[game.active]!.id;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor)!,
      jev: null,
    });
    plans.set(actor, decision.plan);
    try {
      game = applyAction(game, actor, decision.action, random);
    } catch {
      rejected++;
      const rescue = timeoutAction(game, actor, random);
      if (!rescue) break;
      game = applyAction(game, actor, rescue, random);
    }
  }
  return {
    seed,
    players,
    steps,
    turn: game.turn,
    winner: game.winner,
    rejected,
    game: sha256(JSON.stringify(game)),
  };
}

export async function boardFixture() {
  const boards = boardSeeds().map((seed) => [seed, boardHash(generateBoard(seed))] as const);
  return {
    preset: 'balanced-v2',
    topology: topology(),
    boards,
    deals: DEALT_SEEDS.map((seed) => {
      const board = generateBoard(seed);
      return { seed, hexes: board.hexes.map((h) => [h.terrain, h.number]), ports: board.ports };
    }),
    games: await Promise.all(SELF_PLAY.map(([seed, players]) => selfPlay(seed, players))),
  };
}

async function write(file: URL, value: unknown) {
  const path = fileURLToPath(file);
  const options = { ...(await resolveConfig(path)), filepath: path };
  writeFileSync(path, await format(JSON.stringify(value, null, 2), options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await write(BOARD_FIXTURE, await boardFixture());
}
