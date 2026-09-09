import type { CSSProperties, ReactNode } from 'react';
import { Layers, ScrollText, Route, Shield, Trophy, WifiOff } from './GameIcons.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
export function PlayerRail({
  room,
  game,
  me,
  timer,
}: {
  room: RoomState;
  game: GameView;
  me?: string;
  timer?: ReactNode;
}) {
  return (
    <aside className="player-rail" aria-label="Players">
      {game.players.map((p, i) => {
        const seat = room.players.find((s) => s.id === p.id),
          active = game.players[game.active]?.id === p.id && !game.winner,
          road = game.longestRoad === p.id,
          army = game.largestArmy === p.id;
        return (
          <article
            key={p.id}
            data-player-profile={p.id}
            aria-label={`${p.name}${p.id === me ? ', your profile' : ''}${active ? ', current turn' : ''}`}
            className={`player-profile ${active ? 'active' : ''} ${p.id === me ? 'self' : ''}`}
            style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
          >
            <div className="profile-portrait">
              <Avatar profile={seat?.profile ?? defaultProfile(p.name)} />
              {!seat?.connected && (
                <span className="offline-mark" title="Disconnected" aria-label="Disconnected">
                  <WifiOff size={24} />
                </span>
              )}
              {active && (
                <span className="profile-turn" aria-label="Current turn">
                  <span className="turn-gem" />
                  {timer}
                </span>
              )}
              <span className="profile-score" title={`${p.points} victory points`}>
                <Trophy size={22} />
                <b>{p.points}</b>
              </span>
            </div>
            <div className="profile-caption">
              <strong title={p.name}>{p.name}</strong>
              <div className="profile-stats">
                <span title={`${p.resourceCount} resource cards`}>
                  <Layers size={20} />
                  {p.resourceCount}
                </span>
                <span title={`${p.cardCount} development cards`}>
                  <ScrollText size={20} />
                  {p.cardCount}
                </span>
              </div>
            </div>
            {(road || army || game.winner === p.id) && (
              <div className="profile-awards">
                {road && (
                  <span
                    key="road"
                    className="award-ribbon"
                    aria-label="Longest Road, plus 2 victory points"
                    title="Longest Road · +2 points"
                  >
                    <Route />
                    <b>+2</b>
                  </span>
                )}
                {army && (
                  <span
                    key="army"
                    className="award-ribbon"
                    aria-label="Largest Army, plus 2 victory points"
                    title="Largest Army · +2 points"
                  >
                    <Shield />
                    <b>+2</b>
                  </span>
                )}
                {game.winner === p.id && (
                  <span className="award-ribbon winner" title="Winner">
                    <Trophy />
                  </span>
                )}
              </div>
            )}
          </article>
        );
      })}
    </aside>
  );
}
