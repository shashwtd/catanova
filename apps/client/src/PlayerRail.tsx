import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { GameIcon, Route, Shield, Trophy, WifiOff } from './GameIcons.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
import { playerTurnActivity } from './turn-activity.js';
import { DisconnectStatus } from './DisconnectStatus.js';

function InventoryCount({ kind, count }: { kind: 'resource' | 'development'; count: number }) {
  const label = `${count} ${kind === 'resource' ? 'resource' : 'development'} cards`;
  return (
    <span className={`profile-${kind}-count`} data-empty={count === 0} title={label} aria-label={label}>
      <svg className="profile-inventory-art" viewBox="0 0 30 30" aria-hidden="true" fill="none">
        {kind === 'resource' ? (
          <>
            <rect
              x="3"
              y="6"
              width="15"
              height="21"
              rx="2.5"
              transform="rotate(-12 3 6)"
              fill="#b96b49"
              stroke="#f0c18b"
            />
            <rect
              x="10"
              y="3"
              width="15"
              height="21"
              rx="2.5"
              transform="rotate(10 10 3)"
              fill="#467963"
              stroke="#b7d3a1"
            />
            <rect x="9" y="7" width="15" height="21" rx="2.5" fill="#dfbb71" stroke="#fff0c5" />
            <path d="M12 10h9v15h-9z" stroke="#aa7c3d" strokeWidth=".7" />
            <path d="m16.5 13 3.5 4.5-3.5 4.5-3.5-4.5Z" fill="#8e6335" />
          </>
        ) : (
          <>
            <rect
              x="5"
              y="3"
              width="17"
              height="23"
              rx="2.5"
              transform="rotate(-9 5 3)"
              fill="#554574"
              stroke="#a8a2c8"
            />
            <rect x="9" y="6" width="17" height="23" rx="2.5" fill="#716299" stroke="#d9ccec" />
            <path d="M12 9h11v17H12z" stroke="#b8a5d4" strokeWidth=".7" />
            <path d="m17.5 12 1.5 3.5 3.5 2-3.5 1.5-1.5 4-1.5-4-3.5-1.5 3.5-2Z" fill="#f2dcaa" />
          </>
        )}
      </svg>
      <b>{count}</b>
    </span>
  );
}

function AwardEmblem({ kind, held }: { kind: 'road' | 'army'; held: boolean }) {
  const Icon = kind === 'road' ? Route : Shield;
  return (
    <span className="profile-award-emblem" aria-hidden="true">
      {held && (
        <img
          src={
            kind === 'road'
              ? '/art/optimized/simple-road-award.a16c85e5b0e5.webp'
              : '/art/optimized/simple-army-award.8e351c70c123.webp'
          }
          width="32"
          height="32"
          alt=""
        />
      )}

      {!held && <Icon size={15} />}
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
              <DisconnectStatus
                resigned={p.resigned}
                deadline={!seat?.connected && game.phase !== 'finished' ? seat?.resignAt : undefined}
                now={serverNow}
                paused={room.paused}
              />
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
                <InventoryCount kind="resource" count={p.resourceCount} />
                <InventoryCount kind="development" count={p.cardCount} />
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
