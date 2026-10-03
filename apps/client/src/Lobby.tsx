import { CLASSIC, botsPlayIn, findRuleset, numberWord } from '../../../packages/rules/src/rulesets.js';
import {
  Bot,
  BotMark,
  Check,
  Clock3,
  Dices,
  Copy,
  LogOut,
  Link,
  Plus,
  Play,
  Settings2,
  Share2,
  Users,
  Trophy,
  WifiOff,
  LightCheck,
  LightClose,
} from './GameIcons.js';
import { useEffect, useRef, useState, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { RoomPreview, RoomState } from '../../../packages/protocol/src/index.js';
import { roomHostId } from '../../../packages/protocol/src/room-host.js';
import {
  PLAYER_COLORS,
  PLAYER_COLOR_LABEL,
  PLAYER_COLOR_LIST,
} from '../../../packages/protocol/src/colors.js';
import type { PlayerColor } from '../../../packages/protocol/src/colors.js';
import { seatHexColors } from './player-colors.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { BrandLogo } from './BrandLogo.js';
import { Avatar } from './Profile.js';
import { FriendButton } from './PlayerRail.js';
import type { RailFriendship } from './PlayerRail.js';
import { roomPath, visibleRoomCode } from './navigation.js';
import { modeCopy, seatsText } from './game-modes.js';
import { ModeIcons } from './ModeChooser.js';

/** Room setup: three rails, each broken by a ring at a different place, drawn on a 24-unit grid. */
function SetupIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="setup-icon">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M3 6h2.75M10.25 6H21M3 12h10.75M18.25 12H21M3 18h4.75M12.25 18H21" />
        <circle cx="8" cy="6" r="2.25" />
        <circle cx="16" cy="12" r="2.25" />
        <circle cx="10" cy="18" r="2.25" />
      </g>
    </svg>
  );
}
/** The host's crown, drawn in the colour of the text beside it. */
function HostCrown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.8 9.5H5.3z" fill="currentColor" />
      <path d="M5.5 20.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
/** Swap the mode: two arrows passing each other. */
function SwapIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="swap-icon">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5" />
        <path d="M20 16H5M8.5 12.5 5 16l3.5 3.5" />
      </g>
    </svg>
  );
}

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

/** How many a room's table seats: its mode's number, four in Classic. Empty places are drawn, not hidden. */
const seatsOf = (room: Pick<RoomState, 'settings'>) =>
  (findRuleset(room.settings?.mode) ?? CLASSIC).seats.max;

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
  noBots,
}: {
  host: boolean;
  busy: boolean;
  onInvite: () => void;
  onAddBot?: () => void;
  /** Why no bot can sit down in this room's mode, if none can. */
  noBots?: string;
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
            disabled={busy || !!noBots}
            // Which of the three sits down is the room's draw, not a setting,
            // so this is one action and you meet them at the table.
            title={noBots ?? 'Which one turns up is the luck of the draw'}
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

/**
 * Pick your colour.
 *
 * Colour is the only label the pieces on the island carry, so being told
 * yours — rather than being handed the third one because you joined third —
 * is the difference between recognising your own roads and counting seats.
 *
 * It opens on a press rather than sitting there permanently. Eight swatches
 * under a name is a paint chart, and the question they answer is one a player
 * asks once: the card shows the colour it is, and the rest of the palette is
 * one tap away. A colour somebody else holds is still drawn, greyed and
 * unpressable, so the table's whole arrangement is visible while choosing.
 */
export function ColorChoice({
  mine,
  taken,
  busy,
  onChoose,
  initialOpen = false,
}: {
  mine: PlayerColor;
  taken: ReadonlySet<PlayerColor>;
  busy: boolean;
  onChoose: (color: PlayerColor) => void;
  /** Opened for tests, which render one frame and cannot press anything. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className={`seat-color-choice ${open ? 'is-open' : ''}`} ref={root}>
      <button
        type="button"
        className="seat-color-current"
        style={{ '--swatch': PLAYER_COLORS[mine] } as CSSProperties}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Your colour: ${PLAYER_COLOR_LABEL[mine]}. Change it`}
        title="Change your colour"
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="seat-color-dot" aria-hidden="true" />
        <span>{PLAYER_COLOR_LABEL[mine]}</span>
      </button>
      {open && (
        <div className="seat-colors" role="radiogroup" aria-label="Your colour">
          {PLAYER_COLOR_LIST.map((color) => {
            const held = taken.has(color) && color !== mine;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                className="seat-color"
                style={{ '--swatch': PLAYER_COLORS[color] } as CSSProperties}
                aria-checked={color === mine}
                aria-label={held ? `${PLAYER_COLOR_LABEL[color]}, taken` : PLAYER_COLOR_LABEL[color]}
                title={held ? `${PLAYER_COLOR_LABEL[color]} · taken` : PLAYER_COLOR_LABEL[color]}
                data-held={held}
                disabled={busy || held}
                onClick={() => {
                  if (color !== mine) onChoose(color);
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
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
  onConfigure = onSettings,
  onMode = onConfigure,
  onFriends,
  onAddBot,
  onKick,
  onChooseColor,
  onPreviousResults,
  friendship,
  seats = seatsOf(room),
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
  onConfigure?: () => void;
  /** Opens the mode chooser; Room setup when there is none. */
  onMode?: () => void;
  onFriends?: () => void;
  onAddBot?: () => void;
  onKick?: (playerId: string) => Promise<void>;
  onChooseColor?: (color: PlayerColor) => void;
  onPreviousResults?: () => void;
  /** Friend requests from a seat, for a viewer with a Google account, as the in-game rail makes them. */
  friendship?: RailFriendship;
  /** How many the table seats: the room's mode's number unless a preview says otherwise. */
  seats?: number;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalError, setRemovalError] = useState('');
  const removalTarget = room.players.find((p) => p.id === removing);
  const self = room.players.find((p) => p.id === me),
    hostId = roomHostId(room.players),
    host = hostId === me;
  // The room's mode sets the seats, the players needed and whether bots may sit down.
  const rules = findRuleset(room.settings?.mode) ?? CLASSIC,
    enough = room.players.length >= rules.seats.min;
  const canStart = enough && room.players.every((p) => p.connected && (p.id === hostId || p.ready));
  // Everyone here, then one place to fill. Four permanent slots would make a
  // game of two look short-handed, and the old alternative — a tile a quarter
  // the size of a seat, off at the end of the row — did not read as a seat at
  // all. One more place, the same size as the rest, and it goes when full.
  const places: (RoomState['players'][number] | null)[] =
    room.players.length < seats ? [...room.players, null] : [...room.players];
  // Only when there is a mode to speak of: a room not in Classic, or a host who could pick another.
  const showMode = rules.id !== CLASSIC.id || (room.modes?.length ?? 0) > 1;
  const copy = modeCopy(rules);
  // Resolved the same way the board resolves them, so the swatch on a card and
  // the roads on the island are never two different answers.
  const colors = seatHexColors(room.players);
  const held = new Set(room.players.map((p) => p.color).filter((c): c is PlayerColor => !!c));
  return (
    <section className="lobby-screen room-lobby" aria-label="Room lobby">
      {/* Your profile (the button that edits it), the logo, then Friends, your settings and Leave. */}
      <header className="lobby-heading">
        {self ? (
          <button
            type="button"
            className="lobby-self lobby-profile"
            onClick={onEdit}
            aria-label="Edit your profile"
            title="Edit your profile"
          >
            <Avatar profile={self.profile ?? defaultProfile(self.name)} />
            <strong>{self.name}</strong>
          </button>
        ) : (
          <span />
        )}
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
          {/* Yours, not the table's: sound, board, privacy. The table's own
              rules live behind the sliders in the footer. */}
          <button
            type="button"
            className="lobby-preferences"
            title="Your settings"
            aria-label="Your settings"
            onClick={onSettings}
          >
            <Settings2 />
          </button>
          <button
            type="button"
            className="lobby-back"
            onClick={() => setConfirmLeave(true)}
            disabled={busy}
            aria-label="Leave lobby"
          >
            <LogOut size={20} />
            <span>Leave lobby</span>
          </button>
        </div>
      </header>
      <div className="lobby-center">
        <div className="lobby-caption">
          <h1 className="visually-hidden">Game room</h1>
          <div className="lobby-room-options">
            <button className="lobby-goal" onClick={onConfigure} aria-label="Points to win. Room setup">
              <Trophy size={18} />
              <span>{room.settings?.victoryPoints ?? rules.victoryPoints.default} points</span>
            </button>
            <button
              type="button"
              className="lobby-timer"
              onClick={onConfigure}
              aria-label={
                room.settings?.turnTimerSeconds
                  ? `Turn timer: ${room.settings.turnTimerSeconds} seconds. Room setup`
                  : 'Turn timer off. Room setup'
              }
            >
              <Clock3 size={18} />
              <span>
                Turn timer{' '}
                <b>{room.settings?.turnTimerSeconds ? `${room.settings.turnTimerSeconds}s` : 'Off'}</b>
              </span>
            </button>
            <button className="lobby-dice-rule" onClick={onConfigure} aria-label="Dice mode. Room setup">
              <Dices size={18} />
              <span>{room.settings?.diceMode === 'balanced' ? 'Balanced' : 'Natural'} dice</span>
            </button>
          </div>
        </div>
        <ol
          className="seat-row"
          aria-label="Seats at this table"
          style={{ '--places': places.length } as CSSProperties}
          // Only five and six places are marked, for their three-column layout in room-seats.css.
          data-places={places.length > 4 ? places.length : undefined}
        >
          {places.map((p, i) => (
            <li className="seat-place" key={p?.id ?? `open-${i}`}>
              {p ? (
                <article
                  className={`seat-card ${p.id === me ? 'is-you' : ''} ${!p.connected ? 'is-offline' : ''}`}
                  style={{ '--seat-color': colors[i] } as CSSProperties}
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
                    {p.id !== me && friendship && p.accountId && p.accountId !== friendship.self && (
                      <FriendButton
                        name={p.name}
                        accountId={p.accountId}
                        friendship={friendship}
                        className="seat-badge is-friend"
                      />
                    )}
                    {/* Your colour, as a swatch on your portrait: tap it to pick another. */}
                    {p.id === me && onChooseColor && (
                      <ColorChoice
                        mine={(p.color ?? PLAYER_COLOR_LIST.find((c) => PLAYER_COLORS[c] === colors[i]))!}
                        taken={held}
                        busy={busy || !connected}
                        onChoose={onChooseColor}
                      />
                    )}
                    {!p.connected && (
                      <span className="offline-mark" title="Disconnected">
                        <WifiOff size={28} />
                      </span>
                    )}
                  </div>
                  <div className="seat-name">
                    {/* The host's crown, or a tick for a player who is ready, where the eye reads the name. */}
                    {p.id === hostId && (
                      <span className="seat-host-mark" title="Host">
                        <HostCrown />
                      </span>
                    )}
                    {p.connected && !p.bot && p.id !== hostId && p.ready && (
                      <span className="seat-ready-mark" title="Ready">
                        <LightCheck size={13} />
                      </span>
                    )}
                    <strong title={p.name}>{p.name}</strong>
                    {p.bot && <BotMark level={p.botLevel} />}
                  </div>
                  <span
                    className={`seat-status visually-hidden ${p.ready && p.connected && !p.bot ? 'is-ready' : ''}`}
                  >
                    {!p.connected ? (
                      'Disconnected'
                    ) : p.id === hostId ? (
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
                <OpenSeat
                  host={!!host}
                  busy={busy || !connected}
                  onInvite={onInvite}
                  onAddBot={onAddBot}
                  {...(rules.bots ? {} : { noBots: botsPlayIn() })}
                />
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
        <div className="lobby-share-results">
          <Invite code={visibleRoomCode(room) ?? undefined} roomId={room.roomId} />
          {onPreviousResults && (
            <button
              className="lobby-previous-results"
              onClick={onPreviousResults}
              disabled={busy || !connected}
            >
              <Trophy size={18} /> Previous results
            </button>
          )}
        </div>
        <div className="lobby-launch">
          <span role="status">
            {!enough
              ? rules.seats.min === 2
                ? 'Invite another player'
                : `${rules.name} needs ${numberWord(rules.seats.min)} players`
              : !room.players.every((p) => p.connected)
                ? 'Waiting for reconnection'
                : canStart
                  ? host
                    ? 'Everyone is ready'
                    : 'Waiting for host'
                  : 'Waiting for players'}
          </span>
          <div className="lobby-start-controls">
            {showMode && (
              <button
                type="button"
                className="lobby-mode-banner"
                onClick={onMode}
                aria-label={`Game mode: ${copy.name}. ${host ? 'Choose a game mode' : 'Game modes'}`}
              >
                {copy.emblem && <img src={copy.emblem} alt="" />}
                <span className="lobby-mode-banner-text">
                  <small>Game mode</small>
                  <strong>{copy.name}</strong>
                  <span>
                    <Users size={15} />
                    {seatsText(rules)}
                    <ModeIcons copy={copy} />
                  </span>
                </span>
                {host && (
                  <span className="lobby-mode-banner-change" aria-hidden="true">
                    <SwapIcon />
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              className="lobby-setup hub-room-button"
              title="Room setup"
              onClick={onConfigure}
              disabled={busy}
              aria-label={host ? 'Room setup' : 'Room setup, chosen by the host'}
            >
              <SetupIcon />
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
export function InviteRoster({ room, seats = seatsOf(room) }: { room: RoomPreview; seats?: number }) {
  return (
    <div className="invite-roster">
      {room.players.map((p) => (
        <div key={p.id}>
          <Avatar profile={p.profile ?? defaultProfile(p.name)} />
          <span>{p.name}</span>
        </div>
      ))}
      <span className="invite-capacity">
        {room.players.length}
        {`/${seats}`}
      </span>
    </div>
  );
}
