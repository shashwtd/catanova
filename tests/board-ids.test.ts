import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import {
  applyAction,
  BOARD_ID_LIMIT,
  createGame,
  gameView,
  parseGameAction,
  RuleError,
} from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';
import { readyLobby } from './helpers.js';

/** Corners, edges and hexes that are not on the Classic island: 54 corners, 72 edges, 19 hexes. */
const OFF_BOARD: GameAction[] = [
  { kind: 'settlement', vertex: 54 },
  { kind: 'city', vertex: 79 },
  { kind: 'road', edge: 72 },
  { kind: 'road', edge: BOARD_ID_LIMIT - 1 },
  { kind: 'robber', hex: 19 },
  { kind: 'robber', hex: 29, victim: 'anyone' },
];
const offBoard = (error: unknown) => error instanceof RuleError && error.message === 'Invalid board location';

test('the protocol takes any well-formed board id, and nothing else', () => {
  // The outermost corner, edge and hex of the 30-hex Big Table island, which the Classic bounds refused.
  for (const action of [
    { kind: 'settlement', vertex: 79 },
    { kind: 'road', edge: 108 },
    { kind: 'robber', hex: 29 },
    { kind: 'city', vertex: BOARD_ID_LIMIT - 1 },
  ] satisfies GameAction[]) {
    assert.deepEqual(parseGameAction(action), action);
    const message = { type: 'action', commandId: 'board-id-check', expectedRevision: 3, action };
    assert.deepEqual(parseClientMessage(JSON.stringify(message)), message);
  }
  for (const id of [-1, 1.5, '3', null, undefined, NaN, Infinity, BOARD_ID_LIMIT, 2 ** 53, 1e308])
    for (const action of [
      { kind: 'settlement', vertex: id },
      { kind: 'city', vertex: id },
      { kind: 'road', edge: id },
      { kind: 'robber', hex: id },
    ])
      assert.throws(() => parseGameAction(action), offBoard, `${action.kind} ${String(id)}`);
});

test('the rules refuse a corner, edge or hex that is not on the game’s island, whatever the phase', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    481,
    () => 0.5,
  );
  const active = game.players[game.active]!.id;
  for (const action of OFF_BOARD)
    assert.throws(() => applyAction(game, active, action, Math.random), offBoard);
  // With the protocol no longer bounding hexes, an off-board hex in the robber phase would reach robberVictims,
  // which reads the hex without looking: the board check must stop it first.
  const robbing = { ...structuredClone(game), phase: 'robber' as const };
  assert.throws(() => applyAction(robbing, active, { kind: 'robber', hex: 19 }, Math.random), offBoard);
  // The last corner and hex on the island are still on it.
  const settled = applyAction(game, active, { kind: 'settlement', vertex: 53 }, Math.random);
  assert.equal(settled.buildings[53]?.player, active);
  assert.notEqual(game.robber, 18);
  assert.equal(applyAction(robbing, active, { kind: 'robber', hex: 18 }, Math.random).robber, 18);
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the room');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a started game refuses sites off its island over the wire, changes nothing, and carries on', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null });
  const host = new Connection(server.url, newSession('Host'), { minRetryMs: 30, maxRetryMs: 100 });
  t.after(async () => {
    host.stop();
    await server.close();
  });
  host.start();
  await until(() => host.status === 'connected');
  const roomId = host.session.roomId!;
  server.store.enter('join', newSession('Guest').token, 'Guest', roomId);
  const seat = server.store.snapshot(roomId).players.find((p) => p.name === 'Host')!;
  server.store.action({ ...seat, room_id: roomId }, 'start-board-ids', readyLobby(server.store, roomId), {
    kind: 'start',
  });
  // The store started the game behind the socket's back, so the client asks for the room as it now is.
  host.sync();
  await until(() => !!host.state?.game);
  const before = server.store.loadGame(roomId)!,
    revision = server.store.snapshot(roomId).revision,
    receipts = () => server.store.db.prepare('SELECT COUNT(*) AS n FROM game_receipts').get()!.n;
  const saved = receipts();
  for (const action of OFF_BOARD) {
    await assert.rejects(host.action(action), /^Error: ILLEGAL_ACTION: Invalid board location$/);
    assert.equal(server.store.snapshot(roomId).revision, revision);
  }
  assert.deepEqual(server.store.loadGame(roomId), before);
  assert.equal(receipts(), saved);
  assert.equal(host.status, 'connected');
  // Whoever is first to place still can, on the island's own corners.
  const first = before.players[before.active]!;
  const vertex = gameView(before, first.id).legal.settlements.at(-1)!;
  const place = { kind: 'settlement', vertex } as const;
  if (first.id === seat.id) await host.action(place);
  else {
    const guest = server.store.snapshot(roomId).players.find((p) => p.id === first.id)!;
    server.store.action({ ...guest, room_id: roomId }, 'place-board-id', revision, place);
  }
  assert.equal(server.store.loadGame(roomId)!.buildings[vertex]?.player, first.id);
});
