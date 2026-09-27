import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  OnlinePerson,
  PlayerDetail as Detail,
  PlayerMatch,
  PlayerSort,
  PlayersPage,
} from '../../server/src/admin/types.js';
import { api, ApiError, useApi } from '../api.js';
import { accountLabel, count, relative, short, time } from '../format.js';
import { Badge, Empty, Failure, Loading, Section, Stat, When } from '../ui.js';
import type { Tone } from '../ui.js';
import { go } from '../route.js';

const OUTCOME_TONE: Record<string, Tone> = {
  won: 'good',
  lost: 'neutral',
  resigned: 'serious',
  abandoned: 'warning',
  playing: 'accent',
};

const SORT_CHOICES = [
  { value: 'lastSeen:desc', label: 'Last seen, newest' },
  { value: 'lastSeen:asc', label: 'Last seen, oldest' },
  { value: 'games:desc', label: 'Most games' },
  { value: 'wins:desc', label: 'Most wins' },
  { value: 'joined:desc', label: 'First game, newest' },
  { value: 'joined:asc', label: 'First game, oldest' },
  { value: 'name:asc', label: 'Name, A to Z' },
  { value: 'games:asc', label: 'Fewest games' },
  { value: 'wins:asc', label: 'Fewest wins' },
  { value: 'name:desc', label: 'Name, Z to A' },
];

const percentOf = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const unnamed = (name: string | null) => name ?? 'Unnamed account';

function CurrentRoom({ room }: { room: { roomId: string; roomCode?: string } | null }) {
  if (!room) return <span className="muted">—</span>;
  return (
    <a href={`#/games/${room.roomId}`} className="mono">
      {room.roomCode ?? short(room.roomId)}
    </a>
  );
}

/** A game on the player's record, linked to how it went: its own round, or the room's current game. */
export const matchHref = (match: Pick<PlayerMatch, 'roomId' | 'matchId' | 'archived'>) =>
  match.archived ? `#/games/${match.roomId}?round=${match.matchId}` : `#/games/${match.roomId}`;

/** A column header that sorts the list; pressing it again turns the order round. */
function SortHeader({
  label,
  sort,
  current,
  dir,
  onSort,
  className = '',
}: {
  label: string;
  sort: PlayerSort;
  current: PlayerSort;
  dir: 'asc' | 'desc';
  onSort: (sort: PlayerSort, dir: 'asc' | 'desc') => void;
  className?: string;
}) {
  const active = sort === current;
  const next = active ? (dir === 'asc' ? 'desc' : 'asc') : sort === 'name' ? 'asc' : 'desc';
  return (
    <th className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className="sort"
        title={`Sort by ${label.toLowerCase()}`}
        onClick={() => onSort(sort, next)}
      >
        {label}
        <span className="sort-mark" aria-hidden="true">
          {active ? (dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
}

function OnlineDot({ online }: { online: boolean }) {
  return online ? <i className="online-dot" title="Online now" aria-label="online now" /> : null;
}

export function Players({ params }: { params: URLSearchParams }) {
  const q = params.get('q') ?? '';
  const sort = (params.get('sort') ?? 'lastSeen') as PlayerSort;
  const dir = (params.get('dir') ?? (sort === 'name' ? 'asc' : 'desc')) as 'asc' | 'desc';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(sort !== 'lastSeen' ? { sort } : {}),
    ...(params.get('dir') ? { dir } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  });
  const { data, error, loading, reload } = useApi<PlayersPage>(`/api/admin/players?${query}`, 30_000);
  const set = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    if (!('page' in next)) merged.delete('page');
    go('players', undefined, merged);
  };
  const onSort = (next: PlayerSort, nextDir: 'asc' | 'desc') => set({ sort: next, dir: nextDir });
  const header = (label: string, key: PlayerSort, className?: string) => (
    <SortHeader
      label={label}
      sort={key}
      current={sort}
      dir={dir}
      onSort={onSort}
      {...(className ? { className } : {})}
    />
  );
  const now = Date.now();
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="stack">
      <div className="toolbar">
        <form
          className="search"
          role="search"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            set({ q: search.trim() });
          }}
        >
          <input
            type="search"
            value={search}
            maxLength={64}
            placeholder="Name or account id"
            aria-label="Search accounts by any name they used, or the start of their id"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="button">
            Search
          </button>
        </form>
        <label className="sort-by">
          <span className="muted small">Sort by</span>
          <select
            value={`${sort}:${dir}`}
            onChange={(event) => {
              const [nextSort, nextDir] = event.target.value.split(':') as [PlayerSort, 'asc' | 'desc'];
              onSort(nextSort, nextDir);
            }}
          >
            {SORT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {data && !data.presence && (
          <p className="muted small">
            Online means at a room: this server does not report account presence yet.
          </p>
        )}
      </div>
      <Failure error={error} retry={reload} />
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <Empty>{q ? `No accounts match “${q}”.` : 'No accounts yet.'}</Empty>
      ) : (
        <Section
          title={`${count(data.total)} account${data.total === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}`}
          actions={loading ? <span className="muted">Refreshing…</span> : undefined}
          className="wide"
        >
          <div className="table-wrap">
            <table className="stacked players">
              <thead>
                <tr>
                  {header('Name', 'name')}
                  <th className="hide-phone">Account</th>
                  {header('Games', 'games', 'num hide-phone')}
                  {header('Wins', 'wins', 'num hide-phone')}
                  <th className="num hide-phone">Win rate</th>
                  <th className="num hide-phone">Avg points</th>
                  {header('Last seen', 'lastSeen')}
                  {header('First game', 'joined', 'hide-phone')}
                  <th className="hide-phone">Now</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((player) => (
                  <tr key={player.userId}>
                    <td>
                      <OnlineDot online={player.online} />
                      <a href={`#/players/${player.userId}`}>{unnamed(player.name)}</a>
                    </td>
                    <td className="hide-phone muted">{accountLabel(player.accountType) ?? '—'}</td>
                    <td className="num hide-phone">{count(player.games)}</td>
                    <td className="num hide-phone">{count(player.wins)}</td>
                    <td className="num hide-phone">{percentOf(player.winRate)}</td>
                    <td className="num hide-phone">{player.averagePoints ?? '—'}</td>
                    <td className="nowrap cell-end">
                      <When at={player.lastSeen} now={now} />
                    </td>
                    <td className="nowrap hide-phone">
                      <When at={player.firstPlayed} now={now} />
                    </td>
                    <td className="hide-phone">
                      {player.currentRoom ? (
                        <CurrentRoom room={player.currentRoom} />
                      ) : player.online ? (
                        <span className="muted">online</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="show-phone cell-wide muted small">
                      {[
                        accountLabel(player.accountType),
                        `${count(player.games)} game${player.games === 1 ? '' : 's'}`,
                        `${count(player.wins)} won${player.winRate === null ? '' : ` (${percentOf(player.winRate)})`}`,
                        player.firstPlayed === null ? null : `first ${relative(player.firstPlayed, now)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {player.currentRoom && (
                        <>
                          {' · in '}
                          <CurrentRoom room={player.currentRoom} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="pager" aria-label="Pages">
              <button
                type="button"
                className="button"
                disabled={page <= 1}
                onClick={() => set({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="button"
                disabled={page >= pages}
                onClick={() => set({ page: String(page + 1) })}
              >
                Next
              </button>
            </nav>
          )}
          <p className="footnote">
            Win rate counts games with a winner (won, lost or resigned); average points are what those games
            ended with. First game is when the account&rsquo;s first recorded game started.
          </p>
        </Section>
      )}
    </div>
  );
}

function OnlineNow({ person, presence }: { person: OnlinePerson | null; presence: boolean }): ReactNode {
  if (!person) return <span className="muted">{presence ? 'Not online' : 'Not at a room'}</span>;
  const place = person.place;
  const where =
    place.kind === 'hub' ? (
      'in the player hub'
    ) : place.kind === 'lobby' ? (
      <>
        in lobby{' '}
        <CurrentRoom
          room={{ roomId: place.roomId, ...(place.roomCode ? { roomCode: place.roomCode } : {}) }}
        />
      </>
    ) : (
      <>
        {place.atTable ? 'playing ' : 'away from '}
        <CurrentRoom
          room={{ roomId: place.roomId, ...(place.roomCode ? { roomCode: place.roomCode } : {}) }}
        />
      </>
    );
  return (
    <>
      <OnlineDot online /> Online, {where}
      {person.since !== null && (
        <span className="muted">
          {' '}
          · for {relative(person.since).replace(' ago', '')}
          {person.tabs !== null && person.tabs > 1 && ` in ${person.tabs} tabs`}
        </span>
      )}
    </>
  );
}

/** Whether the account's rooms may pick the modes open to testers, and the switch that changes it. */
function TesterSwitch({
  userId,
  tester,
  onChanged,
}: {
  userId: string;
  tester: Detail['tester'];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiError>();
  const toggle = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api(`/api/admin/testers/${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: { tester: !tester },
      });
      onChanged();
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure : new ApiError(0, 'ERROR', 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="footnote tester-line">
        <span>
          {tester ? (
            <>
              A tester: their rooms may pick the <a href="#/modes">modes</a> open to testers
              {tester.source === 'environment' && (
                <>
                  , as <code>production.env</code> says
                </>
              )}
              .
            </>
          ) : (
            <>
              Not a tester: their rooms may pick the <a href="#/modes">modes</a> open to everyone.
            </>
          )}
        </span>
        {tester?.source !== 'environment' && (
          <button type="button" className="button" disabled={busy} onClick={() => void toggle()}>
            {tester ? 'Stop testing' : 'Make tester'}
          </button>
        )}
      </div>
      <Failure error={problem} />
    </>
  );
}

export function PlayerDetail({ userId }: { userId: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/admin/players/${encodeURIComponent(userId)}`, 30_000);
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const now = Date.now();
  const { record } = data;
  return (
    <div className="stack">
      <p>
        <a href="#/players">← Players</a>
      </p>
      <div className="title-row">
        <h1>{unnamed(data.names[0] ?? null)}</h1>
        {data.accountType && (
          <Badge tone={data.accountType === 'guest' ? 'warning' : 'accent'}>
            {accountLabel(data.accountType)}
          </Badge>
        )}
        {data.online && <Badge tone="good">online</Badge>}
        {data.tester && <Badge>tester</Badge>}
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
            <Stat
              label="First game"
              value={<When at={record.firstPlayed} now={now} />}
              hint={time(record.firstPlayed)}
            />
            <Stat label="Playing now" value={<CurrentRoom room={data.currentRoom} />} />
          </div>
          <p className="footnote first-line">
            <OnlineNow person={data.online} presence={data.presence} />
          </p>
          {data.names.length > 1 && (
            <p className="footnote">Also played as {data.names.slice(1).join(', ')}.</p>
          )}
          <TesterSwitch userId={data.userId} tester={data.tester} onChanged={reload} />
        </Section>
        <Section title="Record">
          <div className="stats">
            <Stat label="Games" value={count(record.matches)} hint={`${count(record.playing)} in progress`} />
            <Stat
              label="Won"
              value={count(record.won)}
              hint={`${count(record.lost)} lost · ${count(record.resigned)} resigned`}
            />
            <Stat
              label="Win rate"
              value={percentOf(record.winRate)}
              hint={`of ${count(record.won + record.lost + record.resigned)} with a winner`}
            />
            <Stat label="Average points" value={record.averagePoints ?? '—'} hint="in those games" />
            <Stat label="Abandoned" value={count(record.abandoned)} hint="no winner" />
          </div>
          <p className="footnote">
            From match records. A match from before records existed appears once the player opens their own
            history.
          </p>
        </Section>
      </div>
      <Section title="Recent games" className="wide">
        {data.matches.length ? (
          <div className="table-wrap">
            <table className="stacked matches">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Outcome</th>
                  <th className="num">Points</th>
                  <th className="num hide-phone">Turns</th>
                  <th className="hide-phone">Started</th>
                  <th>Table</th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((match) => (
                  <tr key={match.matchId}>
                    <td className="nowrap">
                      <a href={matchHref(match)} className="mono" title="How this game went">
                        {match.roomCode ?? short(match.roomId)}
                      </a>
                      {match.archived && <span className="muted"> · earlier round</span>}
                    </td>
                    <td>
                      <Badge tone={OUTCOME_TONE[match.outcome] ?? 'neutral'}>{match.outcome}</Badge>
                    </td>
                    <td className="num cell-end">{match.points}</td>
                    <td className="num hide-phone">{match.turns}</td>
                    <td className="nowrap hide-phone">{time(match.startedAt)}</td>
                    <td className="cell-wide">
                      {match.players.map((player, index) => (
                        <span key={index} className="nowrap">
                          {index > 0 && ', '}
                          {player.name} {player.points}
                          {player.winner && ' ★'}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No recorded games.</Empty>
        )}
        <p className="footnote">Each game opens how it went. Points are what the table saw.</p>
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
