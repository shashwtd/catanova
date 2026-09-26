import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BotMark, GameIcon, Trophy, WifiOff } from './GameIcons.js';
import type { GameView, PlayerView } from '../../../packages/rules/src/game.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { ABSENCE_AFTER_MS } from '../../../packages/protocol/src/settings.js';
import { findRuleset, routeAwardName } from '../../../packages/rules/src/rulesets.js';
import { Avatar } from './Profile.js';
import { seatColorMap } from './player-colors.js';
import { playerTurnActivity } from './turn-activity.js';
import { DisconnectStatus } from './DisconnectStatus.js';
import { playerStandings } from './player-ranking.js';
import { CardTooltip } from './CardTooltip.js';
import type { FriendStatus } from './social-presence.js';

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

/**
 * Road length and Knights played: the race for Longest Road and Largest Army,
 * on a small plate at the foot of the portrait so the name and the counters
 * beside it keep their room. The holder's number is gilded like the medal.
 */
function AwardCounts({
  player,
  road,
  army,
  sea,
}: {
  player: PlayerView;
  road: boolean;
  army: boolean;
  sea: boolean;
}) {
  // Open Sea counts ships too, and calls the award Longest Route (docs/RULEBOOK-OPEN-SEA.md, 11.1).
  const roads = sea
    ? `Longest route: ${player.roadLength}${road ? ', holds Longest Route' : ''}`
    : `Longest road: ${player.roadLength}${road ? ', holds Longest Road' : ''}`;
  const knights = `Knights played: ${player.knights}${army ? ', holds Largest Army' : ''}`;
  return (
    <span className="profile-award-counts">
      <span className="profile-road-count" data-held={road} title={roads} aria-label={roads}>
        <GameIcon name="road" size={17} />
        <b>{player.roadLength}</b>
      </span>
      <span className="profile-knight-count" data-held={army} title={knights} aria-label={knights}>
        <GameIcon name="swords" size={17} />
        <b>{player.knights}</b>
      </span>
    </span>
  );
}

/** How the rail offers friend requests, for a viewer with a Google account. */
export type RailFriendship = {
  /** The viewer's own account, never offered. */
  self: string;
  status: (accountId: string) => FriendStatus;
  /** Both report their own failures and resolve either way. */
  request: (accountId: string) => Promise<unknown>;
  accept: (accountId: string) => Promise<unknown>;
};

/**
 * Add someone at the table as a friend, or accept their request, from a small
 * button on the corner of their portrait. It shows while the card is hovered or
 * focused, or once it is tapped, so the rail stays quiet until it is wanted.
 */
function FriendButton({
  name,
  accountId,
  friendship,
}: {
  name: string;
  accountId: string;
  friendship: RailFriendship;
}) {
  const [busy, setBusy] = useState(false);
  const status = friendship.status(accountId);
  if (status === 'friends') return null;
  if (status === 'sent')
    return (
      <span
        className="profile-friend"
        data-status="sent"
        role="img"
        title="Friend request sent"
        aria-label={`Friend request sent to ${name}`}
      >
        <GameIcon name="light-check" size={15} />
      </span>
    );
  const accepting = status === 'received';
  const label = accepting ? `Accept ${name}’s friend request` : `Add ${name} as a friend`;
  return (
    <button
      type="button"
      className="profile-friend"
      data-status={status}
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void (accepting ? friendship.accept : friendship.request)(accountId).finally(() => setBusy(false));
      }}
    >
      <GameIcon name="add-friend" size={16} />
    </button>
  );
}

export function AwardStandings({ game, kind }: { game: GameView; kind: 'longestRoad' | 'largestArmy' }) {
  const field = kind === 'longestRoad' ? 'roadLength' : 'knights';
  const sea = !!findRuleset(game.ruleset)?.sea;
  const players = game.players
    .map((player, seat) => ({ player, seat }))
    .sort((a, b) => b.player[field] - a.player[field] || a.seat - b.seat);
  return (
    <span className="award-standings">
      <strong>{kind === 'longestRoad' ? routeAwardName(findRuleset(game.ruleset)) : 'Largest Army'}</strong>
      <small>
        {kind === 'largestArmy'
          ? 'Knights played · minimum 3'
          : sea
            ? 'Connected roads and ships · minimum 5'
            : 'Connected roads · minimum 5'}
      </small>
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
  friendship,
}: {
  room: RoomState;
  game: GameView;
  me?: string;
  timer?: ReactNode;
  clockOffset?: number;
  friendship?: RailFriendship;
}) {
  const ranked = playerStandings(game);
  // Keyed by player, not by seat number: the game shuffles the order when it
  // starts, so the rail's third portrait is not the room's third seat.
  const colors = seatColorMap(room.players);
  const tied = ranked.filter((p) => p.leading).length > 1;
  const rail = useRef<HTMLElement>(null);
  /**
   * Publish how tall the rail actually is.
   *
   * On a phone everything below it — the prompt, the tools, the top of the
   * board — used to be placed against a constant, so a table of two left a
   * band of empty wood where a third row of portraits would have been, and a
   * table of four overflowed it. The rail is the only thing that knows.
   */
  useEffect(() => {
    const node = rail.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const publish = () =>
      document.documentElement.style.setProperty('--rail-height', `${Math.round(node.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--rail-height');
    };
  }, []);
  /** The card whose friend button a tap has shown, where there is no hover to show it. */
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!revealed) return;
    const away = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.('[data-player-profile]');
      if (card?.getAttribute('data-player-profile') !== revealed) setRevealed(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [revealed]);
  const [now, setNow] = useState(Date.now);
  const fallback = useRef({ server: room.serverNow ?? Date.now(), local: Date.now() });
  if (room.serverNow !== undefined && room.serverNow !== fallback.current.server)
    fallback.current = { server: room.serverNow, local: Date.now() };
  const serverNow = now + (clockOffset ?? fallback.current.server - fallback.current.local);
  // Classic covers an empty seat with a stand-in; a mode without one says when the clock takes over.
  const standIns = findRuleset(game.ruleset)?.standIns ?? true;
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
    <aside className="player-rail" aria-label="Players" ref={rail}>
      {ranked.map(({ player: p, seatIndex: i, points, leading }) => {
        const seat = room.players.find((s) => s.id === p.id),
          active = game.players[game.active]?.id === p.id && game.phase !== 'finished' && !p.resigned,
          activity = playerTurnActivity(game, p.id),
          road = game.longestRoad === p.id,
          army = game.largestArmy === p.id,
          sea = !!findRuleset(game.ruleset)?.sea;
        return (
          <article
            key={p.id}
            data-player-profile={p.id}
            aria-label={`${p.name}${p.id === me ? ', your profile' : ''}${active ? ', current turn' : ''}`}
            className={`player-profile ${active ? 'active' : ''} ${p.id === me ? 'self' : ''} ${!seat?.connected ? 'offline' : ''} ${p.resigned ? 'has-resigned' : ''}`}
            style={{ '--player-color': colors[p.id] } as CSSProperties}
            data-friend-reveal={revealed === p.id || undefined}
            onClick={friendship ? () => setRevealed(p.id) : undefined}
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
                standIn={!!seat?.standIn && game.phase !== 'finished'}
                deadline={!seat?.connected && game.phase !== 'finished' ? seat?.resignAt : undefined}
                now={serverNow}
                paused={room.paused}
                {...(!standIns && seat?.disconnectedAt !== undefined
                  ? { forcedMovesAt: seat.disconnectedAt + ABSENCE_AFTER_MS }
                  : {})}
              />
              <AwardCounts player={p} road={road} army={army} sea={sea} />
              {friendship && seat?.accountId && seat.accountId !== friendship.self && (
                <FriendButton name={p.name} accountId={seat.accountId} friendship={friendship} />
              )}
            </div>
            <div className="profile-caption">
              <div className="profile-name-row">
                <strong className="profile-name-banner" title={p.name}>
                  {p.name}
                </strong>
                {(seat?.bot || seat?.standIn) && <BotMark level={seat.botLevel} size={16} />}
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
                      aria-label={
                        sea
                          ? `Longest Route, plus 2 victory points, ${p.roadLength} connected roads and ships`
                          : `Longest Road, plus 2 victory points, ${p.roadLength} connected roads`
                      }
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
