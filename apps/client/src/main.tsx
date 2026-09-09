import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  Castle,
  Check,
  CircleHelp,
  Copy,
  Crown,
  DoorOpen,
  Dices,
  House,
  Layers,
  LoaderCircle,
  Maximize,
  Plus,
  Route,
  ScrollText,
  Swords,
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
import { generateBoard } from '../../../packages/rules/src/board.js';
import { CARD_NAMES, canPay, emptyHand, robberVictims, total } from '../../../packages/rules/src/game.js';
import type { Card, GameAction, Hand } from '../../../packages/rules/src/game.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { Board, PLAYER_COLORS, ResourceIcon } from './Board.js';
import type { BuildMode } from './Board.js';
import { invitationCode, roomPath, shouldResume, validRoomCode } from './navigation.js';
import './style.css';

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
function NumberPop({ value }: { value: number }) {
  return (
    <span key={value} className="t-digit-group is-animating">
      <span className="t-digit">{value}</span>
    </span>
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
function Dice({ dice, turn }: { dice: [number, number] | null; turn: number }) {
  const locations: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <div className="dice-pair" aria-label={dice ? `Rolled ${dice[0]} and ${dice[1]}` : 'Dice'}>
      {(dice ?? [0, 0]).map((n, i) => (
        <div key={`${turn}-${n}-${i}`} className={`die ${n ? 'rolled' : 'unrolled'}`}>
          {n ? (
            Array.from({ length: 9 }, (_, j) => (
              <i key={j} className={locations[n]!.includes(j) ? 'pip filled' : 'pip'} />
            ))
          ) : (
            <Dices />
          )}
        </div>
      ))}
    </div>
  );
}

function App() {
  const connection = useRef<Connection | null>(null);
  const initialInvite = useRef(invitationCode(location.pathname, location.search));
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
    [panel, setPanel] = useState<'trade' | 'cards' | 'rules' | 'journal' | 'leave' | null>(null);
  const [robberHex, setRobberHex] = useState<number | null>(null),
    [selected, setSelected] = useState<Hand>(emptyHand),
    [give, setGive] = useState<Hand>(emptyHand),
    [want, setWant] = useState<Hand>(emptyHand);
  const [bankGive, setBankGive] = useState<Resource>('wood'),
    [bankReceive, setBankReceive] = useState<Resource>('brick');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null),
    [cardResource, setCardResource] = useState<Resource>('wood');
  const preview = useMemo(() => generateBoard(2026), []);
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
    setRoom(null);
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
    setRoom(null);
    setBusy(!!pending);
    const c = new Connection(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      session,
      {
        pending,
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
    c.subscribe((message) => {
      if (connection.current !== c) return;
      if (message.type === 'welcome' || message.type === 'state') {
        setRoom(c.state);
        setMe(c.playerId ?? undefined);
        if (message.type === 'welcome') history.replaceState(null, '', roomPath(message.state.roomId));
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
        if (message.commandId) setBusy(false);
        if (['SEAT_LEFT', 'INVALID_SESSION', 'ROOM_NOT_FOUND'].includes(message.code)) {
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
    const saved = readJSON<Session>(sessionStorage, SESSION_KEY);
    if (shouldResume(saved, initialInvite.current))
      connect(saved!, readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY));
    return () => connection.current?.stop();
  }, []);
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
    fetch(`/api/rooms/${invite}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Room not found' : 'Room unavailable');
        return response.json() as Promise<RoomPreview>;
      })
      .then(setPreviewRoom)
      .catch((e) => {
        if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : 'Room unavailable');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [invite, room?.roomId]);
  useEffect(() => {
    setMode(null);
    setRobberHex(null);
    setSelected(emptyHand());
    setSelectedCard(null);
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
      setSelectedCard(null);
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
  function enter(e: FormEvent, kind: 'create' | 'join') {
    e.preventDefault();
    setError('');
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
    connect(newSession(name.trim(), kind === 'join' ? target : undefined));
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
  const roster = g?.players ?? room?.players ?? previewRoom?.players;
  const visibleBoard = g?.board ?? room?.board ?? previewRoom?.board ?? preview;
  const last = readJSON<Session>(localStorage, LAST_SEAT_KEY);
  const resumableInvite = entry === 'invite' && last?.roomId === invite && last.joined;
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
    <main className={`game-world ${g ? 'playing' : room ? 'lobby' : 'entry-world'}`}>
      <div className="board-anchor">
        <Board
          board={visibleBoard}
          game={g}
          me={me}
          mode={mode}
          disabled={disabled}
          onAction={(a) => void act(a)}
          onRobber={chooseRobber}
        />
      </div>
      <nav className="side-controls" aria-label="Game controls">
        {room && (
          <>
            <IconButton label="Copy invite link" onClick={() => void copyInvite()}>
              <Copy />
            </IconButton>
            <IconButton
              label="Leave room"
              onClick={() => (g && !g.winner ? setPanel('leave') : void leave())}
              disabled={busy}
              className="leave-control"
            >
              <DoorOpen />
            </IconButton>
          </>
        )}
        <IconButton
          label="Rules"
          active={panel === 'rules'}
          onClick={() => setPanel(panel === 'rules' ? null : 'rules')}
        >
          <CircleHelp />
        </IconButton>
        {g && (
          <IconButton
            label="Game log"
            active={panel === 'journal'}
            onClick={() => setPanel(panel === 'journal' ? null : 'journal')}
          >
            <ScrollText />
          </IconButton>
        )}
        <IconButton label="Fullscreen" onClick={() => void fullscreen()}>
          <Maximize />
        </IconButton>
        {room && (
          <span
            className={`network-indicator ${connected ? 'connected' : ''}`}
            title={busy ? 'Saving' : connected ? 'Connected' : status}
            aria-label={busy ? 'Saving' : status}
          >
            {networkBusy || busy ? <LoaderCircle className="spin" /> : connected ? <Wifi /> : <WifiOff />}
          </span>
        )}
      </nav>
      {!!roster && (
        <div className="table-hud">
          <div className="room-indicator">
            <span>{room?.roomId ?? invite}</span>
            <Users size={13} />
            <span>{roster.length}/4</span>
          </div>
          <div className={`player-roster count-${g ? roster.length : 4}`}>
            {Array.from({ length: g ? roster.length : 4 }, (_, i) => {
              const p = roster[i],
                details = g?.players.find((x) => x.id === p?.id),
                presence = room?.players.find((x) => x.id === p?.id);
              return p ? (
                <div
                  key={p.id}
                  className={`player-hud ${active?.id === p.id ? 'active' : ''} ${p.id === me ? 'self' : ''}`}
                  style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
                >
                  <div className="portrait">
                    {p.name.slice(0, 1).toUpperCase()}
                    {room?.players[0]?.id === p.id && !g && <Crown className="host-crown" size={12} />}
                    <i className={`presence ${presence?.connected ? 'online' : ''}`} />
                  </div>
                  <div className="player-data">
                    <strong title={p.name}>{p.name}</strong>
                    {details && (
                      <span className="player-stats">
                        <span title="Resource cards">
                          <Layers />
                          {details.resourceCount}
                        </span>
                        <span title="Development cards">
                          <ScrollText />
                          {details.cardCount}
                        </span>
                        <span title="Played knights">
                          <Swords />
                          {details.knights}
                        </span>
                      </span>
                    )}
                  </div>
                  {details && (
                    <span className="score" title="Victory points">
                      <Trophy />
                      <NumberPop value={details.points} />
                    </span>
                  )}
                </div>
              ) : (
                <button
                  key={i}
                  className="empty-seat"
                  title="Copy invite link"
                  aria-label="Invite player"
                  disabled={!room}
                  onClick={() => void copyInvite()}
                >
                  <Plus />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss error" onClick={() => setError('')}>
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
                <h1>Catanova</h1>
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
                    Resume game <ArrowRight size={15} />
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
                {entry === 'invite' && <div className="invite-room-code">{invite}</div>}
                {previewError && entry === 'invite' ? (
                  <p className="entry-error">{previewError}</p>
                ) : (
                  <form onSubmit={(e) => enter(e, entry === 'create' ? 'create' : 'join')}>
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
                      Your name
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
                        disabled={networkBusy}
                        onClick={() => connect(last!)}
                      >
                        Resume room <ArrowRight />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="gold-button"
                        disabled={networkBusy || (entry === 'invite' && (previewLoading || !previewRoom))}
                      >
                        {networkBusy || previewLoading ? (
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
        <div className="lobby-start">
          {room.players[0]?.id === me ? (
            <button
              className="gold-button"
              disabled={disabled || room.players.length < 3}
              onClick={() => act({ kind: 'start' })}
            >
              <Dices />
              Start game
            </button>
          ) : (
            <span className="waiting-label">Waiting for host</span>
          )}
          {room.players.length < 3 && <span className="minimum-players">3 players minimum</span>}
        </div>
      )}
      {g && (
        <>
          <div className="phase-prompt" role="status">
            {g.winner ? <Trophy /> : myTurn ? <span className="turn-dot" /> : null}
            {phaseText}
            {mode && (
              <IconButton label="Cancel placement" onClick={() => setMode(null)}>
                <X />
              </IconButton>
            )}
          </div>
          <div className="awards-hud">
            <span
              title={`Longest Road: ${g.longestRoad ? g.players.find((p) => p.id === g.longestRoad)?.name : 'unclaimed, 5 required'}`}
              className={g.longestRoad === me ? 'owned' : ''}
            >
              <Route />
              <b>{player?.roadLength ?? 0}</b>
            </span>
            <span
              title={`Largest Army: ${g.largestArmy ? g.players.find((p) => p.id === g.largestArmy)?.name : 'unclaimed, 3 required'}`}
              className={g.largestArmy === me ? 'owned' : ''}
            >
              <Swords />
              <b>{player?.knights ?? 0}</b>
            </span>
          </div>
          <div className="bottom-hud">
            <div className="resource-hand" aria-label="Your resources">
              {RESOURCES.map((r) => (
                <div
                  key={r}
                  className={`resource-card resource-${r}`}
                  title={`${RESOURCE_NAMES[r]}: ${hand[r]}`}
                >
                  <ResourceIcon resource={r} />
                  <NumberPop value={hand[r]} />
                </div>
              ))}
            </div>
            <div className="action-hud">
              <div className="build-actions">
                {(['road', 'settlement', 'city'] as const).map((kind, i) => {
                  const sites =
                    kind === 'road' ? g.legal.roads : kind === 'city' ? g.legal.cities : g.legal.settlements;
                  const Icon = [Route, House, Castle][i]!;
                  return (
                    <IconButton
                      key={kind}
                      label={`${kind[0]!.toUpperCase() + kind.slice(1)} · ${RESOURCES.filter(
                        (r) => COSTS[kind][r],
                      )
                        .map((r) => `${COSTS[kind][r]} ${RESOURCE_NAMES[r]}`)
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
                  label="Trade"
                  active={panel === 'trade'}
                  disabled={g.phase !== 'actions'}
                  onClick={() => {
                    setPanel(panel === 'trade' ? null : 'trade');
                    setMode(null);
                  }}
                >
                  <ArrowLeftRight />
                </IconButton>
                <IconButton
                  label="Development cards"
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
              <div className="turn-actions">
                <Dice dice={g.dice} turn={g.turn} />
                {myTurn && g.phase === 'roll' ? (
                  <button className="gold-button" disabled={disabled} onClick={() => act({ kind: 'roll' })}>
                    Roll <Dices />
                  </button>
                ) : actionPhase ? (
                  <button
                    className="gold-button"
                    disabled={disabled}
                    onClick={() => act({ kind: 'endTurn' })}
                  >
                    End turn <ArrowRight />
                  </button>
                ) : (
                  <span className="turn-wait">
                    {g.phase.startsWith('setup')
                      ? 'Setup'
                      : g.winner
                        ? 'Finished'
                        : myTurn
                          ? 'Choose on board'
                          : active?.name}
                  </span>
                )}
              </div>
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
          {(panel === 'trade' || panel === 'cards' || panel === 'journal') && (
            <aside className="game-panel floating-panel" aria-label={panel}>
              <div className="panel-heading">
                <h2>{panel === 'trade' ? 'Trade' : panel === 'cards' ? 'Development' : 'Game log'}</h2>
                <IconButton label="Close panel" onClick={() => setPanel(null)}>
                  <X />
                </IconButton>
              </div>
              {panel === 'journal' && (
                <ol className="event-log">
                  {g.log
                    .slice(-30)
                    .reverse()
                    .map((e) => (
                      <li key={e.id}>{e.text}</li>
                    ))}
                </ol>
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
              {panel === 'cards' && (
                <>
                  <button
                    className="dark-button"
                    disabled={disabled || !g.legal.canBuyCard}
                    onClick={() => act({ kind: 'buyCard' })}
                  >
                    Buy card <ResourceSummary hand={COSTS.developmentCard} />
                  </button>
                  <div className="development-hand">
                    {player?.cards?.length ? (
                      player.cards.map((card) => (
                        <button
                          key={card.id}
                          className={`development-card ${selectedCard?.id === card.id ? 'is-selected' : ''}`}
                          disabled={disabled || !g.legal.playableCards.includes(card.id)}
                          onClick={() => {
                            if (card.kind === 'knight' || card.kind === 'roadBuilding')
                              void act({ kind: 'playCard', cardId: card.id });
                            else {
                              setSelectedCard(card);
                              setSelected(emptyHand());
                            }
                          }}
                        >
                          <span>{CARD_NAMES[card.kind]}</span>
                          <small>
                            {card.kind === 'victoryPoint'
                              ? '+1 VP'
                              : card.boughtTurn === g.turn
                                ? 'Next turn'
                                : 'Play'}
                          </small>
                        </button>
                      ))
                    ) : (
                      <p className="muted">No development cards</p>
                    )}
                  </div>
                  {selectedCard?.kind === 'monopoly' && (
                    <>
                      <ResourceSelect label="Collect" value={cardResource} onChange={setCardResource} />
                      <button
                        className="gold-button"
                        disabled={disabled}
                        onClick={() =>
                          act({ kind: 'playCard', cardId: selectedCard.id, resource: cardResource })
                        }
                      >
                        Play Monopoly
                      </button>
                    </>
                  )}
                  {selectedCard?.kind === 'yearOfPlenty' && (
                    <>
                      <ResourcePicker label="Take 2" value={selected} onChange={setSelected} max={g.bank} />
                      <button
                        className="gold-button"
                        disabled={
                          disabled || total(selected) !== Math.min(2, total(g.bank)) || !total(selected)
                        }
                        onClick={() =>
                          act({ kind: 'playCard', cardId: selectedCard.id, resources: selected })
                        }
                      >
                        Take cards
                      </button>
                    </>
                  )}
                </>
              )}
            </aside>
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
