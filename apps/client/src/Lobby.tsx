import { Check, Copy, Crown, DoorOpen, Pencil, Plus, Sailboat, Settings2, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RoomPreview, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
export function Invite({ code, copy }: { code: string; copy: () => void }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(''), 2500);
      return () => clearTimeout(timer);
    }
  }, [feedback]);
  return (
    <div className="invite-block">
      <span className="field-caption">Invite friends</span>
      <div className="invite-code">
        <code>{code}</code>
        <button
          type="button"
          aria-label="Copy room code"
          title="Copy room code"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => setFeedback('Code copied'),
              () => setFeedback('Select and copy the code above'),
            );
          }}
        >
          {feedback === 'Code copied' ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <button className="dark-button" onClick={copy}>
        <Copy size={17} />
        Copy invite link
      </button>
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
}) {
  const self = room.players.find((p) => p.id === me),
    host = room.players[0]?.id === me;
  const canStart =
    room.players.length >= 3 && room.players.every((p, i) => p.connected && (i === 0 || p.ready));
  return (
    <section className="lobby-screen" aria-label="Room lobby">
      <div className="lobby-heading">
        <div className="lobby-title">
          <Sailboat />
          <h1>Lobby</h1>
          <span>{room.players.length}/4</span>
        </div>
        <div className="lobby-tools">
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
      </div>
      <div className="lobby-content">
        <div className="lobby-seats">
          {Array.from({ length: 4 }, (_, i) => {
            const p = room.players[i];
            return p ? (
              <article className={`lobby-seat ${p.id === me ? 'self' : ''}`} key={p.id}>
                <div className="lobby-avatar">
                  <Avatar profile={p.profile ?? defaultProfile(p.name)} />
                  {i === 0 && <Crown className="host-mark" size={19} />}
                  {!p.connected && (
                    <span className="offline-mark" title="Disconnected">
                      <WifiOff size={19} />
                    </span>
                  )}
                </div>
                <strong>{p.name}</strong>
                <span className={`ready-status ${p.ready ? 'ready' : ''}`}>
                  {!p.connected ? (
                    <>
                      <WifiOff size={14} />
                      Disconnected
                    </>
                  ) : i === 0 ? (
                    'Host'
                  ) : p.ready ? (
                    <>
                      <Check size={14} />
                      Ready
                    </>
                  ) : (
                    'Getting ready'
                  )}
                </span>
                {p.id === me && (
                  <button className="edit-profile" onClick={onEdit} title="Customize your profile">
                    <Pencil size={13} />
                    Customize
                  </button>
                )}
              </article>
            ) : (
              <button
                key={i}
                className="lobby-seat open-seat"
                aria-label="Invite player"
                title="Invite player"
                onClick={onInvite}
              >
                <Plus size={32} />
              </button>
            );
          })}
        </div>
        <aside className="lobby-invite">
          <Invite code={room.roomId} copy={onInvite} />
          <div className="lobby-options">
            <span>Base game</span>
            <b>3–4 players</b>
            <span>Island</span>
            <b>Balanced</b>
            <span>Victory</span>
            <b>10 points</b>
            <span>Turn timer</span>
            <b>{room.settings?.turnTimerSeconds ? `${room.settings.turnTimerSeconds}s` : 'Off'}</b>
          </div>
        </aside>
      </div>
      <footer className="lobby-footer">
        <span>
          {room.players.length < 3
            ? '3 players minimum'
            : !room.players.every((p) => p.connected)
              ? 'Waiting for reconnection'
              : canStart
                ? host
                  ? 'Everyone is ready'
                  : 'Waiting for host'
                : 'Waiting for players to ready up'}
        </span>
        <div>
          {!host && (
            <button
              className={self?.ready ? 'dark-button' : 'gold-button'}
              aria-pressed={!!self?.ready}
              disabled={busy || !connected}
              onClick={() => onReady(!self?.ready)}
            >
              <Check size={18} />
              {self?.ready ? 'Not ready' : 'Ready'}
            </button>
          )}
          {host && (
            <button className="gold-button" disabled={busy || !connected || !canStart} onClick={onStart}>
              Start game
              <Sailboat size={18} />
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
