import { Connection, newSession } from '../apps/client/src/connection.js';

const endpoint = process.argv[2] ?? 'ws://127.0.0.1:3000/ws';
const first = new Connection(endpoint, newSession('Player one'));
const second = new Connection(endpoint, newSession('Player two'));
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
try {
  first.start();
  await until(() => first.status === 'connected', 'first player connects');
  second.session.roomId = first.state!.roomId;
  second.start();
  await until(() => second.status === 'connected' && first.state!.players.length === 2, 'second player joins');
  const start = performance.now();
  const receipt = await first.increment();
  await until(() => second.state!.revision === receipt.revision, 'second player receives committed update');
  console.log(JSON.stringify({ result: 'PASS', endpoint, players: 2, revision: receipt.revision, counter: second.state!.counter, roundTripAndFanoutMs: Math.round((performance.now() - start) * 10) / 10 }, null, 2));
} finally { first.stop(); second.stop(); }
