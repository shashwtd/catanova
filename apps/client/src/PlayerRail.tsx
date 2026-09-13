import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { GameIcon, Trophy, WifiOff } from './GameIcons.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
import { playerTurnActivity } from './turn-activity.js';
import { DisconnectStatus } from './DisconnectStatus.js';
import { rankedPlayers } from './player-ranking.js';
import { usePlayerOrderMotion } from './usePlayerOrderMotion.js';

function InventoryCount({ kind, count }: { kind: 'resource' | 'development'; count: number }) {
  const label = `${count} ${kind === 'resource' ? 'resource' : 'development'} cards`;
  return (
    <span className={`profile-${kind}-count`} data-empty={count === 0} title={label} aria-label={label}>
      <GameIcon
        className="profile-inventory-art"
        name={kind === 'resource' ? 'cards' : 'development'}
        size={23}
      />
      <b>{count}</b>
    </span>
  );
}

export function PlayerRail({
  room,
  game,
  me,
  timer,
  clockOffset,
  reducedMotion = false,
}: {
  room: RoomState;
  game: GameView;
  me?: string;
  timer?: ReactNode;
  clockOffset?: number;
  reducedMotion?: boolean;
}) {
  const rail = useRef<HTMLElement>(null);
  const ranked = rankedPlayers(game);
  usePlayerOrderMotion(rail, ranked.map((p) => p.player.id).join('|'), room.roomId, reducedMotion);
  const tied = ranked.filter((p) => p.leading).length > 1;
  const [now, setNow] = useState(Date.now);
  const fallback = useRef({ server: room.serverNow ?? Date.now(), local: Date.now() });
  if (room.serverNow !== undefined && room.serverNow !== fallback.current.server)
    fallback.current = { server: room.serverNow, local: Date.now() };
  const serverNow = now + (clockOffset ?? fallback.current.server - fallback.current.local);
  const counting =
    game.phase !== 'finished' && room.players.some((seat) => !seat.connected && seat.resignAt !== undefined);
  useEffect(() => {
    if (!counting) return;
    const update = () => setNow(Date.now());
    update();
    const interval = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [counting]);
  return (
    <aside ref={rail} className="player-rail" aria-label="Players">
      {ranked.map(({ player: p, seatIndex: i, publicPoints, leading }) => {
        const seat = room.players.find((s) => s.id === p.id),
          active = game.players[game.active]?.id === p.id && game.phase !== 'finished' && !p.resigned,
          activity = playerTurnActivity(game, p.id),
          road = game.longestRoad === p.id,
          army = game.largestArmy === p.id;
        return (
          <article
            key={p.id}
            data-player-profile={p.id}
            aria-label={`${p.name}${p.id === me ? ', your profile' : ''}${active ? ', current turn' : ''}`}
            className={`player-profile ${active ? 'active' : ''} ${p.id === me ? 'self' : ''} ${!seat?.connected ? 'offline' : ''} ${p.resigned ? 'has-resigned' : ''}`}
            style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
          >
            <div className="profile-portrait">
              <Avatar profile={seat?.profile ?? defaultProfile(p.name)} />
              {leading && (
                <span
                  className="profile-rank"
                  aria-label={`${tied ? 'Joint leader' : 'Leader'}, ${publicPoints} public points`}
                  title={`${tied ? 'Joint leader' : 'Leader'} · ${publicPoints} public points`}
                >
                  #1
                </span>
              )}
              {!seat?.connected && (
                <span className="offline-mark" role="img" title="Disconnected" aria-label="Disconnected">
                  <WifiOff size={38} />
                </span>
              )}
              {activity && (
                <span
                  className="profile-turn"
                  data-turn-activity={activity.icon}
                  title={activity.label}
                  aria-label={`${active ? 'Current turn: ' : ''}${activity.label}`}
                >
                  <GameIcon name={activity.icon} size={20} />
                  {active && timer}
                </span>
              )}
              <DisconnectStatus
                resigned={p.resigned}
                deadline={!seat?.connected && game.phase !== 'finished' ? seat?.resignAt : undefined}
                now={serverNow}
                paused={room.paused}
              />
            </div>
            <div className="profile-caption">
              <div className="profile-name-row">
                <strong className="profile-name-banner" title={p.name}>
                  {p.name}
                </strong>
                {(road || army) && (
                  <div className="profile-held-awards" aria-label="Awards">
                    {road && (
                      <span
                        className="profile-medal road-award"
                        title={`Longest Road · ${p.roadLength} connected roads · +2 points`}
                        aria-label={`Longest Road, plus 2 victory points, ${p.roadLength} connected roads`}
                      >
                        <GameIcon name="road-award" size={30} />
                      </span>
                    )}
                    {army && (
                      <span
                        className="profile-medal army-award"
                        title={`Largest Army · ${p.knights} Knights played · +2 points`}
                        aria-label={`Largest Army, plus 2 victory points, ${p.knights} Knights played`}
                      >
                        <GameIcon name="army-award" size={30} />
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="profile-details">
                <div className="profile-stats">
                  <span
                    className="profile-score"
                    title={`${p.points} victory points`}
                    aria-label={`${p.points} victory points`}
                  >
                    <Trophy size={23} />
                    <b>{p.points}</b>
                  </span>
                </div>
                <div className="profile-detail-grid">
                  <div className="profile-inventories">
                    <InventoryCount kind="resource" count={p.resourceCount} />
                    <InventoryCount kind="development" count={p.cardCount} />
                  </div>
                </div>
              </div>
            </div>
            {game.winner === p.id && (
              <div className="profile-awards">
                <span
                  className="award-ribbon winner"
                  title={game.finishReason === 'resignation' ? 'Winner by resignation' : 'Winner'}
                >
                  <Trophy />
                </span>
              </div>
            )}
          </article>
        );
      })}
    </aside>
  );
}
