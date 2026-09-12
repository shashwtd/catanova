import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { GameIcon, Layers, ScrollText, Route, Shield, Trophy, WifiOff } from './GameIcons.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
import { playerTurnActivity } from './turn-activity.js';
import { DisconnectStatus } from './DisconnectStatus.js';
function AwardEmblem({ kind, held }: { kind: 'road' | 'army'; held: boolean }) {
  const Icon = kind === 'road' ? Route : Shield;
  return (
    <span className="profile-award-emblem" aria-hidden="true">
      {held && (
        <svg className="award-laurel" viewBox="0 0 36 36" fill="none">
          <path
            d="M15 31C3 27 3 12 11 6M21 31C33 27 33 12 25 6M8 11l-4-2m3 8-4-2m5 9-4-1m9 6-4 2M28 11l4-2m-3 8 4-2m-5 9 4-1m-9 6 4 2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="m18 2 2 3-2 3-2-3Z" fill="currentColor" />
        </svg>
      )}
      <Icon size={held ? 20 : 15} />
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
      {game.players.map((p, i) => {
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
            </div>
            <div className="profile-caption">
              <strong className="profile-name-banner" title={p.name}>
                {p.name}
              </strong>
              <div className="profile-stats">
                <span
                  className="profile-score"
                  title={`${p.points} victory points`}
                  aria-label={`${p.points} victory points`}
                >
                  <Trophy size={23} />
                  <b>{p.points}</b>
                </span>
                <span
                  className="profile-resource-count"
                  title={`${p.resourceCount} resource cards`}
                  aria-label={`${p.resourceCount} resource cards`}
                >
                  <Layers size={23} />
                  <b>{p.resourceCount}</b>
                </span>
                <span
                  className="profile-development-count"
                  title={`${p.cardCount} development cards`}
                  aria-label={`${p.cardCount} development cards`}
                >
                  <ScrollText size={23} />
                  <b>{p.cardCount}</b>
                </span>
              </div>
              <div className="profile-achievements" aria-label="Award progress">
                <span
                  className={`profile-achievement ${road ? 'held road-award' : ''}`}
                  aria-label={`${road ? 'Longest Road, plus 2 victory points' : 'Longest route'}, ${p.roadLength} connected roads`}
                  title={`Longest Road · ${p.roadLength} connected roads · ${road ? '+2 points' : 'At least 5 to claim'}`}
                >
                  <AwardEmblem kind="road" held={road} />
                  <b>{p.roadLength}</b>
                  {road && <small>+2</small>}
                </span>
                <span
                  className={`profile-achievement ${army ? 'held army-award' : ''}`}
                  aria-label={`${army ? 'Largest Army, plus 2 victory points' : 'Knights played'}, ${p.knights} Knights played`}
                  title={`Largest Army · ${p.knights} Knights played · ${army ? '+2 points' : 'At least 3 to claim'}`}
                >
                  <AwardEmblem kind="army" held={army} />
                  <b>{p.knights}</b>
                  {army && <small>+2</small>}
                </span>
              </div>
              <DisconnectStatus
                resigned={p.resigned}
                deadline={!seat?.connected && game.phase !== 'finished' ? seat?.resignAt : undefined}
                now={serverNow}
                paused={room.paused}
              />
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
