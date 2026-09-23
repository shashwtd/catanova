/**
 * The tab's presence socket. It keeps a signed-in player online for as long as
 * Catanova is open, in front or not, and hears friends arrive and leave the
 * moment they do (see apps/server/src/presence-hub.ts).
 *
 * It reconnects by itself with backoff, and at once when the tab comes back or
 * the network returns. Coming back also checks that a socket which still looks
 * open is really alive: a phone that slept can leave one silently dead. While
 * it is down the caller falls back to the older HTTP heartbeat, so presence
 * never rests on this socket alone.
 */
import { PROTOCOL_VERSION } from '../../../packages/protocol/src/index.js';
import type { ServerMessage } from '../../../packages/protocol/src/index.js';
import type { FriendPresenceChange } from '../../../packages/protocol/src/player-hub.js';

/** How often a connected socket asks for a pong. Background tabs may stretch it to a minute. */
export const PRESENCE_PING_MS = 30_000;
/** Heard nothing for this long: the connection is dead even if the browser has not said so. */
export const PRESENCE_SILENCE_MS = 150_000;
/** After the tab or network comes back, a live socket answers within this. */
export const PRESENCE_PROBE_MS = 8_000;
export const PRESENCE_AUTH_CHECK_MS = 30_000;

type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>;
type Events = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export type PresenceSocketOptions = {
  url: string;
  /** The current sign-in token; none means not signed in right now, so try again later. */
  accessToken: () => Promise<string | undefined>;
  onFriend: (change: FriendPresenceChange) => void;
  onConnected?: (connected: boolean) => void;
  WebSocket?: typeof WebSocket;
  timers?: Timers;
  /** Where `online` fires, and the document whose visibility wakes the socket. */
  window?: Events;
  document?: Events & Pick<Document, 'visibilityState'>;
  clock?: () => number;
  minRetryMs?: number;
  maxRetryMs?: number;
};

export class PresenceSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private connected = false;
  private attempt = 0;
  private lastHeard = 0;
  /** Messages received, so a probe knows whether anything came back after it asked. */
  private heard = 0;
  private offered: string | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private authCheck: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: PresenceSocketOptions) {}

  private get timers(): Timers {
    return this.options.timers ?? globalThis;
  }
  private now() {
    return (this.options.clock ?? (() => performance.now()))();
  }

  get isConnected() {
    return this.connected;
  }

  start() {
    this.options.window?.addEventListener('online', this.wake);
    this.options.document?.addEventListener('visibilitychange', this.wake);
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.options.window?.removeEventListener('online', this.wake);
    this.options.document?.removeEventListener('visibilitychange', this.wake);
    this.timers.clearTimeout(this.retryTimer);
    this.clearLive();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setConnected(false);
  }

  /** The tab came back or the network returned: reconnect now, or prove the open socket still works. */
  private readonly wake = () => {
    if (this.stopped || this.options.document?.visibilityState === 'hidden') return;
    const socket = this.socket;
    if (!socket) {
      this.timers.clearTimeout(this.retryTimer);
      this.attempt = 0;
      this.connect();
      return;
    }
    if (!this.connected || this.probeTimer !== undefined) return;
    const before = this.heard;
    this.ping(socket);
    this.probeTimer = this.timers.setTimeout(() => {
      this.probeTimer = undefined;
      if (this.socket === socket && this.heard === before) socket.close();
    }, PRESENCE_PROBE_MS);
  };

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.options.onConnected?.(connected);
  }

  private clearLive() {
    this.timers.clearInterval(this.pinger);
    this.timers.clearInterval(this.authCheck);
    this.timers.clearTimeout(this.probeTimer);
    this.pinger = this.authCheck = this.probeTimer = undefined;
  }

  private ping(socket: WebSocket) {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping', nonce: crypto.randomUUID() }));
  }

  private connect() {
    if (this.stopped) return;
    const Socket = this.options.WebSocket ?? WebSocket;
    const socket = new Socket(this.options.url);
    this.socket = socket;
    socket.onopen = async () => {
      let token: string | undefined;
      try {
        token = await this.options.accessToken();
      } catch {
        token = undefined;
      }
      if (this.stopped || this.socket !== socket || socket.readyState !== 1) return;
      if (!token) {
        socket.close();
        return;
      }
      this.offered = token;
      socket.send(JSON.stringify({ type: 'presence', version: PROTOCOL_VERSION, accessToken: token }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastHeard = this.now();
      this.heard++;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'presence') {
        this.attempt = 0;
        this.setConnected(true);
        this.keepAlive(socket);
      } else if (message.type === 'friend') this.options.onFriend(message.friend);
      else if (message.type === 'error') {
        // A server without accounts will never accept one; anything else is worth another try.
        if (message.code === 'ACCOUNT_SETUP_REQUIRED') this.stop();
        else socket.close();
      }
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearLive();
      this.setConnected(false);
      if (this.stopped) return;
      const base = this.options.minRetryMs ?? 1000,
        cap = this.options.maxRetryMs ?? 30_000;
      const delay = Math.min(cap, base * 2 ** Math.min(this.attempt++, 5)) * (0.8 + Math.random() * 0.4);
      this.retryTimer = this.timers.setTimeout(() => this.connect(), delay);
    };
  }

  private keepAlive(socket: WebSocket) {
    this.clearLive();
    this.pinger = this.timers.setInterval(() => {
      if (this.now() - this.lastHeard > PRESENCE_SILENCE_MS) socket.close();
      else this.ping(socket);
    }, PRESENCE_PING_MS);
    // The socket closes when its sign-in expires unless it is offered the refreshed one.
    this.authCheck = this.timers.setInterval(() => {
      void this.options
        .accessToken()
        .then((token) => {
          if (!token || token === this.offered || this.socket !== socket || socket.readyState !== 1) return;
          this.offered = token;
          socket.send(JSON.stringify({ type: 'auth', accessToken: token }));
        })
        .catch(() => {});
    }, PRESENCE_AUTH_CHECK_MS);
  }
}
