import { createVerifier, readAuthConfig } from './auth.js';
import type { AuthConfig, Identity, VerifyIdentity } from './auth.js';
import { AccountService, accountFailure } from './accounts.js';
import { parseProfile } from '../../../packages/protocol/src/profile.js';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';
import type { RoomState, ServerMessage } from '../../../packages/protocol/src/index.js';
import { ProtocolError, Store } from './store.js';
import type { Seat } from './store.js';
import { RuleError } from '../../../packages/rules/src/game.js';
import { serveClient } from './static.js';

/** Validation errors must release a pending command without reflecting arbitrary payload text. */
function validationCommandId(input: string): string | undefined {
  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const id = (value as Record<string, unknown>).commandId;
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export async function startServer(
  options: {
    port?: number;
    host?: string;
    databasePath?: string;
    allowedOrigins?: string[];
    heartbeatMs?: number;
    clientDirectory?: string;
    auth?: AuthConfig | null;
    verifyIdentity?: VerifyIdentity;
    now?: () => number;
  } = {},
) {
  const auth = options.auth === null ? undefined : (options.auth ?? readAuthConfig());
  const verify = options.verifyIdentity ?? (auth ? createVerifier(auth) : undefined);
  const accounts = auth ? new AccountService(auth) : undefined;
  const now = options.now ?? Date.now;
  const store = new Store(options.databasePath ?? 'data/probe.sqlite', { now });
  let closing = false;
  const http = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/api/config') {
      response
        .writeHead(200)
        .end(JSON.stringify({ auth: auth ?? null, mode: verify ? 'authenticated' : 'local' }));
    } else if (request.url?.startsWith('/api/account') || request.url?.startsWith('/api/friends')) {
      try {
        if (!accounts)
          throw new ProtocolError(
            'ACCOUNT_SETUP_REQUIRED',
            'Supabase accounts are not configured on this server',
          );
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        const url = new URL(request.url, 'http://localhost');
        const body = async () => {
          let value = '';
          for await (const chunk of request) {
            value += String(chunk);
            if (value.length > 4096) throw new Error('Request too large');
          }
          return JSON.parse(value || '{}') as Record<string, unknown>;
        };
        let result: unknown;
        if (request.method === 'GET' && url.pathname === '/api/account') result = await accounts.get(token);
        else if (request.method === 'POST' && url.pathname === '/api/account/activity')
          result = await accounts.touch(token);
        else if (request.method === 'GET' && url.pathname === '/api/account/username')
          result = await accounts.username(token, url.searchParams.get('name') ?? '');
        else if (request.method === 'PUT' && url.pathname === '/api/account/profile') {
          const account = await accounts.save(token, await body());
          result = account;
        } else if (request.method === 'GET' && url.pathname === '/api/friends')
          result = await accounts.friends(token);
        else if (request.method === 'GET' && url.pathname === '/api/friends/search')
          result = await accounts.search(token, url.searchParams.get('q') ?? '');
        else if (request.method === 'POST' && url.pathname === '/api/friends') {
          const value = await body();
          if (typeof value.action !== 'string' || typeof value.other !== 'string')
            throw accountFailure('FRIEND_INVALID');
          result = await accounts.friendAction(token, value.action, value.other);
        } else {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200).end(JSON.stringify(result));
      } catch (error) {
        const code = error instanceof ProtocolError ? error.code : 'INVALID_ACCOUNT_REQUEST';
        const status = ['ACCOUNT_SETUP_REQUIRED', 'ACCOUNT_UNAVAILABLE'].includes(code)
          ? 503
          : code === 'AUTH_REQUIRED'
            ? 401
            : code === 'GUEST_EXPIRED'
              ? 410
              : code === 'GOOGLE_REQUIRED'
                ? 403
                : code === 'USERNAME_TAKEN'
                  ? 409
                  : code === 'ACCOUNT_RATE_LIMIT'
                    ? 429
                    : 400;
        response.writeHead(status).end(
          JSON.stringify({
            code,
            error: error instanceof Error ? error.message : 'Could not update your account',
          }),
        );
      }
    } else if (request.url === '/api/profile') {
      try {
        if (!verify) throw new ProtocolError('AUTH_REQUIRED', 'Google sign-in is not configured');
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        if (accounts) {
          let account;
          if (request.method === 'GET') account = await accounts.get(token);
          else if (request.method === 'PUT') {
            let body = '';
            for await (const chunk of request) {
              body += String(chunk);
              if (body.length > 4096) throw new Error('Profile too large');
            }
            account = await accounts.save(token, JSON.parse(body));
          } else {
            response.writeHead(405).end();
            return;
          }
          if (!account.profile)
            throw new ProtocolError('ONBOARDING_REQUIRED', 'Choose your username and avatar before playing');
          response.writeHead(200).end(JSON.stringify(account.profile));
          return;
        }
        const identity = await verify(token);
        if (request.method === 'GET')
          response.writeHead(200).end(JSON.stringify(store.profile(identity.id, identity.name)));
        else if (request.method === 'PUT') {
          let body = '';
          for await (const chunk of request) {
            body += String(chunk);
            if (body.length > 4096) throw new Error('Profile too large');
          }
          const profile = store.saveProfile(identity.id, parseProfile(JSON.parse(body)));
          response.writeHead(200).end(JSON.stringify(profile));
        } else response.writeHead(405).end();
      } catch (error) {
        response
          .writeHead(
            error instanceof ProtocolError
              ? ['AUTH_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_SETUP_REQUIRED'].includes(error.code)
                ? 503
                : 401
              : 400,
          )
          .end(
            JSON.stringify({
              code: error instanceof ProtocolError ? error.code : 'INVALID_PROFILE',
              error: error instanceof ProtocolError ? error.message : 'Invalid profile',
            }),
          );
      }
    } else if (request.method === 'GET' && request.url === '/healthz') {
      try {
        store.db.prepare('SELECT 1').get();
        response.writeHead(closing ? 503 : 200).end(
          JSON.stringify({
            status: closing ? 'draining' : 'ok',
            service: 'catanova-connectivity',
            protocol: PROTOCOL_VERSION,
          }),
        );
      } catch {
        response.writeHead(503).end('{"status":"unavailable"}');
      }
    } else if (request.method === 'GET' && /^\/api\/rooms\/[A-Z2-9]{8}$/.test(request.url ?? '')) {
      try {
        const preview = store.preview(request.url!.split('/').pop()!);
        const authorization = request.headers.authorization;
        const identity = authorization?.startsWith('Bearer ')
          ? accounts
            ? await accounts.get(authorization.slice(7))
            : verify
              ? await verify(authorization.slice(7))
              : undefined
          : undefined;
        response.writeHead(200).end(
          JSON.stringify({
            ...preview,
            ...(identity ? { canResume: store.hasAccountSeat(preview.roomId, identity.id) } : {}),
          }),
        );
      } catch (error) {
        response
          .writeHead(error instanceof ProtocolError && error.code === 'ROOM_NOT_FOUND' ? 404 : 503)
          .end(
            JSON.stringify({ error: error instanceof ProtocolError ? error.message : 'Room unavailable' }),
          );
      }
    } else {
      void serveClient(request, response, options.clientDirectory ?? 'dist/client', auth?.url);
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24576, perMessageDeflate: false });
  const sessions = new Map<WebSocket, Seat>();
  const activeSeats = new Map<string, WebSocket>();
  const alive = new Set<WebSocket>();
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128 * 1024) {
      ws.close(1013, 'Slow connection; reconnect');
      return;
    }
    ws.send(JSON.stringify(message));
  }
  function snapshot(roomId: string, viewer: string): RoomState {
    const state = store.snapshot(roomId, viewer);
    return {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        connected: activeSeats.get(p.id)?.readyState === WebSocket.OPEN,
      })),
    };
  }
  function broadcast(roomId: string) {
    if (closing) return;
    for (const [ws, seat] of sessions) {
      if (seat.room_id !== roomId) continue;
      try {
        send(ws, { type: 'state', state: snapshot(roomId, seat.id) });
      } catch (error) {
        send(ws, {
          type: 'error',
          code: error instanceof ProtocolError ? error.code : 'STORAGE_ERROR',
          message: 'Saved game unavailable; reconnect after recovery',
        });
      }
    }
  }
  http.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    const origins = options.allowedOrigins ?? [];
    const sameOrigin =
      origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
    if (
      closing ||
      request.url !== '/ws' ||
      wss.clients.size >= 400 ||
      (origin && !sameOrigin && !origins.includes(origin))
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => alive.add(ws));
    const handshakeTimeout = setTimeout(() => {
      if (!sessions.has(ws)) ws.close(1008, 'Join a room first');
    }, 12000);
    handshakeTimeout.unref();
    let windowStart = Date.now();
    let messages = 0;
    let authenticating = false;
    let authExpiry: ReturnType<typeof setTimeout> | undefined;
    let accountToken: string | undefined, accountIdentity: Identity | undefined;
    let activityPending = false,
      lastActivityWrite = 0,
      profileUpdating = false;
    function setAuthDeadline() {
      clearTimeout(authExpiry);
      if (!accountIdentity) return;
      authExpiry = setTimeout(
        () => ws.close(4003, 'Refresh account session'),
        Math.max(1, Math.min(2147483647, accountIdentity.expiresAt - Date.now())),
      );
      authExpiry.unref();
    }
    function assertSession(seat: Seat) {
      if (ws.readyState !== WebSocket.OPEN || sessions.get(ws) !== seat || activeSeats.get(seat.id) !== ws)
        throw new ProtocolError('SESSION_REPLACED', 'This seat is connected elsewhere');
      if (accountIdentity && accountIdentity.expiresAt <= Date.now()) {
        const guestExpired =
          accountIdentity.guestExpiresAt !== undefined && accountIdentity.guestExpiresAt <= Date.now();
        throw accountFailure(guestExpired ? 'GUEST_EXPIRED' : 'AUTH_REQUIRED');
      }
    }
    function recordGuestActivity() {
      const identity = accountIdentity;
      if (!accounts || !identity?.isGuest || activityPending || Date.now() - lastActivityWrite < 60000)
        return;
      activityPending = true;
      lastActivityWrite = Date.now();
      // Game commits do not wait for Supabase. Only a confirmed activity write extends the known deadline.
      void accounts
        .touch(accountToken)
        .then((account) => {
          if (ws.readyState !== WebSocket.OPEN || accountIdentity !== identity || !sessions.has(ws)) return;
          if (account.id !== identity.id || !account.registered || !account.profile) {
            ws.close(4003, 'Account unavailable');
            return;
          }
          identity.isGuest = account.isGuest;
          identity.guestExpiresAt = account.expiresAt ? Date.parse(account.expiresAt) : undefined;
          identity.expiresAt = Math.min(
            identity.tokenExpiresAt ?? identity.expiresAt,
            identity.guestExpiresAt ?? Infinity,
          );
          setAuthDeadline();
        })
        .catch((error) => {
          if (error instanceof ProtocolError && ['GUEST_EXPIRED', 'AUTH_REQUIRED'].includes(error.code))
            ws.close(4003, 'Refresh account session');
          // A service outage never extends identity validity; later activity retries after the throttle.
        })
        .finally(() => {
          activityPending = false;
        });
    }
    ws.on('message', async (data, isBinary) => {
      let commandId: string | undefined;
      try {
        if (Date.now() - windowStart > 1000) {
          windowStart = Date.now();
          messages = 0;
        }
        if (++messages > 30) {
          ws.close(1008, 'Too many messages');
          return;
        }
        if (isBinary) throw new ProtocolError('INVALID_MESSAGE', 'Use JSON text messages');
        let message: ReturnType<typeof parseClientMessage>;
        try {
          message = parseClientMessage(data.toString());
        } catch (error) {
          commandId = validationCommandId(data.toString());
          throw error;
        }
        if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
          if (sessions.has(ws)) throw new ProtocolError('ALREADY_JOINED', 'Socket already has a seat');
          if (authenticating) throw new ProtocolError('ALREADY_JOINING', 'Joining is already in progress');
          authenticating = true;
          let identity: Identity | undefined;
          try {
            identity = verify ? await verify(message.accessToken) : undefined;
          } finally {
            authenticating = false;
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          if (identity && identity.expiresAt <= Date.now())
            throw accountFailure(
              identity.guestExpiresAt !== undefined && identity.guestExpiresAt <= Date.now()
                ? 'GUEST_EXPIRED'
                : 'AUTH_REQUIRED',
            );
          const seat = store.enter(
            message.type,
            message.token,
            message.name,
            message.roomId,
            identity,
            message.profile,
          );
          if (identity) {
            accountToken = message.accessToken;
            accountIdentity = identity;
            setAuthDeadline();
          }
          const oldSocket = activeSeats.get(seat.id);
          if (oldSocket && oldSocket !== ws) {
            // Revoke immediately, before asynchronous close, so the replaced socket cannot act.
            sessions.delete(oldSocket);
            oldSocket.close(4001, 'Seat resumed elsewhere');
          }
          sessions.set(ws, seat);
          activeSeats.set(seat.id, ws);
          clearTimeout(handshakeTimeout);
          send(ws, {
            type: 'welcome',
            playerId: seat.id,
            state: snapshot(seat.room_id, seat.id),
            version: PROTOCOL_VERSION,
          });
          broadcast(seat.room_id);
        } else {
          const seat = sessions.get(ws);
          if (!seat) throw new ProtocolError('NOT_JOINED', 'Join or resume before sending actions');
          assertSession(seat);
          if (message.type === 'ping') {
            const revision = store.db.prepare('SELECT revision FROM rooms WHERE id = ?').get(seat.room_id)!
              .revision as number;
            send(ws, { type: 'pong', nonce: message.nonce, revision, serverNow: now() });
            return;
          }
          if (message.type === 'sync') {
            send(ws, { type: 'state', state: snapshot(seat.room_id, seat.id) });
            return;
          }
          if (message.type === 'history') {
            send(ws, {
              type: 'history',
              ...store.history(seat.room_id, message.before),
              ...(message.before === undefined ? {} : { before: message.before }),
            });
            return;
          }
          if (accounts && accountIdentity) {
            commandId = 'commandId' in message ? message.commandId : undefined;
            if (profileUpdating) throw accountFailure('ACCOUNT_BUSY');
            let account;
            if (message.type === 'lobby' && message.profile) {
              profileUpdating = true;
              try {
                account = await accounts.get(accountToken);
              } finally {
                profileUpdating = false;
              }
              // Authentication/profile checks may yield while another socket resumes this exact seat.
              assertSession(seat);
            }
            if (account && (account.id !== accountIdentity.id || !account.registered || !account.profile))
              throw accountFailure('ONBOARDING_REQUIRED');
            if (
              account &&
              message.type === 'lobby' &&
              message.profile &&
              !store.db
                .prepare('SELECT 1 FROM lobby_receipts WHERE room_id=? AND player_id=? AND command_id=?')
                .get(seat.room_id, seat.id, message.commandId)
            ) {
              if (JSON.stringify(parseProfile(message.profile)) !== JSON.stringify(account.profile))
                throw new ProtocolError(
                  'ACCOUNT_PROFILE_MISMATCH',
                  'Save your account profile before updating the lobby',
                );
            }
          }
          if (message.type === 'lobby') {
            commandId = message.commandId;
            const receipt = store.lobby(
              seat,
              commandId,
              message.expectedRevision,
              message.ready,
              message.profile,
            );
            recordGuestActivity();
            send(ws, { type: 'ack', commandId, ...receipt });
            broadcast(seat.room_id);
            return;
          }
          if (message.type === 'settings') {
            commandId = message.commandId;
            const receipt = store.configureSettings(
              seat,
              commandId,
              message.expectedRevision,
              message.settings,
            );
            recordGuestActivity();
            send(ws, { type: 'ack', commandId, ...receipt });
            broadcast(seat.room_id);
            return;
          }
          if (message.type === 'leave') {
            commandId = message.commandId;
            const receipt = store.leave(seat, commandId, message.expectedRevision);
            sessions.delete(ws);
            activeSeats.delete(seat.id);
            send(ws, { type: 'ack', commandId, ...receipt });
            ws.close(4002, 'Left room');
            broadcast(seat.room_id);
            return;
          }
          if (message.type !== 'increment' && message.type !== 'action')
            throw new ProtocolError('INVALID_MESSAGE', 'Unknown action');
          commandId = message.commandId;
          // Resolve the persisted deadline before accepting a late move, even between scheduler ticks.
          if (message.type === 'action' && store.expireRoom(seat.room_id)) broadcast(seat.room_id);
          if (
            message.type === 'action' &&
            message.action.kind === 'start' &&
            !store.loadGame(seat.room_id) &&
            !store
              .snapshot(seat.room_id)
              .players.every((p) => activeSeats.get(p.id)?.readyState === WebSocket.OPEN)
          )
            throw new ProtocolError('NOT_CONNECTED', 'Wait for every player to reconnect');
          const receipt =
            message.type === 'action'
              ? store.action(seat, message.commandId, message.expectedRevision, message.action)
              : store.increment(seat, message.commandId, message.expectedRevision);
          recordGuestActivity();
          // The database transaction has committed before any success reaches a client.
          send(ws, { type: 'ack', commandId: message.commandId, ...receipt });
          broadcast(seat.room_id);
        }
      } catch (error) {
        const code =
          error instanceof ProtocolError || error instanceof RuleError
            ? error.code
            : error instanceof SyntaxError || (error instanceof Error && !('code' in error))
              ? 'INVALID_MESSAGE'
              : 'STORAGE_ERROR';
        send(ws, {
          type: 'error',
          code,
          message:
            error instanceof ProtocolError || error instanceof RuleError
              ? error.message
              : code === 'INVALID_MESSAGE'
                ? 'Invalid message or protocol version'
                : 'Could not save the action; no success was acknowledged',
          ...(commandId ? { commandId } : {}),
        });
        const seat = sessions.get(ws);
        if (seat && code === 'STALE_STATE')
          send(ws, { type: 'state', state: snapshot(seat.room_id, seat.id) });
      }
    });
    ws.on('close', () => {
      clearTimeout(handshakeTimeout);
      clearTimeout(authExpiry);
      alive.delete(ws);
      const seat = sessions.get(ws);
      sessions.delete(ws);
      if (seat && activeSeats.get(seat.id) === ws) {
        activeSeats.delete(seat.id);
        broadcast(seat.room_id);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, options.heartbeatMs ?? 15000);
  heartbeat.unref();
  const clockErrors = new Set<string>();
  const clockScheduler = setInterval(() => {
    if (closing) return;
    let due: string[];
    try {
      due = store.dueRooms();
      clockErrors.delete('scheduler');
    } catch (error) {
      if (!clockErrors.has('scheduler')) {
        clockErrors.add('scheduler');
        console.error('Turn clock storage is unavailable:', error);
      }
      return;
    }
    for (const roomId of due) {
      try {
        if (store.expireRoom(roomId)) broadcast(roomId);
        clockErrors.delete(roomId);
      } catch (error) {
        // A failed transaction never advances the game; retry from its last committed clock next tick.
        broadcast(roomId);
        if (!clockErrors.has(roomId)) {
          clockErrors.add(roomId);
          console.error('Turn clock could not finish a saved turn:', error);
          for (const [ws, seat] of sessions)
            if (seat.room_id === roomId)
              send(ws, {
                type: 'error',
                code: 'CLOCK_STATE',
                message: 'Automatic turn completion is waiting for server recovery. Saved moves are intact.',
              });
        }
      }
    }
  }, 500);
  clockScheduler.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port ?? 3000, options.host ?? '127.0.0.1', resolve);
    });
  } catch (error) {
    clearInterval(heartbeat);
    clearInterval(clockScheduler);
    wss.close();
    store.close();
    throw error;
  }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  return {
    port: address.port,
    url: `ws://127.0.0.1:${address.port}/ws`,
    store,
    async close() {
      closing = true;
      clearInterval(heartbeat);
      clearInterval(clockScheduler);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
    },
  };
}
