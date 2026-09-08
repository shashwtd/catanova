import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';
import type { RoomState, ServerMessage } from '../../../packages/protocol/src/index.js';
import { ProtocolError, Store } from './store.js';
import type { Seat } from './store.js';
import { RuleError } from '../../../packages/rules/src/game.js';

export async function startServer(options: { port?: number; host?: string; databasePath?: string; allowedOrigins?: string[]; heartbeatMs?: number } = {}) {
  const store = new Store(options.databasePath ?? 'data/probe.sqlite');
  let closing = false;
  const http = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/healthz') {
      try {
        store.db.prepare('SELECT 1').get();
        response.writeHead(closing ? 503 : 200).end(JSON.stringify({ status: closing ? 'draining' : 'ok', service: 'catanova-connectivity', protocol: PROTOCOL_VERSION }));
      } catch { response.writeHead(503).end('{"status":"unavailable"}'); }
    } else { response.writeHead(404).end('{"error":"not_found"}'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const sessions = new Map<WebSocket, Seat>();
  const activeSeats = new Map<string, WebSocket>();
  const alive = new Set<WebSocket>();
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128 * 1024) { ws.close(1013, 'Slow connection; reconnect'); return; }
    ws.send(JSON.stringify(message));
  }
  function snapshot(roomId: string, viewer: string): RoomState {
    const state = store.snapshot(roomId, viewer);
    return { ...state, players: state.players.map(p => ({ ...p, connected: activeSeats.get(p.id)?.readyState === WebSocket.OPEN })) };
  }
  function broadcast(roomId: string) {
    if (closing) return;
    for (const [ws, seat] of sessions) if (seat.room_id === roomId) send(ws, { type: 'state', state: snapshot(roomId, seat.id) });
  }
  http.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    const origins = options.allowedOrigins ?? [];
    if (closing || request.url !== '/ws' || wss.clients.size >= 400 || (origin && !origins.includes(origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', ws => {
    alive.add(ws);
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => alive.add(ws));
    const handshakeTimeout = setTimeout(() => { if (!sessions.has(ws)) ws.close(1008, 'Join a room first'); }, 5000);
    handshakeTimeout.unref();
    let windowStart = Date.now(); let messages = 0;
    ws.on('message', (data, isBinary) => {
      let commandId: string | undefined;
      try {
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messages = 0; }
        if (++messages > 30) { ws.close(1008, 'Too many messages'); return; }
        if (isBinary) throw new ProtocolError('INVALID_MESSAGE', 'Use JSON text messages');
        const message = parseClientMessage(data.toString());
        if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
          if (sessions.has(ws)) throw new ProtocolError('ALREADY_JOINED', 'Socket already has a seat');
          const seat = store.enter(message.type, message.token, message.name, message.roomId);
          const oldSocket = activeSeats.get(seat.id);
          if (oldSocket && oldSocket !== ws) {
            // Revoke immediately, before asynchronous close, so the replaced socket cannot act.
            sessions.delete(oldSocket);
            oldSocket.close(4001, 'Seat resumed elsewhere');
          }
          sessions.set(ws, seat); activeSeats.set(seat.id, ws); clearTimeout(handshakeTimeout);
          send(ws, { type: 'welcome', playerId: seat.id, state: snapshot(seat.room_id, seat.id), version: PROTOCOL_VERSION });
          broadcast(seat.room_id);
        } else {
          const seat = sessions.get(ws);
          if (!seat) throw new ProtocolError('NOT_JOINED', 'Join or resume before sending actions');
          if (message.type === 'ping') { send(ws, { type: 'pong', nonce: message.nonce }); return; }
          if (message.type !== 'increment' && message.type !== 'action') throw new ProtocolError('INVALID_MESSAGE', 'Unknown action');
          commandId = message.commandId;
          const receipt = message.type === 'action' ? store.action(seat, message.commandId, message.expectedRevision, message.action) : store.increment(seat, message.commandId, message.expectedRevision);
          // The database transaction has committed before any success reaches a client.
          send(ws, { type: 'ack', commandId: message.commandId, ...receipt });
          broadcast(seat.room_id);
        }
      } catch (error) {
        const code = error instanceof ProtocolError || error instanceof RuleError ? error.code : error instanceof SyntaxError || (error instanceof Error && !('code' in error)) ? 'INVALID_MESSAGE' : 'STORAGE_ERROR';
        send(ws, { type: 'error', code, message: error instanceof ProtocolError || error instanceof RuleError ? error.message : code === 'INVALID_MESSAGE' ? 'Invalid message or protocol version' : 'Could not save the action; no success was acknowledged', ...(commandId ? { commandId } : {}) });
        const seat = sessions.get(ws);
        if (seat && code === 'STALE_STATE') send(ws, { type: 'state', state: snapshot(seat.room_id, seat.id) });
      }
    });
    ws.on('close', () => {
      clearTimeout(handshakeTimeout); alive.delete(ws);
      const seat = sessions.get(ws); sessions.delete(ws);
      if (seat && activeSeats.get(seat.id) === ws) { activeSeats.delete(seat.id); broadcast(seat.room_id); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws); ws.ping();
    }
  }, options.heartbeatMs ?? 15000);
  heartbeat.unref();
  try {
    await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(options.port ?? 3000, options.host ?? '127.0.0.1', resolve); });
  } catch (error) { clearInterval(heartbeat); wss.close(); store.close(); throw error; }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  return {
    port: address.port,
    url: `ws://127.0.0.1:${address.port}/ws`,
    store,
    async close() {
      closing = true; clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
      store.close();
    },
  };
}
