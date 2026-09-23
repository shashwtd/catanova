import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PlayerDetail as Detail, PlayerSummary } from '../../server/src/admin/types.js';
import { useApi } from '../api.js';
import { count, short, time } from '../format.js';
import { Badge, Empty, Failure, Loading, Section, Stat, Table, When } from '../ui.js';
import type { Tone } from '../ui.js';
import { go } from '../route.js';

const OUTCOME_TONE: Record<string, Tone> = {
  won: 'good',
  lost: 'neutral',
  resigned: 'serious',
  abandoned: 'warning',
  playing: 'accent',
};

function CurrentRoom({ room }: { room: { roomId: string; roomCode?: string } | null }) {
  if (!room) return <span className="muted">—</span>;
  return (
    <a href={`#/games/${room.roomId}`} className="mono">
      {room.roomCode ?? short(room.roomId)}
    </a>
  );
}

export function Players({ params }: { params: URLSearchParams }) {
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const { data, error, loading, reload } = useApi<{ players: PlayerSummary[] }>(
    q.length >= 2 ? `/api/admin/players?${new URLSearchParams({ q })}` : null,
  );
  const now = Date.now();
  return (
    <div className="stack">
      <form
        className="search"
        role="search"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          go('players', undefined, new URLSearchParams(search.trim() ? { q: search.trim() } : {}));
        }}
      >
        <input
          type="search"
          value={search}
          minLength={2}
          maxLength={64}
          placeholder="Username or account id"
          aria-label="Search accounts by username or account id"
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <Failure error={error} retry={reload} />
      {q.length < 2 ? (
        <Empty>Search by username, or paste the start of an account id.</Empty>
      ) : loading && !data ? (
        <Loading />
      ) : data && data.players.length === 0 ? (
        <Empty>No accounts match “{q}”.</Empty>
      ) : data ? (
        <Section
          title={`${data.players.length} account${data.players.length === 1 ? '' : 's'}`}
          className="wide"
        >
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th className="num">Matches</th>
                <th className="num">Wins</th>
                <th>Last seen</th>
                <th>Playing now</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((player) => (
                <tr key={player.userId}>
                  <td>
                    <a href={`#/players/${player.userId}`}>{player.name}</a>
                  </td>
                  <td>
                    <code className="small">{short(player.userId, 13)}</code>
                    {player.accountType && <span className="muted"> · {player.accountType}</span>}
                  </td>
                  <td className="num">{count(player.matches)}</td>
                  <td className="num">{count(player.wins)}</td>
                  <td className="nowrap">
                    <When at={player.lastSeen} now={now} />
                  </td>
                  <td>
                    <CurrentRoom room={player.currentRoom} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}

export function PlayerDetail({ userId }: { userId: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/admin/players/${encodeURIComponent(userId)}`);
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const now = Date.now();
  return (
    <div className="stack">
      <p>
        <a href="#/players">← Players</a>
      </p>
      <div className="title-row">
        <h1>{data.names[0]}</h1>
        {data.accountType && (
          <Badge tone={data.accountType === 'guest' ? 'warning' : 'accent'}>{data.accountType}</Badge>
        )}
      </div>
      <div className="grid">
        <Section title="Account">
          <div className="stats">
            <Stat label="Account id" value={<code className="small">{data.userId}</code>} />
            <Stat
              label="Last seen"
              value={<When at={data.lastSeen} now={now} />}
              hint={data.sharesLastSeen ? 'shared with friends' : 'hidden from friends'}
            />
            <Stat label="Playing now" value={<CurrentRoom room={data.currentRoom} />} />
            {data.names.length > 1 && <Stat label="Also played as" value={data.names.slice(1).join(', ')} />}
          </div>
        </Section>
        <Section title="Record">
          <div className="stats">
            <Stat label="Matches" value={count(data.record.matches)} />
            <Stat label="Won" value={count(data.record.won)} />
            <Stat label="Lost" value={count(data.record.lost)} />
            <Stat label="Resigned" value={count(data.record.resigned)} />
            <Stat label="Abandoned" value={count(data.record.abandoned)} />
            <Stat label="In progress" value={count(data.record.playing)} />
          </div>
          <p className="footnote">
            From match records. A match from before records existed appears once the player opens their own
            history.
          </p>
        </Section>
      </div>
      <Section title="Recent matches" className="wide">
        {data.matches.length ? (
          <Table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Started</th>
                <th>Finished</th>
                <th className="num">Turns</th>
                <th>Outcome</th>
                <th className="num">Points</th>
                <th>Table</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((match) => (
                <tr key={match.matchId}>
                  <td>
                    <a href={`#/games/${match.roomId}`} className="mono">
                      {match.roomCode ?? short(match.roomId)}
                    </a>
                    {match.archived && <span className="muted"> · earlier round</span>}
                  </td>
                  <td className="nowrap">{time(match.startedAt)}</td>
                  <td className="nowrap">{time(match.finishedAt)}</td>
                  <td className="num">{match.turns}</td>
                  <td>
                    <Badge tone={OUTCOME_TONE[match.outcome] ?? 'neutral'}>{match.outcome}</Badge>
                  </td>
                  <td className="num">{match.points}</td>
                  <td>
                    {match.players
                      .map((player) => `${player.name} ${player.points}${player.winner ? ' ★' : ''}`)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No recorded matches.</Empty>
        )}
      </Section>
      <div className="grid">
        <Section title="Recent seats">
          {data.seats.length ? (
            <ul className="plain">
              {data.seats.map((seat) => (
                <li key={`${seat.roomId}-${seat.name}`}>
                  <a href={`#/games/${seat.roomId}`} className="mono">
                    {seat.roomCode ?? short(seat.roomId)}
                  </a>{' '}
                  as {seat.name}
                  {seat.departed && <span className="muted"> · left</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No seats.</Empty>
          )}
        </Section>
        <Section title="Feedback sent">
          {data.feedback.length ? (
            <ul className="plain">
              {data.feedback.map((item) => (
                <li key={item.id}>
                  <a href={`#/feedback?status=all`}>#{item.id}</a> {item.category} ·{' '}
                  <When at={item.at} now={now} /> · {item.status}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Section>
      </div>
    </div>
  );
}
