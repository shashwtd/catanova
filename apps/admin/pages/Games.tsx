import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  GameDetail as Detail,
  GameListItem,
  GameResult,
  GamesPage,
  PrivateGameState,
  RoomStatus,
  SeatSummary,
} from '../../server/src/admin/types.js';
import type { HistoryEntry, RoomState } from '../../../packages/protocol/src/index.js';
import type { Game } from '../../../packages/rules/src/game.js';
import { RESOURCE_NAMES, RESOURCES } from '../../../packages/rules/src/index.js';
import { api, ApiError, useApi } from '../api.js';
import { accountLabel, count, diceLabel, phaseLabel, short, time } from '../format.js';
import {
  Badge,
  Columns,
  Empty,
  Failure,
  Json,
  Loading,
  Notice,
  PlayerColour,
  Section,
  Stat,
  Table,
  Tabs,
  When,
} from '../ui.js';
import type { Tone } from '../ui.js';
import { FAIR_DICE_SHARE, go } from '../route.js';

const STATUS_TONE: Record<RoomStatus, Tone> = {
  live: 'good',
  paused: 'warning',
  lobby: 'accent',
  finished: 'neutral',
  empty: 'neutral',
};
const STATUSES: ('all' | RoomStatus)[] = ['all', 'live', 'paused', 'lobby', 'finished', 'empty'];
const STATUS_LABELS: Record<'all' | RoomStatus, string> = {
  all: 'All',
  live: 'Live',
  paused: 'Paused',
  lobby: 'Lobby',
  finished: 'Finished',
  empty: 'Empty',
};

export function StatusBadge({ status }: { status: RoomStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

/**
 * A seat as a compact chip: name, points once a game is on, and what is going
 * on with it. Connection only matters while a game can still be played, so a
 * finished game's seats are never flagged offline.
 */
export function SeatChip({
  seat,
  points,
  winner = false,
  over = false,
}: {
  seat: SeatSummary;
  points?: number | null;
  winner?: boolean;
  over?: boolean;
}) {
  const flags = [
    seat.bot ? `bot${seat.botLevel ? ` · ${seat.botLevel}` : ''}` : null,
    !over && seat.standIn ? 'bot standing in' : null,
    seat.resigned ? 'resigned' : null,
    seat.departed ? 'left' : null,
    !over && !seat.bot && !seat.connected && !seat.resigned && !seat.departed ? 'offline' : null,
  ].filter(Boolean);
  const state =
    seat.resigned || seat.departed
      ? 'gone'
      : seat.bot || (!over && seat.standIn)
        ? 'bot'
        : over
          ? 'done'
          : seat.connected
            ? 'on'
            : 'off';
  return (
    <span className={`seat seat-${state}`} title={flags.join(', ') || (over ? 'played' : 'connected')}>
      <i aria-hidden="true" />
      {seat.name}
      {points !== undefined && points !== null && (
        <span className="seat-points" title={`${points} points`}>
          {points}
          {winner && ' ★'}
        </span>
      )}
      {flags.length > 0 && <span className="seat-flags">{flags.join(' · ')}</span>}
    </span>
  );
}

const RESULT_TEXT: Record<GameResult['reason'], (winner: string | null) => string> = {
  points: (winner) => `${winner ?? 'Someone'} won`,
  resignation: (winner) => `${winner ?? 'Someone'} won by resignation`,
  abandoned: () => 'No winner',
};

function GameRow({ game, now }: { game: GameListItem; now: number }) {
  const over = game.status === 'finished';
  const seated = game.players.length;
  return (
    <tr>
      <td>
        <a href={`#/games/${game.roomId}`} className="mono">
          {game.roomCode ?? short(game.roomId)}
        </a>
      </td>
      <td>
        <StatusBadge status={game.status} />
        {game.error && <Badge tone="critical">{game.error}</Badge>}
      </td>
      <td className="cell-wide">
        <div className="seats">
          {game.players.map((seat) => (
            <SeatChip
              key={seat.id}
              seat={seat}
              points={seat.points}
              winner={game.result?.winnerId === seat.id}
              over={over}
            />
          ))}
        </div>
      </td>
      <td className="nowrap cell-wide">
        {game.result ? (
          RESULT_TEXT[game.result.reason](game.result.winner)
        ) : game.turn !== null ? (
          <>
            Turn {game.turn}
            <span className="muted"> · {phaseLabel(game.phase).toLowerCase()}</span>
          </>
        ) : (
          <span className="muted">{seated} seated</span>
        )}
      </td>
      <td className="nowrap hide-phone">
        <When at={game.createdAt} now={now} />
      </td>
      <td className="nowrap cell-end">
        <When at={game.lastActivity} now={now} />
      </td>
    </tr>
  );
}

export function Games({ params }: { params: URLSearchParams }) {
  const status = (params.get('status') ?? 'all') as 'all' | RoomStatus;
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
    ...(status !== 'all' ? { status } : {}),
    ...(q ? { q } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  });
  const { data, error, loading, reload } = useApi<GamesPage>(`/api/admin/games?${query}`, 15_000);
  const set = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    if (!('page' in next)) merged.delete('page');
    go('games', undefined, merged);
  };
  const now = Date.now();
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="stack">
      <div className="toolbar">
        <Tabs
          label="Room status"
          value={status}
          onChange={(value) => set({ status: value === 'all' ? null : value })}
          options={STATUSES.map((value) => ({
            value,
            label: (
              <>
                {STATUS_LABELS[value]}
                {data && value !== 'all' && <span className="count">{data.counts[value]}</span>}
              </>
            ),
          }))}
        />
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
            placeholder="Room code or player"
            aria-label="Search rooms by code or player name"
            maxLength={64}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="button">
            Search
          </button>
        </form>
      </div>
      <Failure error={error} retry={reload} />
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <Empty>{q ? `No rooms match “${q}”.` : 'No rooms here.'}</Empty>
      ) : (
        <Section
          title={`${count(data.total)} room${data.total === 1 ? '' : 's'}`}
          actions={loading ? <span className="muted">Refreshing…</span> : undefined}
          className="wide"
        >
          <Table className="games stacked">
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Players</th>
                <th>Game</th>
                <th className="hide-phone">Started</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((game) => (
                <GameRow key={game.roomId} game={game} now={now} />
              ))}
            </tbody>
          </Table>
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
        </Section>
      )}
    </div>
  );
}

function History({
  roomId,
  first,
}: {
  roomId: string;
  first: { entries: HistoryEntry[]; hasMore: boolean };
}) {
  const [entries, setEntries] = useState(first.entries);
  // Null until an older page is loaded; after that, whether there is more before it.
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  // A refresh brings in new moves at the top and keeps the older pages already loaded.
  useEffect(() => {
    const oldest = first.entries.at(-1)?.revision ?? Infinity;
    setEntries((current) => [...first.entries, ...current.filter((entry) => entry.revision < oldest)]);
  }, [first]);
  const more = olderMore ?? first.hasMore;
  const earlier = async () => {
    setBusy(true);
    try {
      const page = await api<{ entries: HistoryEntry[]; hasMore: boolean }>(
        `/api/admin/games/${roomId}/history?before=${entries.at(-1)!.revision}`,
      );
      setEntries((current) => [...current, ...page.entries]);
      setOlderMore(page.hasMore);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setBusy(false);
    }
  };
  if (!entries.length) return <Empty>No moves recorded in this round.</Empty>;
  return (
    <>
      <Table className="history">
        <thead>
          <tr>
            <th className="num">Rev</th>
            <th className="num">Turn</th>
            <th>Kind</th>
            <th>What happened</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.revision}>
              <td className="num">{entry.revision}</td>
              <td className="num">{entry.turn}</td>
              <td>
                <code>{entry.kind}</code>
                {entry.automatic && <span className="muted"> · auto</span>}
              </td>
              <td>
                {entry.lines.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </td>
              <td className="nowrap">{time(Date.parse(entry.at))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Failure error={error} />
      {more && (
        <button type="button" className="button" disabled={busy} onClick={() => void earlier()}>
          {busy ? 'Loading…' : 'Earlier moves'}
        </button>
      )}
    </>
  );
}

/** Hands, cards and decks first; the whole saved game underneath for anything else. */
function PrivateSummary({ game, revision }: { game: Game; revision: number }) {
  // Cards are drawn from the end of the deck.
  const upcoming = [...game.deck].reverse();
  return (
    <>
      <p className="footnote">As of revision {revision}.</p>
      <Table className="compact">
        <thead>
          <tr>
            <th>Player</th>
            {RESOURCES.map((resource) => (
              <th key={resource} className="num">
                {RESOURCE_NAMES[resource]}
              </th>
            ))}
            <th>Development cards</th>
            <th className="num">Knights</th>
          </tr>
        </thead>
        <tbody>
          {game.players.map((player) => (
            <tr key={player.id}>
              <td>
                {player.name}
                {player.resigned && <span className="muted"> · resigned</span>}
              </td>
              {RESOURCES.map((resource) => (
                <td key={resource} className="num">
                  {player.hand[resource]}
                </td>
              ))}
              <td>{player.cards.map((card) => card.kind).join(', ') || '—'}</td>
              <td className="num">{player.knights}</td>
            </tr>
          ))}
          <tr>
            <th>Bank</th>
            {RESOURCES.map((resource) => (
              <td key={resource} className="num muted">
                {game.bank[resource]}
              </td>
            ))}
            <td colSpan={2} />
          </tr>
        </tbody>
      </Table>
      <dl className="pairs">
        <div className="pair">
          <dt>Development deck</dt>
          <dd>
            {upcoming.length} left
            {upcoming.length > 0 && <span className="muted"> · next: {upcoming.slice(0, 6).join(', ')}</span>}
          </dd>
        </div>
        {game.balancedDice && (
          <div className="pair">
            <dt>Dice deck</dt>
            <dd>
              {game.balancedDice.remaining.length} pairs left
              {game.balancedDice.lastTotal !== undefined && ` · last total ${game.balancedDice.lastTotal}`}
            </dd>
          </div>
        )}
      </dl>
      <details>
        <summary>Full saved game</summary>
        <Json value={game} />
      </details>
    </>
  );
}

function PrivateState({ roomId }: { roomId: string }) {
  const [state, setState] = useState<PrivateGameState>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const reveal = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setState(await api<PrivateGameState>(`/api/admin/games/${roomId}/private`));
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Private state" className="wide">
      <p className="muted">
        Every hand, the development deck and the dice deck. Opening it is recorded in the audit log under your
        name.
      </p>
      <Failure error={error} />
      {state ? (
        <PrivateSummary game={state.game as Game} revision={state.revision} />
      ) : (
        <button type="button" className="button" disabled={busy} onClick={() => void reveal()}>
          {busy ? 'Opening…' : 'Show private state'}
        </button>
      )}
    </Section>
  );
}

function EndGame({ detail, onEnded }: { detail: Detail; onEnded: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const matches = typed.trim().toUpperCase() === detail.confirmation.toUpperCase();
  const end = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/admin/games/${detail.roomId}/end`, { method: 'POST', body: { confirm: typed.trim() } });
      setTyped('');
      onEnded();
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="End this game" className="wide danger">
      <p>
        Closes the game with no winner, as if every remaining player had left. Players still connected see it
        end at once and can leave the room; it cannot be undone. Use it for a stuck or abandoned table.
      </p>
      <form className="confirm" onSubmit={(event) => void end(event)}>
        <label>
          <span>
            Type <code>{detail.confirmation}</code> to confirm
          </span>
          <input
            value={typed}
            aria-label={`Type ${detail.confirmation} to confirm`}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="end-game-note"
          />
        </label>
        <button type="submit" className="button button-danger" disabled={!matches || busy}>
          {busy ? 'Ending…' : 'End game'}
        </button>
      </form>
      <p id="end-game-note" className="footnote">
        Recorded in the audit log and the game&rsquo;s own history.
      </p>
      <Failure error={error} />
    </Section>
  );
}

function Pair({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="pair">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A finished game's result as the table was told it. */
export function resultText(game: NonNullable<RoomState['game']>): string {
  const winner = game.players.find((player) => player.id === game.winner);
  if (!winner) return 'No winner: the game was abandoned';
  if (game.finishReason === 'resignation') return `${winner.name} won: everyone else resigned`;
  return `${winner.name} won with ${winner.points} points`;
}

/**
 * Who is at the table and what it is waiting for, worded the way the game
 * treats it. While anyone is at a live table, an absent player keeps their
 * seat and a bot plays it after half a minute; seats are only given up once
 * the table has been empty for the whole grace period (it is then paused).
 */
function TableState({ data, now }: { data: Detail; now: number }) {
  const game = data.snapshot?.game;
  const name = (id: string) => data.seats.find((seat) => seat.id === id)?.name ?? short(id);
  if (data.status === 'lobby' || data.status === 'empty') {
    const seated = data.seats.filter((seat) => !seat.departed);
    return (
      <Section title="Lobby">
        <dl className="pairs">
          <Pair label="Seated">
            {seated.length} of 4 · {seated.filter((seat) => seat.ready || seat.bot).length} ready
          </Pair>
          <Pair label="Connected">
            {seated.filter((seat) => !seat.bot && seat.connected).length} of{' '}
            {seated.filter((seat) => !seat.bot).length} people
          </Pair>
        </dl>
      </Section>
    );
  }
  if (data.status === 'finished' || !game) {
    return (
      <Section title="Result">
        <dl className="pairs">
          <Pair label="Ended">
            {game && game.phase === 'finished' ? resultText(game) : <span className="muted">—</span>}
          </Pair>
          <Pair label="Last move">
            <When at={data.lastActivity} now={now} />
          </Pair>
        </dl>
      </Section>
    );
  }
  const people = data.seats.filter(
    (seat) => !seat.bot && !seat.resigned && !seat.departed && game.players.some((p) => p.id === seat.id),
  );
  const standIns = new Map(data.standIns.map((standIn) => [standIn.playerId, standIn]));
  const clock = data.clock;
  const discarding = Object.keys(game.discards ?? {});
  return (
    <Section title="Table">
      <dl className="pairs">
        <Pair label="State">
          {data.presence.paused ? (
            <>
              Paused: nobody has been at the table since <When at={data.presence.pausedAt} now={now} />
            </>
          ) : (
            `Live: ${people.filter((seat) => seat.connected).length} of ${people.length} people at the table`
          )}
        </Pair>
        <Pair label="Up now">
          {`${name(game.players[game.active]?.id ?? '')} · turn ${game.turn} · ${phaseLabel(game.phase).toLowerCase()}`}
        </Pair>
        <Pair label="Turn clock">
          {!clock ? (
            game.turn === 0 ? (
              'none during setup'
            ) : (
              'no turn timer'
            )
          ) : data.presence.paused ? (
            'held until someone is back'
          ) : clock.pausedAt !== undefined ? (
            `stopped while ${discarding.map(name).join(', ') || 'players'} discard`
          ) : (
            <>
              {name(clock.playerId)}&rsquo;s turn ends <When at={clock.deadlineAt} now={now} />
            </>
          )}
        </Pair>
        {data.presence.absent.map((absent) => {
          const standIn = standIns.get(absent.playerId);
          return (
            <Pair key={absent.playerId} label={name(absent.playerId)}>
              away since <When at={absent.disconnectedAt} now={now} />
              {data.presence.paused ? (
                <>
                  {' '}
                  · gives up the seat <When at={absent.resignAt} now={now} /> unless someone returns
                </>
              ) : standIn ? (
                <>
                  {' '}
                  · a bot ({standIn.level}) has played for them since <When at={standIn.since} now={now} />
                </>
              ) : (
                <>
                  {' '}
                  · a bot takes the seat <When at={absent.standInAt} now={now} />
                </>
              )}
            </Pair>
          );
        })}
      </dl>
    </Section>
  );
}

export function GameDetail({ roomId }: { roomId: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/admin/games/${encodeURIComponent(roomId)}`, 15_000);
  if (!data) return error ? <Failure error={error} retry={reload} /> : <Loading />;
  const now = Date.now();
  const game = data.snapshot?.game;
  return (
    <div className="stack">
      <p>
        <a href="#/games">← All games</a>
      </p>
      <div className="title-row">
        <h1 className="mono">{data.roomCode ?? short(data.roomId)}</h1>
        <StatusBadge status={data.status} />
      </div>
      {data.integrityError && (
        <Notice tone="critical">
          The saved game cannot be read ({data.integrityError}). Moves are refused until it is recovered.
        </Notice>
      )}
      <div className="grid">
        <Section title="Room">
          <div className="stats">
            <Stat label="Room id" value={<code className="small">{data.roomId}</code>} />
            <Stat
              label="Turn"
              value={game ? game.turn : '—'}
              hint={game ? phaseLabel(game.phase) : undefined}
            />
            <Stat
              label="Started"
              value={<When at={data.createdAt} now={now} />}
              hint={data.round ? 'this round' : undefined}
            />
            <Stat label="Last activity" value={<When at={data.lastActivity} now={now} />} />
            <Stat
              label="Dice"
              value={diceLabel(game?.diceMode ?? data.settings.diceMode)}
              hint={`${
                data.settings.turnTimerSeconds ? `${data.settings.turnTimerSeconds} s turns` : 'no turn timer'
              } · ${game?.victoryPoints ?? data.settings.victoryPoints ?? 10} points to win`}
            />
            <Stat
              label="Revision"
              value={data.revision}
              {...(data.round ? { hint: `this round began after ${data.round}` } : {})}
            />
          </div>
        </Section>
        <TableState data={data} now={now} />
      </div>
      <Section title="Seats" className="wide">
        <Table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Account</th>
              <th className="num">Points</th>
              <th className="num">Cards</th>
              <th>Colour</th>
            </tr>
          </thead>
          <tbody>
            {data.seats.map((seat) => {
              const view = game?.players.find((player) => player.id === seat.id);
              return (
                <tr key={seat.id}>
                  <td>
                    <SeatChip seat={seat} over={data.status === 'finished'} />
                    {game?.winner === seat.id && <span className="seat-points"> ★ winner</span>}
                    {!game && seat.ready && <Badge tone="good">ready</Badge>}
                  </td>
                  <td>
                    {seat.userId ? (
                      <a href={`#/players/${seat.userId}`} className="mono">
                        {short(seat.userId)}
                      </a>
                    ) : (
                      <span className="muted">{seat.bot ? 'bot' : 'local seat'}</span>
                    )}
                    {seat.accountType && <span className="muted"> · {accountLabel(seat.accountType)}</span>}
                  </td>
                  <td className="num">{view?.points ?? '—'}</td>
                  <td className="num">{view ? `${view.resourceCount} res · ${view.cardCount} dev` : '—'}</td>
                  <td>
                    <PlayerColour color={seat.color} chosen={seat.colorChosen} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Section>
      {data.statistics && data.statistics.rolls > 0 && (
        <Section title={`Dice this round (${data.statistics.rolls} rolls)`} className="wide">
          <Columns
            label="Rolls of each total this round, against two fair dice"
            categories={Array.from({ length: 11 }, (_, i) => String(i + 2))}
            series={[{ name: 'Rolled', slot: 1, values: data.statistics.diceCounts }]}
            reference={{
              name: 'Two fair dice',
              values: FAIR_DICE_SHARE.map((p) => Math.round(p * data.statistics!.rolls * 10) / 10),
            }}
          />
        </Section>
      )}
      <Section title="Move history" className="wide">
        <History roomId={data.roomId} first={data.history} />
      </Section>
      {data.rounds.length > 0 && (
        <Section title="Earlier rounds in this room" className="wide">
          <Table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Finished</th>
                <th className="num">Turns</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {data.rounds.map((round) => (
                <tr key={round.archiveId}>
                  <td>{time(round.startedAt)}</td>
                  <td>{time(round.finishedAt)}</td>
                  <td className="num">{round.turns}</td>
                  <td>{round.winner ?? <span className="muted">no winner</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
      <Section title="Public snapshot" className="wide">
        <details>
          <summary>What a spectator is sent</summary>
          <Json value={data.snapshot} />
        </details>
      </Section>
      {game && <PrivateState roomId={data.roomId} />}
      {data.canEnd && <EndGame detail={data} onEnded={reload} />}
    </div>
  );
}
