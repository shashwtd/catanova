import { useEffect, useRef, useState } from 'react';
import { Clock3, Pause } from 'lucide-react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
export function TurnTimer({
  room,
  me,
  offset,
  connected,
  onWarning,
}: {
  room: RoomState;
  me?: string;
  offset?: number;
  connected: boolean;
  onWarning: () => void;
}) {
  const [now, setNow] = useState(Date.now),
    fallback = useRef({ server: room.serverNow ?? Date.now(), local: Date.now() }),
    warned = useRef('');
  if (fallback.current.server !== room.serverNow && room.serverNow)
    fallback.current = { server: room.serverNow, local: Date.now() };
  const clock = room.turnClock,
    deadline = (me && clock?.discardDeadlines?.[me]) || clock?.deadlineAt;
  const paused = !!clock?.pausedAt && !(me && clock.discardDeadlines?.[me]);
  const serverNow = now + (offset ?? fallback.current.server - fallback.current.local),
    remaining = deadline
      ? Math.max(0, Math.ceil((deadline - (paused ? clock!.pausedAt! : serverNow)) / 1000))
      : 0;
  const mine = !!clock && (clock.playerId === me || !!(me && clock.discardDeadlines?.[me]));
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
  if (!clock || !room.game || room.game.winner) return null;
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
