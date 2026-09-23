import { startServer } from './server.js';
import { readAdminConfig } from './admin/config.js';
import { startAdminServer } from './admin/listener.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
const host = process.env.HOST ?? '127.0.0.1';
const databasePath = process.env.DATABASE_PATH ?? 'data/probe.sqlite';
// Read before the game starts: a bad admin configuration stops startup instead of running without it.
const adminConfig = readAdminConfig(process.env);
const server = await startServer({
  port, host,
  databasePath,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
});
console.log(JSON.stringify({ event: 'listening', port: server.port, host, service: 'catanova-connectivity' }));
const admin = adminConfig
  ? await startAdminServer({
      config: adminConfig,
      store: server.store,
      runtime: server.runtime,
      databasePath,
    })
  : undefined;
if (admin && adminConfig)
  console.log(
    JSON.stringify({
      event: 'admin_listening',
      port: admin.port,
      host: adminConfig.host,
      auth: adminConfig.auth.mode,
    }),
  );
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await admin?.close();
  await server.close();
});
