/** The pieces every admin API module shares with the listener. */
import type { Store } from '../store.js';
import type { AdminConfig } from './config.js';
import type { AdminAudit, AuditInput } from './audit.js';
import type { AuthRejection } from './types.js';

/** What the game server exposes to the admin listener: live socket counts and a way to push a room. */
export type GameRuntime = {
  sockets(): { total: number; players: number; spectators: number; seats: string[] };
  broadcast(roomId: string): void;
};

/** A refusal with a status and a stable code, safe to show to the admin. */
export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export type ApiRequest = {
  actor: string;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Writes an audit row for this request. Call it inside the change's transaction. */
  audit: (entry: Omit<AuditInput, 'at' | 'actor' | 'ip' | 'requestId'>) => number;
  requestId: string;
  ip: string | null;
  ray: string | null;
};

export type ApiRoute = {
  method: 'GET' | 'POST';
  path: RegExp;
  handle: (request: ApiRequest) => unknown;
};

export type AdminContext = {
  config: AdminConfig;
  store: Store;
  runtime: GameRuntime;
  audit: AdminAudit;
  databasePath: string;
  now: () => number;
  rejections: () => AuthRejection[];
};
