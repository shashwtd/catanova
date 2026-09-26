/**
 * Deal thousands of boards from each preset that deals new boards and report how long they took: the figures
 * docs/MAP_GENERATION.md records against its 100 ms limit per board.
 *
 *   npx tsx scripts/measure-boards.ts                 seeds 0 to 19,999 of every preset and template
 *   npx tsx scripts/measure-boards.ts --seeds 2000    fewer seeds, for a quick look
 *   npx tsx scripts/measure-boards.ts --preset big-table-balanced-v1
 *
 * The build compiles it too, so the production image can measure the VM it runs on:
 * `node dist/scripts/measure-boards.js` inside the container takes the same options.
 *
 * Every board is timed once, after a warm-up. The slowest are then dealt three more times each and keep their
 * best time, as the board tests do, so that another process taking the CPU mid-deal is not reported as the
 * search. Run it on a quiet machine: a laptop busy elsewhere, or one that parks the process on an efficiency
 * core, can still inflate every figure.
 */
import { cpus } from 'node:os';
import { BOARD_PRESETS, generateBoard } from '../packages/rules/src/board.js';
import type { BoardPreset } from '../packages/rules/src/board.js';

const arg = (name: string) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SEEDS = Number(arg('seeds') ?? 20000);
const PRESETS = BOARD_PRESETS.filter((preset) => (arg('preset') ?? preset.id) === preset.id);
/** How many of the slowest boards are dealt again. */
const RETIMED = 50;

const time = (preset: BoardPreset, seed: number) => {
  const started = performance.now();
  generateBoard(seed, preset);
  return performance.now() - started;
};
const name = (preset: BoardPreset) =>
  preset.id + (preset.islands ? `, ${preset.islands.players} players` : '');
const ms = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} ms`;

console.log(`${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, Node ${process.version}`);
if (!PRESETS.length)
  throw new Error(`Name one of: ${[...new Set(BOARD_PRESETS.map((p) => p.id))].join(', ')}`);
for (const preset of PRESETS) {
  for (let seed = 0; seed < 200; seed++) generateBoard(1_000_000 + seed, preset);
  const times = Array.from({ length: SEEDS }, (_, seed) => time(preset, seed));
  const slowest = times
    .map((elapsed, seed) => ({ elapsed, seed }))
    .sort((a, b) => b.elapsed - a.elapsed)
    .slice(0, RETIMED);
  for (const { seed } of slowest)
    times[seed] = Math.min(times[seed]!, ...[0, 1, 2].map(() => time(preset, seed)));
  const sorted = [...times].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
  const worst = times.indexOf(sorted[sorted.length - 1]!);
  console.log(
    `${name(preset)}: median ${ms(at(0.5))}, p99 ${ms(at(0.99))}, max ${ms(sorted[sorted.length - 1]!)}` +
      ` (seed ${worst}), ${times.filter((elapsed) => elapsed >= 100).length} of ${SEEDS} at 100 ms or more`,
  );
}
