import { PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';
import type { ClientMessage, RoomState, ServerMessage, Session } from '../../../packages/protocol/src/index.js';
import type { GameAction } from '../../../packages/rules/src/game.js';

type Ack = Extract<ServerMessage, { type: 'ack' }>;
export type PendingCommand = Extract<ClientMessage, { type: 'increment' | 'action' }>;
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export function newSession(name: string, roomId?: string): Session {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { name, ...(roomId ? { roomId } : {}), token: Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('') };
}

/** Browser-compatible transport. Store the session privately before connecting. */
export class Connection {
  state: RoomState | null = null;
  playerId: string | null = null;
  status: ConnectionStatus = 'idle';
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private lastReceived = 0;
  private pending?: { message: PendingCommand; resolve: (ack: Ack) => void; reject: (error: Error) => void };
  private listeners = new Set<(message: ServerMessage) => void>();
  constructor(readonly url: string, readonly session: Session, private options: {
    onStatus?: (status: ConnectionStatus) => void;
    onSession?: (session: Session) => void;
    onPending?: (command: PendingCommand | null) => void;
    pending?: PendingCommand;
    minRetryMs?: number;
    maxRetryMs?: number;
  } = {}) {
    if (options.pending) this.pending = { message: options.pending, resolve: () => {}, reject: () => {} };
  }
  get awaitingConfirmation() { return !!this.pending; }
  subscribe(listener: (message: ServerMessage) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private setStatus(status: ConnectionStatus) { this.status = status; this.options.onStatus?.(status); }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.options.onSession?.({ ...this.session });
    this.connect();
  }
  private connect() {
    if (this.stopped) return;
    this.setStatus(this.session.joined ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.socket = ws;
    const deadline = setTimeout(() => ws.close(), 6000);
    ws.onopen = () => {
      if (this.stopped) { ws.close(); return; }
      const type = this.session.joined ? 'resume' : this.session.roomId ? 'join' : 'create';
      ws.send(JSON.stringify({ type, version: PROTOCOL_VERSION, ...this.session }));
    };
    ws.onmessage = event => {
      if (this.stopped || this.socket !== ws) return;
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)) as ServerMessage; }
      catch { ws.close(1002, 'Invalid server message'); return; }
      this.lastReceived = Date.now();
      if (message.type === 'welcome') {
        if (message.version !== PROTOCOL_VERSION) { this.stop(); return; }
        clearTimeout(deadline); this.attempt = 0;
        this.session.roomId = message.state.roomId; this.session.joined = true;
        this.options.onSession?.({ ...this.session });
        this.playerId = message.playerId; this.state = message.state;
        this.setStatus('connected');
        if (this.pending) ws.send(JSON.stringify(this.pending.message));
        clearInterval(this.watchdog);
        this.watchdog = setInterval(() => {
          if (Date.now() - this.lastReceived > 30000) { ws.close(); return; }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', nonce: crypto.randomUUID() }));
        }, 10000);
      } else if (message.type === 'state') {
        if (!this.state || message.state.revision >= this.state.revision) this.state = message.state;
      } else if (message.type === 'ack' && this.pending?.message.commandId === message.commandId) {
        this.pending.resolve(message); this.pending = undefined; this.options.onPending?.(null);
      } else if (message.type === 'error') {
        if (message.commandId && this.pending?.message.commandId === message.commandId) {
          this.pending.reject(new Error(`${message.code}: ${message.message}`)); this.pending = undefined; this.options.onPending?.(null);
        }
        if (['INVALID_SESSION', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'CAPACITY', 'VERSION_MISMATCH'].includes(message.code) || this.status !== 'connected') this.stop();
      }
      for (const listener of this.listeners) listener(message);
    };
    ws.onerror = () => { /* onclose drives retries; never treat an error as an accepted move. */ };
    ws.onclose = event => {
      clearTimeout(deadline); clearInterval(this.watchdog);
      if (event.code === 4001) { this.stop(); return; }
      if (this.stopped) return;
      this.setStatus('reconnecting');
      const base = this.options.minRetryMs ?? 250;
      const cap = this.options.maxRetryMs ?? 5000;
      const delay = Math.min(cap, base * 2 ** Math.min(this.attempt++, 6)) * (0.8 + Math.random() * 0.4);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }
  private submit(action?: GameAction): Promise<Ack> {
    if (this.status !== 'connected' || !this.state || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Wait until connected'));
    if (this.pending) return Promise.reject(new Error('An action is already awaiting confirmation'));
    const common = { commandId: crypto.randomUUID(), expectedRevision: this.state.revision };
    const message: PendingCommand = action ? { type: 'action', ...common, action } : { type: 'increment', ...common };
    return new Promise((resolve, reject) => {
      // Persist intent before the network write, including across full page reloads.
      this.options.onPending?.(message);
      this.pending = { message, resolve, reject };
      this.socket!.send(JSON.stringify(message));
    });
  }
  increment() { return this.submit(); }
  action(action: GameAction) { return this.submit(action); }
  stop() {
    this.stopped = true; clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    this.socket?.close(); this.socket = null;
    this.pending?.reject(new Error('Connection closed; resume to inspect the saved state before retrying'));
    this.pending = undefined;
    this.setStatus('closed');
  }
}
