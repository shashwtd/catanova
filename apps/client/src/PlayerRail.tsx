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
            className={`player-profile ${active ? 'active' : ''} ${p.id === me ? 'self' : ''} ${!seat?.connected ? 'offline' : ''}`}
            style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
          >
            <div className="profile-portrait">
              <Avatar profile={seat?.profile ?? defaultProfile(p.name)} />
              {!seat?.connected && (
                <span className="offline-mark" role="img" title="Disconnected" aria-label="Disconnected">
                  <svg
                    className="profile-offline-distress"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M0 13h32v4H0Zm48-1h52v7H48ZM0 32h71v3H0Zm82-2h18v7H82ZM0 62h18v8H0Zm29 3h71v4H29ZM0 83h60v5H0Zm73-2h27v3H73Z"
                      fill="#ec8c7952"
                    />
                    <path
                      d="M0 22h49m18 0h33M0 52h24m51 0h25M0 76h37m29 0h34M17 0l-4 12m71 71-4 15M0 94h100"
                      fill="none"
                      stroke="#ffd6be8c"
                      strokeWidth="1"
                    />
                    <path d="M0 43h18v3H0m81-19h19v4H81M0 71h9v5H0m83 17h17v5H83" fill="#682c2d99" />
                  </svg>
                  <span className="profile-offline-symbol" aria-hidden="true">
                    <WifiOff size={38} />
                    <span>Offline</span>
                  </span>
                </span>
              )}
              {active && (
                <span className="profile-turn" aria-label="Current turn">
                  <span className="profile-turn-label">Turn</span>
                  {timer}
                </span>
              )}
            </div>
            <div className="profile-caption">
              <strong className="profile-name-banner" title={p.name}>
                {p.name}
              </strong>
              <span
                className="profile-score profile-score-plaque"
                role="img"
                title={`${p.points} victory points`}
                aria-label={`${p.points} victory points`}
              >
                <b aria-hidden="true">{p.points}</b>
                <span className="profile-score-unit" aria-hidden="true">
                  VP
                </span>
              </span>
              <div className="profile-stats">
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
            </div>
            {(road || army || game.winner === p.id) && (
              <div className="profile-awards">
                {road && (
                  <span
                    key="road"
                    className="award-ribbon road-award"
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
                    className="award-ribbon army-award"
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
