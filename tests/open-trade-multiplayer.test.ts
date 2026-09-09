import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { PendingCommand } from '../apps/client/src/connection.js';
import { activePlayer, applyAction, createGame, emptyHand, gameView } from '../packages/rules/src/game.js';
import type { Game, Hand } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';

const hand = (values: Partial<Hand>): Hand => ({ ...emptyHand(), ...values });
/** Install an initial controlled economy before the first event, which records the legacy baseline atomically. */
function fixture(store: Store, roomId: string) {
  let game = createGame(
    store.snapshot(roomId).players.map(({ id, name }) => ({ id, name })),
    82,
    () => 0.34,
  );
  while (!game.turn) {
    const player = activePlayer(game),
      legal = gameView(game, player.id).legal;
    game = applyAction(
      game,
      player.id,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.34,
    );
  }
  for (const player of game.players)
    for (const resource of RESOURCES) {
      game.bank[resource] += player.hand[resource];
      player.hand[resource] = 0;
    }
  const hands = [hand({ wood: 3 }), hand({ sheep: 3, ore: 2 }), hand({ wheat: 3 }), hand({ ore: 2 })];
  game.players.forEach((player, index) => {
    player.hand = hands[index]!;
    for (const resource of RESOURCES) game.bank[resource] -= player.hand[resource];
  });
  game.phase = 'actions';
  store.db.prepare('INSERT INTO games(room_id,state) VALUES(?,?)').run(roomId, JSON.stringify(game));
  return game;
}
function conserved(game: Game) {
  for (const resource of RESOURCES)
    assert.equal(game.bank[resource] + game.players.reduce((n, player) => n + player.hand[resource], 0), 19);
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for open trade state');
    await pause(10);
  }
}

test('proposal receipts and acceptance survive restart; stale commands and failed durable writes cannot partially exchange', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-open-trade-')),
    path = join(directory, 'game.sqlite');
  let store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const session = newSession('Alice'),
    host = store.enter('create', session.token, session.name);
  for (const name of ['Bob', 'Cara']) {
    const session = newSession(name);
    store.enter('join', session.token, name, host.room_id);
  }
  const game = fixture(store, host.room_id),
    bidder = { ...game.players[1]!, room_id: host.room_id };
  let revision = store.snapshot(host.room_id).revision;
  revision = store.action(host, 'durable-open-offer', revision, {
    kind: 'openTrade',
    give: hand({ wood: 2 }),
  }).revision;
  const tradeId = store.loadGame(host.room_id)!.trade!.id,
    proposalRevision = revision;
  const proposal = { kind: 'proposeTrade' as const, tradeId, give: hand({ sheep: 2 }) };
  revision = store.action(bidder, 'durable-proposal', revision, proposal).revision;
  assert.equal(store.action(bidder, 'durable-proposal', proposalRevision, proposal).duplicate, true);
  assert.throws(
    () =>
      store.action(bidder, 'durable-proposal', proposalRevision, { ...proposal, give: hand({ sheep: 1 }) }),
    /different payload/,
  );
  assert.throws(
    () =>
      store.action(bidder, 'stale-replacement', proposalRevision, { ...proposal, give: hand({ sheep: 1 }) }),
    /State changed/,
  );
  const saved = structuredClone(store.loadGame(host.room_id)!);
  const accept = { kind: 'acceptProposal' as const, tradeId, player: bidder.id };
  assert.throws(() => store.action(host, 'stale-acceptance', proposalRevision, accept), /State changed/);
  store.db.exec(
    "CREATE TEMP TRIGGER fail_trade_receipt BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT,'Trade receipt failure'); END",
  );
  assert.throws(() => store.action(host, 'durable-acceptance', revision, accept), /Trade receipt failure/);
  assert.deepEqual(store.loadGame(host.room_id), saved);
  assert.equal(store.snapshot(host.room_id).revision, revision);
  assert.equal(store.history(host.room_id).entries[0]!.kind, 'proposeTrade');
  store.db.exec('DROP TRIGGER fail_trade_receipt');
  store.close();
  store = new Store(path);
  assert.deepEqual(store.loadGame(host.room_id), saved);
  assert.equal(store.action(bidder, 'durable-proposal', proposalRevision, proposal).duplicate, true);
  const accepted = store.action(host, 'durable-acceptance', revision, accept);
  const after = structuredClone(store.loadGame(host.room_id)!);
  store.close();
  store = new Store(path);
  assert.equal(store.action(host, 'durable-acceptance', revision, accept).duplicate, true);
  assert.equal(store.snapshot(host.room_id).revision, accepted.revision);
  assert.deepEqual(store.loadGame(host.room_id), after);
  assert.equal(after.trade, null);
  assert.equal(after.players[0]!.hand.sheep, 2);
  assert.equal(after.players[1]!.hand.wood, 2);
  const completed = store.history(host.room_id).entries.filter((entry) => entry.kind === 'acceptProposal');
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0]!.lines, ['Alice traded 2 Timber to Bob for 2 Sheep.']);
  assert.ok(!JSON.stringify(store.history(host.room_id)).includes('"hand":'));
  conserved(after);
});

test('four real clients publish proposals, reconnect privately, and recover one accepted exchange with an unacknowledged outbox command', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-open-wire-')),
    path = join(directory, 'game.sqlite');
  let server = await startServer({ port: 0, databasePath: path, auth: null });
  const port = server.port,
    clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const host = new Connection(server.url, newSession('Alice'), { minRetryMs: 30, maxRetryMs: 100 });
  clients.push(host);
  host.start();
  await until(() => host.status === 'connected');
  for (const name of ['Bob', 'Cara', 'Dan']) {
    const client = new Connection(server.url, newSession(name, host.session.roomId), {
      minRetryMs: 30,
      maxRetryMs: 100,
    });
    clients.push(client);
    client.start();
    await until(() => client.status === 'connected');
  }
  await until(() => clients.every((client) => client.state?.players.length === 4));
  const roomId = host.session.roomId!,
    game = fixture(server.store, roomId);
  let actor = clients.find((client) => client.playerId === game.players[0]!.id)!;
  const bidders = game.players
    .slice(1)
    .map((player) => clients.find((client) => client.playerId === player.id)!);
  let ack = await actor.action({ kind: 'openTrade', give: hand({ wood: 2 }) });
  await until(() => clients.every((client) => client.state!.revision === ack.revision));
  const tradeId = actor.state!.game!.trade!.id;
  for (const [index, resource] of ['sheep', 'wheat', 'ore'].entries()) {
    ack = await bidders[index]!.action({ kind: 'proposeTrade', tradeId, give: hand({ [resource]: 1 }) });
    await until(() => clients.every((client) => client.state!.revision === ack.revision));
  }
  assert.equal(actor.state!.game!.trade!.proposals!.length, 3);
  const beforeRestart = structuredClone(server.store.loadGame(roomId)!);
  await server.close();
  server = await startServer({ port, databasePath: path, auth: null });
  await until(() => clients.every((client) => client.status === 'connected'));
  for (const client of clients) {
    assert.deepEqual(client.state!.game!.trade, beforeRestart.trade);
    for (const player of client.state!.game!.players)
      assert.equal(!!player.hand, player.id === client.playerId);
  }
  const command: PendingCommand = {
    type: 'action',
    commandId: 'unacknowledged-open-trade',
    expectedRevision: actor.state!.revision,
    action: { kind: 'acceptProposal', tradeId, player: bidders[0]!.playerId! },
  };
  const seat = { ...game.players[0]!, room_id: roomId };
  server.store.action(seat, command.commandId, command.expectedRevision, command.action);
  const accepted = structuredClone(server.store.loadGame(roomId)!);
  actor.stop();
  await server.close();
  server = await startServer({ port, databasePath: path, auth: null });
  let cleared = false;
  const reloaded = new Connection(
    server.url,
    { ...actor.session },
    {
      pending: command,
      minRetryMs: 30,
      maxRetryMs: 100,
      onPending: (pending) => {
        if (!pending) cleared = true;
      },
    },
  );
  const stopped = actor;
  actor = reloaded;
  clients.push(reloaded);
  reloaded.start();
  await until(
    () =>
      cleared &&
      clients
        .filter((client) => client !== stopped)
        .every(
          (client) =>
            client.status === 'connected' && client.state!.revision === command.expectedRevision + 1,
        ),
  );
  assert.deepEqual(server.store.loadGame(roomId), accepted);
  assert.equal(accepted.trade, null);
  assert.equal(
    server.store.history(roomId).entries.filter((entry) => entry.kind === 'acceptProposal').length,
    1,
  );
  assert.equal(actor.state!.game!.players.find((player) => player.id === actor.playerId)!.hand!.sheep, 1);
  assert.equal(
    actor.state!.game!.players.find((player) => player.id === bidders[0]!.playerId)!.hand,
    undefined,
  );
  conserved(accepted);
});
