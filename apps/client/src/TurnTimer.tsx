import { useEffect, useRef, useState } from 'react';
import { Clock3, Pause } from './GameIcons.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
export function TurnTimer({
  room,
  me,
  offset,
  connected,
  onWarning,
  discard = false,
}: {
  room: RoomState;
  me?: string;
  offset?: number;
  connected: boolean;
  onWarning: () => void;
  discard?: boolean;
}) {
  const [now, setNow] = useState(Date.now),
    fallback = useRef({ server: room.serverNow ?? Date.now(), local: Date.now() }),
    warned = useRef('');
  if (fallback.current.server !== room.serverNow && room.serverNow)
    fallback.current = { server: room.serverNow, local: Date.now() };
  const clock = room.turnClock,
    deadline = discard ? (me ? clock?.discardDeadlines?.[me] : undefined) : clock?.deadlineAt;
  const paused = room.paused || (clock?.pausedAt !== undefined && !discard);
  const serverNow = now + (offset ?? fallback.current.server - fallback.current.local),
    remaining = deadline
      ? Math.max(0, Math.ceil((deadline - (paused ? (clock?.pausedAt ?? serverNow) : serverNow)) / 1000))
      : 0;
  const mine = !!clock && (discard ? !!(me && clock.discardDeadlines?.[me]) : clock.playerId === me);
  const warning = useRef(onWarning);
  warning.current = onWarning;
  useEffect(() => {
    if (!clock) return;
    const interval = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 250);
    return () => clearInterval(interval);
  }, [clock?.turn, deadline]);
  useEffect(() => {
    const key = `${room.roomId}:${clock?.turn}:${deadline}`;
    if (remaining > 0 && remaining <= 10 && mine && !paused && connected && warned.current !== key) {
      warned.current = key;
      warning.current();
    }
  }, [remaining, mine, paused, connected, room.roomId, clock?.turn, deadline]);
  if (!clock || !deadline || !room.game || room.game.winner || room.paused) return null;
  return (
    <span
      className={`turn-timer ${remaining <= 10 && !paused ? 'running-low' : ''} ${paused ? 'paused' : ''}`}
      title={
        !connected
          ? 'Reconnecting; the server clock continues'
          : paused
            ? 'Turn clock paused while players discard'
            : mine
              ? 'Your remaining time'
              : 'Active player’s remaining time'
      }
    >
      {paused ? <Pause size={13} /> : <Clock3 size={13} />}
      <b>{remaining}s</b>
      {paused && <small>Discards</small>}
    </span>
  );
}
