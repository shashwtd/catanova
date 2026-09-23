import { GameHandDock } from './GameHandDock.js';
import { useMatchResults } from './useMatchResults.js';
import { GameOver } from './GameOver.js';
import { GameStatistics } from './GameStatistics.js';
import { LoungeBackdrop } from './LoungeBackdrop.js';
import { PlacementConfirmation } from './PlacementConfirmation.js';
import { TurnButtonAttention } from './TurnButtonAttention.js';
import { UtilityPanel } from './UtilityPanel.js';
import { ConnectionPanel } from './ConnectionPanel.js';
import type { GameToolPanel } from './GameTools.js';
import { GameTools } from './GameTools.js';
import { IncomingTrade, TradePanel } from './TradePanel.js';
import { ResourceSummary } from './ResourcePicker.js';
import { MoveHistory } from './MoveHistory.js';
import { QuickRules } from './QuickRules.js';
import { isBuildAction, placementValid } from './placement.js';
import type { PlacementDraft } from './placement.js';
import { BOARD_THEMES } from './board-theme.js';
import { usePreferences } from './preferences.js';
import { dicePresentationGame, useFeedback } from './useFeedback.js';
import { ResourceHand } from './ResourceHand.js';
import { DevelopmentCards, DevelopmentPurchase } from './DevelopmentCards.js';
import { GameEffects } from './GameEffects.js';
import { PlayerSettings, RoomConfiguration } from './GameSettings.js';
import { TurnTimer } from './TurnTimer.js';
import { RobberFlow } from './RobberFlow.js';
import { useGameAttention } from './useGameAttention.js';
import { FantasyTransition } from './FantasyTransition.js';
import type { RoomSettings } from '../../../packages/protocol/src/settings.js';
import { useAuth, entryLocation } from './auth.js';
import { Avatar } from './Profile.js';
import { Lobby, Invite } from './Lobby.js';
import { EntryScreen } from './EntryScreen.js';
import { GameLoader } from './GameLoader.js';
import { takeEntryIntent } from './entry-intent.js';
import { preloadGameAssets } from './game-assets.js';
import { useRoomInvites } from './useRoomInvites.js';
import { RoomInviteNotice, visibleRoomInvitations } from './RoomInvitePanel.js';
import { FriendsDrawer } from './FriendsDrawer.js';
import { PlayerHub, PlayerProfile } from './PlayerHub.js';
import { usePlayerGames } from './usePlayerGames.js';
import { seatColorMap } from './player-colors.js';
import type { PlayerColor } from '../../../packages/protocol/src/colors.js';
import { useAccountPrivacy } from './usePrivacy.js';
import {
  showPlayerHome,
  browserRoomPath,
  roomNavigationState,
  navigationRoomReference,
  accountHomePath,
  previewJoinReference,
} from './navigation.js';
import { PlayerRail } from './PlayerRail.js';
import { BoardViewport } from './BoardViewport.js';
import { ReactionButton, ReactionLayer, useFlyingReactions } from './Reactions.js';
import { initialMetrics } from './connection.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { GameStatistics as Statistics, HistoryEntry } from '../../../packages/protocol/src/index.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { mountApp } from './mount-app.js';
import {
  GameIcon,
  Settings2,
  NextTurn,
  Check,
  CircleHelp,
  DoorOpen,
  Dices,
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
import { emptyHand } from '../../../packages/rules/src/game.js';
import type { GameAction } from '../../../packages/rules/src/game.js';
import { Board, ResourceIcon } from './Board.js';
import type { BuildMode } from './Board.js';
import { invitationCode, roomPath, shouldResume, validRoomCode } from './navigation.js';
import { normalizeRoomReference } from '../../../packages/protocol/src/room-reference.js';
import './style.css';
import './card-motion.css';
import './dice.css';
import './reactions.css';
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
import './settings.css';
import './trade-polish.css';
import './awards.css';
import './game-guidance.css';
import './mobile-layout.css';
import './disconnect.css';
import './player-hub.css';
import './friends-drawer.css';
import './room-lobby.css';
import './history-mobile.css';
import './resource-counters.css';
import './lounge.css';
import './room-refinement.css';
import './play-refinement.css';
import './tool-motion.css';
import './lounge-controls.css';
import './game-dialogs.css';
import './game-feedback-polish.css';
import './lounge-tabletop.css';
import './match-followups.css';
import './game-popover.css';
import './hub-entry-refinement.css';
import './landing-features.css';
import './room-seats.css';
import './mobile-shelf.css';
import './table-light.css';

/** One shared empty list, so `glowHexes` is not a new array every render. */
const NO_GLOW: number[] = [];

const SESSION_KEY = 'catanova.seat.v1',
  OUTBOX_KEY = 'catanova.outbox.v1',
  LAST_SEAT_KEY = 'catanova.last-seat.v1';
const designPreview = import.meta.env.DEV && location.pathname === '/dev/lounge';
const resultsPreview = import.meta.env.DEV && location.pathname === '/dev/results';
// Consume the OAuth choice once per page load, outside React renders (including StrictMode).
const arrivalLocation = entryLocation();
const arrivalInvite = navigationRoomReference(
  arrivalLocation.pathname,
  arrivalLocation.search,
  history.state,
);
const arrivalIntent = designPreview || resultsPreview ? 'home' : takeEntryIntent(sessionStorage);
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
function Dialog(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  compact?: boolean;
  side?: boolean;
  tool?: GameToolPanel;
}) {
  return props.side ? (
    <UtilityPanel tool={props.tool} title={props.title} onClose={props.onClose}>
      {props.children}
    </UtilityPanel>
  ) : (
    <ModalDialog {...props} />
  );
}
function ModalDialog({
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
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
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
  const reactions = useFlyingReactions();
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const connection = useRef<Connection | null>(null);
  const admissionEpoch = useRef(0);
  const accountIdentity = auth.user?.id ?? (auth.config?.mode === 'local' ? 'local' : null);
  const currentIdentity = useRef(accountIdentity);
  currentIdentity.current = accountIdentity;
  const currentHomePath = useRef(accountHomePath(auth));
  currentHomePath.current = accountHomePath(auth);
  const connectedIdentity = useRef<string | null>(null);
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
  const [admitting, setAdmitting] = useState(false);
  const [admissionLabel, setAdmissionLabel] = useState('Joining room…');
  const [signingOut, setSigningOut] = useState(false);
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
      | 'configure'
      | 'trade'
      | 'rules'
      | 'journal'
      | 'statistics'
      | 'connection'
      | 'leave'
      | 'signOut'
      | 'profile'
      | 'editProfile'
      | 'invite'
      | 'friends'
      | null
    >(null);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [robberHex, setRobberHex] = useState<number | null>(null);
  const [placement, setPlacement] = useState<PlacementDraft | null>(null);
  const [isFullscreen, setFullscreen] = useState(!!document.fullscreenElement);

  const g = room?.game,
    player = g?.players.find((p) => p.id === me),
    active = g?.players[g.active],
    myTurn = !!me && active?.id === me && !player?.resigned;
  const matchResults = useMatchResults(room, `${accountIdentity ?? 'anonymous'}:${me ?? 'spectator'}`);
  const entering = !room && (admitting || (auth.loading && (location.pathname !== '/' || !!arrivalInvite)));
  const playerHome = !room && !entering && showPlayerHome(auth, invite);
  const privacy = useAccountPrivacy(
    auth.accessToken,
    auth.config?.mode === 'authenticated' && !!auth.account && !auth.account.isGuest,
    auth.account?.id,
  );
  const playerGames = usePlayerGames(
    auth.account?.id,
    auth.accessToken,
    auth.canPlay && (!g || g.phase === 'finished' || panel === 'profile'),
  );
  const roomInvites = useRoomInvites(
    auth.account?.id,
    auth.accessToken,
    auth.canPlay && !!auth.account && !auth.account.isGuest,
  );
  const excludedInviteRoomIds = [room?.roomId, previewRoom?.roomId, invite];
  const incomingInvites = visibleRoomInvitations(roomInvites.incoming, excludedInviteRoomIds);
  const roomEntryBlocked = room ? 'Leave your current room to join another.' : undefined;
  const [assetProgress, setAssetProgress] = useState(0);
  const [launchVisualExpired, setLaunchVisualExpired] = useState(false);
  const connected = status === 'connected',
    disabled =
      !!room?.spectating ||
      !connected ||
      busy ||
      !!room?.launch ||
      !!transitionId ||
      feedback.presentationBusy ||
      !!player?.resigned ||
      !!room?.paused,
    hand = player?.hand ?? emptyHand();
  const presentedGame = room ? dicePresentationGame(room, feedback.board) : undefined;
  const gameNotice = useGameAttention(room, me, connected, feedback.presentationBusy, (cue) =>
    feedback.sound.playAttention(cue),
  );
  useEffect(() => {
    feedback.sound.setScene(g ? 'game' : 'menu');
  }, [!!g, feedback.sound]);
  const actionPhase = myTurn && g?.phase === 'actions';
  const networkBusy = status === 'connecting' || status === 'reconnecting';
  const invitationNotice = (
    <RoomInviteNotice
      invitations={incomingInvites}
      busy={!!roomInvites.busy || busy || networkBusy}
      blockedReason={roomEntryBlocked}
      error={roomInvites.error}
      onOpen={openInvitation}
      onDismiss={(id) => void roomInvites.dismiss(id)}
      onShowAll={() => setPanel('friends')}
    />
  );
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
  /**
   * The board is dealt once and never changes, but every state message arrives
   * as fresh JSON, so `g.board` was a new object each time and the scenery was
   * rebuilt with it. Pinning it to the seed lets the static half of the board
   * render once for the whole game.
   */
  const stableBoard = useMemo(() => g?.board, [g?.board.seed]);
  /** Seat colours change only when somebody picks one, so they are derived from
   *  the seats' own colours rather than rebuilt on every render — `Board` is
   *  memoised and a fresh array each time would defeat it. */
  const seatColors = useMemo(
    () => seatColorMap(room?.players),
    [room?.players.map((p) => `${p.id}:${p.color ?? ''}`).join('|')],
  );
  /**
   * Stable handler identities. Defined inline they changed on every render,
   * which defeats the board's memo on its own; the ref keeps the identity
   * fixed while always calling the current logic.
   */
  const handlers = useRef({ previewPlacement: (_: GameAction) => {}, chooseRobber: (_: number) => {} });
  const onBoardAction = useCallback((action: GameAction) => handlers.current.previewPlacement(action), []);
  const onBoardRobber = useCallback((hex: number) => handlers.current.chooseRobber(hex), []);
  // Both are hoisted declarations further down, so this reads them fresh on
  // every render while the identities the board sees never change.
  handlers.current = { previewPlacement, chooseRobber };

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
      if (mode === action.kind) {
        void act(action);
        return;
      }
      setPlacement(draft);
      setPanel(null);
    }
  }

  function home(released = false) {
    admissionEpoch.current++;
    initialInvite.current = null;
    connectedIdentity.current = null;
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
    setStatistics(null);
    setTransitionId(null);
    setRoom(null);
    setHistoryEntries([]);
    historyLoaded.current = false;
    setMetrics(initialMetrics());
    setMe(undefined);
    setStatus('idle');
    setBusy(false);
    setAdmitting(false);
    setPanel(null);
    setMode(null);
    setError('');
    setInvite(null);
    setPreviewRoom(null);
    setPreviewLoading(false);
    setPreviewError('');
    setEntry('home');
    history.replaceState(null, '', currentHomePath.current);
  }
  function connect(session: Session, pending?: PendingCommand) {
    setAdmissionLabel(
      session.roomId ? (session.joined ? 'Returning to room…' : 'Joining room…') : 'Creating room…',
    );
    setAdmitting(true);
    admissionEpoch.current++;
    connectedIdentity.current = currentIdentity.current;
    const old = connection.current;
    connection.current = null;
    old?.stop();
    setError('');
    feedback.reset();
    setStatistics(null);
    setTransitionId(null);
    setRoom(null);
    setBusy(!!pending);
    const c = new Connection(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      session,
      {
        pending,
        preloadGame: true,
        accessToken: auth.accessToken,
        onMetrics: (value) => {
          if (connection.current === c) setMetrics(value);
        },
        onStatus: (value) => {
          if (connection.current === c) setStatus(value);
        },
        onSession: (saved) => {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
          if (!saved.spectating) localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(saved));
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
      if (message.type === 'reaction') {
        reactions.add(message.reaction, message.name);
        return;
      }
      if (message.type === 'welcome' || message.type === 'state') {
        const next = c.state;
        if (next && c.playerId) {
          if (previousSnapshot && (next.round ?? 0) !== (previousSnapshot.round ?? 0)) {
            feedback.reset();
            setHistoryEntries([]);
            historyLoaded.current = false;
            setStatistics(null);
            setPanel(null);
          }
          feedback.accept(previousSnapshot, next, c.playerId, message.type === 'welcome');
          if (message.type === 'state' && previousSnapshot && !previousSnapshot.game && next.game) {
            setTransitionId(previousSnapshot.launch?.id ?? `${next.roomId}:${next.revision}`);
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
        if (next) setAdmitting(false);
        setRoom(next);
        setMe(c.playerId ?? undefined);
        if (message.type === 'welcome' && next)
          history.replaceState(roomNavigationState(next), '', browserRoomPath(next));
      }
      if (message.type === 'statistics' && message.statistics.round === (c.state?.round ?? 0))
        setStatistics(message.statistics);
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
        if (message.code === 'GAME_STARTED' && !c.state && !c.session.joined && !c.session.spectating) {
          connect({ ...c.session, spectating: true });
          return;
        }
        if (!c.state) setAdmitting(false);
        if (message.code === 'LOBBY_REMOVED') {
          home(true);
          setToast(message.message);
          return;
        }
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
          if (!c.session.spectating) localStorage.removeItem(LAST_SEAT_KEY);
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
    if (!room || room.game) return;
    // Requests are cached and shared with the actual launch and WebGL renderer.
    void preloadGameAssets(undefined, preferences.boardTheme).catch(() => {});
  }, [room?.roomId, preferences.boardTheme]);
  useEffect(() => {
    const launchId = room?.launch?.id;
    const c = connection.current;
    if (!launchId || !c || !connected) return;
    let active = true;
    setAssetProgress(0);
    void preloadGameAssets((ready, total) => {
      if (active) setAssetProgress(ready / total);
    }, preferences.boardTheme).then(
      () => {
        if (active && connection.current === c && !c.session.spectating) c.launchReady(launchId, true);
      },
      () => {
        if (active && connection.current === c && !c.session.spectating) c.launchReady(launchId, false);
      },
    );
    return () => {
      active = false;
    };
  }, [room?.launch?.id, connected, preferences.boardTheme]);
  useEffect(() => {
    setLaunchVisualExpired(false);
    const launch = room?.launch;
    if (!launch) return;
    const serverTime = room.serverNow ?? Date.now() + (metrics.clockOffsetMs ?? 0);
    const remaining = Math.max(0, Math.min(10_000, launch.deadlineAt - serverTime));
    const timer = setTimeout(() => {
      setLaunchVisualExpired(true);
      connection.current?.sync();
    }, remaining + 500);
    return () => clearTimeout(timer);
  }, [room?.launch?.id]);

  useEffect(() => {
    if (auth.loading || room || invite || location.pathname === '/auth/callback') return;
    const destination = accountHomePath(auth);
    if (location.pathname === '/' || location.pathname === '/play')
      history.replaceState(null, '', destination);
  }, [auth.loading, auth.canPlay, auth.config?.mode, auth.profile.name, room?.roomId, invite]);
  useEffect(() => {
    const navigate = () => {
      const path = location.pathname,
        search = location.search,
        binding = history.state;
      const reference = navigationRoomReference(path, search, binding);
      if (room && reference === room.roomId) return;
      home(false);
      history.replaceState(binding, '', path + search);
      initialInvite.current = reference;
      setInvite(reference);
      setEntry(reference ? 'invite' : 'home');
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, [room?.roomId, auth.canPlay]);
  function openInvitation(reference: string) {
    if (room) return;
    setPanel(null);
    setEntry('invite');
    history.pushState(null, '', roomPath(reference));
    initialInvite.current = reference;
    setInvite(reference);
    if (auth.canPlay) {
      setPanel(null);
      void enterRoom('join', reference);
      return;
    }
    setEntry('invite');
    setPreviewRoom(null);
  }

  useEffect(() => {
    if (!auth.loading && connection.current && connectedIdentity.current !== accountIdentity) home(false);
  }, [auth.loading, accountIdentity]);
  useEffect(() => {
    admissionEpoch.current++;
    if (!connection.current) {
      setBusy(false);
      setAdmitting(false);
    }
  }, [accountIdentity]);
  useEffect(() => {
    if (auth.profile.name) setName(auth.profile.name);
  }, [auth.profile.name]);
  useEffect(() => {
    if (panel === 'journal' && connected && room?.game) connection.current?.history();
  }, [panel, connected, room?.historyRevision]);
  useEffect(() => {
    if (connected && panel === 'statistics') connection.current?.statistics();
  }, [panel, connected, g?.phase, room?.historyRevision, room?.round]);
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
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'Room not found'
              : response.status === 429
                ? 'Too many attempts. Try again in a minute.'
                : 'Room unavailable',
          );
        return response.json() as Promise<RoomPreview>;
      })
      .then((preview) => {
        if (!controller.signal.aborted) {
          setPreviewRoom(preview);
          history.replaceState(roomNavigationState(preview), '', browserRoomPath(preview));
        }
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
  }, [g?.phase, g?.turn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  async function act(action: GameAction, propagateFailure = false) {
    const c = connection.current;
    if (!c || disabled) return false;
    setBusy(true);
    setError('');
    try {
      await c.action(action);
      setMode(null);
      setRobberHex(null);
      return true;
    } catch (e) {
      if (connection.current === c)
        setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Action failed');
      if (propagateFailure) throw e;
      return false;
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  async function leave() {
    const c = connection.current;
    if (c?.session.spectating) {
      home(false);
      return;
    }
    if (!c || busy) return;
    if (!connected) {
      setError('Reconnect to confirm leaving the game.');
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
  async function enterRoom(kind: 'create' | 'join', requestedCode?: string, watch = false) {
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
    if (busy || networkBusy || room) return;
    const attempt = ++admissionEpoch.current;
    const owner = accountIdentity;
    const current = () => admissionEpoch.current === attempt && currentIdentity.current === owner;
    let target = normalizeRoomReference(requestedCode ?? (entry === 'invite' ? invite : code) ?? '');
    if (kind === 'join' && (!target || !validRoomCode(target))) {
      setError('Enter a four-character room code');
      return;
    }
    sessionStorage.removeItem(OUTBOX_KEY);
    localStorage.setItem('catanova.name', chosenName);
    setBusy(true);
    setAdmitting(true);
    setAdmissionLabel(kind === 'create' ? 'Creating room…' : 'Joining room…');
    try {
      if (kind === 'join') {
        let targetPreview = previewRoom;
        let resolved = previewJoinReference(target, previewRoom);
        if (!resolved) {
          const token = auth.user ? await auth.accessToken() : undefined;
          if (!current()) return;
          const response = await fetch(`/api/rooms/${target}`, {
            signal: AbortSignal.timeout(10_000),
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          });
          if (!response.ok)
            throw new Error(response.status === 404 ? 'Room not found' : 'Room unavailable. Try again.');
          targetPreview = (await response.json()) as RoomPreview;
          resolved = previewJoinReference(target, targetPreview);
          if (!current()) return;
        }
        if (!resolved) throw new Error('The room link changed. Open it again.');
        target = resolved;
        watch ||= !!targetPreview?.started && !targetPreview.canResume;
      }
      if (!current()) return;
      const profile =
        auth.config?.mode === 'authenticated'
          ? auth.profile
          : await auth.saveProfile({ ...auth.profile, name: chosenName });
      if (!current()) return;
      connect({
        ...newSession(profile.name, kind === 'join' ? target : undefined, profile),
        ...(watch ? { spectating: true } : {}),
      });
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : 'Could not save profile');
      setBusy(false);
      setAdmitting(false);
    }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (await auth.signOut()) home(true);
    } finally {
      setSigningOut(false);
    }
  }
  function resumeGame(roomId: string) {
    if (room || busy || networkBusy || !auth.canPlay) return;
    setPanel(null);
    setError('');
    sessionStorage.removeItem(OUTBOX_KEY);
    setBusy(true);
    connect(newSession(auth.profile.name, roomId, auth.profile));
  }
  function chooseRobber(hex: number) {
    if (!g || !me || disabled || !myTurn || g.phase !== 'robber' || hex === g.robber) return;
    setRobberHex(hex);
    setPanel(null);
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
  const savedInviteSeat = !!last?.joined && !!invite && last.roomId === (previewRoom?.roomId ?? invite);
  const resumableInvite = entry === 'invite' && (!!previewRoom?.canResume || savedInviteSeat);
  async function ready(value: boolean) {
    const c = connection.current;
    if (!c || disabled) return false;
    setBusy(true);
    try {
      await c.lobby(value);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not update readiness');
      return false;
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  /** Colour is a lobby change like readiness, so it goes through the same
   *  single-command path and keeps this seat's ready state as it was. */
  async function chooseColor(color: PlayerColor) {
    const c = connection.current;
    if (!c || disabled) return;
    setBusy(true);
    try {
      await c.chooseColor(color, !!room?.players.find((p) => p.id === me)?.ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change colour');
    } finally {
      if (connection.current === c) setBusy(c.awaitingConfirmation);
    }
  }
  async function addBot() {
    const c = connection.current;
    if (!c || disabled) return;
    setBusy(true);
    try {
      await c.addBot();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Could not add a bot');
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
    : room?.spectating || player?.resigned || room?.paused
      ? (gameNotice?.prompt ?? '')
      : ['discard', 'robber'].includes(g.phase)
        ? ''
        : mode && myTurn && g.phase === 'actions'
          ? `Choose a highlighted ${mode === 'road' ? 'path for your road' : mode === 'city' ? 'settlement to upgrade' : 'corner for your settlement'}`
          : g.phase === 'actions'
            ? ''
            : (gameNotice?.prompt ?? '');
  return (
    <main
      className={`game-world ${g ? 'playing' : room ? 'lobby' : playerHome ? 'player-home' : 'entry-world'}`}
      data-motion={reducedMotion ? 'reduced' : 'full'}
      onClickCapture={(e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (button && !button.disabled) feedback.sound.play('ui');
      }}
    >
      {!g && (room || playerHome) && <LoungeBackdrop />}
      {g && (
        <div className="board-anchor">
          <BoardViewport seed={g.board.seed} reducedMotion={reducedMotion}>
            <Board
              art={BOARD_THEMES[preferences.boardTheme]}
              board={stableBoard ?? g.board}
              game={presentedGame ?? g}
              glowHexes={reducedMotion ? NO_GLOW : feedback.event?.glowHexes}
              effectId={feedback.event?.id}
              me={me}
              mode={mode}
              disabled={disabled}
              selectedRobberHex={robberHex}
              colors={seatColors}
              pendingBuild={placementReady ? placement?.action : null}
              onAction={onBoardAction}
              onRobber={onBoardRobber}
            />
          </BoardViewport>
          <ReactionLayer flying={reactions.flying} />
        </div>
      )}
      {!g && !room && !playerHome && !entering && <div className="title-scenery" aria-hidden="true" />}
      {g && (
        <GameTools
          panel={panel}
          onPanel={setPanel}
          onClosePanel={() => setPanel(null)}
          fullscreen={isFullscreen}
          onFullscreen={() => void fullscreen()}
          busy={busy}
          onLeave={() => (room?.spectating || g.phase === 'finished' ? void leave() : setPanel('leave'))}
          reactions={
            !room?.spectating && (
              <ReactionButton
                disabled={!connected || !!player?.resigned || g.phase === 'finished'}
                onReact={(reaction) => {
                  connection.current?.react(reaction);
                  // The server echoes accepted reactions to every player, including us.
                  feedback.sound.play('hover');
                }}
              />
            )
          }
        />
      )}
      {g && room && (
        <PlayerRail
          clockOffset={metrics.clockOffsetMs}
          room={room}
          game={presentedGame ?? g}
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
              <GameLoader label="Reconnecting…" />
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
      {entering && (
        <section className="room-admission" aria-label="Loading room" aria-busy="true">
          <GameLoader label={auth.loading ? 'Connecting…' : admissionLabel} />
          {!auth.loading && (
            <button className="dark-button" onClick={() => home(false)}>
              Cancel
            </button>
          )}
        </section>
      )}
      {playerHome && (
        <PlayerHub
          // This and the drawer are siblings: account IDs alone collide during reconciliation.
          key={`hub:${auth.account?.id ?? 'local'}`}
          auth={auth}
          games={playerGames}
          busy={busy || networkBusy}
          initialJoin={entry === 'join'}
          invitationCount={incomingInvites.length}
          notifications={panel === 'friends' ? null : invitationNotice}
          onCreate={() => void enterRoom('create')}
          onJoin={(value) => enterRoom('join', value)}
          onResume={resumeGame}
          onProfile={() => setPanel('profile')}
          onEditProfile={() => setPanel('editProfile')}
          onFriends={() => setPanel('friends')}
          onSettings={() => setPanel('settings')}
          onSignOut={() => setPanel('signOut')}
        />
      )}
      {!playerHome && panel !== 'friends' && <div className="room-notifications">{invitationNotice}</div>}
      {!room && !playerHome && !entering && (
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
                ? savedInviteSeat
                  ? last
                  : newSession(auth.profile.name, previewRoom?.roomId ?? invite!, auth.profile)
                : last;
            if (seat) connect(seat);
          }}
          onWatch={() => void enterRoom('join', undefined, true)}
          onBack={() => home(false)}
          onProfile={() => setPanel('profile')}
          onFriends={() => setPanel('friends')}
          onSettings={() => setPanel('settings')}
          onSignOut={() => setPanel('signOut')}
        />
      )}
      {room?.spectating && (
        <div className="spectator-banner" role="status">
          <span>{g ? 'Spectating · Public view' : 'Waiting for the next match'}</span>
          {g && <div className="spectator-dice" data-dice-dock />}
          <button className="dark-button" onClick={() => home(false)}>
            Stop watching
          </button>
        </div>
      )}
      {room && !g && !room.spectating && (
        <Lobby
          room={room}
          me={me}
          busy={busy || !!room.launch}
          connected={connected}
          onReady={(v) => void ready(v)}
          onAddBot={addBot}
          onKick={async (playerId) => {
            const c = connection.current;
            if (!c || disabled) throw new Error('Reconnect before removing a player');
            setBusy(true);
            try {
              await c.kick(playerId);
            } finally {
              if (connection.current === c) setBusy(c.awaitingConfirmation);
            }
          }}
          onPreviousResults={
            matchResults.results
              ? async () => {
                  if (room.players.find((p) => p.id === me)?.ready && !(await ready(false))) return;
                  matchResults.open();
                }
              : undefined
          }
          onStart={() => void act({ kind: 'start' })}
          onInvite={() => setPanel('friends')}
          onFriends={auth.config?.mode === 'authenticated' ? () => setPanel('friends') : undefined}
          onLeave={() => void leave()}
          onEdit={() => setPanel('editProfile')}
          onSettings={() => setPanel('settings')}
          onConfigure={() => setPanel('configure')}
          onChooseColor={(color) => void chooseColor(color)}
        />
      )}
      {g && (
        <>
          {phaseText && (
            <div className="action-prompt" role="status" key={`${g.turn}:${g.phase}:${mode}`}>
              {gameNotice && (
                <GameIcon
                  name={
                    mode === 'city'
                      ? 'city'
                      : mode === 'road'
                        ? 'road'
                        : mode === 'settlement'
                          ? 'settlement'
                          : gameNotice.icon
                  }
                  size={20}
                />
              )}
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
          {!room?.spectating && (
            <GameHandDock
              resources={
                <ResourceHand
                  hand={feedback.hand ?? hand}
                  pulse={feedback.pulse}
                  reducedMotion={reducedMotion}
                />
              }
              development={
                me &&
                !!player?.cards?.length && (
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
                )
              }
              purchase={
                <DevelopmentPurchase
                  disabled={disabled || !g.legal.canBuyCard}
                  onBuy={() => void act({ kind: 'buyCard' })}
                />
              }
              actions={
                <>
                  <div className="dice-dock" data-dice-dock />
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
                  </div>
                  <button
                    className={`turn-action ${actionPhase ? 'end-turn' : 'roll-turn'}`}
                    aria-label={actionPhase ? 'Next turn' : 'Roll dice'}
                    title={actionPhase ? 'Next turn' : 'Roll dice'}
                    disabled={disabled || !myTurn || !['roll', 'actions'].includes(g.phase)}
                    onClick={() => void act({ kind: actionPhase ? 'endTurn' : 'roll' })}
                  >
                    <TurnButtonAttention />
                    {actionPhase ? <NextTurn size={36} /> : <Dices size={38} />}
                    {actionPhase && <span>Next</span>}
                  </button>
                </>
              }
            />
          )}
          {me && !room?.spectating && (
            <IncomingTrade
              roomPlayers={room!.players}
              game={g}
              me={me}
              disabled={disabled}
              onAction={(a) => act(a, true)}
            />
          )}
          {panel === 'trade' && me && (
            <TradePanel
              roomPlayers={room!.players}
              game={g}
              me={me}
              disabled={disabled}
              onAction={(a) => act(a, true)}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'connection' && (
            <UtilityPanel tool="connection" title="Connection" onClose={() => setPanel(null)}>
              <ConnectionPanel
                metrics={metrics}
                status={status}
                revision={room?.revision ?? 0}
                pending={busy}
                onSync={() => connection.current?.sync()}
              />
            </UtilityPanel>
          )}
          {panel === 'statistics' && (
            <UtilityPanel tool="statistics" title="Dice statistics" onClose={() => setPanel(null)}>
              <GameStatistics game={g} statistics={statistics} />
            </UtilityPanel>
          )}
          {panel === 'journal' && (
            <UtilityPanel tool="journal" title="Move history" onClose={() => setPanel(null)}>
              <MoveHistory
                entries={historyEntries}
                game={g}
                hasMore={historyHasMore}
                onEarlier={() => connection.current?.history(historyEntries.at(-1)?.revision)}
              />
            </UtilityPanel>
          )}
          {placementReady && placement && (
            <PlacementConfirmation
              action={placement.action}
              disabled={disabled || !placementReady}
              onCancel={() => setPlacement(null)}
              onConfirm={() => {
                if (!placementValid(placement, g, room?.roomId, me)) return;
                const action = placement.action;
                setPlacement(null);
                void act(action);
              }}
            />
          )}
          {room && !room.spectating && !feedback.presentationBusy && (
            <RobberFlow
              room={room}
              me={me}
              selectedHex={robberHex}
              onSelectHex={setRobberHex}
              onAction={(a) => void act(a)}
              disabled={disabled}
              connected={connected}
              offset={metrics.clockOffsetMs}
              onWarning={() => feedback.sound.play('warning')}
            />
          )}
        </>
      )}
      {matchResults.visible && matchResults.results && room && (
        <GameOver
          results={matchResults.results}
          groupInLobby={!g}
          busy={busy || !connected || feedback.presentationBusy}
          canReturn={
            !room.spectating && !matchResults.results.game.players.find((p) => p.id === me)?.resigned
          }
          error={error}
          onReturn={() => {
            if (!g) matchResults.dismiss();
            else
              void act({ kind: 'returnToLobby' }).then((ok) => {
                if (ok) matchResults.dismiss();
              });
          }}
          onQuit={() => void leave()}
        />
      )}
      {g && (
        <GameEffects
          event={feedback.event}
          // The dock shows the dice of the board being shown, never those of a queued roll.
          lastDice={(presentedGame ?? g).dice}
          reducedMotion={reducedMotion}
          activity={!feedback.rolling}
          awards={feedback.awards}
          onAwardComplete={feedback.finishAward}
          onAwardStart={feedback.announceAward}
        />
      )}
      {room?.launch && (launchVisualExpired || !connected) && (
        <div className="reconnect-banner" role="status">
          Loading interrupted. Reconnect to check the room.
        </div>
      )}
      {((room?.launch && connected && !launchVisualExpired) || transitionId) && (
        <FantasyTransition
          id={room?.launch?.id ?? transitionId!}
          waiting={!!room?.launch}
          players={room?.players}
          readyPlayers={room?.launch?.readyPlayers}
          progress={assetProgress}
          reducedMotion={reducedMotion}
          onComplete={() => setTransitionId(null)}
        />
      )}
      {panel === 'settings' && (
        <Dialog side={!!g} tool="settings" title="Settings" compact onClose={() => setPanel(null)}>
          <PlayerSettings
            preferences={preferences}
            update={update}
            privacy={privacy.value}
            savePrivacy={privacy.save}
            previewSound={() => feedback.sound.play('settlement')}
          />
        </Dialog>
      )}
      {panel === 'configure' && (
        <Dialog title="Room setup" compact onClose={() => setPanel(null)}>
          <RoomConfiguration room={room} me={me} busy={disabled} save={saveSettings} />
        </Dialog>
      )}
      {panel === 'invite' && room && (
        <Dialog title="Room invitation" compact onClose={() => setPanel(null)}>
          <Invite code={room.roomCode ?? room.roomId} roomId={room.roomId} />
        </Dialog>
      )}
      {(panel === 'profile' || panel === 'editProfile') && (
        <Dialog
          title={panel === 'editProfile' ? 'Edit profile' : 'Your profile'}
          onClose={() => setPanel(null)}
        >
          {g ? (
            <>
              <div className="profile-preview">
                <Avatar profile={room?.players.find((p) => p.id === me)?.profile ?? auth.profile} />
                <strong>{player?.name}</strong>
              </div>
              <p className="muted">Change your avatar and username in the lobby before your next game.</p>
            </>
          ) : (
            <PlayerProfile
              key={`${auth.account?.id ?? 'local'}:${panel}`}
              initialEditing={panel === 'editProfile'}
              onEdit={() => setPanel('editProfile')}
              auth={auth}
              profile={room?.players.find((p) => p.id === me)?.profile ?? auth.profile}
              games={playerGames}
              busy={busy}
              resumeDisabled={!!room || networkBusy}
              onSave={saveProfile}
              onResume={resumeGame}
            />
          )}
        </Dialog>
      )}
      {panel === 'friends' && (
        <FriendsDrawer
          key={`friends:${auth.account?.id ?? 'local'}`}
          auth={auth}
          onClose={() => setPanel(null)}
          room={room && !g ? room : undefined}
          excludedRoomIds={excludedInviteRoomIds}
          invites={roomInvites}
          onOpenRoom={openInvitation}
          roomEntryBlocked={roomEntryBlocked}
          onWatch={
            roomEntryBlocked
              ? undefined
              : (reference) => {
                  setPanel(null);
                  void enterRoom('join', reference, true);
                }
          }
        />
      )}
      {panel === 'signOut' && (
        <Dialog title="Sign out?" compact onClose={() => !signingOut && setPanel(null)}>
          <p className="muted">You’ll return to the welcome screen.</p>
          <div className="dialog-actions">
            <button className="dark-button" disabled={signingOut} onClick={() => setPanel(null)}>
              Stay here
            </button>
            <button className="gold-button" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? <GameLoader compact /> : <DoorOpen />} Sign out
            </button>
          </div>
        </Dialog>
      )}
      {panel === 'leave' && (
        <Dialog title="Leave game?" compact onClose={() => setPanel(null)}>
          <p className="muted">Leaving resigns your seat. You cannot rejoin this game.</p>
          <div className="dialog-actions">
            <button className="dark-button" onClick={() => setPanel(null)}>
              Cancel
            </button>
            <button className="gold-button" disabled={busy || !connected} onClick={() => void leave()}>
              <DoorOpen />
              Leave
            </button>
          </div>
        </Dialog>
      )}
      {panel === 'rules' && (
        <Dialog side={!!g} tool="rules" title="How to play" onClose={() => setPanel(null)}>
          <QuickRules victoryPoints={g?.victoryPoints ?? room?.settings?.victoryPoints} />
        </Dialog>
      )}
    </main>
  );
}
const root = mountApp(document.getElementById('root')!);
if (resultsPreview) {
  void import('./dev/ResultsPreview.js').then(({ ResultsPreview }) => root.render(<ResultsPreview />));
} else if (designPreview) {
  void import('./dev/LoungePreview.js').then(({ LoungePreview }) => root.render(<LoungePreview />));
} else {
  root.render(<App />);
}
