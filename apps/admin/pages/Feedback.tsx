import { useEffect, useState } from 'react';
import type { FeedbackItem, FeedbackPage } from '../../server/src/admin/types.js';
import { api, ApiError, useApi } from '../api.js';
import { short, time } from '../format.js';
import { Badge, Empty, Failure, Loading, Tabs, When } from '../ui.js';
import type { Tone } from '../ui.js';
import { go } from '../route.js';

const CATEGORY_TONE: Record<string, Tone> = { bug: 'serious', idea: 'accent', other: 'neutral' };
const CONTEXT_LABELS: Record<string, string> = {
  roomCode: 'Room',
  revision: 'Revision',
  clientBuild: 'Build',
  userAgent: 'Browser',
  viewport: 'Screen',
  connection: 'Connection',
  lastError: 'Last error',
};

function Item({ item, onChanged }: { item: FeedbackItem; onChanged: (item: FeedbackItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(
        await api<FeedbackItem>(`/api/admin/feedback/${item.id}/status`, {
          method: 'POST',
          body: { resolved: item.status !== 'resolved' },
        }),
      );
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`card feedback feedback-${item.status}`}>
      <header className="feedback-head">
        <Badge tone={CATEGORY_TONE[item.category] ?? 'neutral'}>{item.category}</Badge>
        <span className="muted">#{item.id}</span>
        <When at={item.at} />
        <span className="feedback-from">
          {item.userId ? (
            <a href={`#/players/${item.userId}`}>{item.username ?? short(item.userId)}</a>
          ) : (
            <span className="muted">local player</span>
          )}
        </span>
        <button type="button" className="button" disabled={busy} onClick={() => void toggle()}>
          {item.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
        </button>
      </header>
      {/* Rendered as text, never as markup: whatever a player typed stays inert. */}
      <p className="feedback-message">{item.message}</p>
      {item.context && (
        <dl className="pairs small">
          {Object.entries(item.context).map(([key, value]) => (
            <div key={key} className="pair">
              <dt>{CONTEXT_LABELS[key] ?? key}</dt>
              <dd>
                {key === 'roomCode' ? (
                  <a href={`#/games/${String(value)}`} className="mono">
                    {String(value)}
                  </a>
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {item.status === 'resolved' && (
        <p className="footnote">
          Resolved {time(item.resolvedAt)} by {item.resolvedBy}
        </p>
      )}
      <Failure error={error} />
    </article>
  );
}

export function Feedback({ params }: { params: URLSearchParams }) {
  const status = (params.get('status') ?? 'new') as 'new' | 'resolved' | 'all';
  const category = (params.get('category') ?? 'all') as 'all' | 'bug' | 'idea' | 'other';
  const { data, error, reload } = useApi<FeedbackPage>(
    `/api/admin/feedback?${new URLSearchParams({ status, category })}`,
  );
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError>();
  // Items resolved or reopened here since the last load, so the counts stay honest.
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!data) return;
    setItems(data.items);
    setNext(data.nextBefore);
    setMoved(0);
  }, [data]);
  const counts = data ? { new: data.counts.new - moved, resolved: data.counts.resolved + moved } : null;
  const set = (key: string, value: string, fallback: string) => {
    const merged = new URLSearchParams(params);
    if (value === fallback) merged.delete(key);
    else merged.set(key, value);
    go('feedback', undefined, merged);
  };
  const more = async () => {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await api<FeedbackPage>(
        `/api/admin/feedback?${new URLSearchParams({ status, category, before: String(next) })}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNext(page.nextBefore);
    } catch (problem) {
      setMoreError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <Tabs
          label="Status"
          value={status}
          onChange={(value) => set('status', value, 'new')}
          options={[
            { value: 'new', label: <>New{counts && <span className="count">{counts.new}</span>}</> },
            {
              value: 'resolved',
              label: <>Resolved{counts && <span className="count">{counts.resolved}</span>}</>,
            },
            { value: 'all', label: 'All' },
          ]}
        />
        <Tabs
          label="Category"
          value={category}
          onChange={(value) => set('category', value, 'all')}
          options={[
            { value: 'all', label: 'Every kind' },
            { value: 'bug', label: 'Bugs' },
            { value: 'idea', label: 'Ideas' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>
      <Failure error={error ?? moreError} retry={reload} />
      {!data ? (
        !error && <Loading />
      ) : items.length === 0 ? (
        <Empty>
          {status === 'new' ? 'Nothing new. Every message has been handled.' : 'No feedback here.'}
        </Empty>
      ) : (
        <>
          {items.map((item) => (
            <Item
              key={item.id}
              item={item}
              onChanged={(changed) => {
                // Leave it in place until the next refresh, showing its new state.
                if (changed.status !== item.status)
                  setMoved((n) => n + (changed.status === 'resolved' ? 1 : -1));
                setItems((current) => current.map((entry) => (entry.id === changed.id ? changed : entry)));
              }}
            />
          ))}
          {next !== null && (
            <button type="button" className="button" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'Loading…' : 'Older feedback'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
