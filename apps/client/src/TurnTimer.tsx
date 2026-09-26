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
  goldPicker,
}: {
  room: RoomState;
  me?: string;
  offset?: number;
  connected: boolean;
  onWarning: () => void;
  discard?: boolean;
  /** Open Sea: the player picking from a gold field, whose own 20 seconds this shows instead of the turn's. */
  goldPicker?: string;
}) {
  const [now, setNow] = useState(Date.now),
    fallback = useRef({ server: room.serverNow ?? Date.now(), local: Date.now() }),
    warned = useRef('');
  if (fallback.current.server !== room.serverNow && room.serverNow)
    fallback.current = { server: room.serverNow, local: Date.now() };
  const clock = room.turnClock,
    deadline = goldPicker
      ? clock?.goldDeadlines?.[goldPicker]
      : discard
        ? me
          ? clock?.discardDeadlines?.[me]
          : undefined
        : clock?.deadlineAt;
  const paused = room.paused || (clock?.pausedAt !== undefined && !discard && !goldPicker);
  const serverNow = now + (offset ?? fallback.current.server - fallback.current.local),
    remaining = deadline
      ? Math.max(0, Math.ceil((deadline - (paused ? (clock?.pausedAt ?? serverNow) : serverNow)) / 1000))
      : 0;
  const mine =
    !!clock &&
    (goldPicker
      ? goldPicker === me
      : discard
        ? !!(me && clock.discardDeadlines?.[me])
        : clock.playerId === me);
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
  // Open Sea's gold picks pause the turn as discards do; their own 20 seconds are the picker's.
  const picking = room.game.phase === 'goldPick';
  return (
    <span
      className={`turn-timer ${remaining <= 10 && !paused ? 'running-low' : ''} ${paused ? 'paused' : ''}`}
      title={
        !connected
          ? 'Reconnecting; the server clock continues'
          : paused
            ? picking
              ? 'Turn clock paused while players pick from a gold field'
              : 'Turn clock paused while players discard'
            : goldPicker
              ? mine
                ? 'Your time to pick from the gold field'
                : 'Time left to pick from the gold field'
              : mine
                ? 'Your remaining time'
                : 'Active player’s remaining time'
      }
    >
      {paused ? <Pause size={13} /> : <Clock3 size={13} />}
      <b>{remaining}s</b>
      {paused && <small>{picking ? 'Gold picks' : 'Discards'}</small>}
    </span>
  );
}
