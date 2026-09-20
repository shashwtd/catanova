import { resultsFromRoom } from '../../../packages/protocol/src/results.js';
import type { MatchResults, ResultGame } from '../../../packages/protocol/src/results.js';
import { useEffect, useId, useRef } from 'react';
import type { GameStatistics as Statistics, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { GameIcon } from './GameIcons.js';
import { finalStandings, pointBreakdown } from './player-ranking.js';
import { playerHexColor } from './player-colors.js';
import type { CSSProperties } from 'react';

/**
 * Who took an award, and on what.
 *
 * "Most roads" used to sit here, which was worth nothing: every player has
 * fifteen roads and the count says only how many they spent. The award is the
 * thing that was actually contested and actually scored.
 */
function award(game: ResultGame, kind: 'longestRoad' | 'largestArmy') {
  const holder = game.players.find((p) => p.id === game[kind]);
  if (!holder) return 'Nobody claimed it';
  return kind === 'longestRoad'
    ? `${holder.name} · ${holder.roadLength} roads`
    : `${holder.name} · ${holder.knights} knights`;
}

/** Results use the final viewer-safe snapshot; scores are revealed by the server at victory. */
export function GameOver({
  room,
  results,
  groupInLobby = false,
  busy,
  canReturn,
  error,
  onReturn,
  onQuit,
}: {
  room?: RoomState;
  results?: MatchResults;
  groupInLobby?: boolean;
  /** Accepted by older local previews; dice statistics live exclusively in the game menu. */
  statistics?: Statistics | null;
  busy: boolean;
  canReturn: boolean;
  error?: string;
  onReturn: () => void;
  onQuit: () => void;
}) {
  const summary = results ?? resultsFromRoom(room!);
  const game = summary.game;
  const grainId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const winner = game.players.find((p) => p.id === game.winner);
  const profile = (id: string, name: string) =>
    summary.players.find((p) => p.id === id)?.profile ?? defaultProfile(name);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>(canReturn ? 'button.gold-button' : 'button')
      ?.focus({ preventScroll: true });
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
            {winner && (
              <span
                className="game-over-winner-portrait"
                style={{ '--player-color': playerHexColor(summary.players, winner.id) } as CSSProperties}
              >
                <Avatar profile={profile(winner.id, winner.name)} />
                <span className="game-over-laurel" aria-hidden="true">
                  <GameIcon name="trophy" size={34} />
                </span>
              </span>
            )}
            <p>{winner ? 'The island has a champion' : 'Game over'}</p>
            <h1>{winner ? `${winner.name} wins` : 'The island rests'}</h1>
            {/* Why, not just how many. A results screen that says "8 points"
                and stops is a number without the ten minutes behind it. */}
            {winner && game.finishReason !== 'resignation' ? (
              <>
                <p className="game-over-total">
                  <b>{winner.points}</b> victory points
                </p>
                <ul className="game-over-reason" aria-label={`How ${winner.name} scored`}>
                  {pointBreakdown(game, winner).map((part) => (
                    <li key={part.key}>
                      <span>{part.label}</span>
                      <b>+{part.points}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="game-over-total">
                {game.finishReason === 'resignation'
                  ? 'Won by resignation'
                  : 'Everyone left before the island was settled'}
              </p>
            )}
          </header>
          <div className="game-over-standings">
            <h2 className="game-over-standings-heading">Final standings</h2>
            {finalStandings(game).map(({ player, points, place }) => {
              const parts = pointBreakdown(game, player);
              return (
                <article
                  key={player.id}
                  className={`game-over-player ${player.id === game.winner ? 'is-winner' : ''} ${player.resigned ? 'has-resigned' : ''}`}
                  style={{ '--player-color': playerHexColor(summary.players, player.id) } as CSSProperties}
                >
                  <span className="game-over-place" aria-label={`Place ${place}`}>
                    {place}
                  </span>
                  <span className="game-over-player-portrait">
                    <Avatar profile={profile(player.id, player.name)} />
                  </span>
                  <div className="game-over-player-details">
                    <strong>
                      {player.name}
                      {player.resigned && <em className="game-over-resigned">Resigned</em>}
                    </strong>
                    {/* The same breakdown for everyone, so the table can see
                        the margin rather than only the winner's total. */}
                    <ul className="game-over-parts" aria-label={`How ${player.name} scored`}>
                      {parts.length ? (
                        parts.map((part) => (
                          <li key={part.key} data-part={part.key}>
                            {part.key === 'longestRoad' && <GameIcon name="road-award" size={18} />}
                            {part.key === 'largestArmy' && <GameIcon name="army-award" size={18} />}
                            <span>{part.label}</span>
                            <b>+{part.points}</b>
                          </li>
                        ))
                      ) : (
                        <li data-part="none">
                          <span>No points scored</span>
                        </li>
                      )}
                    </ul>
                  </div>
                  <div className="game-over-score">
                    <b>{points}</b>
                    <small>{points === 1 ? 'point' : 'points'}</small>
                  </div>
                </article>
              );
            })}
          </div>
          <dl className="game-over-facts" aria-label="This match">
            <div>
              <dt>Turns</dt>
              <dd>{game.turn}</dd>
            </div>
            <div>
              <dt>Longest Road</dt>
              <dd>{award(game, 'longestRoad')}</dd>
            </div>
            <div>
              <dt>Largest Army</dt>
              <dd>{award(game, 'largestArmy')}</dd>
            </div>
          </dl>
          {groupInLobby && (
            <p className="game-over-lobby-notice" role="status">
              Your group is in the lobby
            </p>
          )}
          {error && (
            <p className="game-over-error" role="alert">
              {error}
            </p>
          )}
          <footer className="game-over-actions">
            <button className="dark-button" disabled={busy} onClick={onQuit}>
              Back to hub
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
