import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection, newSession } from './connection.js';
import type { ConnectionStatus, PendingCommand } from './connection.js';
import type { RoomState, Session } from '../../../packages/protocol/src/index.js';
import { generateBoard } from '../../../packages/rules/src/board.js';
import { CARD_NAMES, canPay, emptyHand, robberVictims, total } from '../../../packages/rules/src/game.js';
import type { Card, GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { Board, PLAYER_COLORS } from './Board.js';
import type { BuildMode } from './Board.js';
import './style.css';

const SESSION_KEY = 'catanova.seat.v1';
const OUTBOX_KEY = 'catanova.outbox.v1';
const LAST_SEAT_KEY = 'catanova.last-seat.v1';
const resourceStyle = (r: Resource) =>
  ({
    '--resource-color': {
      wood: '#287845',
      brick: '#d5793d',
      sheep: '#94bb55',
      wheat: '#e7b730',
      ore: '#71899e',
    }[r],
  }) as CSSProperties;
function readJSON<T>(storage: Storage, key: string): T | undefined {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}
function NumberPop({ value }: { value: number }) {
  return (
    <span key={value} className="t-digit-group is-animating">
      {String(value)
        .split('')
        .map((n, i) => (
          <span key={i} className="t-digit" data-stagger={i ? '1' : undefined}>
            {n}
          </span>
        ))}
    </span>
  );
}
function ResourceSummary({ hand }: { hand: Hand }) {
  return (
    <span>
      {RESOURCES.filter((r) => hand[r])
        .map((r) => `${hand[r]} ${RESOURCE_NAMES[r]}`)
        .join(' + ') || 'Nothing selected'}
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
  onChange: (hand: Hand) => void;
  max?: Hand;
  label: string;
}) {
  return (
    <fieldset className="resource-picker">
      <legend>{label}</legend>
      {RESOURCES.map((r) => (
        <label key={r} style={resourceStyle(r)}>
          <span>
            <i />
            {RESOURCE_NAMES[r]}
          </span>
          <input
            aria-label={`${label} ${RESOURCE_NAMES[r]}`}
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
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Resource)}>
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
    <div
      className="dice-pair"
      aria-label={
        dice ? `Rolled ${dice[0]} and ${dice[1]}, total ${dice[0] + dice[1]}` : 'Waiting for a roll'
      }
    >
      {(dice ?? [0, 0]).map((n, index) => (
        <div key={`${turn}-${n}-${index}`} className={`die ${n ? 'rolled' : 'unrolled'}`}>
          {n ? (
            Array.from({ length: 9 }, (_, i) => (
              <i key={i} className={locations[n]!.includes(i) ? 'pip filled' : 'pip'} />
            ))
          ) : (
            <span>?</span>
          )}
        </div>
      ))}
    </div>
  );
}

function App() {
  const connection = useRef<Connection | null>(null);
  const rulesDialog = useRef<HTMLDialogElement | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null),
    [me, setMe] = useState<string>();
  const [status, setStatus] = useState<ConnectionStatus>('idle'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('catanova.name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [mode, setMode] = useState<BuildMode>(null),
    [panel, setPanel] = useState<'trade' | 'cards' | 'rules' | null>(null);
  const [robberHex, setRobberHex] = useState<number | null>(null),
    [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Hand>(emptyHand),
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
    myTurn = active?.id === me;
  const connected = status === 'connected';
  const disabled = !connected || busy;
  const hand = player?.hand ?? emptyHand();
  function connect(session: Session, pending?: PendingCommand) {
    connection.current?.stop();
    setError('');
    setRoom(null);
    setBusy(!!pending);
    const c = new Connection(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      session,
      {
        pending,
        onStatus: setStatus,
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
      if (message.type === 'welcome' || message.type === 'state') {
        setRoom(c.state);
        setMe(c.playerId ?? undefined);
      }
      if (message.type === 'error') {
        setError(message.message);
        if (message.commandId) setBusy(false);
      }
    });
    connection.current = c;
    c.start();
  }
  useEffect(() => {
    const saved = readJSON<Session>(sessionStorage, SESSION_KEY);
    if (saved && /^[a-f0-9]{64}$/.test(saved.token))
      connect(saved, readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY));
    return () => connection.current?.stop();
  }, []);
  useEffect(() => {
    setMode(null);
    setRobberHex(null);
    setSelected(emptyHand());
    setSelectedCard(null);
  }, [g?.phase, g?.turn]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 9000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (panel === 'rules') rulesDialog.current?.showModal();
  }, [panel]);
  async function act(action: GameAction) {
    if (!connection.current || disabled) return;
    setBusy(true);
    setError('');
    try {
      await connection.current.action(action);
      setMode(null);
      setRobberHex(null);
      setSelectedCard(null);
      if (action.kind === 'playCard') setSelected(emptyHand());
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\w+: /, '') : 'Action failed');
    } finally {
      setBusy(connection.current?.awaitingConfirmation ?? false);
    }
  }
  function enter(e: FormEvent, join: boolean) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Choose a name for your seat.');
      return;
    }
    const cleanCode = code.trim().toUpperCase();
    if (join && !/^[A-Z2-9]{8}$/.test(cleanCode)) {
      setError('Enter the eight-letter room code.');
      return;
    }
    sessionStorage.removeItem(OUTBOX_KEY);
    localStorage.setItem('catanova.name', name.trim());
    connect(newSession(name.trim(), join ? cleanCode : undefined));
  }
  function returnHome() {
    connection.current?.stop();
    connection.current = null;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(OUTBOX_KEY);
    setRoom(null);
    setMe(undefined);
    setStatus('idle');
    setBusy(false);
  }
  function chooseRobber(hex: number) {
    if (!g || !me) return;
    if (!robberVictims(g, me, hex).length) void act({ kind: 'robber', hex });
    else setRobberHex(hex);
  }
  async function copyInvite() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${room.roomId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError(`Share this room code: ${room.roomId}`);
    }
  }
  const actionPhase = myTurn && g?.phase === 'actions';
  const title = !g
    ? room
      ? 'Make room for your friends.'
      : 'A little island. A lot of possibility.'
    : g.winner
      ? `${g.players.find((p) => p.id === g.winner)?.name} wins!`
      : g.phase.startsWith('setup')
        ? myTurn
          ? g.phase === 'setupSettlement'
            ? g.setupIndex >= g.players.length
              ? 'A place to grow.'
              : 'Find your first foothold.'
            : 'The start of a great road.'
          : `${active?.name} is settling in.`
        : g.phase === 'discard'
          ? g.discards[me ?? '']
            ? 'A seven. Time to lighten up.'
            : 'Waiting for discards.'
          : myTurn
            ? g.phase === 'roll'
              ? 'Your island is calling.'
              : g.phase === 'robber'
                ? 'Make your move, robber.'
                : g.phase === 'freeRoads'
                  ? 'Two roads. On the house.'
                  : 'What will you build next?'
            : `${active?.name}'s turn.`;
  const instruction = !g
    ? 'Gather three or four players. Settle, trade, and build your way to ten points.'
    : g.winner
      ? 'A well-earned place in island history. Your finished game is saved.'
      : g.phase === 'setupSettlement'
        ? myTurn
          ? 'Choose a glowing corner. Leave at least one empty corner between settlements.'
          : 'Everyone places once, then the order reverses.'
        : g.phase === 'setupRoad'
          ? myTurn
            ? 'Choose a highlighted edge beside your new settlement.'
            : 'The new road must touch the settlement just placed.'
          : g.phase === 'roll'
            ? myTurn
              ? 'Roll two dice. Everyone collects from matching terrain.'
              : 'You can follow the board and check your hand while you wait.'
            : g.phase === 'discard'
              ? 'Players holding more than seven resource cards discard half, rounded down.'
              : g.phase === 'robber'
                ? myTurn
                  ? 'Choose a different tile, then one adjacent opponent to steal from.'
                  : `${active?.name} is moving the robber.`
                : g.phase === 'freeRoads'
                  ? 'Place each highlighted road. Your second road can extend the first.'
                  : myTurn
                    ? 'Build, trade, and play a card in any order. End your turn when you’re done.'
                    : 'Watch for trade offers. Your seat stays reserved if you disconnect.';
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            if (room) e.preventDefault();
          }}
          aria-label="Catanova home"
        >
          <span className="brand-mark">C</span>catanova<span className="alpha-tag">EARLY PLAYTEST</span>
        </a>
        <div className="header-tools">
          {room && (
            <button className="room-code" onClick={copyInvite} title="Copy invite link">
              {room.roomId}
              <span>{copied ? 'Copied!' : 'Invite friends ↗'}</span>
            </button>
          )}
          <button className="quiet" onClick={() => setPanel(panel === 'rules' ? null : 'rules')}>
            How to play
          </button>
          <a
            className="source-link"
            href="https://github.com/shashwtd/catanova"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      <main className={`game-layout ${g ? 'in-game' : 'in-lobby'}`}>
        <section className="table-area" aria-label="Game table">
          <div className="table-meta">
            <span>
              <i className="tiny-hex" /> BALANCED ISLAND{' '}
              <span className="muted">/ {g ? `SEED ${g.board.seed}` : 'PREVIEW'}</span>
            </span>
            <span>
              {g ? `TURN ${g.turn || '—'}` : '3–4 PLAYERS'} <span className="meta-dot">·</span> FIRST TO 10
            </span>
          </div>
          {room && (
            <div className="players">
              {Array.from({ length: g?.players.length ?? 4 }, (_, i) => {
                const p = g?.players[i] ?? room.players[i];
                const presence = room.players.find((x) => x.id === p?.id);
                const details = g?.players.find((x) => x.id === p?.id);
                return (
                  <div
                    key={p?.id ?? i}
                    className={`player-seat ${p && active?.id === p.id ? 'active-seat' : ''} ${!p ? 'empty-seat' : ''}`}
                    style={{ '--player-color': PLAYER_COLORS[i] } as CSSProperties}
                  >
                    <span className="avatar">{p?.name.slice(0, 1).toUpperCase() ?? '+'}</span>
                    <div className="seat-info">
                      <strong>
                        {p?.name ?? 'Open seat'}
                        {p?.id === me && <small>YOU</small>}
                      </strong>
                      <span>
                        {details
                          ? `${details.resourceCount} resources · ${details.cardCount} dev cards`
                          : p
                            ? presence?.connected
                              ? 'At the table'
                              : 'Reconnecting…'
                            : 'Invite a friend'}
                      </span>
                      {details && (
                        <span>
                          {details.roadLength} road length · {details.knights} knights
                        </span>
                      )}
                    </div>
                    {details && (
                      <span className="points">
                        <NumberPop value={details.points} />
                        <small>VP</small>
                      </span>
                    )}
                    {p && <i className={`presence ${presence?.connected ? 'online' : ''}`} />}
                  </div>
                );
              })}
            </div>
          )}
          <div className="board-wrap">
            <Board
              board={g?.board ?? preview}
              game={g}
              me={me}
              mode={mode}
              disabled={disabled}
              onAction={(a) => void act(a)}
              onRobber={chooseRobber}
            />
            {!room && (
              <div className="board-caption">
                <span>EVERY ISLAND, A NEW STORY</span>
                <p>Five resources. Endless friendly rivalries.</p>
              </div>
            )}
            {g && (
              <div className="board-corner">
                <span>
                  LONGEST ROAD{' '}
                  <b>
                    {g.longestRoad
                      ? g.players.find((p) => p.id === g.longestRoad)?.name
                      : 'Unclaimed · 5 roads'}
                  </b>
                </span>
                <span>
                  LARGEST ARMY{' '}
                  <b>
                    {g.largestArmy
                      ? g.players.find((p) => p.id === g.largestArmy)?.name
                      : 'Unclaimed · 3 knights'}
                  </b>
                </span>
              </div>
            )}
          </div>
          <div className="hand-area">
            <div className="hand-heading">
              <span>{g ? 'YOUR RESOURCES' : 'MEET YOUR RESOURCES'}</span>
              <span>
                {g
                  ? `${total(hand)} cards · Only you can see this hand`
                  : 'Familiar game. Fresh little world.'}
              </span>
            </div>
            <div className="resource-hand">
              {RESOURCES.map((r, i) => (
                <div key={r} className={`resource-card resource-${r}`} style={resourceStyle(r)}>
                  <div
                    className="resource-art"
                    style={{ backgroundPosition: `${(i % 3) * 50}% ${Math.floor(i / 3) * 100}%` }}
                  />
                  <div className="resource-card-footer">
                    <strong>{RESOURCE_NAMES[r]}</strong>
                    {g && <NumberPop value={hand[r]} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <aside className="side-area">
          <div className="connection-line">
            <i className={`status-dot ${connected ? 'online' : ''}`} />
            <span>
              {connected
                ? busy
                  ? 'Saving your move…'
                  : 'Connected · All moves saved'
                : status === 'reconnecting'
                  ? 'Reconnecting · Your seat is reserved'
                  : status === 'connecting'
                    ? 'Connecting to your table…'
                    : status === 'closed'
                      ? 'Connection closed'
                      : 'THE TABLE IS YOURS'}
            </span>
          </div>
          <div className="turn-intro">
            <span className="eyebrow">
              {g?.winner
                ? 'ISLAND CHAMPION'
                : g
                  ? myTurn
                    ? 'YOUR TURN'
                    : g.phase === 'discard' && g.discards[me ?? '']
                      ? 'YOUR ACTION NEEDED'
                      : 'AROUND THE TABLE'
                  : room
                    ? 'PRIVATE TABLE'
                    : 'WELCOME TO CATANOVA'}
            </span>
            <h1>{title}</h1>
            <p>{instruction}</p>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {!connected && room && (
            <div className="notice">
              Your game stays saved.{' '}
              {status === 'closed' ? (
                <button
                  className="text-button"
                  onClick={() => {
                    const s = readJSON<Session>(sessionStorage, SESSION_KEY);
                    if (s) connect(s, readJSON<PendingCommand>(sessionStorage, OUTBOX_KEY));
                  }}
                >
                  Reconnect to this seat
                </button>
              ) : (
                'Trying to reconnect…'
              )}
            </div>
          )}
          {!room && (
            <form className="join-form" onSubmit={(e) => enter(e, false)}>
              <label className="field">
                Your name
                <input
                  autoComplete="nickname"
                  value={name}
                  maxLength={32}
                  placeholder="What should we call you?"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={status === 'connecting' || status === 'reconnecting'}
                type="submit"
              >
                Create a table <span>→</span>
              </button>
              <div className="or-divider">
                <span>or take a seat</span>
              </div>
              <label className="field">
                Room code
                <input
                  className="code-input"
                  value={code}
                  maxLength={8}
                  placeholder="XXXXXXXX"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
              <button
                className="secondary"
                type="button"
                disabled={status === 'connecting' || status === 'reconnecting'}
                onClick={(e) => enter(e, true)}
              >
                Join friends
              </button>
              {readJSON<Session>(localStorage, LAST_SEAT_KEY)?.joined && (
                <button
                  className="text-button resume-button"
                  type="button"
                  onClick={() => connect(readJSON<Session>(localStorage, LAST_SEAT_KEY)!)}
                >
                  Resume your last seat ↗
                </button>
              )}
              <p className="small-note">
                No account needed. Send your friends a room link.
                <br />
                Each player needs their own browser tab or device.
              </p>
            </form>
          )}
          {room && !g && (
            <div className="lobby-controls">
              <div className="room-ticket">
                <span>YOUR ROOM CODE</span>
                <strong>{room.roomId}</strong>
                <button className="secondary" onClick={copyInvite}>
                  {copied ? 'Invite copied ✓' : 'Copy invite link ↗'}
                </button>
              </div>
              <div className="lobby-count">
                <b>{room.players.length}/4</b>
                <span>
                  players at the table
                  <br />
                  Start with three or four.
                </span>
              </div>
              {room.players[0]?.id === me ? (
                <button
                  className="primary"
                  disabled={disabled || room.players.length < 3}
                  onClick={() => act({ kind: 'start' })}
                >
                  Set sail <span>→</span>
                </button>
              ) : (
                <p className="small-note">The host will start when everyone is here.</p>
              )}
              <p className="small-note">
                Turn order is randomized. Setup goes forward, then back. The island is generated when you
                start.
              </p>
            </div>
          )}
          {g && (
            <>
              <div className="roll-area">
                <Dice dice={g.dice} turn={g.turn} />
                <div>
                  <strong>{g.dice ? g.dice[0] + g.dice[1] : '—'}</strong>
                  <span>
                    {g.phase.startsWith('setup')
                      ? 'Settle first'
                      : g.dice
                        ? g.dice[0] + g.dice[1] === 7
                          ? 'The robber stirs'
                          : 'Resources arrive'
                        : 'A fresh turn'}
                  </span>
                </div>
                {myTurn && g.phase === 'roll' && (
                  <button
                    className="primary roll-button"
                    disabled={disabled}
                    onClick={() => act({ kind: 'roll' })}
                  >
                    Roll dice
                  </button>
                )}
              </div>
              {g.phase === 'discard' && !!g.discards[me ?? ''] && (
                <div className="action-card">
                  <ResourcePicker value={selected} onChange={setSelected} max={hand} label="Discard" />
                  <button
                    className="primary"
                    disabled={disabled || total(selected) !== g.discards[me!]}
                    onClick={() => act({ kind: 'discard', resources: selected })}
                  >
                    Discard {total(selected)} / {g.discards[me!]} cards
                  </button>
                </div>
              )}
              {robberHex !== null && myTurn && g.phase === 'robber' && (
                <div className="action-card">
                  <h3>Steal from one neighbor</h3>
                  {robberVictims(g, me!, robberHex).map((id) => (
                    <button
                      key={id}
                      className="secondary"
                      disabled={disabled}
                      onClick={() => act({ kind: 'robber', hex: robberHex, victim: id })}
                    >
                      {g.players.find((p) => p.id === id)?.name}
                      <span>→</span>
                    </button>
                  ))}
                  <button className="text-button" onClick={() => setRobberHex(null)}>
                    Choose another tile
                  </button>
                </div>
              )}
              {myTurn && ['setupSettlement', 'setupRoad', 'freeRoads'].includes(g.phase) && (
                <div className="placement-prompt">
                  <span className="placement-icon">＋</span>
                  <span>
                    Click a highlighted {g.phase === 'setupSettlement' ? 'corner' : 'edge'} on the island.
                    {g.phase === 'freeRoads' && (
                      <b>
                        {' '}
                        {g.freeRoads} road{g.freeRoads === 1 ? '' : 's'} remaining
                      </b>
                    )}
                  </span>
                </div>
              )}
              <div className="build-tools">
                <div className="section-label">BUILD SOMETHING</div>
                {(['road', 'settlement', 'city'] as const).map((kind, i) => (
                  <button
                    key={kind}
                    className={`build-button ${mode === kind ? 'selected' : ''}`}
                    disabled={
                      disabled ||
                      !actionPhase ||
                      !(
                        kind === 'road'
                          ? g.legal.roads
                          : kind === 'settlement'
                            ? g.legal.settlements
                            : g.legal.cities
                      ).length
                    }
                    onClick={() => {
                      setMode(mode === kind ? null : kind);
                      setPanel(null);
                    }}
                  >
                    <span className="build-icon">{['╱', '⌂', '♜'][i]}</span>
                    <span>
                      <strong>{kind[0]!.toUpperCase() + kind.slice(1)}</strong>
                      <small>
                        {RESOURCES.filter((r) => COSTS[kind][r])
                          .map((r) => `${COSTS[kind][r]} ${RESOURCE_NAMES[r]}`)
                          .join(' · ')}
                      </small>
                    </span>
                    <span className="piece-stock">
                      {
                        [
                          15 - player!.pieces.roads,
                          5 - player!.pieces.settlements,
                          4 - player!.pieces.cities,
                        ][i]
                      }
                    </span>
                  </button>
                ))}
              </div>
              {mode && (
                <button className="text-button" onClick={() => setMode(null)}>
                  Cancel placement
                </button>
              )}
              <div className="utility-buttons">
                <button
                  className={`secondary ${panel === 'trade' ? 'selected' : ''}`}
                  disabled={g.phase !== 'actions'}
                  onClick={() => {
                    setPanel(panel === 'trade' ? null : 'trade');
                    setMode(null);
                  }}
                >
                  ⇄ Trade
                </button>
                <button
                  className={`secondary ${panel === 'cards' ? 'selected' : ''}`}
                  onClick={() => {
                    setPanel(panel === 'cards' ? null : 'cards');
                    setMode(null);
                  }}
                >
                  ▱ Cards <span>{player?.cards?.length ?? 0}</span>
                </button>
              </div>
              {g.trade && !myTurn && (
                <div className="trade-offer">
                  <span className="eyebrow">{active?.name} OFFERS</span>
                  <strong>
                    <ResourceSummary hand={g.trade.give} />
                  </strong>
                  <p>
                    for <ResourceSummary hand={g.trade.want} />
                  </p>
                  <button
                    className="primary"
                    disabled={disabled || !canPay(hand, g.trade.want)}
                    onClick={() => act({ kind: 'acceptTrade', tradeId: g.trade!.id })}
                  >
                    Accept trade
                  </button>
                </div>
              )}
              <div className="panel-container">
                <div
                  className="t-panel-slide"
                  data-open={panel === 'trade' || panel === 'cards'}
                  inert={panel !== 'trade' && panel !== 'cards'}
                >
                  {panel === 'trade' && (
                    <div className="action-card">
                      <div className="panel-title">
                        <h3>Make a little exchange</h3>
                        <button aria-label="Close trading" onClick={() => setPanel(null)}>
                          ×
                        </button>
                      </div>
                      {actionPhase ? (
                        <>
                          <div className="section-label">BANK & HARBORS</div>
                          <div className="trade-selects">
                            <ResourceSelect
                              label={`Give ${g.legal.rates[bankGive]}`}
                              value={bankGive}
                              onChange={setBankGive}
                            />
                            <span>→</span>
                            <ResourceSelect label="Get 1" value={bankReceive} onChange={setBankReceive} />
                          </div>
                          <button
                            className="secondary"
                            disabled={
                              disabled ||
                              bankGive === bankReceive ||
                              hand[bankGive] < g.legal.rates[bankGive] ||
                              !g.bank[bankReceive]
                            }
                            onClick={() => act({ kind: 'bankTrade', give: bankGive, receive: bankReceive })}
                          >
                            Exchange at {g.legal.rates[bankGive]}:1
                          </button>
                          <hr />
                          <div className="section-label">OFFER TO THE TABLE</div>
                          <ResourcePicker value={give} onChange={setGive} max={hand} label="You give" />
                          <ResourcePicker value={want} onChange={setWant} label="You receive" />
                          <button
                            className="primary"
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
                            <>
                              <p className="small-note">
                                Your offer is open. Any opponent with the cards can accept it. Taking another
                                action withdraws it.
                              </p>
                              <button className="text-button" onClick={() => act({ kind: 'cancelTrade' })}>
                                Withdraw offer
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <p>The active player can make an offer. You can accept it when it appears here.</p>
                      )}
                    </div>
                  )}
                  {panel === 'cards' && (
                    <div className="action-card">
                      <div className="panel-title">
                        <h3>A card up your sleeve</h3>
                        <button aria-label="Close cards" onClick={() => setPanel(null)}>
                          ×
                        </button>
                      </div>
                      <button
                        className="secondary"
                        disabled={disabled || !g.legal.canBuyCard}
                        onClick={() => act({ kind: 'buyCard' })}
                      >
                        Buy development card <span>{g.deckCount} left</span>
                      </button>
                      <p className="small-note">
                        1 Sheep · 1 Hay · 1 Rock
                        <br />
                        Play one per turn, starting on a later turn. Victory points count automatically.
                      </p>
                      <div className="development-hand">
                        {player?.cards?.length ? (
                          player.cards.map((card) => (
                            <button
                              key={card.id}
                              className={`development-card ${selectedCard?.id === card.id ? 'selected' : ''}`}
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
                                  ? '+1 point · counted'
                                  : card.boughtTurn === g.turn
                                    ? 'Ready next turn'
                                    : 'Play card →'}
                              </small>
                            </button>
                          ))
                        ) : (
                          <p className="small-note">Your development cards will appear here.</p>
                        )}
                      </div>
                      {selectedCard?.kind === 'monopoly' && (
                        <>
                          <ResourceSelect
                            label="Collect from every opponent"
                            value={cardResource}
                            onChange={setCardResource}
                          />
                          <button
                            className="primary"
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
                          <ResourcePicker
                            label="Take from bank"
                            value={selected}
                            onChange={setSelected}
                            max={g.bank}
                          />
                          <button
                            className="primary"
                            disabled={
                              disabled ||
                              total(selected) !== Math.min(2, total(g.bank)) ||
                              total(selected) === 0
                            }
                            onClick={() =>
                              act({ kind: 'playCard', cardId: selectedCard.id, resources: selected })
                            }
                          >
                            Take {total(selected)} cards
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {actionPhase && (
                <button className="end-turn" disabled={disabled} onClick={() => act({ kind: 'endTurn' })}>
                  End turn <span>→</span>
                </button>
              )}
              <details className="event-log" open>
                <summary>
                  Island journal <span>↗</span>
                </summary>
                <ol>
                  {g.log
                    .slice(-7)
                    .reverse()
                    .map((event) => (
                      <li key={event.id}>{event.text}</li>
                    ))}
                </ol>
              </details>
            </>
          )}
          {room && (
            <button className="text-button leave-table" onClick={returnHome}>
              Back to home · keep my seat
            </button>
          )}
          <div className="sidebar-footer">
            <span>MADE FOR FRIENDS, BUILT IN THE OPEN.</span>
            <p>An independent, unofficial Catan-style game.</p>
          </div>
        </aside>
      </main>
      {panel === 'rules' && (
        <dialog
          ref={rulesDialog}
          className="rules-dialog"
          aria-labelledby="rules-title"
          onCancel={() => setPanel(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPanel(null);
          }}
        >
          <section className="rules-sheet">
            <button className="close-sheet" autoFocus aria-label="Close rules" onClick={() => setPanel(null)}>
              ×
            </button>
            <span className="eyebrow">A QUICK REFRESHER</span>
            <h2 id="rules-title">
              Small island.
              <br />
              Big plans.
            </h2>
            <ol>
              <li>
                <strong>Settle in.</strong> Three or four players place a settlement and road each, then
                repeat in reverse order. Your second settlement gives your first resources.
              </li>
              <li>
                <strong>Roll & collect.</strong> Both dice decide which tiles produce. Each adjacent
                settlement collects one card; a city collects two.
              </li>
              <li>
                <strong>Trade & build.</strong> Trade with the bank, use ports for better rates, or make a
                public offer to your friends. Build roads, settlements and cities.
              </li>
              <li>
                <strong>Watch the robber.</strong> On seven, hands over seven cards discard half. Move the
                robber to a new tile and steal one random resource from a neighbor.
              </li>
              <li>
                <strong>Race to ten.</strong> Settlements give one point, cities two. Longest Road and Largest
                Army give two each. Hidden victory cards count too. You win on your own turn.
              </li>
            </ol>
            <div className="notice">
              Balanced islands: no adjacent 6/8 tiles, no large resource clusters, and no overpowered
              production corners. Dice stay random.
            </div>
            <a
              className="primary full-rules-link"
              href="https://github.com/shashwtd/catanova/blob/main/docs/RULEBOOK.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the full rulebook ↗
            </a>
          </section>
        </dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
