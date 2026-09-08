import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
const host = process.env.HOST ?? '127.0.0.1';
const server = await startServer({
  port, host,
  databasePath: process.env.DATABASE_PATH ?? 'data/probe.sqlite',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
});
console.log(JSON.stringify({ event: 'listening', port: server.port, host, service: 'catanova-connectivity' }));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await server.close();
});
