import type { CSSProperties } from 'react';
import { Castle, House, Layers, Route, ScrollText, Shield, Swords, Trophy, WifiOff } from 'lucide-react';
import type { GameView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
export function PlayerRail({ room, game, me }: { room: RoomState; game: GameView; me?: string }) {
  return (
    <aside className="player-rail" aria-label="Players">
      {game.players.map((p, i) => {
        const seat = room.players.find((s) => s.id === p.id),
          road = game.longestRoad === p.id,
          army = game.largestArmy === p.id;
        return (
          <article
            data-player-profile={p.id}
            key={p.id}
            className={`player-profile ${game.players[game.active]?.id === p.id ? 'active' : ''} ${p.id === me ? 'self' : ''}`}
            style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
          >
            <div className="player-heading">
              <div className="profile-portrait">
                <Avatar profile={seat?.profile ?? defaultProfile(p.name)} />
                {!seat?.connected && (
                  <span className="offline-mark" title="Disconnected" aria-label="Disconnected">
                    <WifiOff size={19} />
                  </span>
                )}
              </div>
              <div className="profile-name">
                <strong title={p.name}>{p.name}</strong>
                <span>
                  {!seat?.connected
                    ? 'Disconnected'
                    : p.id === me
                      ? 'You'
                      : game.players[game.active]?.id === p.id
                        ? 'Playing'
                        : 'Connected'}
                </span>
              </div>
              <span className="profile-score" title="Victory points">
                <Trophy size={15} />
                <b>{p.points}</b>
              </span>
            </div>
            <div className="profile-stats">
              <span title="Resource cards">
                <Layers />
                {p.resourceCount}
              </span>
              <span title="Development cards">
                <ScrollText />
                {p.cardCount}
              </span>
              <span title="Played knights">
                <Swords />
                {p.knights}
              </span>
              <span title="Longest continuous road">
                <Route />
                {p.roadLength}
              </span>
            </div>
            <div className="profile-pieces">
              <span title="Roads built">
                <Route />
                {p.pieces.roads}/15
              </span>
              <span title="Settlements built">
                <House />
                {p.pieces.settlements}/5
              </span>
              <span title="Cities built">
                <Castle />
                {p.pieces.cities}/4
              </span>
            </div>
            {(road || army || game.winner === p.id) && (
              <div className="profile-awards">
                {road && (
                  <span key="road" className="award-ribbon" title="Longest Road · +2 victory points">
                    <Route size={15} />
                    Longest Road
                    <span className="t-badge" data-open="true">
                      <span className="t-badge-dot">+2</span>
                    </span>
                  </span>
                )}
                {army && (
                  <span key="army" className="award-ribbon" title="Largest Army · +2 victory points">
                    <Shield size={15} />
                    Largest Army
                    <span className="t-badge" data-open="true">
                      <span className="t-badge-dot">+2</span>
                    </span>
                  </span>
                )}
                {game.winner === p.id && (
                  <span className="award-ribbon winner">
                    <Trophy size={15} />
                    Winner
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
