/**
 * The page to glance at: who is online and where, what is being played, the
 * day's and week's games, how the server has been doing, and anything the
 * host or the error log needs looked at. System and the other tabs hold the
 * detail.
 */
import { useMemo, useState } from 'react';
import type {
  AdminOverview,
  LiveGame,
  MetricsHistory,
  MetricsRange,
  OnlinePerson,
} from '../../server/src/admin/types.js';
import { useApi } from '../api.js';
import {
  accountLabel,
  bytes,
  clock,
  count,
  dayClock,
  duration,
  localWindows,
  phaseLabel,
  relative,
  short,
  time,
  timeTicks,
} from '../format.js';
import { Badge, Empty, Failure, LineChart, Loading, Notice, Section, Tabs, When } from '../ui.js';
import type { LineSeries } from '../ui.js';
import { SeatChip, StatusBadge } from './Games.js';
import { HostReportLines } from './HostReports.js';

const ONLINE_SHOWN = 12;

function Kpi({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | null;
  hint?: string;
  href?: string;
}) {
  const shown = value === null ? '—' : count(value);
  return (
    <div className="kpi">
      <span className="stat-label">{label}</span>
      <span className="kpi-value">{href && value !== null ? <a href={href}>{shown}</a> : shown}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function RoomLink({ roomId, roomCode }: { roomId: string; roomCode: string | null }) {
  return (
    <a href={`#/games/${roomId}`} className="mono">
      {roomCode ?? short(roomId)}
    </a>
  );
}

function Where({ person }: { person: OnlinePerson }) {
  const place = person.place;
  if (place.kind === 'hub') return <span className="muted">Player hub</span>;
  if (place.kind === 'lobby')
    return (
      <>
        Lobby <RoomLink roomId={place.roomId} roomCode={place.roomCode} />
      </>
    );
  if (!place.atTable)
    return (
      <>
        Seated in <RoomLink roomId={place.roomId} roomCode={place.roomCode} />
        <span className="muted"> · away from the table</span>
      </>
    );
  return (
    <>
      {place.status === 'finished' ? 'At the finished table' : 'Playing'}{' '}
      <RoomLink roomId={place.roomId} roomCode={place.roomCode} />
      {place.turn !== null && place.status !== 'finished' && (
        <span className="muted"> · turn {place.turn}</span>
      )}
      {place.status === 'paused' && <span className="muted"> · paused</span>}
    </>
  );
}

function WhoIsOnline({ data }: { data: AdminOverview }) {
  const [all, setAll] = useState(false);
  const { people, accounts } = data.online;
  const shown = all ? people : people.slice(0, ONLINE_SHOWN);
  return (
    <Section title={`Who's online (${count(data.online.counts.online)})`}>
      {!accounts && (
        <p className="footnote first">
          This server does not report account presence yet, so only people connected to a room are listed.
        </p>
      )}
      {people.length ? (
        <>
          <table className="compact stacked online">
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th>Where</th>
                <th>Online for</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((person) => (
                <tr key={person.userId ?? person.seatId ?? person.name}>
                  <td>
                    {person.userId ? <a href={`#/players/${person.userId}`}>{person.name}</a> : person.name}
                    {person.tabs !== null && person.tabs > 1 && (
                      <span className="muted"> · {person.tabs} tabs</span>
                    )}
                  </td>
                  <td className="muted">{accountLabel(person.accountType) ?? 'Local player'}</td>
                  <td className="cell-wide">
                    <Where person={person} />
                  </td>
                  <td className="nowrap cell-end muted">
                    {person.since === null ? '—' : relative(person.since, data.now).replace(' ago', '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {people.length > ONLINE_SHOWN && (
            <p className="more">
              <button type="button" className="link-button" onClick={() => setAll(!all)}>
                {all ? 'Show fewer' : `Show all ${count(people.length)}`}
              </button>
            </p>
          )}
        </>
      ) : (
        <Empty>Nobody is online right now.</Empty>
      )}
      {data.online.counts.spectators > 0 && (
        <p className="footnote">
          And {count(data.online.counts.spectators)} spectator
          {data.online.counts.spectators === 1 ? '' : 's'} watching a game.
        </p>
      )}
    </Section>
  );
}

function LiveGames({ data }: { data: AdminOverview }) {
  const total = 'error' in data.rooms ? null : data.rooms.live + data.rooms.paused;
  return (
    <Section
      title={`Live games${total === null ? '' : ` (${count(total)})`}`}
      actions={<a href="#/games?status=live">All games</a>}
    >
      {data.liveGames.length ? (
        <>
          <table className="compact stacked live-games">
            <thead>
              <tr>
                <th>Room</th>
                <th>Players</th>
                <th>Turn</th>
                <th>Running</th>
              </tr>
            </thead>
            <tbody>
              {data.liveGames.map((game: LiveGame) => (
                <tr key={game.roomId}>
                  <td className="nowrap">
                    <RoomLink roomId={game.roomId} roomCode={game.roomCode} />
                    {game.status === 'paused' && (
                      <>
                        {' '}
                        <StatusBadge status="paused" />
                      </>
                    )}
                  </td>
                  <td className="cell-wide">
                    <div className="seats">
                      {game.players.map((seat) => (
                        <SeatChip key={seat.id} seat={seat} points={seat.points} />
                      ))}
                    </div>
                  </td>
                  <td className="cell-wide">
                    <div className="nowrap">Turn {game.turn}</div>
                    <div className="muted small">
                      {phaseLabel(game.phase)}
                      {game.target !== 10 && ` · first to ${game.target}`}
                    </div>
                  </td>
                  <td className="nowrap cell-end">
                    <div>{game.startedAt === null ? '—' : duration((data.now - game.startedAt) / 1000)}</div>
                    <div className="muted small">
                      moved <When at={game.lastActivity} now={data.now} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total !== null && total > data.liveGames.length && (
            <p className="more">
              <a href="#/games?status=live">{count(total - data.liveGames.length)} more in Games</a>
            </p>
          )}
        </>
      ) : (
        <Empty>No games being played right now.</Empty>
      )}
    </Section>
  );
}

const RANGES: { value: MetricsRange; label: string; ms: number }[] = [
  { value: '1h', label: '1 h', ms: 3_600_000 },
  { value: '6h', label: '6 h', ms: 6 * 3_600_000 },
  { value: '24h', label: '24 h', ms: 24 * 3_600_000 },
];

const mb = (value: number) => Math.round((value / 1048576) * 10) / 10;

/** Every plotted value, minute by minute: the charts' table view. */
function PerformanceTable({
  samples,
  label,
}: {
  samples: MetricsHistory['samples'];
  label: (at: number) => string;
}) {
  return (
    <details className="chart-table">
      <summary>Show the numbers</summary>
      <div className="chart-table-scroll">
        <table className="compact">
          <caption className="sr-only">Performance samples, newest first</caption>
          <thead>
            <tr>
              <th>Time</th>
              <th className="num">Delay p99 (ms)</th>
              <th className="num">CPU (%)</th>
              <th className="num">Resident (MB)</th>
              <th className="num">Heap (MB)</th>
              <th className="num">Sockets</th>
              <th className="num">Online</th>
              <th className="num">Playing</th>
            </tr>
          </thead>
          <tbody>
            {[...samples].reverse().map((sample) => (
              <tr key={sample.at}>
                <td className="nowrap">{label(sample.at)}</td>
                <td className="num">{sample.loopP99Ms}</td>
                <td className="num">{sample.cpuPercent}</td>
                <td className="num">{mb(sample.rssBytes)}</td>
                <td className="num">{mb(sample.heapUsedBytes)}</td>
                <td className="num">{sample.sockets}</td>
                <td className="num">{sample.online ?? '—'}</td>
                <td className="num">{sample.playing ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Performance({ data }: { data: AdminOverview }) {
  const [range, setRange] = useState<MetricsRange>('1h');
  const history = useApi<MetricsHistory>(`/api/admin/metrics?range=${range}`, 60_000);
  const metrics = history.data;
  const span = RANGES.find((option) => option.value === range)!.ms;
  const to = metrics?.now ?? data.now;
  const from = to - span;
  const samples = metrics?.samples ?? [];
  const x = samples.map((sample) => sample.at);
  const ticks = useMemo(() => timeTicks(from, to), [from, to]);
  const markers = metrics && metrics.since > from ? [{ x: metrics.since, label: 'server started' }] : [];
  const perPoint = metrics ? `${metrics.bucketSeconds / 60} min` : '1 min';
  const pointLabel = range === '24h' ? dayClock : clock;
  const chart = (
    label: string,
    yTitle: string,
    series: LineSeries[],
    format: (value: number) => string,
    integer = false,
  ) => (
    <LineChart
      label={label}
      x={x}
      series={series}
      domain={[from, to]}
      ticks={ticks}
      tickLabel={clock}
      pointLabel={pointLabel}
      format={format}
      xTitle="Time"
      yTitle={yTitle}
      gapAfter={(metrics?.bucketSeconds ?? 60) * 2500}
      area={series.length === 1}
      markers={markers}
      integer={integer}
      height={130}
      table={false}
    />
  );
  const window = data.performance.window;
  return (
    <Section
      title="Performance"
      className="wide"
      actions={
        <Tabs
          label="Time range"
          value={range}
          onChange={setRange}
          options={RANGES.map((option) => ({ value: option.value, label: option.label }))}
        />
      }
    >
      <Failure error={history.error} retry={history.reload} />
      {metrics && !samples.length && (
        <Notice>
          No samples yet: the first is taken a minute after the server starts, then one every minute.
        </Notice>
      )}
      <div className="minis">
        <div>
          <div className="mini-head">
            <h3>Event-loop delay</h3>
            <span className="mini-now">{window.eventLoop.p99Ms} ms p99 now</span>
          </div>
          {chart(
            'Event-loop delay: the worst 1% of timer waits (p99) in each minute, in milliseconds',
            'ms',
            [{ name: 'p99 delay', slot: 1, values: samples.map((sample) => sample.loopP99Ms) }],
            (value) => `${value} ms`,
          )}
        </div>
        <div>
          <div className="mini-head">
            <h3>CPU</h3>
            <span className="mini-now">{window.cpuPercent}% now</span>
          </div>
          {chart(
            'Process CPU use, as a share of one core, averaged over each minute',
            '% of a core',
            [{ name: 'CPU', slot: 1, values: samples.map((sample) => sample.cpuPercent) }],
            (value) => `${value}%`,
          )}
        </div>
        <div>
          <div className="mini-head">
            <h3>Memory</h3>
            <span className="mini-now">{bytes(data.performance.rssBytes)} now</span>
          </div>
          {chart(
            'Memory: resident size and JavaScript heap in use, in megabytes',
            'MB',
            [
              { name: 'Resident', slot: 1, values: samples.map((sample) => mb(sample.rssBytes)) },
              { name: 'Heap used', slot: 2, values: samples.map((sample) => mb(sample.heapUsedBytes)) },
            ],
            (value) => `${value} MB`,
          )}
        </div>
        <div>
          <div className="mini-head">
            <h3>Sockets</h3>
            <span className="mini-now">{count(data.performance.sockets)} now</span>
          </div>
          {chart(
            'Open WebSocket connections: players, spectators and handshakes',
            'sockets',
            [{ name: 'Sockets', slot: 1, values: samples.map((sample) => sample.sockets) }],
            (value) => count(value),
            true,
          )}
        </div>
        <div>
          <div className="mini-head">
            <h3>People</h3>
            <span className="mini-now">
              {count(data.online.counts.online)} online · {count(data.online.counts.playing)} playing
            </span>
          </div>
          {chart(
            'People online and people playing at a table',
            'people',
            [
              { name: 'Online', slot: 1, values: samples.map((sample) => sample.online) },
              { name: 'Playing', slot: 2, values: samples.map((sample) => sample.playing) },
            ],
            (value) => count(value),
            true,
          )}
        </div>
      </div>
      {samples.length > 0 && <PerformanceTable samples={samples} label={pointLabel} />}
      <p className="footnote">
        One point per {perPoint}: the worst delay, the average CPU and the peak of each count in it. Kept in
        the server&rsquo;s memory since it started{' '}
        {metrics ? <When at={metrics.since} now={metrics.now} /> : '—'}, up to a day; a restart clears it.
      </p>
    </Section>
  );
}

export function Overview() {
  const windows = localWindows();
  const { data, error, loading, updatedAt, reload } = useApi<AdminOverview>(
    `/api/admin/overview?day=${windows.day}&week=${windows.week}`,
    10_000,
  );
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const { counts } = data.online;
  const rooms = 'error' in data.rooms ? null : data.rooms;
  const activity = 'error' in data.activity ? null : data.activity;
  const tables = new Set(
    data.online.people.flatMap((person) =>
      person.place.kind === 'game' && person.place.atTable ? [person.place.roomId] : [],
    ),
  ).size;
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">
          {loading ? 'Refreshing…' : `Updated ${updatedAt ? time(updatedAt) : '—'} · every 10 seconds`}
          {' · '}revision <code>{data.revision?.slice(0, 7) ?? '—'}</code> · up {duration(data.uptimeSeconds)}
        </p>
        <button type="button" className="button" onClick={reload}>
          Refresh
        </button>
      </div>
      <Failure error={error} retry={reload} />
      {'error' in data.rooms && (
        <Notice tone="critical">Room counts are unavailable: {data.rooms.error}</Notice>
      )}
      {'error' in data.activity && (
        <Notice tone="critical">Today&rsquo;s games cannot be counted: {data.activity.error}</Notice>
      )}
      <div className="kpis">
        <Kpi
          label="Online now"
          value={counts.online}
          hint={
            data.online.accounts
              ? `${count(counts.online - counts.playing)} not in a game`
              : 'at rooms; accounts not reported'
          }
        />
        <Kpi
          label="Playing now"
          value={counts.playing}
          hint={`at ${count(tables)} table${tables === 1 ? '' : 's'}`}
        />
        <Kpi
          label="Live games"
          value={rooms?.live ?? null}
          hint={rooms ? `+ ${count(rooms.paused)} paused` : undefined}
          href="#/games?status=live"
        />
        <Kpi
          label="Lobbies"
          value={rooms?.lobbies ?? null}
          hint="waiting to start"
          href="#/games?status=lobby"
        />
        <Kpi
          label="Started today"
          value={activity?.started.day ?? null}
          hint={activity ? `${count(activity.started.week)} this week` : undefined}
        />
        <Kpi
          label="Finished today"
          value={activity ? activity.finished.day + activity.abandoned.day : null}
          hint={
            activity
              ? `${count(activity.abandoned.day)} abandoned · ${count(activity.finished.week + activity.abandoned.week)} this week`
              : undefined
          }
        />
        <Kpi
          label="Players this week"
          value={activity?.players.week ?? null}
          hint={activity ? `${count(activity.players.day)} today` : undefined}
          href="#/players"
        />
        <Kpi
          label="New this week"
          value={activity?.newPlayers.week ?? null}
          hint={activity ? `first game · ${count(activity.newPlayers.day)} today` : undefined}
        />
      </div>
      <div className="grid">
        <WhoIsOnline data={data} />
        <LiveGames data={data} />
      </div>
      <Performance data={data} />
      <div className="grid">
        <Section title="Host reports" actions={<a href="#/system">Details in System</a>}>
          <HostReportLines status={data.status} now={data.now} />
        </Section>
        <Section
          title={`Recent errors (${count(data.errors.total)})`}
          actions={<a href="#/system">All in System</a>}
        >
          {data.errors.recent.length ? (
            <ul className="plain">
              {data.errors.recent.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="error-line">
                  <span className="nowrap muted">
                    <When at={entry.at} now={data.now} />
                  </span>
                  <Badge>{entry.source}</Badge>
                  <span className="message" title={entry.message}>
                    {entry.message}
                    {entry.count > 1 && <span className="muted"> ×{entry.count}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No errors since the server started.</Empty>
          )}
          {data.rejections > 0 && (
            <p className="footnote">
              {count(data.rejections)} refused admin request{data.rejections === 1 ? '' : 's'} since the
              server started; see System.
            </p>
          )}
        </Section>
      </div>
      <p className="footnote">
        Today and this week start at your own midnight and Monday. Finished games include those abandoned with
        no winner. A new player is an account whose first recorded game started this week.
      </p>
    </div>
  );
}
