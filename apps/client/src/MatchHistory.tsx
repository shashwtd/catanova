import type { MatchSummary, PlayerGames } from '../../../packages/protocol/src/player-hub.js';
import { Avatar } from './Profile.js';
import { ArrowRight, Clock3, Crown, History, RefreshCw, Trophy } from './GameIcons.js';
import { GameLoader } from './GameLoader.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';

export type PlayerGameState = {
  data: PlayerGames | null;
  error: string;
  loading: boolean;
  refresh: () => void;
  loadMore: () => void;
};
const outcomes = {
  playing: 'In progress',
  won: 'Victory',
  lost: 'Defeat',
  resigned: 'Resigned',
  abandoned: 'Abandoned',
};
export function matchDate(timestamp: number | null) {
  return timestamp === null
    ? 'Earlier game'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}
export function PlayerStats({ stats }: { stats?: PlayerGames['stats'] }) {
  return (
    <dl className="player-record" aria-label="Your game record">
      <div>
        <dt>
          <Trophy size={22} /> Wins
        </dt>
        <dd>{stats ? stats.wins : '—'}</dd>
      </div>
      <div>
        <dt>
          <History size={22} /> Games played
        </dt>
        <dd>{stats ? stats.played : '—'}</dd>
      </div>
    </dl>
  );
}
export function MatchRow({
  game,
  busy,
  onResume,
}: {
  game: MatchSummary;
  busy?: boolean;
  onResume: (roomId: string) => void;
}) {
  return (
    <details className={`match-row outcome-${game.outcome}`}>
      <summary>
        <span className="match-outcome-mark" aria-hidden="true">
          {game.outcome === 'won' ? (
            <Trophy size={26} />
          ) : game.outcome === 'playing' ? (
            <Clock3 size={25} />
          ) : (
            <History size={25} />
          )}
        </span>
        <span className="match-summary-text">
          <strong>{outcomes[game.outcome]}</strong>
          <small>
            {game.players.length} players <span aria-hidden="true">·</span> {game.turns} turns
          </small>
        </span>
        <span className="match-score">
          <b>{game.points}</b>
          <small>points</small>
        </span>
        <time dateTime={game.startedAt === null ? undefined : new Date(game.startedAt).toISOString()}>
          {matchDate(game.startedAt)}
        </time>
        <svg className="match-expand" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="m5 8 5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="match-detail">
        <ul className="match-scoreboard" aria-label="Players and scores">
          {game.players.map((player) => (
            <li key={player.id}>
              <Avatar profile={player.profile ?? defaultProfile(player.name)} />
              <strong>{player.name}</strong>
              {player.winner && (
                <span title="Winner">
                  <Crown size={18} />
                  <span className="visually-hidden">Winner</span>
                </span>
              )}
              <b aria-label={`${player.points} points`}>{player.points}</b>
            </li>
          ))}
        </ul>
        {game.resumable && (
          <button className="hub-return" disabled={busy} onClick={() => onResume(game.roomId)}>
            Return to game <ArrowRight size={19} />
          </button>
        )}
      </div>
    </details>
  );
}
export function MatchHistory({
  state,
  compact = false,
  busy = false,
  onResume,
  onAll,
}: {
  state: PlayerGameState;
  compact?: boolean;
  busy?: boolean;
  onResume: (roomId: string) => void;
  onAll?: () => void;
}) {
  const games = state.data?.games ?? [];
  return (
    <section
      className={`match-history ${compact ? 'is-compact' : ''}`}
      aria-label={compact ? 'Recent games' : 'Game history'}
    >
      <header className="hub-section-heading">
        <h2>{compact ? 'Recent games' : 'Game history'}</h2>
        {compact ? (
          onAll && (
            <button className="hub-text-action" onClick={onAll}>
              View all <ArrowRight size={16} />
            </button>
          )
        ) : (
          <button
            className="hub-tool"
            aria-label="Refresh game history"
            disabled={state.loading}
            onClick={state.refresh}
          >
            <RefreshCw size={21} />
          </button>
        )}
      </header>
      {state.loading && !state.data ? (
        <div className="hub-history-empty">
          <GameLoader label="Loading your games…" />
        </div>
      ) : null}
      {state.error && (
        <div className="hub-history-error" role="alert">
          <p>{state.error}</p>
          <button className="hub-text-action" disabled={state.loading} onClick={state.refresh}>
            Try again
          </button>
        </div>
      )}
      {state.data && !games.length && (
        <div className="hub-history-empty">
          <History size={42} />
          <h3>No games yet</h3>
          <p>Your games will appear here.</p>
        </div>
      )}
      <div className="match-list">
        {(compact ? games.slice(0, 3) : games).map((game) => (
          <MatchRow key={game.roomId} game={game} busy={busy} onResume={onResume} />
        ))}
      </div>
      {!compact && !!state.data?.nextCursor && (
        <button className="hub-more" disabled={state.loading} onClick={state.loadMore}>
          {state.loading ? 'Loading…' : 'Earlier games'}
        </button>
      )}
      {!compact && state.data && <p className="record-caption">Your record counts completed games.</p>}
    </section>
  );
}
