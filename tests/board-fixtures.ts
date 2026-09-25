/**
 * The Classic island as it is dealt, drawn and played today, pinned so that making the board data
 * (docs/BIGGER-MAPS-AND-MODES.md, Phase 0) can prove it changed nothing a player could see.
 *
 *   npx tsx tests/board-fixtures.ts                  rewrite tests/fixtures/classic-*.json from this checkout
 *   npx tsx tests/board-fixtures.ts markup <name>    print one pinned SVG render, to diff two checkouts
 *
 * The committed files are the reference, and board-fixtures.test.ts and scene-fixtures.test.ts compare
 * this checkout against them. Rewrite them only for a deliberate change, such as a new preset, or a React
 * upgrade that serialises the same SVG differently, and only once screenshots of the board taken before and
 * after the change agree.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { format, resolveConfig } from 'prettier';
import { generateBoard, isCoastalEdge, seededRandom, topology } from '../packages/rules/src/board.js';
import type { Board as Island } from '../packages/rules/src/board.js';
import { applyAction, createGame, gameView, roadSites, settlementSites } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan } from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';
import { Board } from '../apps/client/src/Board.js';
import { BoardViewport } from '../apps/client/src/BoardViewport.js';
import { BOARD_THEMES } from '../apps/client/src/board-theme.js';
import { constrainCamera, fitBoard, maxZoom } from '../apps/client/src/camera.js';
import type { Bounds, Camera } from '../apps/client/src/camera.js';
import { coastline, portPlacement, waterOutline, WATER_FEATHER, WORLD } from '../apps/client/src/scene.js';
import { fragmentSource } from '../apps/client/src/Terrain.js';

export const BOARD_FIXTURE = new URL('./fixtures/classic-board.json', import.meta.url);
export const SCENE_FIXTURE = new URL('./fixtures/classic-scene.json', import.meta.url);

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

/**
 * The table the design preview at /dev/lounge opens on (dev/LoungePreview.tsx), rebuilt here: seed 481, four
 * seats, the first legal setup moves, a roll and a road long enough to show every kind of build site.
 */
export function loungeGame(): Game {
  const seats = ['FernCaptain', 'Mossling', 'CopperFox', 'Juniper'].map((name, i) => ({
    id: `sample-${i}`,
    name,
  }));
  const me = seats[0]!.id;
  let game = createGame(seats, 481, () => 0.37);
  for (let i = 0; i < 16; i++) {
    const player = game.players[game.active]!;
    const view = gameView(game, player.id);
    const action =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement' as const, vertex: view.legal.settlements[0]! }
        : { kind: 'road' as const, edge: view.legal.roads[0]! };
    game = applyAction(game, player.id, action, () => 0.37);
  }
  game = applyAction(game, me, { kind: 'roll' }, () => 0.34);
  extend: for (const edge of roadSites(game, me)) {
    const candidate = structuredClone(game);
    candidate.roads[edge] = me;
    for (const next of roadSites(candidate, me)) {
      const extended = structuredClone(candidate);
      extended.roads[next] = me;
      if (settlementSites(extended, me).length) {
        game = extended;
        break extend;
      }
    }
  }
  game.players[0]!.hand = { wood: 3, brick: 2, sheep: 2, wheat: 7, ore: 4 };
  game.turn = 8;
  return game;
}

const island = (seed: number) => () =>
  renderToStaticMarkup(
    createElement(Board, {
      board: generateBoard(seed),
      mode: null,
      disabled: true,
      onAction: () => {},
      onRobber: () => {},
    }),
  );
/** Each pinned render, by name. Rendered markup is the SVG a browser paints, less the WebGL layer. */
export const MARKUP: Record<string, () => string> = {
  ...Object.fromEntries([0, 42, 281, 481, 2026, 98765].map((seed) => [`island-${seed}`, island(seed)])),
  'lounge-481': () => {
    const game = loungeGame(),
      view = gameView(game, game.players[0]!.id);
    return renderToStaticMarkup(
      createElement(Board, {
        board: view.board,
        game: view,
        me: view.players[0]!.id,
        mode: null,
        disabled: false,
        art: BOARD_THEMES.storybook,
        onAction: () => {},
        onRobber: () => {},
      }),
    );
  },
  viewport: () => renderToStaticMarkup(createElement(BoardViewport, { seed: 481, children: 'board' })),
};

/** The test viewports in board-camera.test.ts, then phone, landscape phone, tablet and desktop board areas. */
const CAMERA_BOUNDS: Bounds[] = [
  { width: 180, height: 520 },
  { width: 940, height: 240 },
  { width: 620, height: 560 },
  { width: 280, height: 190 },
  { width: 360, height: 440 },
  { width: 800, height: 700 },
  { width: 375, height: 520 },
  { width: 812, height: 300 },
  { width: 768, height: 760 },
  { width: 1440, height: 820 },
];
const CAMERAS: Camera[] = [
  { scale: 1, x: 0, y: 0 },
  { scale: 0.5, x: -40, y: 30 },
  { scale: 2.2, x: -120, y: 260 },
  { scale: 3, x: 500, y: -500 },
  { scale: 5, x: -2000, y: 2000 },
];

export function sceneFixture() {
  // Classic's coast, water and harbour poses depend on the island's shape alone, never on its seed.
  const board = generateBoard(481);
  return {
    world: { ...WORLD },
    coastline: coastline(board),
    // As Board.tsx writes a polygon's points; inset WATER_FEATHER / 2 is the one it draws.
    water: Object.fromEntries(
      [0, WATER_FEATHER / 2, WATER_FEATHER].map((inset) => [
        inset,
        waterOutline(board, inset)
          .map((p) => `${p.x},${p.y}`)
          .join(' '),
      ]),
    ),
    ports: board.edges
      .filter((e) => isCoastalEdge(board, e))
      .map((e) => ({ edge: e.id, ...portPlacement(board, e.id) })),
    camera: CAMERA_BOUNDS.map((bounds) => ({
      bounds,
      fit: fitBoard(bounds),
      maxZoom: maxZoom(bounds),
      constrained: CAMERAS.map((camera) => constrainCamera(camera, bounds)),
    })),
    markup: Object.fromEntries(Object.entries(MARKUP).map(([name, render]) => [name, sha256(render())])),
    shader: sha256(fragmentSource),
  };
}

async function write(file: URL, value: unknown) {
  const path = fileURLToPath(file);
  const options = { ...(await resolveConfig(path)), filepath: path };
  writeFileSync(path, await format(JSON.stringify(value, null, 2), options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, name] = process.argv.slice(2);
  if (command === 'markup') {
    const render = MARKUP[name ?? ''];
    if (!render) throw new Error(`Name one of: ${Object.keys(MARKUP).join(', ')}`);
    process.stdout.write(render().replaceAll('><', '>\n<') + '\n');
  } else {
    await write(BOARD_FIXTURE, await boardFixture());
    await write(SCENE_FIXTURE, sceneFixture());
  }
}
