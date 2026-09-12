import { DEFAULT_VICTORY_POINTS } from '../../../packages/rules/src/victory.js';
import {
  Check,
  Clock3,
  Dices,
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
import { useEffect, useRef, useState, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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
function RoomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="game-dialog lobby-sheet"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-surface">
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </dialog>
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
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [infoPlayer, setInfoPlayer] = useState<string | null>(null);
  const selectedPlayer = room.players.find((p) => p.id === infoPlayer);
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
          onClick={() => setConfirmLeave(true)}
          disabled={busy}
          aria-label="Leave lobby"
        >
          <DoorOpen size={20} />
          <span>Leave lobby</span>
        </button>
        <div className="lobby-tools">
          {onFriends && (
            <button className="lobby-friends" title="Friends" aria-label="Friends" onClick={onFriends}>
              <Users />
              <span>Friends</span>
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
            <button className="lobby-dice-rule" onClick={onSettings} aria-label="Dice mode. Game settings">
              <Dices size={18} />
              <span>{room.settings?.diceMode === 'balanced' ? 'Balanced' : 'Natural'} dice</span>
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
                {p.id !== me && (
                  <button
                    type="button"
                    className="lobby-player-info"
                    aria-label={`Player info for ${p.name}`}
                    onClick={() => {
                      setInfoPlayer(p.id);
                      setConfirmKick(null);
                      setKickError('');
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="19" cy="12" r="2" />
                    </svg>
                  </button>
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
              className="lobby-configure hub-room-button"
              onClick={onSettings}
              disabled={busy}
              aria-label="Game settings"
            >
              <Settings2 size={22} />
              <span>Settings</span>
            </button>
            {host ? (
              <button
                className="gold-button hub-room-button hub-create-button"
                disabled={busy || !connected || !canStart}
                onClick={onStart}
              >
                Start game
                <Sailboat size={21} />
              </button>
            ) : (
              <button
                className={`hub-room-button ${self?.ready ? 'dark-button' : 'gold-button hub-create-button'}`}
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
      {confirmLeave && (
        <RoomSheet title="Leave this lobby?" onClose={() => setConfirmLeave(false)}>
          <p>Your seat will be released.</p>
          <div className="room-sheet-actions">
            <button autoFocus className="hub-room-button" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
            <button
              className="lobby-back"
              disabled={busy}
              onClick={() => {
                setConfirmLeave(false);
                onLeave();
              }}
            >
              Leave lobby
            </button>
          </div>
        </RoomSheet>
      )}
      {selectedPlayer && (
        <RoomSheet
          title="Player info"
          onClose={() => {
            if (!kicking) setInfoPlayer(null);
          }}
        >
          <div className="room-sheet-player">
            <Avatar profile={selectedPlayer.profile ?? defaultProfile(selectedPlayer.name)} />
            <div>
              <strong>{selectedPlayer.name}</strong>
              <span>
                {!selectedPlayer.connected
                  ? 'Disconnected'
                  : selectedPlayer.id === room.players[0]?.id
                    ? 'Host'
                    : selectedPlayer.ready
                      ? 'Ready'
                      : 'Not ready'}
              </span>
            </div>
          </div>
          {confirmKick === selectedPlayer.id && <p>Remove {selectedPlayer.name} from this lobby?</p>}
          <div className="room-sheet-actions">
            <button
              autoFocus
              className="hub-room-button"
              disabled={kicking}
              onClick={() => setInfoPlayer(null)}
            >
              Close
            </button>
            {host && onKick && (
              <button
                className="lobby-back"
                disabled={busy || kicking || !connected}
                onClick={async () => {
                  if (confirmKick !== selectedPlayer.id) {
                    setConfirmKick(selectedPlayer.id);
                    return;
                  }
                  setKicking(true);
                  setKickError('');
                  try {
                    await onKick(selectedPlayer.id);
                    setInfoPlayer(null);
                  } catch (error) {
                    setKickError(error instanceof Error ? error.message : 'Could not remove player');
                  } finally {
                    setKicking(false);
                  }
                }}
              >
                {kicking
                  ? 'Removing…'
                  : confirmKick === selectedPlayer.id
                    ? 'Confirm removal'
                    : 'Remove player'}
              </button>
            )}
          </div>
          {kickError && <p role="alert">{kickError}</p>}
        </RoomSheet>
      )}
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
