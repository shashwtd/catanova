import { useEffect, useId, useRef } from 'react';
import type { GameStatistics as Statistics, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { GameIcon } from './GameIcons.js';
import { finalStandings } from './player-ranking.js';

/** Results use the final viewer-safe snapshot; scores are revealed by the server at victory. */
export function GameOver({
  room,
  busy,
  canReturn,
  error,
  onReturn,
  onQuit,
}: {
  room: RoomState;
  /** Accepted by older local previews; dice statistics live exclusively in the game menu. */
  statistics?: Statistics | null;
  busy: boolean;
  canReturn: boolean;
  error?: string;
  onReturn: () => void;
  onQuit: () => void;
}) {
  const game = room.game!;
  const grainId = useId();
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
        <div className="game-over-plank">
          <svg className="results-timber" viewBox="0 0 680 720" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id={grainId} width="680" height="720" patternUnits="userSpaceOnUse">
                <image
                  href="/art/optimized/environment-painted.00c506c983c0.webp"
                  x="-680"
                  y="-720"
                  width="1360"
                  height="1440"
                  preserveAspectRatio="none"
                />
              </pattern>
            </defs>
            <path
              className="results-wood"
              d="M16 15 L118 10 L121 14 L349 8 L352 12 L568 9 L657 17 L664 75 L659 80 L666 183 L663 362 L668 368 L662 542 L666 648 L658 701 L545 706 L538 702 L320 710 L166 703 L161 707 L20 701 L13 621 L18 617 L12 427 L16 420 L10 241 L15 236 L11 89 Z"
              fill={`url(#${grainId})`}
            />
            <path
              className="results-grain-edge"
              d="M23 23 L117 19 M360 20 L563 18 L648 24 M21 692 L158 697 M329 699 L539 693 L650 692"
            />
            <path
              className="results-wood-cracks"
              d="M15 80 L67 83 L27 88 M666 182 L605 185 L641 187 M12 426 L62 429 M665 648 L593 652 L626 655"
            />
            {[34, 686].flatMap((y) =>
              [34, 646].map((x) => (
                <g key={`${x}-${y}`} className="results-nail">
                  <circle cx={x} cy={y} r="5" />
                  <path d={`M${x - 2} ${y + 2}l4 -4`} />
                </g>
              )),
            )}
          </svg>
          <header className="game-over-hero">
            <div className="game-over-laurel" aria-hidden="true">
              <GameIcon name="trophy" size={76} />
            </div>
            {winner && <Avatar profile={profile(winner.id, winner.name)} />}
            <p>{winner ? 'The island has a champion' : 'Game over'}</p>
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
          <div className="game-over-standings">
            {finalStandings(game).map(({ player, points, place }) => (
              <article
                key={player.id}
                className={`game-over-player ${player.id === game.winner ? 'is-winner' : ''}`}
              >
                <span className="game-over-place">{place}</span>
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
    </div>
  );
}
