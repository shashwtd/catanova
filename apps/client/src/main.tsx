import { usePreferences } from './preferences.js';
import { useFeedback } from './useFeedback.js';
import { ResourceHand } from './ResourceHand.js';
import { DevelopmentCards } from './DevelopmentCards.js';
import { GameEffects } from './GameEffects.js';
import { GameSettings } from './GameSettings.js';
import { TurnTimer } from './TurnTimer.js';
import { FantasyTransition } from './FantasyTransition.js';
import type { RoomSettings } from '../../../packages/protocol/src/settings.js';
import { useAuth, entryLocation } from './auth.js';
import { Avatar, ProfileEditor } from './Profile.js';
import { Lobby, Invite, InviteRoster } from './Lobby.js';
import { PlayerRail } from './PlayerRail.js';
import { ConnectionPanel } from './ConnectionPanel.js';
import { BoardViewport } from './BoardViewport.js';
import { initialMetrics } from './connection.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Settings2,
  UserRound,
  LogOut,
  Sailboat,
  ArrowLeft,
  ArrowRight,
  Castle,
  Check,
  CircleHelp,
  DoorOpen,
  Dices,
  House,
  LoaderCircle,
  Maximize,
  Plus,
  Route,
  ScrollText,
  Trophy,
  Users,
  Wifi,
  WifiOff,
  X,
  ArrowLeftRight,
} from 'lucide-react';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import { Connection, newSession } from './connection.js';
import type { ConnectionStatus, PendingCommand } from './connection.js';
import type { RoomPreview, RoomState, Session } from '../../../packages/protocol/src/index.js';
import { canPay, emptyHand, robberVictims, total } from '../../../packages/rules/src/game.js';
import type { GameAction, Hand } from '../../../packages/rules/src/game.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { Board, ResourceIcon } from './Board.js';
import type { BuildMode } from './Board.js';
import { invitationCode, roomPath, shouldResume, validRoomCode } from './navigation.js';
import './style.css';
import './card-motion.css';
import './pieces3d.css';
import './dice.css';
import './presentation.css';
import './board-camera.css';
import './fantasy-transition.css';

const SESSION_KEY = 'catanova.seat.v1',
  OUTBOX_KEY = 'catanova.outbox.v1',
  LAST_SEAT_KEY = 'catanova.last-seat.v1';
function readJSON<T>(storage: Storage, key: string): T | undefined {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'is-selected' : ''} ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Dialog({
  title,
  children,
  onClose,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`game-dialog ${compact ? 'compact' : ''}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-surface">
        <div className="panel-heading">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function ResourceSummary({ hand }: { hand: Hand }) {
  return (
    <span className="resource-summary">
      {RESOURCES.filter((r) => hand[r]).map((r) => (
        <span key={r} title={RESOURCE_NAMES[r]}>
          <ResourceIcon resource={r} />
          <b>{hand[r]}</b>
        </span>
      ))}
    </span>
  );
}
function ResourcePicker({
  value,
  onChange,
  max,
  label,
}: {
  value: Hand;
  onChange: (h: Hand) => void;
  max?: Hand;
  label: string;
}) {
  return (
    <fieldset className="resource-picker">
      <legend>{label}</legend>
      <div>
        {RESOURCES.map((r) => (
          <label key={r} title={RESOURCE_NAMES[r]}>
            <ResourceIcon resource={r} />
            <input
              aria-label={`${label}: ${RESOURCE_NAMES[r]}`}
              type="number"
              inputMode="numeric"
              min="0"
              max={max?.[r] ?? 19}
              value={value[r]}
              onChange={(e) =>
                onChange({
                  ...value,
                  [r]: Math.max(0, Math.min(max?.[r] ?? 19, Math.floor(Number(e.target.value) || 0))),
                })
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function ResourceSelect({
  value,
  onChange,
  label,
}: {
  value: Resource;
  onChange: (r: Resource) => void;
  label: string;
}) {
  return (
    <label className="resource-select">
      <span>{label}</span>
      <ResourceIcon resource={value} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Resource)}>
        {RESOURCES.map((r) => (
          <option key={r} value={r}>
            {RESOURCE_NAMES[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

function App() {
  const auth = useAuth();
  const { preferences, update, reducedMotion, osReduced } = usePreferences();
  const feedback = useFeedback(preferences, reducedMotion);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const connection = useRef<Connection | null>(null);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]),
    [historyHasMore, setHistoryHasMore] = useState(false);
  const historyLoaded = useRef(false);
  const initialInvite = useRef(invitationCode(entryLocation().pathname, entryLocation().search));
  const [entry, setEntry] = useState<'home' | 'create' | 'join' | 'invite'>(
    initialInvite.current ? 'invite' : 'home',
  );
  const [invite, setInvite] = useState<string | null>(initialInvite.current);
  const [previewRoom, setPreviewRoom] = useState<RoomPreview | null>(null),
    [previewLoading, setPreviewLoading] = useState(false),
    [previewError, setPreviewError] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null),
    [me, setMe] = useState<string>();
  const [status, setStatus] = useState<ConnectionStatus>('idle'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('catanova.name') ?? ''),
    [code, setCode] = useState('');
  const [mode, setMode] = useState<BuildMode>(null),
    [panel, setPanel] = useState<
      'settings' | 'trade' | 'cards' | 'rules' | 'journal' | 'leave' | 'profile' | 'network' | 'invite' | null
    >(null);
  const [robberHex, setRobberHex] = useState<number | null>(null),
    [selected, setSelected] = useState<Hand>(emptyHand),
    [give, setGive] = useState<Hand>(emptyHand),
    [want, setWant] = useState<Hand>(emptyHand);
  const [bankGive, setBankGive] = useState<Resource>('wood'),
    [bankReceive, setBankReceive] = useState<Resource>('brick');

  const g = room?.game,
    player = g?.players.find((p) => p.id === me),
    active = g?.players[g.active],
    myTurn = !!me && active?.id === me;
  const connected = status === 'connected',
    disabled = !connected || busy,
    hand = player?.hand ?? emptyHand();
  const actionPhase = myTurn && g?.phase === 'actions';
  const networkBusy = status === 'connecting' || status === 'reconnecting';
  function home(released = false) {
    const old = connection.current;
    connection.current = null;
    old?.stop();
    if (released) {
      const last = readJSON<Session>(localStorage, LAST_SEAT_KEY);
      if (last?.token === old?.session.token || !old) localStorage.removeItem(LAST_SEAT_KEY);
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(OUTBOX_KEY);
    feedback.reset();
    setTransitionId(null);
    setRoom(null);
    setHistoryEntries([]);
    historyLoaded.current = false;
    setMetrics(initialMetrics());
    setMe(undefined);
    setStatus('idle');
    setBusy(false);
    setPanel(null);
    setMode(null);
    setError('');
    setInvite(null);
    setPreviewRoom(null);
    setPreviewError('');
    setEntry('home');
    history.replaceState(null, '', '/');
  }
  function connect(session: Session, pending?: PendingCommand) {
    const old = connection.current;
    connection.current = null;
    old?.stop();
    setError('');
    feedback.reset();
    setTransitionId(null);
    setRoom(null);
    setBusy(!!pending);
    const c = new Connection(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      session,
      {
        pending,
        accessToken: auth.accessToken,
        onMetrics: (value) => {
          if (connection.current === c) setMetrics(value);
        },
        onStatus: (value) => {
          if (connection.current === c) setStatus(value);
        },
        onSession: (saved) => {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
          localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(saved));
        },
        onPending: (command) => {
          if (command) sessionStorage.setItem(OUTBOX_KEY, JSON.stringify(command));
          else {
            sessionStorage.removeItem(OUTBOX_KEY);
            setBusy(false);
          }
        },
      },
    );
    let previousSnapshot: RoomState | null = null;
    c.subscribe((message) => {
      if (connection.current !== c) return;
      if (message.type === 'welcome' || message.type === 'state') {
        const next = c.state;
        if (next && c.playerId) {
          feedback.accept(previousSnapshot, next, c.playerId, message.type === 'welcome');
          if (message.type === 'state' && previousSnapshot && !previousSnapshot.game && next.game) {
            setTransitionId(`${next.roomId}:${next.revision}`);
            feedback.sound.play('development');
          } else if (
            !next.game &&
            previousSnapshot &&
            next.players.length > previousSnapshot.players.length
          ) {
            feedback.sound.play('join');
          }
          previousSnapshot = next;
        }
        setRoom(next);
        setMe(c.playerId ?? undefined);
        if (message.type === 'welcome' && next) history.replaceState(null, '', roomPath(next.roomId));
      }
      if (message.type === 'history') {
        if (message.before !== undefined || !historyLoaded.current) setHistoryHasMore(message.hasMore);
        historyLoaded.current = true;
        setHistoryEntries((current) =>
          [...new Map([...current, ...message.entries].map((e) => [e.revision, e])).values()].sort(
            (a, b) => b.revision - a.revision,
          ),
        );
      }
      if (message.type === 'ack' && message.released !== undefined) {
        home(message.released);
        return;
      }
      if (message.type === 'error') {
        if (
          message.code === 'SEAT_LEFT' &&
          readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY)?.type === 'leave'
        ) {
          home(true);
          return;
        }
        setError(message.message);
        feedback.sound.play('error');
        if (message.commandId) setBusy(false);
        if (['SEAT_LEFT', 'INVALID_SESSION', 'ROOM_NOT_FOUND', 'AUTH_MISMATCH'].includes(message.code)) {
          sessionStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(OUTBOX_KEY);
          localStorage.removeItem(LAST_SEAT_KEY);
          setBusy(false);
        }
      }
    });
    connection.current = c;
    c.start();
  }
  useEffect(() => {
    if (!auth.canPlay || connection.current) return;
    const saved = readJSON<Session>(sessionStorage, SESSION_KEY);
    if (shouldResume(saved, initialInvite.current))
      connect(saved!, readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY));
  }, [auth.canPlay, auth.user?.id]);
  useEffect(() => () => connection.current?.stop(), []);
  useEffect(() => {
    if (!auth.loading && auth.config?.mode === 'authenticated' && !auth.user && connection.current)
      home(false);
  }, [auth.loading, auth.user?.id]);
  useEffect(() => {
    if (auth.profile.name) setName(auth.profile.name);
  }, [auth.profile.name]);
  useEffect(() => {
    if (panel === 'journal' && connected && room?.game) connection.current?.history();
  }, [panel, connected, room?.historyRevision]);
  useEffect(() => {
    if (!invite || room) return;
    setPreviewRoom(null);
    setPreviewError('');
    if (!validRoomCode(invite)) {
      setPreviewError('Invalid room link');
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    (async () => {
      const token = auth.user ? await auth.accessToken() : undefined;
      return fetch(`/api/rooms/${invite}`, {
        signal: controller.signal,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      });
    })()
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Room not found' : 'Room unavailable');
        return response.json() as Promise<RoomPreview>;
      })
      .then((preview) => {
        if (!controller.signal.aborted) setPreviewRoom(preview);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : 'Room unavailable');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [invite, room?.roomId, auth.user?.id]);
  useEffect(() => {
    setMode(null);
    setRobberHex(null);
    setSelected(emptyHand());
  }, [g?.phase, g?.turn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  async function act(action: GameAction) {
    const c = connection.current;
    if (!c || disabled) return;
    setBusy(true);
    setError('');
    try {
      await c.action(action);
      setMode(null);
      setRobberHex(null);
      if (action.kind === 'playCard') setSelected(emptyHand());
    } catch (e) {
      if (connection.current === c)
        setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Action failed');
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  async function leave() {
    const c = connection.current;
    if (!c || busy) return;
    if (!connected) {
      home(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await c.leave();
    } catch (e) {
      if (connection.current === c) {
        setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not leave');
        setBusy(c.awaitingConfirmation);
      }
    }
  }
  async function enter(e: FormEvent, kind: 'create' | 'join') {
    e.preventDefault();
    setError('');
    if (!auth.canPlay) {
      await auth.signIn(invite ? roomPath(invite) : '/');
      return;
    }
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }
    const target = (entry === 'invite' ? invite : code)?.trim().toUpperCase();
    if (kind === 'join' && (!target || !validRoomCode(target))) {
      setError('Enter an eight-character room code');
      return;
    }
    sessionStorage.removeItem(OUTBOX_KEY);
    localStorage.setItem('catanova.name', name.trim());
    setBusy(true);
    try {
      const profile = await auth.saveProfile({ ...auth.profile, name: name.trim() });
      connect(newSession(profile.name, kind === 'join' ? target : undefined, profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile');
      setBusy(false);
    }
  }
  async function copyInvite() {
    const id = room?.roomId ?? invite;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}${roomPath(id)}`);
      setToast('Link copied');
    } catch {
      setError(`Room code: ${id}`);
    }
  }
  async function signOut() {
    if (await auth.signOut()) home(true);
  }
  function chooseRobber(hex: number) {
    if (!g || !me) return;
    if (!robberVictims(g, me, hex).length) void act({ kind: 'robber', hex });
    else setRobberHex(hex);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setToast('Fullscreen unavailable');
    }
  }
  const last = readJSON<Session>(localStorage, LAST_SEAT_KEY);
  const resumableInvite =
    entry === 'invite' && (!!previewRoom?.canResume || (last?.roomId === invite && last.joined));
  async function ready(value: boolean) {
    const c = connection.current;
    if (!c || disabled) return;
    setBusy(true);
    try {
      await c.lobby(value);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not update readiness');
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  async function saveSettings(settings: RoomSettings) {
    const c = connection.current;
    if (!c || disabled) throw new Error('Reconnect before changing room rules');
    setBusy(true);
    try {
      await c.settings(settings);
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  async function saveProfile(profile: Profile) {
    const c = connection.current;
    if (room && !g && c) {
      setBusy(true);
      try {
        await c.lobby(false, profile);
      } finally {
        setBusy(c.awaitingConfirmation);
      }
    }
    await auth.saveProfile(profile);
    setName(profile.name);
    setPanel(null);
  }
  const phaseText = !g
    ? ''
    : g.winner
      ? `${g.players.find((p) => p.id === g.winner)?.name} wins`
      : g.phase === 'discard'
        ? g.discards[me ?? '']
          ? `Discard ${g.discards[me!]} cards`
          : 'Waiting for discards'
        : !myTurn
          ? `${active?.name}'s turn`
          : g.phase === 'setupSettlement'
            ? 'Place a settlement'
            : g.phase === 'setupRoad'
              ? 'Place a road'
              : g.phase === 'roll'
                ? 'Your turn'
                : g.phase === 'robber'
                  ? 'Move the robber'
                  : g.phase === 'freeRoads'
                    ? `Place ${g.freeRoads} free road${g.freeRoads === 1 ? '' : 's'}`
                    : mode
                      ? `Place ${mode === 'city' ? 'a city' : `a ${mode}`}`
                      : 'Your turn';
  return (
    <main
      className={`game-world ${g ? 'playing' : room ? 'lobby' : 'entry-world'}`}
      data-motion={reducedMotion ? 'reduced' : 'full'}
      onClickCapture={(e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (button && !button.disabled) feedback.sound.play('ui');
      }}
    >
      {g && (
        <div className="board-anchor">
          <BoardViewport
            seed={g.board.seed}
            depth={preferences.depth}
            tilt={preferences.boardTilt}
            reducedMotion={reducedMotion}
          >
            <Board
              board={g.board}
              game={g}
              depth={preferences.depth}
              glowHexes={reducedMotion ? [] : feedback.event?.glowHexes}
              effectId={feedback.event?.id}
              me={me}
              mode={mode}
              disabled={disabled}
              onAction={(a) => void act(a)}
              onRobber={chooseRobber}
            />
          </BoardViewport>
        </div>
      )}
      <nav className="side-controls game-controls" aria-label="Current game tools">
        {g && (
          <IconButton
            label="Move history"
            active={panel === 'journal'}
            onClick={() => setPanel(panel === 'journal' ? null : 'journal')}
          >
            <ScrollText />
          </IconButton>
        )}
        {room && (
          <IconButton
            label="Connection and ping"
            active={panel === 'network'}
            className={connected ? 'connected' : 'disconnected'}
            onClick={() => setPanel(panel === 'network' ? null : 'network')}
          >
            {networkBusy ? <LoaderCircle className="spin" /> : connected ? <Wifi /> : <WifiOff />}
          </IconButton>
        )}
        <IconButton
          label="Rules"
          active={panel === 'rules'}
          onClick={() => setPanel(panel === 'rules' ? null : 'rules')}
        >
          <CircleHelp />
        </IconButton>
        {g && (
          <IconButton label="Fullscreen" onClick={() => void fullscreen()}>
            <Maximize />
          </IconButton>
        )}
      </nav>
      <nav className="side-controls room-controls" aria-label="Room and profile">
        <IconButton label="Settings" active={panel === 'settings'} onClick={() => setPanel('settings')}>
          <Settings2 />
        </IconButton>
        {auth.canPlay && (
          <IconButton label="Your profile" active={panel === 'profile'} onClick={() => setPanel('profile')}>
            <UserRound />
          </IconButton>
        )}
        {room && (
          <>
            <IconButton
              label="Room invitation"
              active={panel === 'invite'}
              onClick={() => setPanel(panel === 'invite' ? null : 'invite')}
            >
              <Users />
            </IconButton>
            <IconButton
              label="Leave room"
              disabled={busy}
              onClick={() => (g && !g.winner ? setPanel('leave') : void leave())}
            >
              <DoorOpen />
            </IconButton>
          </>
        )}
        {auth.user && !room && (
          <IconButton label="Sign out" onClick={() => void signOut()}>
            <LogOut />
          </IconButton>
        )}
      </nav>
      {g && room && <PlayerRail room={room} game={g} me={me} />}
      {(error || auth.error) && (
        <div className="error-toast" role="alert">
          <span>{error || auth.error}</span>
          <IconButton
            label="Dismiss error"
            onClick={() => {
              setError('');
              auth.clearError();
            }}
          >
            <X />
          </IconButton>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {room && !connected && (
        <div className="reconnect-banner" role="status">
          {networkBusy ? (
            <>
              <LoaderCircle className="spin" />
              Reconnecting…
            </>
          ) : (
            <>
              <WifiOff />
              Disconnected{' '}
              <button
                onClick={() => {
                  const s = readJSON<Session>(sessionStorage, SESSION_KEY);
                  if (s) connect(s, readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY));
                }}
              >
                Reconnect
              </button>
            </>
          )}
        </div>
      )}
      {!room && (
        <div className="entry-overlay">
          <section
            className={`entry-card ${entry === 'home' ? 'main-menu' : ''}`}
            aria-label={entry === 'home' ? 'Game menu' : entry === 'create' ? 'Create room' : 'Join room'}
          >
            {entry === 'home' ? (
              <>
                <Sailboat className="menu-emblem" />
                <h1>Catanova</h1>
                {auth.loading ? (
                  <div className="menu-loading">
                    <LoaderCircle className="spin" />
                  </div>
                ) : auth.canPlay ? (
                  <>
                    <button className="menu-profile" onClick={() => setPanel('profile')}>
                      <Avatar profile={auth.profile} />
                      <span>{auth.profile.name || 'Choose your profile'}</span>
                    </button>
                    <div className="entry-actions">
                      <button className="gold-button" onClick={() => setEntry('create')}>
                        <Plus />
                        Create room
                      </button>
                      <button className="dark-button" onClick={() => setEntry('join')}>
                        <Users />
                        Join room
                      </button>
                    </div>
                    {last?.joined && (
                      <button className="resume-button" onClick={() => connect(last)}>
                        Resume game
                        <ArrowRight size={15} />
                      </button>
                    )}
                    {auth.config?.mode === 'local' && <span className="local-mode">Local playtest</span>}
                  </>
                ) : auth.user ? (
                  <button className="dark-button" onClick={() => void auth.retryProfile()}>
                    {auth.error ? 'Retry profile' : 'Loading profile…'}
                  </button>
                ) : (
                  <button
                    className="google-button"
                    disabled={!auth.config?.auth}
                    onClick={() => void auth.signIn()}
                  >
                    <span className="google-letter">G</span>Continue with Google
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="entry-heading">
                  <IconButton label="Back" onClick={() => home(false)}>
                    <ArrowLeft />
                  </IconButton>
                  <h1>{entry === 'create' ? 'Create room' : 'Join room'}</h1>
                </div>
                {entry === 'invite' && (
                  <>
                    <div className="invite-room-code">{invite}</div>
                    {previewRoom && <InviteRoster room={previewRoom} />}
                  </>
                )}
                {previewError && entry === 'invite' ? (
                  <p className="entry-error">{previewError}</p>
                ) : !auth.canPlay && auth.user ? (
                  <button className="dark-button" onClick={() => void auth.retryProfile()}>
                    {auth.error ? 'Retry profile' : 'Loading profile…'}
                  </button>
                ) : !auth.canPlay && !auth.loading ? (
                  <button
                    className="google-button"
                    disabled={!auth.config?.auth}
                    onClick={() => void auth.signIn(invite ? roomPath(invite) : '/')}
                  >
                    <span className="google-letter">G</span>Sign in to join
                  </button>
                ) : (
                  <form onSubmit={(e) => void enter(e, entry === 'create' ? 'create' : 'join')}>
                    {entry === 'join' && (
                      <label className="field">
                        Room code
                        <input
                          autoComplete="off"
                          autoCapitalize="characters"
                          maxLength={8}
                          value={code}
                          onChange={(e) => setCode(e.target.value.toUpperCase())}
                          placeholder="XXXXXXXX"
                          required
                        />
                      </label>
                    )}
                    <label className="field">
                      Display name
                      <input
                        autoComplete="nickname"
                        maxLength={32}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name"
                        required
                        autoFocus
                      />
                    </label>
                    {entry === 'invite' && previewRoom?.started && !resumableInvite ? (
                      <p className="entry-error">This game has started.</p>
                    ) : entry === 'invite' &&
                      previewRoom &&
                      previewRoom.players.length >= 4 &&
                      !resumableInvite ? (
                      <p className="entry-error">This room is full.</p>
                    ) : resumableInvite ? (
                      <button
                        type="button"
                        className="gold-button"
                        disabled={networkBusy || !auth.canPlay}
                        onClick={() =>
                          connect(
                            last?.roomId === invite
                              ? last
                              : newSession(auth.profile.name, invite!, auth.profile),
                          )
                        }
                      >
                        Resume room
                        <ArrowRight />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="gold-button"
                        disabled={
                          busy ||
                          networkBusy ||
                          !auth.canPlay ||
                          (entry === 'invite' && (previewLoading || !previewRoom))
                        }
                      >
                        {networkBusy || previewLoading || busy ? (
                          <LoaderCircle className="spin" />
                        ) : entry === 'create' ? (
                          <Plus />
                        ) : (
                          <ArrowRight />
                        )}
                        {entry === 'create' ? 'Create room' : 'Join room'}
                      </button>
                    )}
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {room && !g && (
        <Lobby
          room={room}
          me={me}
          busy={busy}
          connected={connected}
          onReady={(v) => void ready(v)}
          onStart={() => void act({ kind: 'start' })}
          onInvite={() => void copyInvite()}
          onLeave={() => void leave()}
          onEdit={() => setPanel('profile')}
          onSettings={() => setPanel('settings')}
        />
      )}
      {g && (
        <>
          <div className="phase-prompt" role="status">
            {g.winner ? <Trophy /> : myTurn ? <span className="turn-dot" /> : null}
            {phaseText}
            {room && (
              <TurnTimer
                room={room}
                me={me}
                offset={metrics.clockOffsetMs}
                connected={connected}
                onWarning={() => feedback.sound.play('warning')}
              />
            )}
            {mode && (
              <IconButton label="Cancel placement" onClick={() => setMode(null)}>
                <X />
              </IconButton>
            )}
          </div>
          <div className="card-table">
            <div className="hand-zone">
              <ResourceHand
                hand={feedback.hand ?? hand}
                pulse={feedback.pulse}
                reducedMotion={reducedMotion}
                onHover={() => feedback.sound.play('hover')}
              />
              <div className="build-actions">
                {(['road', 'settlement', 'city'] as const).map((kind, i) => {
                  const Icon = [Route, House, Castle][i]!,
                    sites =
                      kind === 'road'
                        ? g.legal.roads
                        : kind === 'city'
                          ? g.legal.cities
                          : g.legal.settlements;
                  return (
                    <IconButton
                      key={kind}
                      label={`Build ${kind} · ${RESOURCES.filter((r) => COSTS[kind][r])
                        .map((r) => COSTS[kind][r] + ' ' + RESOURCE_NAMES[r])
                        .join(', ')}`}
                      active={mode === kind}
                      disabled={disabled || !actionPhase || !sites.length}
                      onClick={() => {
                        setMode(mode === kind ? null : kind);
                        setPanel(null);
                      }}
                    >
                      <Icon />
                    </IconButton>
                  );
                })}
                <span className="action-divider" />
                <IconButton
                  label="Your development cards"
                  active={panel === 'cards'}
                  onClick={() => {
                    setPanel(panel === 'cards' ? null : 'cards');
                    setMode(null);
                  }}
                >
                  <ScrollText />
                  {!!player?.cards?.length && <small className="button-count">{player.cards.length}</small>}
                </IconButton>
              </div>
            </div>
            <div className="table-actions">
              <button
                className="dice-button"
                disabled={disabled || !myTurn || g.phase !== 'roll'}
                onClick={() => void act({ kind: 'roll' })}
              >
                <Dices size={32} />
                <span>
                  <strong>
                    {g.dice ? g.dice[0] + ' + ' + g.dice[1] + ' = ' + (g.dice[0] + g.dice[1]) : 'Roll dice'}
                  </strong>
                  <small>
                    {g.dice ? 'Last roll' : myTurn && g.phase === 'roll' ? 'Your turn' : 'Waiting for turn'}
                  </small>
                </span>
              </button>
              <button
                className="table-action"
                disabled={disabled || g.phase !== 'actions'}
                onClick={() => {
                  setPanel(panel === 'trade' ? null : 'trade');
                  setMode(null);
                }}
              >
                <ArrowLeftRight size={18} />
                Trade
              </button>
              <button
                className="table-action"
                disabled={disabled || !g.legal.canBuyCard}
                title="Buy development card · 1 Sheep, 1 Hay, 1 Rock"
                onClick={() => void act({ kind: 'buyCard' })}
              >
                <ScrollText size={18} />
                Buy development card
              </button>
              {actionPhase && (
                <button
                  className="table-action end-turn"
                  disabled={disabled}
                  onClick={() => void act({ kind: 'endTurn' })}
                >
                  End turn
                  <ArrowRight size={17} />
                </button>
              )}
            </div>
          </div>
          {g.trade && !myTurn && (
            <div className="incoming-trade floating-panel">
              <div className="panel-heading">
                <h2>{active?.name}</h2>
                <ArrowLeftRight />
              </div>
              <div className="trade-summary">
                <ResourceSummary hand={g.trade.give} />
                <ArrowLeftRight />
                <ResourceSummary hand={g.trade.want} />
              </div>
              <button
                className="gold-button"
                disabled={disabled || !canPay(hand, g.trade.want)}
                onClick={() => act({ kind: 'acceptTrade', tradeId: g.trade!.id })}
              >
                Accept trade
              </button>
            </div>
          )}
          {(panel === 'trade' || panel === 'journal') && (
            <aside className="game-panel floating-panel" aria-label={panel}>
              <div className="panel-heading">
                <h2>{panel === 'trade' ? 'Trade' : 'Move history'}</h2>
                <IconButton label="Close panel" onClick={() => setPanel(null)}>
                  <X />
                </IconButton>
              </div>
              {panel === 'journal' && (
                <>
                  <ol className="event-log">
                    {historyEntries.length
                      ? historyEntries.map((e) => (
                          <li key={e.revision}>
                            <span className="event-meta">
                              {e.turn ? 'Turn ' + e.turn : 'Setup'} · #{e.revision}
                            </span>
                            {e.lines.map((line, i) => (
                              <p key={i}>{line}</p>
                            ))}
                          </li>
                        ))
                      : g.log
                          .slice()
                          .reverse()
                          .map((e) => <li key={e.id}>{e.text}</li>)}
                  </ol>
                  {historyHasMore && (
                    <button
                      className="dark-button history-more"
                      onClick={() => connection.current?.history(historyEntries.at(-1)?.revision)}
                    >
                      Earlier moves
                    </button>
                  )}
                </>
              )}
              {panel === 'trade' &&
                (actionPhase ? (
                  <>
                    <div className="trade-selects">
                      <ResourceSelect
                        label={`Give ${g.legal.rates[bankGive]}`}
                        value={bankGive}
                        onChange={setBankGive}
                      />
                      <ArrowRight />
                      <ResourceSelect label="Get 1" value={bankReceive} onChange={setBankReceive} />
                    </div>
                    <button
                      className="dark-button"
                      disabled={
                        disabled ||
                        bankGive === bankReceive ||
                        hand[bankGive] < g.legal.rates[bankGive] ||
                        !g.bank[bankReceive]
                      }
                      onClick={() => act({ kind: 'bankTrade', give: bankGive, receive: bankReceive })}
                    >
                      Bank trade · {g.legal.rates[bankGive]}:1
                    </button>
                    <hr />
                    <ResourcePicker label="Offer" value={give} onChange={setGive} max={hand} />
                    <ResourcePicker label="Request" value={want} onChange={setWant} />
                    <button
                      className="gold-button"
                      disabled={
                        disabled ||
                        !total(give) ||
                        !canPay(hand, give) ||
                        !total(want) ||
                        RESOURCES.some((r) => !!give[r] && !!want[r])
                      }
                      onClick={() => act({ kind: 'offerTrade', give, want })}
                    >
                      Offer trade
                    </button>
                    {g.trade && (
                      <button
                        className="text-button"
                        disabled={disabled}
                        onClick={() => act({ kind: 'cancelTrade' })}
                      >
                        Withdraw offer
                      </button>
                    )}
                  </>
                ) : (
                  <p className="muted">Wait for a trade offer.</p>
                ))}
            </aside>
          )}
          {panel === 'cards' && me && (
            <DevelopmentCards
              game={g}
              me={me}
              disabled={disabled}
              reducedMotion={reducedMotion}
              onAction={(a) => void act(a)}
              onClose={() => setPanel(null)}
              onHover={() => feedback.sound.play('hover')}
            />
          )}
          {g.phase === 'discard' && !!g.discards[me ?? ''] && (
            <aside className="required-action floating-panel">
              <div className="panel-heading">
                <h2>Discard {g.discards[me!]} cards</h2>
              </div>
              <ResourcePicker value={selected} onChange={setSelected} max={hand} label="Discard" />
              <button
                className="gold-button"
                disabled={disabled || total(selected) !== g.discards[me!]}
                onClick={() => act({ kind: 'discard', resources: selected })}
              >
                Discard {total(selected)}/{g.discards[me!]}
              </button>
            </aside>
          )}
          {robberHex !== null && myTurn && g.phase === 'robber' && (
            <aside className="required-action floating-panel">
              <div className="panel-heading">
                <h2>Steal from</h2>
                <IconButton label="Choose another tile" onClick={() => setRobberHex(null)}>
                  <X />
                </IconButton>
              </div>
              {robberVictims(g, me!, robberHex).map((id) => (
                <button
                  className="dark-button"
                  key={id}
                  disabled={disabled}
                  onClick={() => act({ kind: 'robber', hex: robberHex, victim: id })}
                >
                  {g.players.find((p) => p.id === id)?.name}
                  <ArrowRight />
                </button>
              ))}
            </aside>
          )}
        </>
      )}
      <GameEffects event={feedback.event} reducedMotion={reducedMotion} activity={preferences.activity} />
      {transitionId && (
        <FantasyTransition
          id={transitionId}
          reducedMotion={reducedMotion}
          onComplete={() => setTransitionId(null)}
        />
      )}
      {panel === 'settings' && (
        <Dialog title="Settings" onClose={() => setPanel(null)}>
          <GameSettings
            preferences={preferences}
            update={update}
            room={room}
            me={me}
            busy={disabled}
            save={saveSettings}
            previewSound={() => feedback.sound.play('settlement')}
            osReduced={osReduced}
          />
        </Dialog>
      )}
      {panel === 'network' && room && (
        <aside className="game-panel utility-panel floating-panel">
          <div className="panel-heading">
            <h2>Connection</h2>
            <IconButton label="Close connection panel" onClick={() => setPanel(null)}>
              <X />
            </IconButton>
          </div>
          <ConnectionPanel
            metrics={metrics}
            status={status}
            revision={room.revision}
            pending={busy}
            onSync={() => connection.current?.sync()}
          />
        </aside>
      )}
      {panel === 'invite' && room && (
        <Dialog title="Room invitation" compact onClose={() => setPanel(null)}>
          <Invite code={room.roomId} copy={() => void copyInvite()} />
        </Dialog>
      )}
      {panel === 'profile' && (
        <Dialog title="Your profile" onClose={() => setPanel(null)}>
          {g ? (
            <>
              <div className="profile-preview">
                <Avatar profile={room?.players.find((p) => p.id === me)?.profile ?? auth.profile} />
                <strong>{player?.name}</strong>
              </div>
              <p className="muted">Change your avatar and name in the lobby before your next game.</p>
            </>
          ) : (
            <ProfileEditor
              initial={room?.players.find((p) => p.id === me)?.profile ?? auth.profile}
              busy={busy}
              onSave={saveProfile}
            />
          )}
        </Dialog>
      )}
      {panel === 'leave' && (
        <Dialog title="Leave game?" compact onClose={() => setPanel(null)}>
          <p className="muted">Your seat stays saved.</p>
          <div className="dialog-actions">
            <button className="dark-button" onClick={() => setPanel(null)}>
              Cancel
            </button>
            <button className="gold-button" disabled={busy} onClick={() => void leave()}>
              <DoorOpen />
              Leave
            </button>
          </div>
        </Dialog>
      )}
      {panel === 'rules' && (
        <Dialog title="Rules" onClose={() => setPanel(null)}>
          <ul className="quick-rules">
            <li>
              <b>10 points</b> wins on your turn.
            </li>
            <li>
              Settlement <b>1</b> · City <b>2</b> · Each award <b>2</b>.
            </li>
            <li>Roll, collect, then trade and build.</li>
            <li>
              On <b>7</b>, hands over 7 discard half; move the robber and steal.
            </li>
            <li>Play one development card per turn, starting a turn after buying it.</li>
          </ul>
          <a
            className="dark-button"
            href="https://github.com/shashwtd/catanova/blob/main/docs/RULEBOOK.md"
            target="_blank"
            rel="noreferrer"
          >
            Full rulebook <ArrowRight />
          </a>
        </Dialog>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
