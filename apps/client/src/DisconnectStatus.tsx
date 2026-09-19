import { Bot, Clock3 } from './GameIcons.js';

export function reconnectSeconds(deadline: number, serverNow: number) {
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

/**
 * What an empty chair says.
 *
 * There are three of them and they mean different things. A resigned player is
 * gone. A player whose seat a bot is holding is only away — their pieces, hand
 * and points are exactly where they left them — so the mark says who is playing
 * rather than counting down to a punishment. The countdown is left for the one
 * case where it is still true: nobody at all is at the table, and the match
 * will be filed as abandoned when it runs out.
 */
export function DisconnectStatus({
  resigned,
  standIn,
  deadline,
  now,
  paused,
}: {
  resigned?: boolean;
  standIn?: boolean;
  deadline?: number;
  now: number;
  paused?: boolean;
}) {
  if (resigned) return <span className="profile-absence resigned-label">Resigned</span>;
  if (standIn)
    return (
      <span
        className="profile-absence is-standin"
        title="A bot is playing this seat until they reconnect. Their pieces and cards are untouched."
      >
        <Bot size={13} />
        <span>Bot playing</span>
      </span>
    );
  if (deadline === undefined) return null;
  const remaining = reconnectSeconds(deadline, now);
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  if (!paused)
    return (
      <span className="profile-absence" title="A bot takes this seat shortly, and hands it back on return">
        <Clock3 size={13} />
        <span>Away</span>
        <b aria-label={`Away for ${remaining} seconds`}>{time}</b>
      </span>
    );
  return (
    <span className="profile-absence" title="Nobody is at this table. The match closes when this runs out">
      <Clock3 size={13} />
      <span>Abandoned in</span>
      <b aria-label={`The match is abandoned in ${remaining} seconds`}>{time}</b>
    </span>
  );
}
