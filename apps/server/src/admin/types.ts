/**
 * Response shapes of the admin API, shared with the admin interface in
 * apps/admin. Type-only: nothing here runs in the browser bundle.
 */
import type { HistoryEntry, RoomState } from '../../../../packages/protocol/src/index.js';
import type { PlayerColor } from '../../../../packages/protocol/src/colors.js';
import type { TurnClock } from '../../../../packages/protocol/src/settings.js';
import type { Metric, Window } from '../../../../scripts/reporting/retention.js';
import type { AuditEntry } from './audit.js';
import type { ServerErrorEntry } from './errors.js';
import type { LoopWindow } from './metrics.js';
import type { FeedbackItem } from '../feedback.js';

export type { AuditEntry, LoopWindow, Metric, ServerErrorEntry };

export type AdminSession = {
  actor: string;
  mode: 'cloudflare-access' | 'local-dev';
  revision: string | null;
};

export type AuthRejection = { at: number; status: number; reason: string; ip: string | null; path: string };

export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null };

/** A cached answer from the analysis worker. */
export type Cached<T> = { value: T; cachedAt: number; fresh: boolean };

export type StatusFile =
  | { state: 'missing' }
  | { state: 'invalid'; error: string; modifiedAt: number | null }
  | { state: 'ok'; modifiedAt: number; data: Record<string, unknown> };

export type AdminOverview = {
  now: number;
  revision: string | null;
  process: {
    uptimeSeconds: number;
    node: string;
    pid: number;
    memory: { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };
  };
  load: { window: LoopWindow; windowSeconds: number; loadAverage: number[]; cores: number };
  sockets: { total: number; players: number; spectators: number; pending: number };
  /** Counted off the game's thread, at most a few seconds before `now`; an error if that failed. */
  rooms:
    | {
        lobbies: number;
        live: number;
        paused: number;
        finished: number;
        empty: number;
        total: number;
        countedAt: number;
      }
    | { error: string };
  players: { connectedSeats: number; distinctPlayers: number };
  /** `seatsInLiveGames` comes with the room counts and is null without them. */
  bots: { seatsInLiveGames: number | null; standIns: number };
  database: {
    path: string;
    fileBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    pageCount: number;
    pageSize: number;
    freelistPages: number;
    /** Counted with the rooms; null without them. */
    journalRows: number | null;
  };
  disk: { path: string; freeBytes: number; totalBytes: number } | { path: string; error: string };
  /** The host's reports (deploy/single-vm/OPERATIONS.md#reading-status): backup, watchdog, restore drill. */
  status: { directory: string; backup: StatusFile; watchdog: StatusFile; drill: StatusFile };
  errors: ServerErrorEntry[];
  rejections: AuthRejection[];
};

export type RoomStatus = 'lobby' | 'live' | 'paused' | 'finished' | 'empty';

export type SeatSummary = {
  id: string;
  name: string;
  bot: boolean;
  botLevel: string | null;
  connected: boolean;
  standIn: boolean;
  resigned: boolean;
  departed: boolean;
  userId: string | null;
  accountType: string | null;
};

export type GameListItem = {
  roomId: string;
  roomCode: string | null;
  status: RoomStatus;
  phase: string | null;
  turn: number | null;
  revision: number;
  createdAt: number | null;
  lastActivity: number | null;
  players: SeatSummary[];
  error?: string;
};

export type GamesPage = {
  items: GameListItem[];
  /** Matches, order and counts are from the room index's pass at `indexedAt`; items are read fresh. */
  total: number;
  page: number;
  pageSize: number;
  counts: Record<RoomStatus, number>;
  indexedAt: number;
};

export type GameDetail = {
  roomId: string;
  roomCode: string | null;
  status: RoomStatus;
  revision: number;
  round: number;
  createdAt: number | null;
  lastActivity: number | null;
  /** What a spectator is sent: the public board, players and filtered game. */
  snapshot: RoomState | null;
  /**
   * `color` is the colour the table sees, resolved the way the game resolves it
   * (a seat that never picked one still has one); `colorChosen` says whether
   * the player picked it. Seats no longer at the table have none.
   */
  seats: (SeatSummary & { color: PlayerColor | null; colorChosen: boolean; ready: boolean })[];
  standIns: { playerId: string; since: number; level: string; styled: boolean }[];
  presence: { paused: boolean; absent: { playerId: string; disconnectedAt: number; resignAt: number }[] };
  clock: TurnClock | null;
  statistics: { rolls: number; diceCounts: number[] } | null;
  history: { entries: HistoryEntry[]; hasMore: boolean };
  rounds: {
    archiveId: string;
    startedAt: number | null;
    finishedAt: number | null;
    turns: number;
    winner: string | null;
  }[];
  settings: Record<string, unknown> | null;
  /** Set when the saved game cannot be read, which is itself worth knowing. */
  integrityError: string | null;
  canEnd: boolean;
  /** What to type to confirm ending the game: its room code, or its id once the code has lapsed. */
  confirmation: string;
};

export type PrivateGameState = { roomId: string; revision: number; game: unknown };

export type PlayerSummary = {
  userId: string;
  name: string;
  accountType: string | null;
  lastSeen: number | null;
  matches: number;
  wins: number;
  currentRoom: { roomId: string; roomCode?: string } | null;
};

export type PlayerMatch = {
  matchId: string;
  roomId: string;
  roomCode: string | null;
  archived: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  turns: number;
  outcome: string;
  points: number;
  players: { name: string; points: number; winner: boolean }[];
};

export type PlayerDetail = {
  userId: string;
  names: string[];
  accountType: string | null;
  lastSeen: number | null;
  sharesLastSeen: boolean;
  currentRoom: { roomId: string; roomCode?: string } | null;
  record: {
    matches: number;
    won: number;
    lost: number;
    resigned: number;
    abandoned: number;
    playing: number;
  };
  matches: PlayerMatch[];
  seats: { roomId: string; roomCode: string | null; name: string; departed: boolean }[];
  feedback: { id: number; at: number; category: string; status: string }[];
};

export type DiceSummary = {
  rolls: number;
  counts: number[];
  expected: number[];
  chiSquare: number | null;
  pValue: number | null;
};

export type AdminStats = {
  generatedAt: number;
  days: { day: string; started: number; finished: number; abandoned: number; players: number }[];
  weeks: { week: string; players: number }[];
  completed: { count: number; medianMinutes: number | null; medianTurns: number | null };
  bots: { matches: number; matchesWithBots: number; seats: number; botSeats: number };
  dice: { overall: DiceSummary; byMode: Record<string, DiceSummary> };
  totals: {
    matches: number;
    finished: number;
    abandoned: number;
    running: number;
    accounts: number;
    unindexedGames: number;
  };
};

export type { FeedbackItem } from '../feedback.js';

export type FeedbackPage = {
  items: FeedbackItem[];
  nextBefore: number | null;
  counts: { new: number; resolved: number };
};

export type RetentionReport = {
  generatedAt: number;
  days: number;
  window: Window;
  metrics: Metric[];
  csv: string;
};
