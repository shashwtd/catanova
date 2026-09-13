import { PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';
import type {
  ClientMessage,
  RoomState,
  ServerMessage,
  Session,
} from '../../../packages/protocol/src/index.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { RoomSettings } from '../../../packages/protocol/src/settings.js';
import type { GameAction } from '../../../packages/rules/src/game.js';
import { snapshotProblem } from './state.js';

type Ack = Extract<ServerMessage, { type: 'ack' }>;
export type PendingCommand = Extract<
  ClientMessage,
  { type: 'increment' | 'action' | 'leave' | 'lobby' | 'settings' }
>;
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type PingSample = { at: number; rtt: number | null };
export type NetworkMetrics = {
  samples: PingSample[];
  reconnects: number;
  rejectedSnapshots: number;
  serverRevision: number | null;
  syncIssue: string | null;
  clockOffsetMs?: number;
};
export const initialMetrics = (): NetworkMetrics => ({
  samples: [],
  reconnects: 0,
  rejectedSnapshots: 0,
  serverRevision: null,
  syncIssue: null,
});
export function newSession(name: string, roomId?: string, profile?: Profile): Session {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    name,
    ...(roomId ? { roomId } : {}),
    ...(profile ? { profile } : {}),
    token: Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join(''),
  };
}
/** Accepted moves remain pending until the corresponding authoritative snapshot is installed. */
export class Connection {
  state: RoomState | null = null;
  playerId: string | null = null;
  status: ConnectionStatus = 'idle';
  metrics = initialMetrics();
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private lastReceived = 0;
  private lastSync = -Infinity;
  private replayAfterSync = false;
  private probes = new Map<string, number>();
  private pending?: {
    message: PendingCommand;
    ack?: Ack;
    resolve: (ack: Ack) => void;
    reject: (error: Error) => void;
  };
  private listeners = new Set<(message: ServerMessage) => void>();
  constructor(
    readonly url: string,
    readonly session: Session,
    private options: {
      onStatus?: (status: ConnectionStatus) => void;
      onSession?: (session: Session) => void;
      onPending?: (command: PendingCommand | null) => void;
      onMetrics?: (metrics: NetworkMetrics) => void;
      accessToken?: () => Promise<string | undefined>;
      pending?: PendingCommand;
      preloadGame?: boolean;
      minRetryMs?: number;
      maxRetryMs?: number;
      pingIntervalMs?: number;
    } = {},
  ) {
    if (options.pending) this.pending = { message: options.pending, resolve: () => {}, reject: () => {} };
  }
  get awaitingConfirmation() {
    return !!this.pending;
  }
  subscribe(listener: (message: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.options.onStatus?.(status);
  }
  private publishMetrics() {
    this.options.onMetrics?.({ ...this.metrics, samples: [...this.metrics.samples] });
  }
  private sample(rtt: number | null) {
    this.metrics.samples.push({ at: Date.now(), rtt });
    this.metrics.samples = this.metrics.samples.slice(-60);
    this.publishMetrics();
  }
  private emit(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.options.onSession?.({ ...this.session });
    this.connect();
  }
  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  sync() {
    // A broken snapshot must not cause a sync-response loop against the server.
    if (performance.now() - this.lastSync < 1000 || this.socket?.readyState !== WebSocket.OPEN) return;
    this.lastSync = performance.now();
    this.send({ type: 'sync' });
  }
  history(before?: number) {
    this.send({ type: 'history', ...(before === undefined ? {} : { before }) });
  }
  private finishPending() {
    const p = this.pending;
    if (
      p?.ack &&
      (p.ack.released !== undefined ||
        (!this.metrics.syncIssue && (this.state?.revision ?? -1) >= p.ack.revision))
    ) {
      this.pending = undefined;
      clearTimeout(this.syncTimer);
      this.options.onPending?.(null);
      p.resolve(p.ack);
    }
  }
  private install(next: RoomState) {
    const issue = snapshotProblem(this.state, next);
    if (issue) {
      this.metrics.rejectedSnapshots++;
      if (issue !== 'stale') {
        this.metrics.syncIssue = issue;
        this.sync();
      }
      this.publishMetrics();
      return false;
    }
    this.state = next;
    this.metrics.serverRevision = next.revision;
    this.metrics.syncIssue = null;
    this.finishPending();
    this.publishMetrics();
    return true;
  }
  private ping() {
    const now = performance.now();
    for (const [nonce, sent] of this.probes)
      if (now - sent > 10000) {
        this.probes.delete(nonce);
        this.sample(null);
      }
    const nonce = crypto.randomUUID();
    this.probes.set(nonce, now);
    this.send({ type: 'ping', nonce });
  }
  private connect() {
    if (this.stopped) return;
    this.setStatus(this.session.joined ? 'reconnecting' : 'connecting');
    this.lastSync = -Infinity;
    const ws = new WebSocket(this.url);
    this.socket = ws;
    const deadline = setTimeout(() => ws.close(), 12000);
    ws.onopen = async () => {
      try {
        const accessToken = await this.options.accessToken?.();
        if (this.stopped || this.socket !== ws || ws.readyState !== WebSocket.OPEN) {
          ws.close();
          return;
        }
        const type = this.session.joined ? 'resume' : this.session.roomId ? 'join' : 'create';
        this.send({
          type,
          version: PROTOCOL_VERSION,
          ...this.session,
          ...(this.options.preloadGame ? { preloadGame: true } : {}),
          ...(accessToken ? { accessToken } : {}),
        });
      } catch {
        if (this.socket !== ws) return;
        this.stop();
        this.emit({ type: 'error', code: 'AUTH_REQUIRED', message: 'Please sign in again' });
      }
    };
    ws.onmessage = (event) => {
      if (this.stopped || this.socket !== ws) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        ws.close(1002, 'Invalid server message');
        return;
      }
      this.lastReceived = performance.now();
      if (message.type === 'welcome') {
        if (message.version !== PROTOCOL_VERSION) {
          this.stop();
          return;
        }
        clearTimeout(deadline);
        this.attempt = 0;
        this.session.roomId = message.state.roomId;
        this.session.joined = true;
        this.options.onSession?.({ ...this.session });
        this.playerId = message.playerId;
        const installed = this.install(message.state);
        this.replayAfterSync = !installed;
        if (!installed) {
          this.metrics.syncIssue ??= 'The server returned an older saved game';
          this.publishMetrics();
          this.sync();
        }
        this.setStatus('connected');
        if (installed && this.pending) this.send(this.pending.message);
        this.probes.clear();
        this.ping();
        clearInterval(this.watchdog);
        this.watchdog = setInterval(() => {
          if (performance.now() - this.lastReceived > 30000) {
            ws.close();
            return;
          }
          this.ping();
        }, this.options.pingIntervalMs ?? 3000);
      } else if (message.type === 'state') {
        if (!this.install(message.state)) return;
        if (this.replayAfterSync) {
          this.replayAfterSync = false;
          if (this.pending) this.send(this.pending.message);
        }
      } else if (message.type === 'ack' && this.pending?.message.commandId === message.commandId) {
        this.pending.ack = message;
        this.finishPending();
        if (this.pending) {
          clearTimeout(this.syncTimer);
          this.syncTimer = setTimeout(() => this.sync(), 800);
        }
      } else if (message.type === 'pong') {
        const sent = this.probes.get(message.nonce);
        if (sent !== undefined) {
          if (message.serverNow !== undefined)
            this.metrics.clockOffsetMs = message.serverNow + (performance.now() - sent) / 2 - Date.now();
          this.probes.delete(message.nonce);
          this.sample(Math.round((performance.now() - sent) * 10) / 10);
        }
        if (message.revision !== undefined) {
          this.metrics.serverRevision = message.revision;
          if ((this.state?.revision ?? -1) < message.revision || this.metrics.syncIssue) this.sync();
        }
      } else if (message.type === 'error') {
        if (message.commandId && this.pending?.message.commandId === message.commandId) {
          this.pending.reject(new Error(`${message.code}: ${message.message}`));
          this.pending = undefined;
          clearTimeout(this.syncTimer);
          this.options.onPending?.(null);
        }
        if (
          [
            'INVALID_SESSION',
            'SEAT_LEFT',
            'LOBBY_REMOVED',
            'ROOM_NOT_FOUND',
            'ROOM_FULL',
            'CAPACITY',
            'VERSION_MISMATCH',
            'AUTH_REQUIRED',
            'AUTH_MISMATCH',
            'GUEST_EXPIRED',
            'ONBOARDING_REQUIRED',
            'ACCOUNT_SETUP_REQUIRED',
            'ACCOUNT_UNAVAILABLE',
            'STATE_INTEGRITY',
          ].includes(message.code) ||
          this.status !== 'connected'
        )
          this.stop();
      }
      this.emit(message);
    };
    ws.onerror = () => {};
    ws.onclose = (event) => {
      clearTimeout(deadline);
      if (this.socket !== ws) return;
      clearInterval(this.watchdog);
      clearTimeout(this.syncTimer);
      if (event.code === 4001 || event.code === 4002) {
        this.stop();
        return;
      }
      if (this.stopped) return;
      this.setStatus('reconnecting');
      this.metrics.reconnects++;
      this.publishMetrics();
      const base = this.options.minRetryMs ?? 250,
        cap = this.options.maxRetryMs ?? 5000;
      const delay = Math.min(cap, base * 2 ** Math.min(this.attempt++, 6)) * (0.8 + Math.random() * 0.4);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }
  private submit(
    operation:
      | Omit<Extract<PendingCommand, { type: 'action' }>, 'commandId' | 'expectedRevision'>
      | Omit<Extract<PendingCommand, { type: 'lobby' }>, 'commandId' | 'expectedRevision'>
      | Omit<Extract<PendingCommand, { type: 'settings' }>, 'commandId' | 'expectedRevision'>
      | { type: 'increment' | 'leave' },
  ): Promise<Ack> {
    if (this.status !== 'connected' || !this.state || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Wait until connected'));
    if (this.pending) return Promise.reject(new Error('An action is already awaiting confirmation'));
    if (this.metrics.syncIssue) return Promise.reject(new Error('Resynchronizing the saved board'));
    const message = {
      ...operation,
      commandId: crypto.randomUUID(),
      expectedRevision: this.state.revision,
    } as PendingCommand;
    return new Promise((resolve, reject) => {
      this.options.onPending?.(message);
      this.pending = { message, resolve, reject };
      this.send(message);
    });
  }
  launchReady(id: string, success: boolean) {
    this.send({ type: 'launchReady', id, success });
  }
  increment() {
    return this.submit({ type: 'increment' });
  }
  action(action: GameAction) {
    return this.submit({ type: 'action', action });
  }
  leave() {
    return this.submit({ type: 'leave' });
  }
  lobby(ready: boolean, profile?: Profile) {
    return this.submit({ type: 'lobby', ready, ...(profile ? { profile } : {}) });
  }
  kick(playerId: string) {
    return this.submit({ type: 'lobby', ready: false, kickPlayerId: playerId });
  }
  settings(settings: RoomSettings) {
    return this.submit({ type: 'settings', settings });
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    clearTimeout(this.syncTimer);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.probes.clear();
    this.pending?.reject(new Error('Connection closed; resume to inspect the saved state before retrying'));
    this.pending = undefined;
    this.setStatus('closed');
  }
}
