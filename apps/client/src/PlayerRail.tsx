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
import { playerStandings } from './player-ranking.js';
import { CardTooltip } from './CardTooltip.js';

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

export function AwardStandings({ game, kind }: { game: GameView; kind: 'longestRoad' | 'largestArmy' }) {
  const field = kind === 'longestRoad' ? 'roadLength' : 'knights';
  const players = game.players
    .map((player, seat) => ({ player, seat }))
    .sort((a, b) => b.player[field] - a.player[field] || a.seat - b.seat);
  return (
    <span className="award-standings">
      <strong>{kind === 'longestRoad' ? 'Longest Road' : 'Largest Army'}</strong>
      <small>{kind === 'longestRoad' ? 'Connected roads · minimum 5' : 'Knights played · minimum 3'}</small>
      <span role="list" aria-label="Award standings">
        {players.map(({ player }) => (
          <span
            role="listitem"
            key={player.id}
            data-holder={game[kind] === player.id}
            aria-label={`${player.name}: ${player[field]}${game[kind] === player.id ? ', award holder' : ''}`}
          >
            <span>{player.name}</span>
            <b>{player[field]}</b>
          </span>
        ))}
      </span>
    </span>
  );
}

export function PlayerRail({
  room,
  game,
  me,
  timer,
  clockOffset,
}: {
  room: RoomState;
  game: GameView;
  me?: string;
  timer?: ReactNode;
  clockOffset?: number;
}) {
  const ranked = playerStandings(game);
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
    <aside className="player-rail" aria-label="Players">
      {ranked.map(({ player: p, seatIndex: i, points, leading }) => {
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
                  aria-label={`${tied ? 'Joint leader' : 'Leader'}, ${points} points`}
                  title={`${tied ? 'Joint leader' : 'Leader'} · ${points} points`}
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
            {(road || army) && (
              <div className="profile-held-awards" aria-label="Awards">
                {road && (
                  <CardTooltip disabledMotion content={<AwardStandings game={game} kind="longestRoad" />}>
                    <span
                      className="profile-medal road-award"
                      aria-label={`Longest Road, plus 2 victory points, ${p.roadLength} connected roads`}
                    >
                      <GameIcon name="road-award" size={30} />
                    </span>
                  </CardTooltip>
                )}
                {army && (
                  <CardTooltip disabledMotion content={<AwardStandings game={game} kind="largestArmy" />}>
                    <span
                      className="profile-medal army-award"
                      aria-label={`Largest Army, plus 2 victory points, ${p.knights} Knights played`}
                    >
                      <GameIcon name="army-award" size={30} />
                    </span>
                  </CardTooltip>
                )}
              </div>
            )}
          </article>
        );
      })}
    </aside>
  );
}
