/**
 * Play a whole game between bots and report what it cost.
 *
 * This runs the rules engine and the decision layer directly, with no server
 * and no sockets, so it is the cheapest way to see whether the bots play
 * sensibly and to get a real token figure rather than an estimate.
 *
 *   npx tsx scripts/bot-game.ts               # three bots, one game
 *   npx tsx scripts/bot-game.ts --games 3     # repeat
 *   npx tsx scripts/bot-game.ts --offline     # no model: fallbacks only
 *   npx tsx scripts/bot-game.ts --quiet       # totals only
 */

import { createGame, gameView, applyAction } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import {
  decide,
  createJevClient,
  initialPlan,
  emptyUsage,
  addUsage,
  describe,
} from '../packages/bot/src/index.js';
import type { BotPlan, BotUsage } from '../packages/bot/src/index.js';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const flag = (name: string) => process.argv.includes('--' + name);

const GAMES = Number(arg('games', '1'));
const SEATS = Number(arg('seats', '3'));
const MAX_TURNS = Number(arg('maxTurns', '400'));
const quiet = flag('quiet');

const NAMES = ['Anchor', 'Beacon', 'Compass', 'Drift'];

async function playOne(seed: number, jev: ReturnType<typeof createJevClient>) {
  const seats = NAMES.slice(0, SEATS).map((name, i) => ({ id: `bot${i}`, name }));
  let game: Game = createGame(seats, seed, Math.random);
  const plans = new Map<string, BotPlan>(seats.map((s) => [s.id, initialPlan(0)]));
  const usage: BotUsage = emptyUsage();
  const started = Date.now();
  let steps = 0;

  while (!game.winner && steps < MAX_TURNS * SEATS) {
    steps++;
    const actor =
      game.phase === 'discard'
        ? (Object.keys(game.discards)[0] ?? game.players[game.active]!.id)
        : game.players[game.active]!.id;
    const view = gameView(game, actor);
    const decision = await decide({
      view,
      board: game.board,
      meId: actor,
      plan: plans.get(actor)!,
      jev,
    });
    plans.set(actor, decision.plan);
    addUsage(usage, decision);
    try {
      game = applyAction(game, actor, decision.action, Math.random);
    } catch (error) {
      // A rejected move means the decision layer offered something the rules
      // refuse; end the turn rather than spin, and report it loudly.
      console.error(`  ! ${decision.action.kind} rejected for ${actor}: ${(error as Error).message}`);
      const rescue = timeoutAction(game, actor, Math.random);
      if (!rescue) throw error;
      game = applyAction(game, actor, rescue, Math.random);
    }
    if (!quiet && steps % 25 === 0) {
      const points = game.players
        .map((p) => `${p.name} ${gameView(game, p.id).players.find((x) => x.id === p.id)?.points ?? 0}`)
        .join('  ');
      console.log(
        `  turn ${game.turn.toString().padStart(3)}  ${points}   ${describe(plans.get(actor)!, game.board)}`,
      );
    }
  }

  const winner = game.players.find((p) => p.id === game.winner);
  const seconds = (Date.now() - started) / 1000;
  return { winner: winner?.name ?? 'nobody', turns: game.turn, steps, usage, seconds, game };
}

async function main() {
  const jev = flag('offline') ? null : createJevClient();
  console.log(jev ? 'thinking with the decision service' : 'offline: deterministic fallbacks only');

  const totals = emptyUsage();
  let turns = 0;
  let seconds = 0;
  for (let i = 0; i < GAMES; i++) {
    const result = await playOne(1000 + i, jev);
    turns += result.turns;
    seconds += result.seconds;
    for (const key of ['calls', 'tokens', 'costUsd', 'decisions', 'degraded'] as const)
      totals[key] += result.usage[key];
    const scores = result.game.players
      .map((p) => `${p.name} ${gameView(result.game, p.id).players.find((x) => x.id === p.id)?.points ?? 0}`)
      .join(', ');
    console.log(
      `game ${i + 1}: ${result.winner} won on turn ${result.turns} (${scores}) — ` +
        `${result.usage.calls} calls, ${result.usage.tokens} tokens, $${result.usage.costUsd.toFixed(5)}, ${result.seconds.toFixed(1)}s`,
    );
  }

  console.log('\n' + '='.repeat(66));
  console.log(`games            ${GAMES} (${SEATS} bots each)`);
  console.log(`turns            ${turns} total, ${(turns / GAMES).toFixed(0)} per game`);
  console.log(
    `decisions        ${totals.decisions} total, ${(totals.decisions / GAMES).toFixed(0)} per game`,
  );
  console.log(`model calls      ${totals.calls} total, ${(totals.calls / GAMES).toFixed(0)} per game`);
  console.log(
    `  free decisions ${totals.decisions - totals.calls} (${(100 * (1 - totals.calls / Math.max(1, totals.decisions))).toFixed(0)}% settled without the model)`,
  );
  console.log(`input tokens     ${totals.tokens} total, ${(totals.tokens / GAMES).toFixed(0)} per game`);
  console.log(
    `cost             $${totals.costUsd.toFixed(5)} total, $${(totals.costUsd / GAMES).toFixed(5)} per game`,
  );
  console.log(`wall clock       ${(seconds / GAMES).toFixed(1)}s per game`);
  if (totals.degraded)
    console.log(`degraded moves   ${totals.degraded} (fallback used because the service failed)`);
}

void main();
