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
};

function Target({ target }: { target: string | null }) {
  if (!target) return <span className="muted">—</span>;
  if (target.startsWith('feedback:')) return <a href="#/feedback?status=all">{target}</a>;
  if (/^[0-9a-f-]{36}$/.test(target))
    return (
      <a href={`#/games/${target}`} className="mono">
        {short(target)}
      </a>
    );
  return <code>{target}</code>;
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
          <Table>
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
                  <td className="nowrap">{time(entry.at)}</td>
                  <td className="nowrap">{entry.actor}</td>
                  <td>
                    <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>{entry.action}</Badge>
                  </td>
                  <td>
                    <Target target={entry.target} />
                  </td>
                  <td>
                    <code className="small wrap">{JSON.stringify(entry.detail)}</code>
                  </td>
                  <td>{entry.ip ?? '—'}</td>
                  <td>
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
