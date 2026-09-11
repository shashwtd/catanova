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
  WifiOff,
} from './GameIcons.js';
import { useEffect, useState } from 'react';
import type { RoomPreview, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { roomPath } from './navigation.js';

export function Invite({ code, roomId = code }: { code: string; roomId?: string }) {
  const [feedback, setFeedback] = useState('');
  const [showLink, setShowLink] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const url = () => `${location.origin}${roomPath(roomId)}`;
  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(message);
    } catch {
      setShowLink(true);
      setFeedback('Select the code or link to copy it');
    }
  }
  async function share() {
    if (!navigator.share) {
      setShowLink((value) => !value);
      return;
    }
    try {
      await navigator.share({ title: 'Join my Catanova room', url: url() });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShowLink(true);
    }
  }
  return (
    <div className="room-share">
      <span className="room-code-label">Room</span>
      <code>{code}</code>
      <div className="room-share-actions">
        <button type="button" aria-label="Share room" title="Share room" onClick={() => void share()}>
          <Share2 size={21} />
        </button>
        <button
          type="button"
          aria-label="Copy invite link"
          title="Copy invite link"
          onClick={() => void copy(url(), 'Link copied')}
        >
          <Link size={21} />
        </button>
        <button
          type="button"
          aria-label="Copy room code"
          title="Copy room code"
          onClick={() => void copy(code, 'Code copied')}
        >
          <Copy size={21} />
        </button>
      </div>
      {showLink && (
        <input
          className="share-link-field"
          aria-label="Room invite link"
          readOnly
          value={typeof location === 'undefined' ? roomPath(roomId) : url()}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {feedback && (
        <span className="copy-feedback" role="status">
          {feedback}
        </span>
      )}
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
}) {
  const self = room.players.find((p) => p.id === me),
    host = room.players[0]?.id === me;
  const canStart =
    room.players.length >= 2 && room.players.every((p, i) => p.connected && (i === 0 || p.ready));
  return (
    <section className="lobby-screen room-lobby" aria-label="Room lobby">
      <header className="lobby-heading">
        {self && (
          <button className="lobby-self" onClick={onEdit} aria-label="Edit your profile">
            <Avatar profile={self.profile ?? defaultProfile(self.name)} />
            <strong>{self.name}</strong>
          </button>
        )}
        <div className="lobby-tools">
          {onFriends && (
            <button className="icon-button" title="Friends" aria-label="Friends" onClick={onFriends}>
              <Users />
            </button>
          )}
          <button
            className="icon-button"
            title="Game settings"
            aria-label="Game settings"
            onClick={onSettings}
          >
            <Settings2 />
          </button>
          <button
            className="icon-button"
            title="Leave lobby"
            aria-label="Leave lobby"
            onClick={onLeave}
            disabled={busy}
          >
            <DoorOpen />
          </button>
        </div>
      </header>
      <div className="lobby-center">
        <div className="lobby-caption">
          <h1>Your crew</h1>
          <span>{room.players.length}/4</span>
        </div>
        <div className="lobby-seats">
          {Array.from({ length: 4 }, (_, i) => {
            const p = room.players[i];
            return p ? (
              <article
                className={`lobby-seat ${p.id === me ? 'self' : ''} ${!p.connected ? 'seat-offline' : ''}`}
                key={p.id}
              >
                <div className="lobby-avatar">
                  <Avatar profile={p.profile ?? defaultProfile(p.name)} />
                  {i === 0 && <Crown className="host-mark" size={23} />}
                  {!p.connected && (
                    <span className="offline-mark" title="Disconnected">
                      <WifiOff size={30} />
                    </span>
                  )}
                </div>
                <strong>{p.name}</strong>
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
            ) : (
              <button
                key={i}
                className="lobby-seat open-seat"
                aria-label="Invite player"
                title="Invite player"
                onClick={onInvite}
              >
                <Plus size={36} />
              </button>
            );
          })}
        </div>
        <button className="lobby-timer" onClick={onSettings}>
          <Clock3 size={16} />
          {room.settings?.turnTimerSeconds ? `${room.settings.turnTimerSeconds}s` : 'No timer'}
        </button>
      </div>
      <footer className="lobby-footer">
        <Invite code={room.roomCode ?? room.roomId} roomId={room.roomId} />
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
