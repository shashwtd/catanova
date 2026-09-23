/**
 * The in-depth view of the server: its process and load, connections and
 * rooms, database and disk, the host's reports in full, every recent error and
 * every refused admin request. Overview keeps the glance.
 */
import type { AdminSystem, ServerErrorEntry } from '../../server/src/admin/types.js';
import { useApi } from '../api.js';
import { bytes, count, duration, percent, time } from '../format.js';
import { Badge, Empty, Failure, Loading, Notice, Section, Stat, Table, When } from '../ui.js';
import { HostReports } from './HostReports.js';

export function ErrorTable({ errors, now }: { errors: ServerErrorEntry[]; now: number }) {
  return (
    <Table className="errors">
      <thead>
        <tr>
          <th>When</th>
          <th>Source</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((entry, index) => (
          <tr key={`${entry.at}-${index}`}>
            <td className="nowrap">
              <When at={entry.at} now={now} />
            </td>
            <td className="nowrap">
              <Badge>{entry.source}</Badge>
              {entry.count > 1 && <span className="muted"> ×{entry.count}</span>}
            </td>
            <td>
              {entry.stack ? (
                <details>
                  <summary>{entry.message}</summary>
                  <pre className="json">{entry.stack}</pre>
                </details>
              ) : (
                entry.message
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function System() {
  const { data, error, loading, updatedAt, reload } = useApi<AdminSystem>('/api/admin/system', 10_000);
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const { process: proc, load, sockets, rooms, database, disk } = data;
  const loop = load.window.eventLoop;
  const [one, five, fifteen] = load.loadAverage;
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">
          {loading ? 'Refreshing…' : `Updated ${updatedAt ? time(updatedAt) : '—'} · every 10 seconds`}
        </p>
        <button type="button" className="button" onClick={reload}>
          Refresh
        </button>
      </div>
      <Failure error={error} retry={reload} />
      <div className="grid">
        <Section title="Process">
          <div className="stats">
            <Stat label="Revision" value={<code>{data.revision?.slice(0, 12) ?? '—'}</code>} />
            <Stat label="Uptime" value={duration(proc.uptimeSeconds)} />
            <Stat label="Node" value={proc.node} hint={`process ${proc.pid}`} />
            <Stat
              label="Memory (resident)"
              value={bytes(proc.memory.rss)}
              hint={`heap ${bytes(proc.memory.heapUsed)} of ${bytes(proc.memory.heapTotal)}`}
            />
            <Stat
              label="Outside the heap"
              value={bytes(proc.memory.external)}
              hint={`${bytes(proc.memory.arrayBuffers)} in buffers`}
            />
          </div>
        </Section>
        <Section title="Load">
          <div className="stats">
            <Stat
              label="Event loop delay (p99)"
              value={`${loop.p99Ms} ms`}
              hint={`p50 ${loop.p50Ms} · mean ${loop.meanMs} · max ${loop.maxMs} ms`}
            />
            <Stat label="CPU" value={`${load.window.cpuPercent}%`} hint="of one core" />
            <Stat
              label="Load average"
              value={`${one ?? '—'} · ${five ?? '—'} · ${fifteen ?? '—'}`}
              hint={`over 1, 5 and 15 min · ${load.cores} cores`}
            />
          </div>
          <p className="footnote">
            Delay and CPU cover the last {load.windowSeconds} seconds. Overview charts the last day.
          </p>
        </Section>
        <Section title="Connections">
          <div className="stats">
            <Stat label="Sockets" value={count(sockets.total)} />
            <Stat label="Seated players" value={count(sockets.players)} hint="connected to a seat" />
            <Stat label="Spectators" value={count(sockets.spectators)} />
            <Stat label="Not joined yet" value={count(sockets.pending)} hint="still handshaking" />
            <Stat label="People" value={count(data.players.distinctPlayers)} hint="distinct, at a seat" />
            <Stat
              label="Bots"
              value={count(data.bots.seatsInLiveGames)}
              hint={`in live games · ${data.bots.standIns} standing in`}
            />
          </div>
        </Section>
        <Section title="Rooms">
          {'error' in rooms ? (
            <Notice tone="critical">Room counts are unavailable: {rooms.error}</Notice>
          ) : (
            <>
              <div className="stats">
                <Stat label="Live" value={<a href="#/games?status=live">{count(rooms.live)}</a>} />
                <Stat label="Paused" value={<a href="#/games?status=paused">{count(rooms.paused)}</a>} />
                <Stat label="Lobbies" value={<a href="#/games?status=lobby">{count(rooms.lobbies)}</a>} />
                <Stat
                  label="Finished"
                  value={<a href="#/games?status=finished">{count(rooms.finished)}</a>}
                  hint="the game is over"
                />
                <Stat label="Empty" value={count(rooms.empty)} hint="nobody seated" />
                <Stat label="All rooms" value={count(rooms.total)} hint="rooms are kept" />
              </div>
              <p className="footnote">
                Counted <When at={rooms.countedAt} now={data.now} /> on a background thread, at most every few
                seconds.
              </p>
            </>
          )}
        </Section>
        <Section title="Database">
          <div className="stats">
            <Stat label="File" value={bytes(database.fileBytes)} />
            <Stat
              label="Write-ahead log"
              value={bytes(database.walBytes)}
              hint={`shared memory ${bytes(database.shmBytes)}`}
            />
            <Stat
              label="Pages"
              value={bytes(database.pageCount * database.pageSize)}
              hint={`${count(database.pageCount)} × ${database.pageSize} B`}
            />
            <Stat label="Free pages" value={count(database.freelistPages)} />
            <Stat label="Journal rows" value={count(database.journalRows)} hint="one per move" />
          </div>
          <p className="footnote">
            <code className="path">{database.path}</code>
          </p>
        </Section>
        <Section title="Disk">
          {'freeBytes' in disk ? (
            <>
              <div className="stats">
                <Stat
                  label="Free"
                  value={bytes(disk.freeBytes)}
                  hint={`${percent(disk.freeBytes, disk.totalBytes)} of ${bytes(disk.totalBytes)}`}
                />
                <Stat label="Used" value={bytes(disk.totalBytes - disk.freeBytes)} />
              </div>
              <meter
                className="meter"
                min={0}
                max={1}
                low={0.1}
                high={0.2}
                optimum={1}
                value={disk.freeBytes / Math.max(1, disk.totalBytes)}
                aria-label="Share of the disk that is free"
              />
            </>
          ) : (
            <Notice tone="critical">The disk cannot be read: {disk.error}</Notice>
          )}
          <p className="footnote">
            <code className="path">{disk.path}</code>
          </p>
        </Section>
      </div>
      <Section title="Host reports" className="wide">
        <HostReports status={data.status} now={data.now} />
      </Section>
      <Section title={`Server errors (${data.errors.length})`} className="wide">
        {data.errors.length ? (
          <ErrorTable errors={data.errors} now={data.now} />
        ) : (
          <Empty>No errors since the server started.</Empty>
        )}
      </Section>
      <Section title="Refused admin requests" className="wide">
        {data.rejections.length ? (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Address</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {data.rejections.map((entry, index) => (
                <tr key={`${entry.at}-${index}`}>
                  <td className="nowrap">
                    <When at={entry.at} now={data.now} />
                  </td>
                  <td>{entry.status}</td>
                  <td>
                    <code>{entry.reason}</code>
                  </td>
                  <td>{entry.ip ?? '—'}</td>
                  <td>
                    <code className="path">{entry.path}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>None since the server started.</Empty>
        )}
      </Section>
    </div>
  );
}
