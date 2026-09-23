import type { AdminOverview, StatusFile } from '../../server/src/admin/types.js';
import { useApi } from '../api.js';
import { bytes, count, duration, percent, time } from '../format.js';
import { HIDDEN_FIELDS, HOST_REPORTS, REPORT_FIELDS, reportVerdict, reportedAt } from '../host-reports.js';
import { Badge, Empty, Failure, Loading, Notice, Section, Stat, Table, When } from '../ui.js';

function StatusReport({
  name,
  every,
  staleAfterMs,
  file,
  now,
}: {
  name: string;
  every: string;
  staleAfterMs: number;
  file: StatusFile;
  now: number;
}) {
  const verdict = reportVerdict(file, now, staleAfterMs);
  const fields =
    file.state === 'ok'
      ? Object.entries(file.data)
          .filter(([key]) => !HIDDEN_FIELDS.has(key))
          .sort(
            ([a], [b]) =>
              (REPORT_FIELDS.indexOf(a) + 1 || 99) - (REPORT_FIELDS.indexOf(b) + 1 || 99) ||
              a.localeCompare(b),
          )
      : [];
  return (
    <div className="status-report">
      <div className="status-title">
        <strong>{name}</strong>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
      </div>
      {file.state === 'missing' && <p className="muted">No report yet from the host.</p>}
      {file.state === 'invalid' && (
        <p className="muted">
          {file.error}
          {file.modifiedAt ? ` · written ${time(file.modifiedAt)}` : ''}
        </p>
      )}
      {file.state === 'ok' && (
        <dl className="pairs">
          <div className="pair">
            <dt>Ran</dt>
            <dd>
              <When at={reportedAt(file)} now={now} /> · runs {every}
            </dd>
          </div>
          {fields.slice(0, 12).map(([key, value]) => (
            <div key={key} className="pair">
              <dt>{key}</dt>
              <dd>
                {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                  ? String(value)
                  : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function Overview() {
  const { data, error, loading, updatedAt, reload } = useApi<AdminOverview>('/api/admin/overview', 10_000);
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const { process: proc, load, sockets, rooms, database, disk } = data;
  const loop = load.window.eventLoop;
  const diskFree = 'freeBytes' in disk ? disk.freeBytes / Math.max(1, disk.totalBytes) : null;
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
        <Section title="Server">
          <div className="stats">
            <Stat label="Revision" value={<code>{data.revision?.slice(0, 12) ?? '—'}</code>} />
            <Stat label="Uptime" value={duration(proc.uptimeSeconds)} />
            <Stat label="Node" value={proc.node} />
            <Stat
              label="Memory"
              value={bytes(proc.memory.rss)}
              hint={`heap ${bytes(proc.memory.heapUsed)}`}
            />
            <Stat
              label="Event loop"
              value={`${loop.p99Ms} ms`}
              hint={`p99 · p50 ${loop.p50Ms} · max ${loop.maxMs} ms`}
            />
            <Stat
              label="CPU"
              value={`${load.window.cpuPercent}%`}
              hint={`load ${load.loadAverage.join(' ')} · ${load.cores} cores`}
            />
          </div>
          <p className="footnote">Delay and CPU cover the last {load.windowSeconds} seconds.</p>
        </Section>
        <Section title="Connections">
          <div className="stats">
            <Stat label="Sockets" value={count(sockets.total)} />
            <Stat label="Players" value={count(sockets.players)} hint="joined a seat" />
            <Stat label="Spectators" value={count(sockets.spectators)} />
            <Stat label="Not joined" value={count(sockets.pending)} />
            <Stat label="People" value={count(data.players.distinctPlayers)} hint="distinct, connected" />
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
                  hint="awaiting return"
                />
                <Stat label="Empty" value={count(rooms.empty)} />
                <Stat label="All rooms" value={count(rooms.total)} />
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
            <Stat label="File" value={bytes(database.fileBytes)} hint={`WAL ${bytes(database.walBytes)}`} />
            <Stat
              label="Pages"
              value={bytes(database.pageCount * database.pageSize)}
              hint={`${count(database.pageCount)} × ${database.pageSize} B`}
            />
            <Stat label="Free pages" value={count(database.freelistPages)} />
            <Stat label="Journal rows" value={count(database.journalRows)} />
            <Stat
              label="Disk free"
              value={'freeBytes' in disk ? bytes(disk.freeBytes) : '—'}
              hint={
                'freeBytes' in disk
                  ? `of ${bytes(disk.totalBytes)} (${percent(disk.freeBytes, disk.totalBytes)})`
                  : disk.error
              }
            />
          </div>
          {diskFree !== null && (
            <meter
              className="meter"
              min={0}
              max={1}
              low={0.1}
              high={0.2}
              optimum={1}
              value={diskFree}
              aria-label="Free disk space"
            />
          )}
          <p className="footnote">
            <code>{database.path}</code>
          </p>
        </Section>
      </div>
      <Section title="Host reports" className="wide">
        <div className="reports">
          {HOST_REPORTS.map((report) => (
            <StatusReport
              key={report.key}
              name={report.name}
              every={report.every}
              staleAfterMs={report.staleAfterMs}
              file={data.status[report.key]}
              now={data.now}
            />
          ))}
        </div>
        <p className="footnote">
          Read from <code>{data.status.directory}</code>, where the host&rsquo;s scripts write them.
        </p>
      </Section>
      <Section title={`Server errors (${data.errors.length})`} className="wide">
        {data.errors.length ? (
          <Table className="errors">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {data.errors.map((entry, index) => (
                <tr key={`${entry.at}-${index}`}>
                  <td className="nowrap">
                    <When at={entry.at} now={data.now} />
                  </td>
                  <td>
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
                    <code>{entry.path}</code>
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
