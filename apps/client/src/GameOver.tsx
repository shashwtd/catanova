import { useEffect, useRef, useState } from 'react';
import type { GameStatistics as Statistics, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { GameIcon } from './GameIcons.js';
import { GameStatistics } from './GameStatistics.js';
import { playerStandings } from './player-ranking.js';

/** Results use the final viewer-safe snapshot; scores are revealed by the server at victory. */
export function GameOver({
  room,
  statistics,
  busy,
  canReturn,
  error,
  onReturn,
  onQuit,
}: {
  room: RoomState;
  statistics: Statistics | null;
  busy: boolean;
  canReturn: boolean;
  error?: string;
  onReturn: () => void;
  onQuit: () => void;
}) {
  const game = room.game!;
  const [tab, setTab] = useState<'standings' | 'dice'>('standings');
  const ref = useRef<HTMLDivElement>(null);
  const winner = game.players.find((p) => p.id === game.winner);
  const profile = (id: string, name: string) =>
    room.players.find((p) => p.id === id)?.profile ?? defaultProfile(name);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="game-over-scrim">
      <div
        ref={ref}
        className="game-over-screen"
        role="dialog"
        aria-modal="true"
        aria-label="Game results"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="game-over-hero">
          <div className="game-over-laurel" aria-hidden="true">
            <GameIcon name="trophy" size={76} />
          </div>
          {winner && <Avatar profile={profile(winner.id, winner.name)} />}
          <p>Game over</p>
          <h1>{winner ? `${winner.name} wins!` : 'The island rests'}</h1>
          <span>
            {game.finishReason === 'resignation'
              ? 'Victory by resignation'
              : game.finishReason === 'abandoned'
                ? 'Everyone left the game'
                : `${winner?.points ?? 0} victory points`}{' '}
            · {game.turn} turns
          </span>
        </header>
        <nav className="game-over-tabs" aria-label="Result views">
          <button aria-pressed={tab === 'standings'} onClick={() => setTab('standings')}>
            Leaderboard
          </button>
          <button aria-pressed={tab === 'dice'} onClick={() => setTab('dice')}>
            Dice statistics
          </button>
        </nav>
        {tab === 'standings' ? (
          <div className="game-over-standings">
            {playerStandings(game).map(({ player, points }, index) => (
              <article
                key={player.id}
                className={`game-over-player ${player.id === game.winner ? 'is-winner' : ''}`}
              >
                <span className="game-over-place">{index + 1}</span>
                <Avatar profile={profile(player.id, player.name)} />
                <div className="game-over-player-details">
                  <strong>{player.name}</strong>
                  <span>
                    {player.pieces.roads} roads · {player.pieces.settlements} houses · {player.pieces.cities}{' '}
                    cities · {player.knights} Knights
                  </span>
                  <div className="game-over-awards">
                    {game.longestRoad === player.id && (
                      <span>
                        <GameIcon name="road-award" size={24} /> Longest Road · {player.roadLength}
                      </span>
                    )}
                    {game.largestArmy === player.id && (
                      <span>
                        <GameIcon name="army-award" size={24} /> Largest Army · {player.knights}
                      </span>
                    )}
                    {player.resigned && <span>Resigned</span>}
                  </div>
                </div>
                <div className="game-over-score">
                  <b>{points}</b>
                  <small>points</small>
                </div>
              </article>
            ))}
            <div className="game-over-highlights">
              {(
                [
                  { field: 'roads', label: 'Most roads', icon: 'road' },
                  { field: 'cities', label: 'Most cities', icon: 'city' },
                ] as const
              ).map(({ field, label, icon }) => {
                const best = Math.max(...game.players.map((p) => p.pieces[field]));
                return best ? (
                  <div key={field}>
                    <GameIcon name={icon} size={28} />
                    <span>
                      <small>
                        {label} · {best}
                      </small>
                      {game.players
                        .filter((p) => p.pieces[field] === best)
                        .map((p) => p.name)
                        .join(' & ')}
                    </span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        ) : (
          <GameStatistics game={game} statistics={statistics} />
        )}
        {error && (
          <p className="game-over-error" role="alert">
            {error}
          </p>
        )}
        <footer className="game-over-actions">
          <button className="dark-button" disabled={busy} onClick={onQuit}>
            Quit Catanova
          </button>
          <button className="gold-button" disabled={busy || !canReturn} onClick={onReturn}>
            Return to lobby
          </button>
        </footer>
      </div>
    </div>
  );
}
