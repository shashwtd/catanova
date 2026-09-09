import { Activity, Wifi, WifiOff } from './GameIcons.js';
import type { NetworkMetrics, ConnectionStatus } from './connection.js';
export function ConnectionPanel({
  metrics,
  status,
  revision,
  pending,
  onSync,
}: {
  metrics: NetworkMetrics;
  status: ConnectionStatus;
  revision: number;
  pending: boolean;
  onSync: () => void;
}) {
  const valid = metrics.samples.filter((s) => s.rtt !== null).map((s) => s.rtt!),
    latest = metrics.samples.at(-1)?.rtt;
  const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  const jitter =
    valid.length > 1
      ? Math.round(
          valid.slice(1).reduce((n, rtt, i) => n + Math.abs(rtt - valid[i]!), 0) / (valid.length - 1),
        )
      : null;
  const max = Math.max(150, ...valid),
    samples = metrics.samples;
  let path = '',
    breakLine = true;
  samples.forEach((s, i) => {
    if (s.rtt === null) {
      breakLine = true;
      return;
    }
    path += `${breakLine ? 'M' : 'L'}${8 + (i / 59) * 264},${94 - (s.rtt / max) * 78} `;
    breakLine = false;
  });
  return (
    <div className="connection-detail">
      <div className={`connection-quality ${status === 'connected' ? 'online' : ''}`}>
        {status === 'connected' ? <Wifi /> : <WifiOff />}
        <strong>
          {status === 'connected' ? 'Connected' : status === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}
        </strong>
        <b>{latest == null ? '—' : `${Math.round(latest)} ms`}</b>
      </div>
      <svg
        className="ping-graph"
        viewBox="0 0 280 120"
        role="img"
        aria-label="Recent server round-trip ping measurements"
      >
        <path d="M8 16H272M8 55H272M8 94H272" className="graph-grid" />
        <path d={path} className="graph-line" />
        {samples.map((s, i) =>
          s.rtt === null ? (
            <circle key={s.at} cx={8 + (i / 59) * 264} cy={97} r={3} className="graph-missed" />
          ) : null,
        )}
        <text x="8" y="113">
          Recent probes
        </text>
        <text x="270" y="12" textAnchor="end">
          {Math.round(max)} ms
        </text>
      </svg>
      <dl className="connection-stats">
        <div>
          <dt>Average ping</dt>
          <dd>{avg === null ? '—' : `${avg} ms`}</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{jitter === null ? '—' : `${jitter} ms`}</dd>
        </div>
        <div>
          <dt>Missed probes</dt>
          <dd>
            {samples.filter((s) => s.rtt === null).length}/{samples.length}
          </dd>
        </div>
        <div>
          <dt>Reconnects</dt>
          <dd>{metrics.reconnects}</dd>
        </div>
        <div>
          <dt>Saved revision</dt>
          <dd>{revision}</dd>
        </div>
        <div>
          <dt>Synchronization</dt>
          <dd>
            {metrics.syncIssue
              ? 'Checking state'
              : pending
                ? 'Saving move'
                : metrics.serverRevision === revision
                  ? 'Up to date'
                  : 'Waiting'}
          </dd>
        </div>
      </dl>
      {metrics.syncIssue && (
        <p role="alert" className="entry-error">
          {metrics.syncIssue}. Your displayed pieces are retained while the server is checked.
        </p>
      )}
      <button
        className="dark-button connection-refresh"
        onClick={onSync}
        disabled={status !== 'connected'}
        aria-label="Refresh game state from the server"
      >
        <svg
          className="sync-refresh"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 9a8 8 0 0 0-14-3L3 9m0-5v5h5M4 15a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />
        </svg>
        Refresh game
      </button>
      <p className="connection-note">
        <Activity size={13} />
        Round-trip server ping; missed probes are not a packet-loss measurement.
      </p>
    </div>
  );
}
