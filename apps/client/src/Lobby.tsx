import { DEFAULT_VICTORY_POINTS } from '../../../packages/rules/src/victory.js';
import {
  Check,
  Clock3,
  Copy,
  Crown,
  DoorOpen,
  Link,
  Plus,
  Sailboat,
  Settings2,
  Share2,
  Users,
  Trophy,
  WifiOff,
} from './GameIcons.js';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RoomPreview, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { roomPath, visibleRoomCode } from './navigation.js';

export function Invite({ code, roomId = code ?? '' }: { code?: string; roomId?: string }) {
  const [feedback, setFeedback] = useState<{ kind: 'code' | 'link'; request: number } | null>(null);
  const [manual, setManual] = useState<'code' | 'link' | null>(null);
  const request = useRef(0);
  const target = `${roomId}:${code}`;
  const currentTarget = useRef(target);
  currentTarget.current = target;
  useEffect(() => {
    setFeedback(null);
    setManual(null);
    return () => {
      request.current++;
    };
  }, [target]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const url = () => `${location.origin}${roomPath(roomId)}`;
  async function copy(value: string, kind: 'code' | 'link') {
    const id = ++request.current;
    setFeedback(null);
    setManual(null);
    try {
      await navigator.clipboard.writeText(value);
      if (id === request.current && currentTarget.current === target) setFeedback({ kind, request: id });
    } catch {
      if (id === request.current && currentTarget.current === target) setManual(kind);
    }
  }
  async function share() {
    const id = ++request.current;
    setFeedback(null);
    if (!navigator.share) {
      setManual((value) => (value === 'link' ? null : 'link'));
      return;
    }
    try {
      await navigator.share({ title: 'Join my Catanova room', url: url() });
    } catch (error) {
      if (
        !(error instanceof Error && error.name === 'AbortError') &&
        id === request.current &&
        currentTarget.current === target
      )
        setManual('link');
    }
  }
  return (
    <div className="room-share">
      <span className="room-code-label">Room</span>
      {code ? <code>{code}</code> : <span className="room-code-unavailable">Share this room</span>}
      <div className="room-share-actions">
        <button type="button" aria-label="Share room" title="Share room" onClick={() => void share()}>
          <Share2 size={21} />
        </button>
        <button
          type="button"
          aria-label={feedback?.kind === 'link' ? 'Invite link copied' : 'Copy invite link'}
          title={feedback?.kind === 'link' ? 'Copied' : 'Copy invite link'}
          className={feedback?.kind === 'link' ? 'copy-done' : undefined}
          onClick={() => void copy(url(), 'link')}
        >
          {feedback?.kind === 'link' ? <Check size={21} /> : <Link size={21} />}
        </button>
        <button
          type="button"
          aria-label={feedback?.kind === 'code' ? 'Room code copied' : 'Copy room code'}
          title={feedback?.kind === 'code' ? 'Copied' : 'Copy room code'}
          className={feedback?.kind === 'code' ? 'copy-done' : undefined}
          disabled={!code}
          onClick={() => {
            if (code) void copy(code, 'code');
          }}
        >
          {feedback?.kind === 'code' ? <Check size={21} /> : <Copy size={21} />}
        </button>
      </div>
      {manual && (
        <input
          className="share-link-field"
          aria-label={manual === 'code' ? 'Room code to copy' : 'Room invite link'}
          readOnly
          autoFocus
          value={manual === 'code' ? code : typeof location === 'undefined' ? roomPath(roomId) : url()}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <span className="room-share-status" role="status" aria-live="polite">
        {feedback
          ? feedback.kind === 'code'
            ? 'Room code copied'
            : 'Invite link copied'
          : manual
            ? 'Select the value and copy it'
            : ''}
      </span>
    </div>
  );
}
export function Lobby({
  room,
  me,
  busy,
  connected,
  onReady,
  onStart,
  onInvite,
  onLeave,
  onEdit,
  onSettings,
  onFriends,
  onKick,
}: {
  room: RoomState;
  me?: string;
  busy: boolean;
  connected: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onInvite: () => void;
  onLeave: () => void;
  onEdit: () => void;
  onSettings: () => void;
  onFriends?: () => void;
  onKick?: (playerId: string) => Promise<void>;
}) {
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const [kickError, setKickError] = useState('');
  const [kicking, setKicking] = useState(false);
  const self = room.players.find((p) => p.id === me),
    host = room.players[0]?.id === me;
  const canStart =
    room.players.length >= 2 && room.players.every((p, i) => p.connected && (i === 0 || p.ready));
  return (
    <section className="lobby-screen room-lobby" aria-label="Room lobby">
      <header className="lobby-heading">
        <button
          type="button"
          className="lobby-back"
          onClick={onLeave}
          disabled={busy}
          aria-label="Leave lobby"
        >
          <DoorOpen size={20} />
          <span>Leave lobby</span>
        </button>
        <div className="lobby-tools">
          {onFriends && (
            <button className="icon-button" title="Friends" aria-label="Friends" onClick={onFriends}>
              <Users />
            </button>
          )}
        </div>
      </header>
      <div className="lobby-center">
        <div className="lobby-caption">
          <h1>Game room</h1>
          <div className="lobby-room-options">
            <button className="lobby-goal" onClick={onSettings} aria-label="Points to win. Game settings">
              <Trophy size={18} />
              <span>{room.settings?.victoryPoints ?? DEFAULT_VICTORY_POINTS} points</span>
            </button>
            <button
              type="button"
              className="lobby-timer"
              onClick={onSettings}
              aria-label={
                room.settings?.turnTimerSeconds
                  ? `Turn timer: ${room.settings.turnTimerSeconds} seconds. Game settings`
                  : 'Turn timer off. Game settings'
              }
            >
              <Clock3 size={18} />
              <span>
                Turn timer{' '}
                <b>{room.settings?.turnTimerSeconds ? `${room.settings.turnTimerSeconds}s` : 'Off'}</b>
              </span>
            </button>
          </div>
        </div>
        <div className={`lobby-seats ${room.players.length === 4 ? 'lobby-full' : ''}`}>
          {room.players.length < 3 ? (
            <button
              type="button"
              className="lobby-invite-tile"
              aria-label="Invite player"
              title="Invite player"
              onClick={onInvite}
            >
              <Plus size={32} />
            </button>
          ) : room.players.length < 4 ? (
            <span className="lobby-invite-spacer" aria-hidden="true" />
          ) : null}
          <div
            className="lobby-player-line"
            style={{ '--room-player-count': room.players.length } as CSSProperties}
          >
            {room.players.map((p, i) => (
              <article
                className={`lobby-seat ${p.id === me ? 'self' : ''} ${!p.connected ? 'seat-offline' : ''}`}
                key={p.id}
              >
                {p.id === me && (
                  <button
                    type="button"
                    className="lobby-seat-edit"
                    onClick={onEdit}
                    aria-label="Your profile"
                    title="Edit profile"
                  >
                    Edit
                  </button>
                )}
                {host && p.id !== me && onKick && (
                  <details
                    className="lobby-player-info"
                    onToggle={() => {
                      setConfirmKick(null);
                      setKickError('');
                    }}
                  >
                    <summary aria-label={`Player info for ${p.name}`} title="Player info">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M12 11v6" stroke="currentColor" strokeWidth="2" />
                        <circle cx="12" cy="7.5" r="1" fill="currentColor" />
                      </svg>
                    </summary>
                    <div className="lobby-player-menu">
                      <strong>{p.name}</strong>
                      <span>{p.connected ? 'In this lobby' : 'Disconnected'}</span>
                      {confirmKick === p.id ? (
                        <>
                          <p>Remove {p.name} from the lobby?</p>
                          <button
                            disabled={busy || kicking || !connected}
                            onClick={async () => {
                              setKicking(true);
                              setKickError('');
                              try {
                                await onKick(p.id);
                                setConfirmKick(null);
                              } catch (error) {
                                setKickError(
                                  error instanceof Error ? error.message : 'Could not remove player',
                                );
                              } finally {
                                setKicking(false);
                              }
                            }}
                          >
                            {kicking ? 'Removing…' : 'Confirm removal'}
                          </button>
                          <button disabled={kicking} onClick={() => setConfirmKick(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button disabled={busy || !connected} onClick={() => setConfirmKick(p.id)}>
                          Remove player
                        </button>
                      )}
                      {kickError && <p role="alert">{kickError}</p>}
                    </div>
                  </details>
                )}
                <div className="lobby-avatar">
                  <Avatar profile={p.profile ?? defaultProfile(p.name)} />
                  {i === 0 && <Crown className="host-mark" size={34} />}
                  {!p.connected && (
                    <span className="offline-mark" title="Disconnected">
                      <WifiOff size={30} />
                    </span>
                  )}
                </div>
                <strong title={p.name}>{p.name}</strong>
                <span className={`ready-status ${p.ready ? 'ready' : ''}`}>
                  {!p.connected ? (
                    'Disconnected'
                  ) : i === 0 ? (
                    'Host'
                  ) : p.ready ? (
                    <>
                      <Check size={16} />
                      Ready
                    </>
                  ) : (
                    'Not ready'
                  )}
                </span>
              </article>
            ))}
          </div>
          {room.players.length < 4 && (
            <button
              type="button"
              className="lobby-invite-tile"
              aria-label="Invite player"
              title="Invite player"
              onClick={onInvite}
            >
              <Plus size={32} />
            </button>
          )}
        </div>
      </div>
      <footer className="lobby-footer">
        <Invite code={visibleRoomCode(room) ?? undefined} roomId={room.roomId} />
        <div className="lobby-launch">
          <span role="status">
            {room.players.length < 2
              ? 'Invite another player'
              : !room.players.every((p) => p.connected)
                ? 'Waiting for reconnection'
                : canStart
                  ? host
                    ? 'Everyone is ready'
                    : 'Waiting for host'
                  : 'Waiting for players'}
          </span>
          <div className="lobby-start-controls">
            <button
              className="lobby-configure"
              onClick={onSettings}
              disabled={busy}
              aria-label="Game settings"
            >
              <Settings2 size={22} />
              <span>Settings</span>
            </button>
            {host ? (
              <button className="gold-button" disabled={busy || !connected || !canStart} onClick={onStart}>
                Start game
                <Sailboat size={21} />
              </button>
            ) : (
              <button
                className={self?.ready ? 'dark-button' : 'gold-button'}
                aria-pressed={!!self?.ready}
                disabled={busy || !connected}
                onClick={() => onReady(!self?.ready)}
              >
                <Check size={21} />
                {self?.ready ? 'Not ready' : 'Ready'}
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}
export function InviteRoster({ room }: { room: RoomPreview }) {
  return (
    <div className="invite-roster">
      {room.players.map((p) => (
        <div key={p.id}>
          <Avatar profile={p.profile ?? defaultProfile(p.name)} />
          <span>{p.name}</span>
        </div>
      ))}
      <span className="invite-capacity">{room.players.length}/4</span>
    </div>
  );
}
