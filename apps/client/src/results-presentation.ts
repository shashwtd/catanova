import type { RoomState } from '../../../packages/protocol/src/index.js';
import { resultsFromRoom } from '../../../packages/protocol/src/results.js';
import type { MatchResults } from '../../../packages/protocol/src/results.js';
/** A spectator may retain the public result already seen, but cannot fetch an archive. */
export function retainedResults(previous: MatchResults | null, room: RoomState | null): MatchResults | null {
  if (!room || (room.game && room.game.phase !== 'finished')) return null;
  if (room.game?.phase === 'finished') return resultsFromRoom(room);
  return room.previousResults ?? (previous?.roomId === room.roomId ? previous : null);
}
