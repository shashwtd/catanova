import { IncomingTrade, TradePanel } from './TradePanel.js';
import { ResourcePicker, ResourceSummary } from './ResourcePicker.js';
import { MoveHistory } from './MoveHistory.js';
import { QuickRules } from './QuickRules.js';
import { isBuildAction, placementValid } from './placement.js';
import type { PlacementDraft } from './placement.js';
import { usePreferences } from './preferences.js';
import { useFeedback } from './useFeedback.js';
import { ResourceHand } from './ResourceHand.js';
import { DevelopmentCards, DevelopmentPurchase } from './DevelopmentCards.js';
import { GameEffects } from './GameEffects.js';
import { GameSettings } from './GameSettings.js';
import { TurnTimer } from './TurnTimer.js';
import { FantasyTransition } from './FantasyTransition.js';
import type { RoomSettings } from '../../../packages/protocol/src/settings.js';
import { useAuth, entryLocation } from './auth.js';
import { Avatar, ProfileEditor } from './Profile.js';
import { Lobby, Invite } from './Lobby.js';
import { EntryScreen } from './EntryScreen.js';
import { takeEntryIntent } from './entry-intent.js';
import { FriendsPanel } from './FriendsPanel.js';
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
  History,
  Settings2,
  ArrowRight,
  Castle,
  Check,
  CircleHelp,
  DoorOpen,
  Dices,
  House,
  LoaderCircle,
  Maximize,
  Minimize,
  Route,
  Wifi,
  WifiOff,
  X,
  ArrowLeftRight,
} from './GameIcons.js';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import { Connection, newSession } from './connection.js';
import type { ConnectionStatus, PendingCommand } from './connection.js';
import type { RoomPreview, RoomState, Session } from '../../../packages/protocol/src/index.js';
import { emptyHand, robberVictims, total } from '../../../packages/rules/src/game.js';
import type { GameAction, Hand } from '../../../packages/rules/src/game.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import { Board, ResourceIcon } from './Board.js';
import type { BuildMode } from './Board.js';
import { invitationCode, roomPath, shouldResume, validRoomCode } from './navigation.js';
import './style.css';
import './card-motion.css';
import './dice.css';
import './presentation.css';
import './board-camera.css';
import './fantasy-transition.css';
import './polish.css';
import './board-polish.css';
import './hand-profile-polish.css';
import './interface-polish.css';
import './profile-presence.css';
import './compact-panels.css';
import './account-panels.css';
import './room-experience.css';
import './landing.css';
import './hud-layout.css';

const SESSION_KEY = 'catanova.seat.v1',
  OUTBOX_KEY = 'catanova.outbox.v1',
  LAST_SEAT_KEY = 'catanova.last-seat.v1';
// Consume the OAuth choice once per page load, outside React renders (including StrictMode).
const arrivalLocation = entryLocation();
const arrivalInvite = invitationCode(arrivalLocation.pathname, arrivalLocation.search);
const arrivalIntent = takeEntryIntent(sessionStorage);
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
function App() {
  const auth = useAuth();
  const { preferences, update, reducedMotion } = usePreferences();
  const feedback = useFeedback(preferences, reducedMotion);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const connection = useRef<Connection | null>(null);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]),
    [historyHasMore, setHistoryHasMore] = useState(false);
  const historyLoaded = useRef(false);
  const initialInvite = useRef(arrivalInvite);
  const [entry, setEntry] = useState<'home' | 'create' | 'join' | 'invite'>(
    initialInvite.current ? 'invite' : arrivalIntent,
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
      | 'settings'
      | 'trade'
      | 'rules'
      | 'journal'
      | 'leave'
      | 'profile'
      | 'network'
      | 'invite'
      | 'friends'
      | null
    >(null);
  const [robberHex, setRobberHex] = useState<number | null>(null),
    [selected, setSelected] = useState<Hand>(emptyHand);
  const [placement, setPlacement] = useState<PlacementDraft | null>(null);
  const [isFullscreen, setFullscreen] = useState(!!document.fullscreenElement);

  const g = room?.game,
    player = g?.players.find((p) => p.id === me),
    active = g?.players[g.active],
    myTurn = !!me && active?.id === me;
  const connected = status === 'connected',
    disabled = !connected || busy || feedback.presentationBusy,
    hand = player?.hand ?? emptyHand();
  const actionPhase = myTurn && g?.phase === 'actions';
  const networkBusy = status === 'connecting' || status === 'reconnecting';
  const placementReady = placementValid(placement, g, room?.roomId, me);
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  useEffect(() => {
    if (placement && (!placementValid(placement, g, room?.roomId, me) || !connected)) setPlacement(null);
  }, [placement, g, room?.roomId, me, connected]);
  useEffect(() => {
    if (panel) setPlacement(null);
  }, [panel]);
  useEffect(() => {
    if (!placement) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlacement(null);
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [placement]);
  function previewPlacement(action: GameAction) {
    if (disabled || !g || !room || !me) return;
    if (!isBuildAction(action)) {
      void act(action);
      return;
    }
    const draft: PlacementDraft = {
      action,
      roomId: room.roomId,
      player: me,
      turn: g.turn,
      phase: g.phase,
      setupIndex: g.setupIndex,
    };
    if (placementValid(draft, g, room.roomId, me)) {
      setPlacement(draft);
      setPanel(null);
    }
  }

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
    setPreviewLoading(false);
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
        if (message.commandId || !c.state) setBusy(false);
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
    setPreviewLoading(false);
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
    await enterRoom(kind);
  }
  async function enterRoom(kind: 'create' | 'join') {
    setError('');
    if (!auth.canPlay) {
      await auth.signIn(invite ? roomPath(invite) : '/');
      return;
    }
    const chosenName = auth.config?.mode === 'authenticated' ? auth.profile.name : name.trim();
    if (!chosenName) {
      setError('Enter your name');
      return;
    }
    const target = (entry === 'invite' ? invite : code)?.trim().toUpperCase();
    if (kind === 'join' && (!target || !validRoomCode(target))) {
      setError('Enter an eight-character room code');
      return;
    }
    sessionStorage.removeItem(OUTBOX_KEY);
    localStorage.setItem('catanova.name', chosenName);
    setBusy(true);
    try {
      const profile =
        auth.config?.mode === 'authenticated'
          ? auth.profile
          : await auth.saveProfile({ ...auth.profile, name: chosenName });
      connect(newSession(profile.name, kind === 'join' ? target : undefined, profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile');
      setBusy(false);
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
    entry === 'invite' && (!!previewRoom?.canResume || (last?.roomId === invite && !!last.joined));
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
    const canonical = await auth.saveProfile(profile);
    const c = connection.current;
    if (room && !g && c) {
      setBusy(true);
      try {
        await c.lobby(false, canonical);
      } finally {
        setBusy(c.awaitingConfirmation);
      }
    }
    setName(canonical.name);
    setPanel(null);
  }
  const phaseText = !g
    ? ''
    : g.winner
      ? `${g.players.find((p) => p.id === g.winner)?.name} wins`
      : g.phase === 'discard'
        ? g.discards[me ?? '']
          ? `Discard ${g.discards[me!]} cards`
          : ''
        : !myTurn
          ? ''
          : g.phase === 'setupSettlement'
            ? 'Place a settlement'
            : g.phase === 'setupRoad'
              ? 'Place a road'
              : g.phase === 'robber'
                ? 'Move the robber'
                : g.phase === 'freeRoads'
                  ? `Place ${g.freeRoads} free road${g.freeRoads === 1 ? '' : 's'}`
                  : mode
                    ? `Place ${mode === 'city' ? 'a city' : `a ${mode}`}`
                    : '';
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
          <BoardViewport seed={g.board.seed} reducedMotion={reducedMotion}>
            <Board
              board={g.board}
              game={g}
              glowHexes={reducedMotion ? [] : feedback.event?.glowHexes}
              effectId={feedback.event?.id}
              me={me}
              mode={mode}
              disabled={disabled}
              pendingBuild={placementReady ? placement?.action : null}
              onAction={previewPlacement}
              onRobber={chooseRobber}
            />
          </BoardViewport>
        </div>
      )}
      {!g && <div className="title-scenery" aria-hidden="true" />}
      {g && (
        <nav className="side-controls game-controls" aria-label="Current game tools">
          <IconButton
            label="Move history"
            active={panel === 'journal'}
            onClick={() => setPanel(panel === 'journal' ? null : 'journal')}
          >
            <History />
          </IconButton>
          <IconButton
            label="Connection and ping"
            active={panel === 'network'}
            className={connected ? 'connected' : 'disconnected'}
            onClick={() => setPanel(panel === 'network' ? null : 'network')}
          >
            {networkBusy ? <LoaderCircle className="spin" /> : connected ? <Wifi /> : <WifiOff />}
          </IconButton>
          <IconButton
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => void fullscreen()}
          >
            {isFullscreen ? <Minimize /> : <Maximize />}
          </IconButton>
        </nav>
      )}
      {g && (
        <nav className="side-controls room-controls" aria-label="Room tools">
          <IconButton
            label="Rules"
            active={panel === 'rules'}
            onClick={() => setPanel(panel === 'rules' ? null : 'rules')}
          >
            <CircleHelp />
          </IconButton>
          <IconButton label="Settings" active={panel === 'settings'} onClick={() => setPanel('settings')}>
            <Settings2 />
          </IconButton>
          <IconButton
            label="Leave room"
            disabled={busy}
            onClick={() => (!g.winner ? setPanel('leave') : void leave())}
          >
            <DoorOpen />
          </IconButton>
        </nav>
      )}
      {g && room && (
        <PlayerRail
          room={room}
          game={g}
          me={me}
          timer={
            <TurnTimer
              room={room}
              me={me}
              offset={metrics.clockOffsetMs}
              connected={connected}
              onWarning={() => feedback.sound.play('warning')}
            />
          }
        />
      )}
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
        <EntryScreen
          auth={auth}
          entry={entry}
          setEntry={setEntry}
          name={name}
          setName={setName}
          code={code}
          setCode={setCode}
          invite={invite}
          previewRoom={previewRoom}
          previewLoading={previewLoading}
          previewError={previewError}
          resumableInvite={resumableInvite}
          last={last}
          busy={busy || networkBusy}
          onEnter={(event, kind) => void enter(event, kind)}
          onCreate={() => void enterRoom('create')}
          onResume={() => {
            const seat =
              entry === 'invite'
                ? last?.roomId === invite
                  ? last
                  : newSession(auth.profile.name, invite!, auth.profile)
                : last;
            if (seat) connect(seat);
          }}
          onBack={() => home(false)}
          onProfile={() => setPanel('profile')}
          onFriends={() => setPanel('friends')}
          onSettings={() => setPanel('settings')}
          onSignOut={() => void signOut()}
          onRules={() => setPanel('rules')}
        />
      )}
      {room && !g && (
        <Lobby
          room={room}
          me={me}
          busy={busy}
          connected={connected}
          onReady={(v) => void ready(v)}
          onStart={() => void act({ kind: 'start' })}
          onInvite={() => setPanel('invite')}
          onFriends={auth.config?.mode === 'authenticated' ? () => setPanel('friends') : undefined}
          onLeave={() => void leave()}
          onEdit={() => setPanel('profile')}
          onSettings={() => setPanel('settings')}
        />
      )}
      {g && (
        <>
          {phaseText && (
            <div className="action-prompt" role="status" key={`${g.turn}:${g.phase}:${mode}`}>
              <span>{phaseText}</span>
              {mode && (
                <IconButton
                  label="Cancel placement"
                  onClick={() => {
                    setMode(null);
                    setPlacement(null);
                  }}
                >
                  <X />
                </IconButton>
              )}
            </div>
          )}
          {g && (
            <div className="construction-tools build-shelf" aria-label="Build">
              {(['road', 'settlement', 'city'] as const).map((kind, i) => {
                const Icon = [Route, House, Castle][i]!,
                  sites =
                    kind === 'road' ? g.legal.roads : kind === 'city' ? g.legal.cities : g.legal.settlements;
                return (
                  <IconButton
                    key={kind}
                    className={`build-control build-${kind}`}
                    label={`Build ${kind} · ${RESOURCES.filter((r) => COSTS[kind][r])
                      .map((r) => `${COSTS[kind][r]} ${RESOURCE_NAMES[r]}`)
                      .join(', ')}`}
                    active={mode === kind}
                    disabled={disabled || !actionPhase || !sites.length}
                    onClick={() => {
                      setPlacement(null);
                      setMode(mode === kind ? null : kind);
                      setPanel(null);
                    }}
                  >
                    <Icon />
                    <span className="build-control-label">
                      {kind === 'settlement' ? 'House' : kind === 'city' ? 'City' : 'Road'}
                    </span>
                  </IconButton>
                );
              })}
            </div>
          )}
          <div className="card-table">
            <div className="hand-zone">
              <ResourceHand
                hand={feedback.hand ?? hand}
                pulse={feedback.pulse}
                reducedMotion={reducedMotion}
                onHover={() => feedback.sound.play('hover')}
              />
              {me && !!player?.cards?.length && (
                <DevelopmentCards
                  game={g}
                  me={me}
                  disabled={disabled}
                  reducedMotion={reducedMotion}
                  onAction={(a) => void act(a)}
                  onHover={() => feedback.sound.play('hover')}
                  obscured={panel !== null || placementReady}
                  onSelect={() => {
                    setPanel(null);
                    setPlacement(null);
                  }}
                />
              )}
            </div>
            <div className="table-actions">
              <div className="dice-dock" data-dice-dock aria-hidden="true" />
              <div className="utility-actions">
                <button
                  className={`trade-action ${panel === 'trade' ? 'is-selected' : ''}`}
                  aria-label="Trade"
                  title="Trade"
                  disabled={disabled || !actionPhase}
                  onClick={() => {
                    setPanel(panel === 'trade' ? null : 'trade');
                    setMode(null);
                  }}
                >
                  <ArrowLeftRight size={33} />
                  <span>Trade</span>
                </button>
                <div className="development-hand-inline purchase-control">
                  <DevelopmentPurchase
                    disabled={disabled || !g.legal.canBuyCard}
                    onBuy={() => void act({ kind: 'buyCard' })}
                  />
                </div>
              </div>
              <button
                className={`turn-action ${actionPhase ? 'end-turn' : 'roll-turn'}`}
                aria-label={actionPhase ? 'End turn' : 'Roll dice'}
                title={actionPhase ? 'End turn' : 'Roll dice'}
                disabled={disabled || !myTurn || !['roll', 'actions'].includes(g.phase)}
                onClick={() => void act({ kind: actionPhase ? 'endTurn' : 'roll' })}
              >
                {actionPhase ? <ArrowRight size={36} /> : <Dices size={38} />}
                <span>{actionPhase ? 'End' : 'Roll'}</span>
              </button>
            </div>
          </div>
          {me && <IncomingTrade game={g} me={me} disabled={disabled} onAction={(a) => void act(a)} />}
          {(panel === 'trade' || panel === 'journal') && (
            <aside
              className={`game-panel floating-panel ${panel === 'trade' ? 'trade-panel' : 'journal-panel'}`}
              aria-label={panel === 'trade' ? 'Trade' : 'Move history'}
            >
              <div className="panel-heading">
                <h2>{panel === 'trade' ? 'Trade' : 'Move history'}</h2>
                <IconButton label="Close panel" onClick={() => setPanel(null)}>
                  <X />
                </IconButton>
              </div>
              {panel === 'trade' && me && (
                <TradePanel game={g} me={me} disabled={disabled} onAction={(a) => void act(a)} />
              )}
              {panel === 'journal' && (
                <MoveHistory
                  entries={historyEntries}
                  game={g}
                  hasMore={historyHasMore}
                  onEarlier={() => connection.current?.history(historyEntries.at(-1)?.revision)}
                />
              )}
            </aside>
          )}
          {placementReady && placement && (
            <aside className="build-confirmation" aria-label="Confirm placement">
              <div className="build-confirmation-title">
                {placement.action.kind === 'road' ? (
                  <Route />
                ) : placement.action.kind === 'city' ? (
                  <Castle />
                ) : (
                  <House />
                )}
                <strong>
                  {placement.action.kind === 'city' ? 'Upgrade to city' : `Place ${placement.action.kind}`}
                </strong>
              </div>
              {g.phase === 'actions' ? (
                <ResourceSummary hand={COSTS[placement.action.kind]} />
              ) : (
                <span className="free-placement">
                  {g.phase === 'freeRoads' ? 'Free road' : 'Starting piece'}
                </span>
              )}
              <div className="build-confirmation-actions">
                <button
                  className="text-button"
                  aria-label="Cancel placement"
                  onClick={() => setPlacement(null)}
                >
                  <X />
                </button>
                <button
                  className="gold-button"
                  disabled={disabled || !placementReady}
                  onClick={() => {
                    if (!placementValid(placement, g, room?.roomId, me)) return;
                    const action = placement.action;
                    setPlacement(null);
                    void act(action);
                  }}
                >
                  <Check />
                  Build
                </button>
              </div>
            </aside>
          )}
          {g.phase === 'discard' && !!g.discards[me ?? ''] && (
            <aside className="required-action floating-panel">
              <div className="panel-heading">
                <h2>Discard {g.discards[me!]} cards</h2>
                <TurnTimer
                  room={room!}
                  me={me}
                  discard
                  offset={metrics.clockOffsetMs}
                  connected={connected}
                  onWarning={() => feedback.sound.play('warning')}
                />
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
      {g && (
        <GameEffects event={feedback.event} lastDice={g.dice} reducedMotion={reducedMotion} activity={true} />
      )}
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
          <Invite code={room.roomId} />
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
              checkUsername={auth.config?.mode === 'authenticated' ? auth.checkUsername : undefined}
              googleAvatarUrl={auth.googleAvatarUrl}
              onSave={saveProfile}
            />
          )}
        </Dialog>
      )}
      {panel === 'friends' && (
        <Dialog title="Friends" onClose={() => setPanel(null)}>
          <FriendsPanel auth={auth} />
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
          <QuickRules />
        </Dialog>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
