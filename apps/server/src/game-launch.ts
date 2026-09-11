import type { RoomState } from '../../../packages/protocol/src/index.js';
import { ProtocolError } from './store.js';

export const LAUNCH_MIN_MS = 2_000;
export const LAUNCH_LIMIT_MS = 10_000;
export type LaunchRequest = { roomId: string; hostId: string; commandId: string; revision: number };
type Pending = LaunchRequest & { startedAt: number; players: string[]; ready: Set<string> };

/** Readiness is temporary coordination. The game itself starts in one ordinary persisted command. */
export class GameLaunch {
  private pending = new Map<string, Pending>();
  private cancelled = new Map<string, number>();
  private key(request: LaunchRequest) {
    return `${request.roomId}:${request.hostId}:${request.commandId}`;
  }
  constructor(
    private dependencies: {
      now: () => number;
      state: (roomId: string) => RoomState;
      commit: (request: LaunchRequest) => void;
      changed: (roomId: string) => void;
      failed: (request: LaunchRequest, message: string) => void;
    },
  ) {}
  view(roomId: string): RoomState['launch'] {
    const launch = this.pending.get(roomId);
    return (
      launch && {
        id: launch.commandId,
        startedAt: launch.startedAt,
        deadlineAt: launch.startedAt + LAUNCH_LIMIT_MS,
        readyPlayers: [...launch.ready],
      }
    );
  }
  begin(request: LaunchRequest) {
    for (const [key, at] of this.cancelled)
      if (this.dependencies.now() - at > 30 * 60_000) this.cancelled.delete(key);
    if (this.cancelled.has(this.key(request)))
      throw new ProtocolError('LAUNCH_CANCELLED', 'That start was cancelled. Press Start again.');
    const old = this.pending.get(request.roomId);
    if (old) {
      if (
        old.hostId === request.hostId &&
        old.commandId === request.commandId &&
        old.revision === request.revision
      )
        return; // Socket replay cannot extend a deadline or start a second launch.
      throw new ProtocolError('GAME_LOADING', 'The island is already loading');
    }
    const state = this.dependencies.state(request.roomId);
    if (state.game) throw new ProtocolError('GAME_STARTED', 'This game is already underway');
    if (state.revision !== request.revision)
      throw new ProtocolError('STALE_STATE', 'The room changed; try again');
    if (state.players[0]?.id !== request.hostId)
      throw new ProtocolError('NOT_HOST', 'Only the host can start');
    if (state.players.length < 2) throw new ProtocolError('NOT_ENOUGH_PLAYERS', 'Invite at least one player');
    if (state.players.some((p) => !p.connected))
      throw new ProtocolError('NOT_CONNECTED', 'Wait for everyone to reconnect');
    if (state.players.slice(1).some((p) => !p.ready))
      throw new ProtocolError('NOT_READY', 'Wait for everyone to be ready');
    this.pending.set(request.roomId, {
      ...request,
      startedAt: this.dependencies.now(),
      players: state.players.map((p) => p.id),
      ready: new Set(),
    });
    this.dependencies.changed(request.roomId);
  }
  ready(roomId: string, playerId: string, id: string, success: boolean) {
    const launch = this.pending.get(roomId);
    if (!launch || launch.commandId !== id || !launch.players.includes(playerId)) return;
    if (!success)
      return this.cancel(roomId, 'A player could not load the island. Retry when everyone is ready.');
    if (launch.ready.has(playerId)) return;
    launch.ready.add(playerId);
    this.dependencies.changed(roomId);
    this.tick();
  }
  cancel(roomId: string, message = 'The room changed while loading. Start again when everyone is ready.') {
    const launch = this.pending.get(roomId);
    if (!launch) return;
    this.pending.delete(roomId);
    this.cancelled.set(this.key(launch), this.dependencies.now());
    if (this.cancelled.size > 2000) this.cancelled.delete(this.cancelled.keys().next().value!);
    this.dependencies.failed(launch, message);
    this.dependencies.changed(roomId);
  }
  tick() {
    for (const launch of this.pending.values()) {
      try {
        const state = this.dependencies.state(launch.roomId);
        if (
          state.game ||
          state.revision !== launch.revision ||
          state.players.length !== launch.players.length ||
          state.players.some((p, i) => p.id !== launch.players[i] || !p.connected)
        ) {
          this.cancel(launch.roomId);
          continue;
        }
        const elapsed = this.dependencies.now() - launch.startedAt;
        if (elapsed >= LAUNCH_LIMIT_MS) {
          this.cancel(launch.roomId, 'Loading took too long. Check your connection, then try again.');
        } else if (elapsed >= LAUNCH_MIN_MS && launch.ready.size === launch.players.length) {
          this.pending.delete(launch.roomId);
          this.dependencies.commit(launch);
        }
      } catch {
        // A failed commit never reports success; the Store keeps its previous transaction intact.
        this.pending.delete(launch.roomId);
        this.cancelled.set(this.key(launch), this.dependencies.now());
        if (this.cancelled.size > 2000) this.cancelled.delete(this.cancelled.keys().next().value!);
        this.dependencies.failed(launch, 'The game could not start. Reconnect and try again.');
        this.dependencies.changed(launch.roomId);
      }
    }
  }
  clear() {
    this.pending.clear();
    this.cancelled.clear();
  }
}
