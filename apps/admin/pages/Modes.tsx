/**
 * Who may pick each game mode, and which accounts test them. A change applies at once, with no restart:
 * a host waiting in a lobby sees their mode picker change, and games under way keep their mode. Every
 * change is audited.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AdminMode, AdminModes, AdminTester } from '../../server/src/admin/types.js';
import { api, ApiError, useApi } from '../api.js';
import { short } from '../format.js';
import { Badge, Empty, Failure, Loading, Notice, Section, Table, Tabs, When } from '../ui.js';

type State = AdminMode['state'];
const STATES: { value: State; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'testers', label: 'Testers' },
  { value: 'everyone', label: 'Everyone' },
];
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

const seats = ({ min, max }: AdminMode['seats']) => (min === max ? `${min}` : `${min}–${max}`);

/** Why a mode stands as it does: who set it here and when, production.env, or nobody yet. */
function Decided({ mode, now }: { mode: AdminMode; now: number }) {
  if (mode.source === 'always') return <span className="muted">Always</span>;
  if (mode.source === 'console')
    return (
      <>
        {mode.changedBy} <span className="muted">·</span> <When at={mode.changedAt} now={now} />
      </>
    );
  if (mode.source === 'environment') return <code>production.env</code>;
  return <span className="muted">Default</span>;
}

function TesterRow({
  tester,
  now,
  busy,
  onRemove,
}: {
  tester: AdminTester;
  now: number;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <tr>
      <td className="cell-first">
        <a href={`#/players/${encodeURIComponent(tester.userId)}`}>{tester.name ?? 'Unnamed account'}</a>
      </td>
      <td className="hide-phone">
        <code className="small" title={tester.userId}>
          {short(tester.userId)}
        </code>
      </td>
      <td className="cell-wide small">
        {tester.source === 'environment' ? (
          <code>production.env</code>
        ) : (
          <>
            {tester.addedBy} <span className="muted">·</span> <When at={tester.addedAt} now={now} />
          </>
        )}
      </td>
      <td className="cell-end num">
        {tester.source === 'console' && (
          <button type="button" className="button" disabled={busy} onClick={onRemove}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

export function Modes() {
  const { data, error, reload } = useApi<AdminModes>('/api/admin/modes', 30_000);
  // A change answers with the whole page, which stands until a later refresh.
  const [fresh, setFresh] = useState<AdminModes>();
  const [busy, setBusy] = useState(false);
  // A refusal is shown by the card whose change it refused.
  const [problem, setProblem] = useState<{ error: ApiError; card: 'modes' | 'testers' }>();
  const [confirming, setConfirming] = useState<AdminMode>();
  const [account, setAccount] = useState('');
  const shown = fresh && (!data || fresh.now >= data.now) ? fresh : data;
  if (!shown) return error ? <Failure error={error} retry={reload} /> : <Loading />;

  const change = async (card: 'modes' | 'testers', path: string, body: unknown) => {
    setBusy(true);
    setProblem(undefined);
    try {
      setFresh(await api<AdminModes>(path, { method: 'POST', body }));
      return true;
    } catch (failure) {
      setProblem({
        card,
        error: failure instanceof ApiError ? failure : new ApiError(0, 'ERROR', 'Something went wrong.'),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const choose = (mode: AdminMode, state: State) => {
    if (state === mode.state) return;
    // Opening a mode to every host is the one change worth a second look.
    if (state === 'everyone') setConfirming(mode);
    else {
      setConfirming(undefined);
      void change('modes', `/api/admin/modes/${mode.id}`, { state });
    }
  };
  const open = async () => {
    if (!confirming) return;
    if (await change('modes', `/api/admin/modes/${confirming.id}`, { state: 'everyone' }))
      setConfirming(undefined);
  };
  const tester = (userId: string, value: boolean) =>
    change('testers', `/api/admin/testers/${encodeURIComponent(userId)}`, { tester: value });
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await tester(account.trim(), true)) setAccount('');
  };
  const valid = ACCOUNT_ID.test(account.trim());
  const { modes, testers, now } = shown;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">
          Who may pick each game mode. A change applies at once: hosts in a lobby see it straight away, and
          games under way keep their mode.
        </p>
        <button type="button" className="button" onClick={reload}>
          Refresh
        </button>
      </div>
      <Section title="Game modes" className="wide">
        <Table className="stacked modes">
          <thead>
            <tr>
              <th>Mode</th>
              <th className="num">Players</th>
              <th>Who may pick it</th>
              <th>Set by</th>
            </tr>
          </thead>
          <tbody>
            {modes.map((mode) => (
              <tr key={mode.id}>
                <td className="cell-mode">
                  <strong>{mode.name}</strong>
                  <span className="muted small">{mode.summary}</span>
                </td>
                <td className="num hide-phone">{seats(mode.seats)}</td>
                <td>
                  {mode.source === 'always' ? (
                    <Badge tone="good">Everyone</Badge>
                  ) : (
                    <Tabs
                      label={`Who may pick ${mode.name}`}
                      value={mode.state}
                      options={STATES}
                      disabled={busy}
                      onChange={(state) => choose(mode, state)}
                    />
                  )}
                </td>
                <td className="small">
                  <Decided mode={mode} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {problem?.card === 'modes' && (
          <div className="modes-notice">
            <Failure error={problem.error} />
          </div>
        )}
        {confirming && (
          <div className="modes-notice">
            <Notice tone="warning">
              <span>
                Open <strong>{confirming.name}</strong> to everyone? Every host will be able to pick it,
                straight away.
              </span>
              <span className="mode-confirm-actions">
                <button type="button" className="button" disabled={busy} onClick={() => void open()}>
                  Open to everyone
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirming(undefined)}
                >
                  Cancel
                </button>
              </span>
            </Notice>
          </div>
        )}
        <p className="footnote">
          Off: nobody can pick it. Testers: only rooms whose host is a tester. Everyone: every host. Classic
          is always open.
        </p>
      </Section>
      <Section title={`Testers (${testers.length})`} className="wide">
        {testers.length ? (
          <Table className="stacked testers">
            <thead>
              <tr>
                <th>Player</th>
                <th>Account id</th>
                <th>Added by</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {testers.map((person) => (
                <TesterRow
                  key={person.userId}
                  tester={person}
                  now={now}
                  busy={busy}
                  onRemove={() => void tester(person.userId, false)}
                />
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No testers yet.</Empty>
        )}
        {problem?.card === 'testers' && (
          <div className="modes-notice">
            <Failure error={problem.error} />
          </div>
        )}
        <form className="search tester-add" onSubmit={(event) => void add(event)}>
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="Account id"
            aria-label="Account id of a new tester"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="button" disabled={busy || !valid}>
            Make tester
          </button>
        </form>
        <p className="footnote">
          A tester&rsquo;s rooms may pick every mode set to Testers. Only the host needs to be one: friends
          join with the room code. Each player&rsquo;s page has their account id and the same switch.
        </p>
      </Section>
    </div>
  );
}
