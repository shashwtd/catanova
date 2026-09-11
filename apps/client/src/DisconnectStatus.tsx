import { Clock3 } from './GameIcons.js';

export function reconnectSeconds(deadline: number, serverNow: number) {
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}
export function DisconnectStatus({
  resigned,
  deadline,
  now,
}: {
  resigned?: boolean;
  deadline?: number;
  now: number;
  paused?: boolean;
}) {
  if (resigned) return <span className="profile-absence resigned-label">Resigned</span>;
  if (deadline === undefined) return null;
  const remaining = reconnectSeconds(deadline, now);
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  return (
    <span className="profile-absence" title="Reconnect before this countdown ends to stay in the game">
      <Clock3 size={13} />
      <span>Auto-resign</span>
      <b aria-label={`Auto-resigns in ${remaining} seconds`}>{time}</b>
    </span>
  );
}
