import { useEffect, useState } from 'react';
import type { AuditEntry, AuditPage } from '../../server/src/admin/types.js';
import { api, ApiError, useApi } from '../api.js';
import { short, time } from '../format.js';
import { Badge, Empty, Failure, Loading, Section, Table } from '../ui.js';
import type { Tone } from '../ui.js';

const ACTION_TONE: Record<string, Tone> = {
  'game.end': 'critical',
  'game.view_private': 'warning',
  'report.retention': 'accent',
  'feedback.resolve': 'good',
  'feedback.reopen': 'neutral',
  'mode.set': 'accent',
  'mode.tester_add': 'accent',
  'mode.tester_remove': 'neutral',
};

/** "roomCode" becomes "room code". */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ');
  return JSON.stringify(value);
}

const ROOM_ID = /^[0-9a-f-]{36}$/;

/** A game is named by the room code the entry recorded, as everywhere else here. */
function roomCodeOf(entry: AuditEntry): string | null {
  return entry.target && ROOM_ID.test(entry.target) && typeof entry.detail.roomCode === 'string'
    ? entry.detail.roomCode
    : null;
}

/** Each recorded detail named in words with its value, leaving out a room code already shown as the target. */
export function detailPairs(entry: AuditEntry): [string, string][] {
  const named = roomCodeOf(entry) !== null;
  return Object.entries(entry.detail)
    .filter(([key]) => !(named && key === 'roomCode'))
    .map(([key, value]) => [words(key), detailValue(value)]);
}

function Target({ entry }: { entry: AuditEntry }) {
  const { target } = entry;
  if (!target) return <span className="muted">—</span>;
  if (target.startsWith('feedback:')) return <a href="#/feedback?status=all">{target}</a>;
  if (target.startsWith('mode:')) return <a href="#/modes">{target}</a>;
  if (target.startsWith('player:'))
    return (
      <a href={`#/players/${encodeURIComponent(target.slice(7))}`} className="mono" title={target}>
        player:{short(target.slice(7))}
      </a>
    );
  if (ROOM_ID.test(target))
    return (
      <a href={`#/games/${target}`} className="mono" title={target}>
        {roomCodeOf(entry) ?? short(target)}
      </a>
    );
  return <code>{target}</code>;
}

/** "revision 51 · turn 12": lines break after a separator, never before one or after a name. */
function Details({ entry }: { entry: AuditEntry }) {
  const pairs = detailPairs(entry);
  if (!pairs.length) return <span className="muted">—</span>;
  return (
    <>
      {pairs.map(([name, value], index) => (
        <span key={name}>
          {index > 0 && <span className="muted">{'\u00a0· '}</span>}
          <span className="muted">{name}</span>
          {'\u00a0'}
          {value}
        </span>
      ))}
    </>
  );
}

export function Audit() {
  const { data, error, reload } = useApi<AuditPage>('/api/admin/audit');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [moreError, setMoreError] = useState<ApiError>();
  useEffect(() => {
    if (!data) return;
    setEntries(data.entries);
    setNext(data.nextBefore);
  }, [data]);
  const more = async () => {
    if (next === null) return;
    try {
      const page = await api<AuditPage>(`/api/admin/audit?before=${next}`);
      setEntries((current) => [...current, ...page.entries]);
      setNext(page.nextBefore);
    } catch (problem) {
      setMoreError(problem instanceof ApiError ? problem : undefined);
    }
  };
  return (
    <div className="stack">
      <p className="muted">
        Every change made here, and every look at a game&rsquo;s private state, with who, when and from where.
        The log is append-only.
      </p>
      <Failure error={error ?? moreError} retry={reload} />
      {!data ? (
        !error && <Loading />
      ) : entries.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <Section title="Audit log" className="wide">
          <Table className="stacked">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
                <th>Address</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap cell-end">{time(entry.at)}</td>
                  <td className="nowrap cell-wide">
                    <span className="phone-only muted">by </span>
                    {entry.actor}
                  </td>
                  <td className="cell-first">
                    <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>{entry.action}</Badge>
                  </td>
                  <td>
                    <Target entry={entry} />
                  </td>
                  <td className="cell-rest">
                    <Details entry={entry} />
                  </td>
                  <td className="nowrap">{entry.ip ?? '—'}</td>
                  <td className="cell-rest">
                    <code className="small" title={entry.requestId}>
                      {short(entry.requestId)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {next !== null && (
            <button type="button" className="button" onClick={() => void more()}>
              Older entries
            </button>
          )}
        </Section>
      )}
    </div>
  );
}
