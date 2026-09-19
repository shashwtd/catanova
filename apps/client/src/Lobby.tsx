import { DEFAULT_VICTORY_POINTS } from '../../../packages/rules/src/victory.js';
import {
  Bot,
  BotMark,
  Check,
  Clock3,
  Dices,
  Copy,
  Crown,
  DoorOpen,
  Link,
  Pencil,
  Plus,
  Play,
  Settings2,
  Share2,
  Users,
  Trophy,
  WifiOff,
  LightClose,
} from './GameIcons.js';
import { useEffect, useRef, useState, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { RoomPreview, RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { BrandLogo } from './BrandLogo.js';
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

/** A Catan table seats four. Empty places are drawn, not hidden. */
const SEATS = 4;

/**
 * An empty place.
 *
 * Filling a seat used to be a small tile that opened a menu, which hid the
 * only two answers behind two taps and made the row read as three cards and a
 * button. The place itself now offers both, so the choice is visible from
 * across the room and costs one press.
 */
function OpenSeat({
  host,
  busy,
  onInvite,
  onAddBot,
}: {
  host: boolean;
  busy: boolean;
  onInvite: () => void;
  onAddBot?: () => void;
}) {
  return (
    <div className="seat-card seat-open">
      <span className="seat-open-mark" aria-hidden="true">
        <Plus size={26} />
      </span>
      <span className="seat-open-title">Open seat</span>
      <div className="seat-open-actions">
        <button type="button" className="seat-fill" onClick={onInvite}>
          <Users size={16} />
          Invite a friend
        </button>
        {host && onAddBot && (
          <button
            type="button"
            className="seat-fill is-bot"
            disabled={busy}
            // Which of the three sits down is the room's draw, not a setting,
            // so this is one action and you meet them at the table.
            title="Which one turns up is the luck of the draw"
            onClick={() => onAddBot()}
          >
            <Bot size={16} />
            Add a bot
          </button>
        )}
      </div>
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
  onAddBot,
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
  onAddBot?: () => void;
  onKick?: (playerId: string) => Promise<void>;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalError, setRemovalError] = useState('');
  const removalTarget = room.players.find((p) => p.id === removing);
  const self = room.players.find((p) => p.id === me),
    host = room.players[0]?.id === me;
  const canStart =
    room.players.length >= 2 && room.players.every((p, i) => p.connected && (i === 0 || p.ready));
  // Everyone here, then one place to fill. Four permanent slots would make a
  // game of two look short-handed, and the old alternative — a tile a quarter
  // the size of a seat, off at the end of the row — did not read as a seat at
  // all. One more place, the same size as the rest, and it goes when full.
  const places: (RoomState['players'][number] | null)[] =
    room.players.length < SEATS ? [...room.players, null] : [...room.players];
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
        <div className="lobby-wordmark">
          <BrandLogo />
        </div>
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
        <ol
          className="seat-row"
          aria-label="Seats at this table"
          style={{ '--places': places.length } as CSSProperties}
        >
          {places.map((p, i) => (
            <li className="seat-place" key={p?.id ?? `open-${i}`}>
              {p ? (
                <article
                  className={`seat-card ${p.id === me ? 'is-you' : ''} ${!p.connected ? 'is-offline' : ''}`}
                >
                  {host && p.id !== me && onKick && (
                    <button
                      type="button"
                      className="seat-remove"
                      disabled={busy || !connected}
                      aria-label={`Remove ${p.name}`}
                      title={`Remove ${p.name}`}
                      onClick={() => {
                        setRemovalError('');
                        setRemoving(p.id);
                      }}
                    >
                      <LightClose size={15} />
                    </button>
                  )}
                  <div className="seat-portrait">
                    <Avatar profile={p.profile ?? defaultProfile(p.name)} />
                    {i === 0 && (
                      <span className="seat-badge is-host" role="img" aria-label="Host" title="Host">
                        <Crown size={16} />
                      </span>
                    )}
                    {p.id === me && (
                      <button
                        type="button"
                        className="seat-badge is-edit"
                        onClick={onEdit}
                        aria-label="Edit your profile"
                        title="Edit your profile"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {!p.connected && (
                      <span className="offline-mark" title="Disconnected">
                        <WifiOff size={28} />
                      </span>
                    )}
                  </div>
                  <div className="seat-name">
                    <strong title={p.name}>{p.name}</strong>
                    {p.bot && <BotMark level={p.botLevel} />}
                  </div>
                  <span className={`seat-status ${p.ready && p.connected && !p.bot ? 'is-ready' : ''}`}>
                    {!p.connected ? (
                      'Disconnected'
                    ) : i === 0 ? (
                      'Host'
                    ) : p.bot ? (
                      // Not which one: you find that out by playing them.
                      'Bot'
                    ) : p.ready ? (
                      <>
                        <Check size={15} />
                        Ready
                      </>
                    ) : (
                      'Not ready'
                    )}
                  </span>
                </article>
              ) : (
                <OpenSeat host={!!host} busy={busy || !connected} onInvite={onInvite} onAddBot={onAddBot} />
              )}
            </li>
          ))}
        </ol>
      </div>
      {removalTarget && onKick && (
        <RoomSheet
          title={`Remove ${removalTarget.name}?`}
          onClose={() => {
            if (!removalBusy) setRemoving(null);
          }}
        >
          <p>They’ll leave this lobby and free up a seat.</p>
          {removalError && <p role="alert">{removalError}</p>}
          <div className="dialog-actions">
            <button className="dark-button" disabled={removalBusy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              className="gold-button"
              disabled={busy || removalBusy || !connected}
              onClick={async () => {
                setRemovalBusy(true);
                try {
                  await onKick(removalTarget.id);
                  setRemoving(null);
                } catch (error) {
                  setRemovalError(error instanceof Error ? error.message : 'Could not remove player');
                } finally {
                  setRemovalBusy(false);
                }
              }}
            >
              {removalBusy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </RoomSheet>
      )}
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
                <Play size={21} />
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
              className="hub-room-button lobby-leave-confirm"
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
