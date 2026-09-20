import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { createGame } from '../packages/rules/src/game.js';
import { retainedResults } from '../apps/client/src/results-presentation.js';
async function until(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for clients');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
test('two live clients, a second tab and a refreshed client keep results after concurrent returns', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  t.after(() => server.close());
  const store = server.store;
  const sa = newSession('Alpha');
  const a = store.enter('create', sa.token, sa.name);
  sa.roomId = a.room_id;
  sa.joined = true;
  const sb = newSession('Beta', a.room_id);
  const b = store.enter('join', sb.token, sb.name, a.room_id);
  sb.joined = true;
  const game = createGame([a, b], 42, () => 0.3);
  game.phase = 'finished';
  game.winner = a.id;
  store.db.prepare('INSERT INTO games VALUES (?,?)').run(a.room_id, JSON.stringify(game));
  const connect = (session: typeof sa) => {
    const client = new Connection(server.url, { ...session });
    t.after(() => client.stop());
    client.start();
    return client;
  };
  const ca = connect(sa),
    cb = connect(sb);
  await until(() => [ca, cb].every((c) => c.status === 'connected'));
  const original = retainedResults(null, cb.state)!;
  await Promise.all([ca.action({ kind: 'returnToLobby' }), cb.action({ kind: 'returnToLobby' })]);
  await until(() => [ca, cb].every((c) => !!c.state?.previousResults));
  assert.deepEqual(retainedResults(original, cb.state)?.game, original.game);
  assert.equal(store.db.prepare('SELECT count(*) n FROM archived_matches').get()!.n, 1);
  const otherTab = connect(sb);
  await until(() => otherTab.status === 'connected');
  assert.deepEqual(retainedResults(null, otherTab.state)?.game, original.game);
  assert.deepEqual(
    retainedResults(original, cb.state)?.game,
    original.game,
    'superseded tab retains its results',
  );
  const refreshed = connect(sb);
  await until(() => refreshed.status === 'connected');
  assert.deepEqual(retainedResults(null, refreshed.state)?.game, original.game);
  assert.equal(refreshed.state!.players.find((p) => p.id === b.id)!.ready, false);
  await assert.rejects(ca.action({ kind: 'start' }), /ready/);
  await ca.leave();
  await until(() => refreshed.state!.players[0]?.id === b.id);
  assert.deepEqual(refreshed.state!.previousResults?.game, original.game, 'host departure preserves results');
});
