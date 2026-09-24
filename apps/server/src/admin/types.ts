/**
 * Response shapes of the admin API, shared with the admin interface in
 * apps/admin. Type-only: nothing here runs in the browser bundle.
 */
import type { HistoryEntry, RoomState } from '../../../../packages/protocol/src/index.js';
import type { PlayerColor } from '../../../../packages/protocol/src/colors.js';
import type { RoomSettings, TurnClock } from '../../../../packages/protocol/src/settings.js';
import type { Metric, Window } from '../../../../scripts/reporting/retention.js';
import type { AuditEntry } from './audit.js';
import type { ServerErrorEntry } from './errors.js';
import type { LoopWindow, MetricSample } from './metrics.js';
import type { FeedbackItem } from '../feedback.js';

export type { AuditEntry, LoopWindow, Metric, MetricSample, ServerErrorEntry };

export type MetricsRange = '1h' | '6h' | '24h';

/** The in-memory performance history (see metrics.ts), for one range. */
export type MetricsHistory = {
  now: number;
  /** When this process started keeping samples: a restart clears the history. */
  since: number;
  range: MetricsRange;
  /** How long each point covers: a minute, or several merged for the longer ranges. */
  bucketSeconds: number;
  samples: MetricSample[];
  /** The latest 30-second window and memory, which the next sample will include. */
  current: { window: LoopWindow; windowSeconds: number; rssBytes: number; heapUsedBytes: number };
};

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

/** The System tab: the process, load, sockets, rooms, database, disk, host reports and every recent error. */
export type AdminSystem = {
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

/** Games and players since the start of the viewer's day and week (see countActivity). */
export type ActivitySummary = {
  countedAt: number;
  day: number;
  week: number;
  started: { day: number; week: number };
  /** Ended with a winner. */
  finished: { day: number; week: number };
  /** Ended with none. */
  abandoned: { day: number; week: number };
  /** Distinct accounts that started a game. */
  players: { day: number; week: number };
  /** Accounts whose first recorded game started in the window. */
  newPlayers: { day: number; week: number };
};

/** A game being played, as Overview lists it: points are what the table sees. */
export type LiveGame = {
  roomId: string;
  roomCode: string | null;
  status: RoomStatus;
  turn: number;
  phase: string;
  target: number;
  startedAt: number | null;
  lastActivity: number | null;
  players: (SeatSummary & { points: number })[];
  /** This turn's roll once it is made, as everyone at the table saw it; null before it. */
  dice: [number, number] | null;
};

/** The dashboard: who is here, what is being played, how the server is doing, and what needs a look. */
export type AdminOverview = {
  now: number;
  revision: string | null;
  uptimeSeconds: number;
  online: OnlineNow;
  /** Counted off the game's thread, at most a few seconds before `now`; an error if that failed. */
  rooms: { live: number; paused: number; lobbies: number; countedAt: number } | { error: string };
  activity: ActivitySummary | { error: string };
  liveGames: LiveGame[];
  performance: {
    window: LoopWindow;
    windowSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    sockets: number;
  };
  status: AdminSystem['status'];
  /** The newest few; System lists them all. */
  errors: { recent: ServerErrorEntry[]; total: number };
  rejections: number;
};

export type RoomStatus = 'lobby' | 'live' | 'paused' | 'finished' | 'empty';

/**
 * Where someone online is: at a table (`atTable` when their seat's socket is
 * connected; otherwise they hold a seat in an unfinished game but are
 * elsewhere, such as the hub), in a lobby, or only in the player hub.
 */
export type OnlinePlace =
  | { kind: 'hub' }
  | { kind: 'lobby'; roomId: string; roomCode: string | null }
  | {
      kind: 'game';
      roomId: string;
      roomCode: string | null;
      status: RoomStatus;
      turn: number | null;
      atTable: boolean;
    };

/** One person online: an account the presence hub reports, or a seat connected without one. */
export type OnlinePerson = {
  userId: string | null;
  /** The seat whose socket is open, if they are connected to a room. */
  seatId: string | null;
  name: string;
  /** `permanent` (Google), `guest`, or null for a local seat with no account. */
  accountType: string | null;
  /** Online since, and in how many tabs: known for accounts the presence hub reports. */
  since: number | null;
  tabs: number | null;
  place: OnlinePlace;
};

export type OnlineNow = {
  /** Whether the game server reports account presence; without it only people connected to rooms appear. */
  accounts: boolean;
  people: OnlinePerson[];
  counts: {
    online: number;
    /** At the table of a game that has started and not finished. */
    playing: number;
    inLobbies: number;
    elsewhere: number;
    spectators: number;
  };
};

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

/** How a finished game ended, as the table was told: by points, because everyone else resigned, or with no winner. */
export type GameResult = {
  winner: string | null;
  winnerId: string | null;
  reason: 'points' | 'resignation' | 'abandoned';
};

export type GameListItem = {
  roomId: string;
  roomCode: string | null;
  status: RoomStatus;
  phase: string | null;
  turn: number | null;
  revision: number;
  /** When this round's game started. */
  createdAt: number | null;
  lastActivity: number | null;
  /** `points` are what the table sees: victory point cards count once a winner reveals them. */
  players: (SeatSummary & { points: number | null })[];
  result: GameResult | null;
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
  /**
   * `paused` is exactly `status === 'paused'`: nobody is at the table. While the
   * table is live, an absent seat is played by a bot from `standInAt`, and
   * `resignAt` does not apply; it is when a paused table gives the seat up.
   */
  presence: {
    paused: boolean;
    pausedAt: number | null;
    absent: { playerId: string; disconnectedAt: number; standInAt: number; resignAt: number }[];
  };
  clock: TurnClock | null;
  history: { entries: HistoryEntry[]; hasMore: boolean };
  rounds: {
    archiveId: string;
    startedAt: number | null;
    finishedAt: number | null;
    turns: number;
    winner: string | null;
  }[];
  /** The room's settings as the server resolves them; a started game's own dice mode is in its snapshot. */
  settings: RoomSettings;
  /** Set when the saved game cannot be read, which is itself worth knowing. */
  integrityError: string | null;
  canEnd: boolean;
  /** What to type to confirm ending the game: its room code, or its id once the code has lapsed. */
  confirmation: string;
};

export type PrivateGameState = { roomId: string; revision: number; game: unknown };

export type PlayerSort = 'lastSeen' | 'games' | 'wins' | 'joined' | 'name';

/** One account in the Players list. */
export type PlayerSummary = {
  userId: string;
  /** The name it last played under; null for an account that only ever opened the player hub. */
  name: string | null;
  accountType: string | null;
  lastSeen: number | null;
  /** When its first recorded game started. */
  firstPlayed: number | null;
  games: number;
  wins: number;
  /** Wins over games with a winner it finished in (won, lost or resigned); null before any. */
  winRate: number | null;
  /** Points those games ended with, every card revealed; null before any. */
  averagePoints: number | null;
  online: boolean;
  currentRoom: { roomId: string; roomCode?: string } | null;
};

export type PlayersPage = {
  items: PlayerSummary[];
  total: number;
  page: number;
  pageSize: number;
  sort: PlayerSort;
  dir: 'asc' | 'desc';
  q: string;
  /** The list is from the room index's worker at this time; online and current games are read fresh. */
  indexedAt: number;
  /** Whether the presence hub is reported, so "online" covers accounts outside rooms too. */
  presence: boolean;
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
  /** Every name it played under, newest first; empty for an account seen only in the player hub. */
  names: string[];
  accountType: string | null;
  lastSeen: number | null;
  sharesLastSeen: boolean;
  /** Where it is, if online now. */
  online: OnlinePerson | null;
  /** Whether the presence hub is reported; without it, only an account at a room can be seen online. */
  presence: boolean;
  currentRoom: { roomId: string; roomCode?: string } | null;
  record: {
    matches: number;
    won: number;
    lost: number;
    resigned: number;
    abandoned: number;
    playing: number;
    winRate: number | null;
    averagePoints: number | null;
    firstPlayed: number | null;
  };
  matches: PlayerMatch[];
  seats: { roomId: string; roomCode: string | null; name: string; departed: boolean }[];
  feedback: { id: number; at: number; category: string; status: string }[];
};

/**
 * Rolls of each total from 2 to 12 against what their dice should give.
 * `model` says what `expected` is: two independent fair dice (Natural), a deck
 * of all 36 pairs (Balanced, which follows the same curve by design, so no
 * χ² test applies), equally likely totals (the retired Flat rule), or a
 * mixture of modes (no single test applies). χ² is null where it means nothing.
 */
export type DiceSummary = {
  rolls: number;
  counts: number[];
  expected: number[];
  model: 'two-dice' | 'deck' | 'flat' | 'mixed';
  chiSquare: number | null;
  pValue: number | null;
  /**
   * Which two dice made each roll, as the table saw them: 36 counts of
   * ordered pairs, the first die's value times six plus the second's (each
   * from 1, so index (first − 1) × 6 + (second − 1)). `unpaired` rolls had a
   * total but no readable pair and are left out of `pairs`.
   */
  pairs?: number[];
  unpaired?: number;
  /**
   * Each pair's expected count where the dice mode gives it exactly: 1 in
   * 36 for two fair dice, or each total's share split among its pairs for
   * the retired flat totals. Null for Balanced dice, whose deck only comes
   * close to 1 in 36, and for a mixture of modes.
   */
  pairExpected?: number[] | null;
};

/** Resource counts by type: Timber (wood), Clay (brick), Sheep, Hay (wheat), Rock (ore). */
export type ResourceCounts = { wood: number; brick: number; sheep: number; wheat: number; ore: number };

/**
 * Why a finished game ended: a player reached the target (`points`), everyone
 * else resigned (`resignation`), or it ended with no winner because the admin
 * closed it, every person left, only bots were left, or the table stayed
 * empty until the seats were given up.
 */
export type GameEndReason =
  'points' | 'resignation' | 'closedByAdmin' | 'everyoneLeft' | 'botsOnly' | 'disconnected' | 'abandoned';

/** One seat in a game's analytics. Everything here is what the table could see. */
export type AnalyticsPlayer = {
  id: string;
  name: string;
  bot: boolean;
  botLevel: string | null;
  userId: string | null;
  accountType: string | null;
  /** The points the table saw at the end: victory point cards only once a winner revealed them. */
  points: number;
  rank: number;
  winner: boolean;
  resigned: { turn: number; how: string } | null;
  pieces: { settlements: number; cities: number; roads: number };
  knights: number;
  longestRoad: boolean;
  largestArmy: boolean;
  /** Moves made from the seat: by the person, by a bot (the seat's own, or one standing in), by the turn timer. */
  moves: { own: number; bot: number; timer: number };
  /** Times a bot took the seat over while its player was away. */
  standIns: number;
  /** Seconds from the start of each of its turns to the next, leaving out turns a stand-in played. */
  turnTime: { turns: number; meanSeconds: number | null; medianSeconds: number | null; botTurns: number };
  resources: {
    /** From dice rolls, by type. */
    produced: ResourceCounts;
    /** `fromCards`: taken with Year of Plenty or Monopoly. */
    gained: {
      production: number;
      setup: number;
      trades: number;
      bank: number;
      fromCards: number;
      stolen: number;
    };
    spent: {
      roads: number;
      settlements: number;
      cities: number;
      devCards: number;
      trades: number;
      bank: number;
      discarded: number;
    };
    lost: { robbed: number; monopoly: number };
  };
  devCards: { bought: number; played: Record<string, number> };
  robber: { moves: number; steals: number; robbed: number; sevens: number };
  trades: { withPlayers: number; offers: number; bank: number };
};

/** How one game went, computed from its journal in the analysis worker. Public information only. */
export type GameAnalytics = {
  roomId: string;
  roomCode: string | null;
  /** The archived round, or null for the room's current game. */
  archiveId: string | null;
  fromRevision: number;
  toRevision: number;
  /** The journal starts part way through: the game was imported from before the journal existed. */
  legacy: boolean;
  /** Rows whose saved game could not be read, and were skipped. */
  unreadable: number;
  status: 'setup' | 'playing' | 'finished';
  diceMode: string;
  victoryPoints: number;
  startedAt: number | null;
  endedAt: number | null;
  lastMoveAt: number | null;
  turns: number;
  moves: number;
  end: { reason: GameEndReason; winnerId: string | null; text: string } | null;
  /** In turn order; points per turn line up with them. */
  players: AnalyticsPlayer[];
  /** Each player's points at the end of each turn, turn 0 being setup. */
  points: { turns: number[]; byPlayer: number[][] };
  dice: DiceSummary & { sevens: number };
  awards: {
    turn: number;
    award: 'longestRoad' | 'largestArmy';
    playerId: string | null;
    fromId: string | null;
  }[];
  robberMoves: {
    turn: number;
    playerId: string;
    terrain: string;
    number: number | null;
    victimId: string | null;
    stole: boolean;
    cause: 'seven' | 'knight';
  }[];
  /** Exchanges between players, as the game announced them. */
  trades: { turn: number; text: string }[];
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

/** The Growth tab's ranges: the last 30 days, 90 days, year, or everything since the first game. */
export type GrowthRange = '30d' | '90d' | '1y' | 'all';

/**
 * One granularity of the growth report, as parallel arrays with one entry per
 * UTC day, week (from Monday) or month. Games are placed by when they started
 * (`started`, seats, bots) or ended (`finished`, `abandoned`, lengths);
 * accounts by when they played (`active`, `trailing`) or first played
 * (`newPlayers`, `accounts`). Only accounts count as players: local seats and
 * bots do not.
 */
export type GrowthSeries = {
  /** Each bucket's first day: 2026-09-16, a Monday, or the 1st of a month. */
  start: string[];
  started: number[];
  /** Games that ended in the bucket with a winner. */
  finished: number[];
  /** Games that ended in the bucket with none. */
  abandoned: number[];
  /** Distinct accounts that started a game in the bucket. */
  active: number[];
  /** Distinct accounts that started a game in the 7 days (days) or 28 days (weeks, months) to the bucket's end. */
  trailing: number[];
  /** Accounts whose first game started in the bucket. */
  newPlayers: number[];
  /** Accounts that had played a game by the bucket's end. */
  accounts: number[];
  /** Seats in the games started in the bucket, how many of them bots filled, and games with a bot. */
  seats: number[];
  botSeats: number[];
  withBots: number[];
  /** Games won in the bucket with a known start: how many, and their median and middle half, in minutes. */
  lengths: { games: number[]; median: (number | null)[]; low: (number | null)[]; high: (number | null)[] };
};

/** Totals over one stretch of time, [from, to). */
export type GrowthPeriod = {
  from: number;
  to: number;
  started: number;
  finished: number;
  abandoned: number;
  /** Distinct accounts that started a game in the period. */
  active: number;
  /** Accounts whose first game started in the period. */
  newPlayers: number;
  /** Accounts that had played before the period began, and by its end. */
  accountsBefore: number;
  accountsAfter: number;
  seats: number;
  botSeats: number;
  withBots: number;
  /** Games won in the period, and their median length in minutes. */
  lengthGames: number;
  medianMinutes: number | null;
  /** New players of the period's weekly cohorts whose following week is over, and how many played in it. */
  nextWeek: { players: number; returned: number };
};

/**
 * How play has grown (growth.ts): series by day (the last 90), week and month
 * since the first game; each range's totals against the period before it
 * (null where that period reaches back before the first game); and the
 * latest weekly cohorts of new players.
 */
export type GrowthReport = {
  generatedAt: number;
  /** When the first recorded game started; null before any. */
  firstGameAt: number | null;
  days: GrowthSeries;
  weeks: GrowthSeries;
  months: GrowthSeries;
  periods: Record<GrowthRange, { current: GrowthPeriod; previous: GrowthPeriod | null }>;
  /**
   * New players by the week (from Monday) of their first game, newest last:
   * `active[k]` is how many played in the k-th week after it, so `active[0]`
   * is the whole cohort. The current week is still under way.
   */
  cohorts: { week: string; active: number[] }[];
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
