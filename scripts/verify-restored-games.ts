/**
 * Verify every saved game in a restored backup with this release's own Store and rules.
 *
 *   node dist/scripts/verify-restored-games.js RESTORED.sqlite [--report FILE.json] [--work-dir DIR]
 *   npm run verify:restored -- RESTORED.sqlite
 *
 * The restore drill (deploy/single-vm/backup/restore_drill.py) runs this inside the deployed
 * game image. The Store's constructor migrates the schema, so it only ever opens a private
 * copy: the source must be a closed standalone snapshot (rollback-journal mode, no WAL or SHM
 * sidecar), which is what backup.py uploads and what a live game database never is.
 *
 * For every room: Store.loadGame (the saved game against its journal head's hash),
 * Store.verifyJournal (every journal row, hash and link), the public history back to the
 * start of the round, the room revision against the journal head, rules invariants, and one
 * safe mandatory move applied to a clone to prove the game can continue. It reads the journal
 * only through Store methods, never game_events.state, whose encoding is the Store's business.
 *
 * Exit status: 0 every room verified, 1 a room failed, 2 the database could not be verified.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../apps/server/src/store.js';
import { applyAction, pieces, roadSites, settlementSites, total } from '../packages/rules/src/game.js';
import type { CardKind, Game, GameAction, Phase } from '../packages/rules/src/game.js';
import { DEVELOPMENT_DECK, RESOURCES, SUPPLY } from '../packages/rules/src/index.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';

export const REPORT_SCHEMA = 1;
const PHASES: Phase[] = [
  'setupSettlement',
  'setupRoad',
  'roll',
  'actions',
  'discard',
  'robber',
  'freeRoads',
  'finished',
];
const CARD_KINDS = Object.keys(DEVELOPMENT_DECK) as CardKind[];
const DECK_SIZE = CARD_KINDS.reduce((sum, kind) => sum + DEVELOPMENT_DECK[kind], 0);
const MISSING_JOURNAL_CHECK =
  "this release's Store has no verifyJournal, so the journal hash chain cannot be checked";

export type JournalCheck = { events: number; problems: string[] };
type JournalStore = Store & { verifyJournal?: (roomId: string) => JournalCheck };
export type RoomReport = {
  roomId: string;
  status: 'verified' | 'failed' | 'no-game';
  phase?: Phase;
  turn?: number;
  players?: number;
  revision?: number;
  journalEvents?: number;
  historyEntries?: number;
  continuedWith?: string | null;
  problems: string[];
};
export type VerificationReport = {
  schema: number;
  result: 'pass' | 'fail';
  rooms: number;
  games: number;
  verified: number;
  failed: number;
  withoutGame: number;
  phases: Record<string, number>;
  journalChain: 'verified' | 'unavailable';
  failures: { roomId: string; problems: string[] }[];
  details: RoomReport[];
};
export type VerifyOptions = {
  /** Default true: a Store without verifyJournal fails every room. */
  requireJournalCheck?: boolean;
  workDirectory?: string;
};

/** Input the verifier refuses to touch, as opposed to a restored database that fails. */
export class UnusableInput extends Error {}

const message = (error: unknown) =>
  error instanceof Error
    ? `${(error as { code?: unknown }).code ? `${String((error as { code?: unknown }).code)} ` : ''}${error.message}`
    : String(error);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Rules invariants every saved game satisfies, as short sentences. Only facts derivable from
 * the rules engine are asserted, so a legitimately played game never produces one.
 */
export function gameInvariantProblems(game: Game): string[] {
  const problems: string[] = [];
  try {
    const players = Array.isArray(game.players) ? game.players : [];
    const ids = new Set(players.map((p) => p.id));
    if (players.length < 2 || players.length > 4)
      problems.push(`${players.length} players; a game seats 2 to 4`);
    if (ids.size !== players.length) problems.push('two players share one seat id');

    // Every resource card is either in the bank or in a hand: 19 of each type.
    for (const resource of RESOURCES) {
      const bank = game.bank?.[resource];
      const hands = players.map((p) => p.hand?.[resource]);
      if (!isCount(bank) || !hands.every(isCount)) {
        problems.push(`${resource}: the bank or a hand holds an invalid count`);
        continue;
      }
      const held = sum(hands);
      if (bank + held !== SUPPLY.resourcesPerType)
        problems.push(
          `${resource}: bank ${bank} + hands ${held} = ${bank + held}, expected ${SUPPLY.resourcesPerType}`,
        );
    }

    // Development cards: each purchase pops the deck and numbers the card, so deck + bought is
    // exactly 25. Played knights are counted; other played cards leave no trace, and a resigning
    // player's cards are discarded, so held + played can only be bounded above.
    const deck = Array.isArray(game.deck) ? game.deck : [];
    const held = players.flatMap((p) => (Array.isArray(p.cards) ? p.cards : []));
    const knights = players.map((p) => p.knights);
    if (!Array.isArray(game.deck) || !deck.every((kind) => CARD_KINDS.includes(kind)))
      problems.push('the development deck holds an unknown card');
    if (!knights.every(isCount)) problems.push('a knight count is invalid');
    const played = sum(knights.filter(isCount));
    if (!isCount(game.nextCard)) problems.push('the purchase counter is invalid');
    else {
      if (deck.length + game.nextCard !== DECK_SIZE)
        problems.push(
          `development cards: ${deck.length} in the deck + ${game.nextCard} bought = ${deck.length + game.nextCard}, expected ${DECK_SIZE}`,
        );
      if (held.length + played > game.nextCard)
        problems.push(
          `development cards: ${held.length} held + ${played} knights played exceed the ${game.nextCard} bought`,
        );
    }
    if (deck.length + held.length + played > DECK_SIZE)
      problems.push(
        `development cards: ${deck.length} in the deck + ${held.length} held + ${played} played exceed ${DECK_SIZE}`,
      );
    for (const kind of CARD_KINDS) {
      const count =
        deck.filter((card) => card === kind).length +
        held.filter((card) => card.kind === kind).length +
        (kind === 'knight' ? played : 0);
      if (count > DEVELOPMENT_DECK[kind])
        problems.push(`${kind} cards: ${count} accounted for, but only ${DEVELOPMENT_DECK[kind]} exist`);
    }
    const cardIds = new Set<string>();
    for (const card of held) {
      const number = /^card-(\d+)$/.exec(String(card.id))?.[1];
      if (cardIds.has(card.id)) problems.push(`development card ${card.id} is held twice`);
      cardIds.add(card.id);
      if (number === undefined || !isCount(game.nextCard) || Number(number) >= game.nextCard)
        problems.push(`development card ${String(card.id)} was never bought`);
      if (!isCount(card.boughtTurn) || card.boughtTurn > game.turn)
        problems.push(`development card ${String(card.id)} has an invalid purchase turn`);
    }
    for (const player of players)
      if (player.resigned && (total(player.hand) > 0 || player.cards.length > 0))
        problems.push('a resigned player still holds cards');

    // Pieces: owners are seated players, locations exist, supply limits hold, distance rule holds.
    const vertices = game.board.vertices;
    const edges = game.board.edges;
    for (const [key, building] of Object.entries(game.buildings)) {
      const vertex = Number(key);
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertices.length)
        problems.push(`a building stands on missing corner ${key}`);
      if (!ids.has(building.player)) problems.push(`the building at corner ${key} belongs to no player`);
      if (building.kind !== 'settlement' && building.kind !== 'city')
        problems.push(`the building at corner ${key} is neither a settlement nor a city`);
      for (const neighbor of vertices[vertex]?.neighbors ?? [])
        if (neighbor > vertex && game.buildings[neighbor])
          problems.push(`buildings at corners ${vertex} and ${neighbor} break the distance rule`);
    }
    for (const [key, owner] of Object.entries(game.roads)) {
      const edge = Number(key);
      if (!Number.isInteger(edge) || edge < 0 || edge >= edges.length)
        problems.push(`a road lies on missing edge ${key}`);
      if (!ids.has(owner)) problems.push(`the road on edge ${key} belongs to no player`);
    }
    for (const player of players) {
      const owned = pieces(game, player.id);
      if (owned.roads > SUPPLY.roads)
        problems.push(`a player has ${owned.roads} roads; the supply is ${SUPPLY.roads}`);
      if (owned.settlements > SUPPLY.settlements)
        problems.push(`a player has ${owned.settlements} settlements; the supply is ${SUPPLY.settlements}`);
      if (owned.cities > SUPPLY.cities)
        problems.push(`a player has ${owned.cities} cities; the supply is ${SUPPLY.cities}`);
    }
    if (!Number.isInteger(game.robber) || game.robber < 0 || game.robber >= game.board.hexes.length)
      problems.push(`the robber stands on missing tile ${String(game.robber)}`);

    // Phase and the player to move.
    const active = players[game.active];
    if (!PHASES.includes(game.phase)) problems.push(`unknown phase ${String(game.phase)}`);
    if (!Number.isInteger(game.active) || !active)
      problems.push(`the active seat ${String(game.active)} is not one of the ${players.length} players`);
    const owed = Object.entries(game.discards ?? {});
    if (game.phase === 'finished') {
      if (game.winner !== null && !players.some((p) => p.id === game.winner && !p.resigned))
        problems.push('the recorded winner is not a remaining player');
      if (game.winner === null && game.finishReason !== 'abandoned')
        problems.push('a finished game without a winner must have been abandoned');
    } else {
      if (game.winner !== null) problems.push('a game in progress already has a winner');
      // During discards the active seat may have resigned; others still discard first.
      if (game.phase !== 'discard' && active?.resigned)
        problems.push(`the active player has resigned during ${game.phase}`);
      const setup = game.phase === 'setupSettlement' || game.phase === 'setupRoad';
      if (setup && game.turn !== 0) problems.push(`setup is still running on turn ${game.turn}`);
      if (
        game.phase === 'setupRoad' &&
        (game.setupVertex === null || game.buildings[game.setupVertex]?.player !== active?.id)
      )
        problems.push("setup road is due without the active player's new settlement");
      if (game.phase === 'discard') {
        if (!owed.length) problems.push('the discard phase has nobody left to discard');
        for (const [id, count] of owed) {
          const player = players.find((p) => p.id === id);
          if (!player || player.resigned) problems.push('a discard is owed by a seat that is not playing');
          else if (!Number.isInteger(count) || count < 1 || count > total(player.hand))
            problems.push(`a discard of ${count} is owed from a hand of ${total(player.hand)}`);
        }
      } else if (owed.length) problems.push(`discards are pending during ${game.phase}`);
      if (game.phase === 'freeRoads' && !(Number.isInteger(game.freeRoads) && game.freeRoads >= 1))
        problems.push('the free-road phase has no free road left');
      if (game.trade && (game.phase !== 'actions' || game.trade.player !== active?.id))
        problems.push("an open trade is not the active player's, during their actions");
    }
  } catch (error) {
    problems.push(`the saved game is malformed: ${message(error)}`);
  }
  return problems;
}

/** A deterministic [0, 1) source per room, so a drill repeats exactly. */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Prove the game can continue: apply the move the turn timer itself would force (or, during
 * setup, the first legal placement) to a clone, and check the result. Nothing is saved.
 */
export function continueGame(game: Game, seed: string): { move: string | null; problems: string[] } {
  if (game.phase === 'finished') return { move: null, problems: [] };
  const random = seededRandom(seed);
  const actor =
    game.phase === 'discard' ? Object.keys(game.discards).sort()[0] : game.players[game.active]?.id;
  if (!actor) return { move: null, problems: ['no player is due to move'] };
  let action: GameAction | undefined;
  try {
    if (game.phase === 'setupSettlement') {
      const vertex = settlementSites(game, actor, true)[0];
      action = vertex === undefined ? undefined : { kind: 'settlement', vertex };
    } else if (game.phase === 'setupRoad') {
      const edge = roadSites(game, actor, game.setupVertex)[0];
      action = edge === undefined ? undefined : { kind: 'road', edge };
    } else action = timeoutAction(game, actor, random);
  } catch (error) {
    return { move: null, problems: [`the mandatory move could not be chosen: ${message(error)}`] };
  }
  if (!action) return { move: null, problems: [`no legal mandatory move exists during ${game.phase}`] };
  let next: Game;
  try {
    next = applyAction(structuredClone(game), actor, action, random);
  } catch (error) {
    return { move: action.kind, problems: [`the mandatory ${action.kind} was rejected: ${message(error)}`] };
  }
  return {
    move: action.kind,
    problems: gameInvariantProblems(next).map((problem) => `after ${action.kind}: ${problem}`),
  };
}

function historyProblems(store: Store, roomId: string, head: number) {
  const problems: string[] = [];
  const entries: { revision: number; kind: string }[] = [];
  let before = Number.MAX_SAFE_INTEGER;
  for (let page = 0; page < 100_000; page++) {
    const result = store.history(roomId, before);
    for (const entry of result.entries) entries.push({ revision: entry.revision, kind: entry.kind });
    if (!result.hasMore || !result.entries.length) break;
    before = result.entries[result.entries.length - 1]!.revision;
  }
  if (!entries.length) return { entries: 0, problems: ['the game has no public history'] };
  if (entries[0]!.revision !== head)
    problems.push(
      `the newest history entry is revision ${entries[0]!.revision}, not the journal head ${head}`,
    );
  for (let i = 1; i < entries.length; i++)
    if (entries[i]!.revision !== entries[i - 1]!.revision - 1) {
      problems.push(
        `the history skips from revision ${entries[i - 1]!.revision} to ${entries[i]!.revision}; journal entries are missing`,
      );
      break;
    }
  const first = entries[entries.length - 1]!;
  if (first.kind !== 'start' && first.kind !== 'legacy')
    problems.push(`the round's history begins with ${first.kind}, not the start of the game`);
  return { entries: entries.length, problems };
}

export function verifyRoom(store: Store, roomId: string, options: VerifyOptions = {}): RoomReport {
  const problems: string[] = [];
  const report: RoomReport = { roomId, status: 'failed', problems };
  let game: Game | undefined;
  try {
    game = store.loadGame(roomId);
  } catch (error) {
    problems.push(`loadGame: ${message(error)}`);
  }
  const verifyJournal = (store as JournalStore).verifyJournal;
  if (typeof verifyJournal === 'function') {
    try {
      const journal = verifyJournal.call(store, roomId);
      report.journalEvents = journal.events;
      for (const problem of journal.problems) problems.push(`journal: ${problem}`);
    } catch (error) {
      problems.push(`verifyJournal: ${message(error)}`);
    }
  } else if (options.requireJournalCheck !== false && game) problems.push(MISSING_JOURNAL_CHECK);
  if (game) {
    report.phase = game.phase;
    report.turn = game.turn;
    report.players = game.players.length;
    try {
      const room = store.snapshot(roomId);
      report.revision = room.revision;
      if (room.historyRevision !== room.revision)
        problems.push(
          `the room is at revision ${room.revision} but its newest journal entry is ${room.historyRevision}`,
        );
      const history = historyProblems(store, roomId, room.historyRevision);
      report.historyEntries = history.entries;
      problems.push(...history.problems);
    } catch (error) {
      problems.push(`history: ${message(error)}`);
    }
    problems.push(...gameInvariantProblems(game));
    const continued = continueGame(game, roomId);
    report.continuedWith = continued.move;
    problems.push(...continued.problems);
  }
  report.status = problems.length ? 'failed' : game ? 'verified' : 'no-game';
  return report;
}

export function verifyStore(store: Store, options: VerifyOptions = {}): VerificationReport {
  const rooms = (store.db.prepare('SELECT id FROM rooms ORDER BY id').all() as { id: string }[]).map(
    (row) => row.id,
  );
  const details = rooms.map((roomId) => verifyRoom(store, roomId, options));
  const games = details.filter((room) => room.phase !== undefined);
  const failures = details.filter((room) => room.status === 'failed');
  const phases: Record<string, number> = {};
  for (const room of games) phases[room.phase!] = (phases[room.phase!] ?? 0) + 1;
  return {
    schema: REPORT_SCHEMA,
    result: failures.length ? 'fail' : 'pass',
    rooms: rooms.length,
    games: games.length,
    verified: details.filter((room) => room.status === 'verified').length,
    failed: failures.length,
    withoutGame: details.filter((room) => room.phase === undefined).length,
    phases,
    journalChain: typeof (store as JournalStore).verifyJournal === 'function' ? 'verified' : 'unavailable',
    failures: failures.map((room) => ({ roomId: room.roomId, problems: room.problems })),
    details,
  };
}

/** Refuse anything that could be a live database; the Store migrates whatever it opens. */
export function assertStandaloneSnapshot(path: string) {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new UnusableInput(`${path} is not a file`);
    size = stat.size;
  } catch (error) {
    if (error instanceof UnusableInput) throw error;
    throw new UnusableInput(`${path} cannot be read`);
  }
  for (const suffix of ['-wal', '-shm', '-journal'])
    if (existsSync(path + suffix))
      throw new UnusableInput(
        `${path}${suffix} exists: verify a closed standalone snapshot, never a live database`,
      );
  const header = Buffer.alloc(100);
  const descriptor = openSync(path, 'r');
  try {
    readSync(descriptor, header, 0, 100, 0);
  } finally {
    closeSync(descriptor);
  }
  if (size < 100 || header.toString('latin1', 0, 16) !== 'SQLite format 3\0')
    throw new UnusableInput(`${path} is not a SQLite database`);
  // Bytes 18 and 19 are 2 in WAL mode, which the live game database always uses.
  if (header[18] !== 1 || header[19] !== 1)
    throw new UnusableInput(
      `${path} is in WAL mode like a live game database; use a snapshot from backup.py or the restore drill`,
    );
  return size;
}

export function verifyRestoredDatabase(source: string, options: VerifyOptions = {}) {
  const path = resolve(source);
  const bytes = assertStandaloneSnapshot(path);
  const work = mkdtempSync(join(options.workDirectory ?? tmpdir(), '.verify-restored-'));
  let store: Store | undefined;
  try {
    chmodSync(work, 0o700);
    const copy = join(work, 'copy.sqlite');
    copyFileSync(path, copy, constants.COPYFILE_EXCL);
    chmodSync(copy, 0o600);
    assertStandaloneSnapshot(path); // unchanged while it was copied
    try {
      // No presence tracking: on start-up it would write lifecycle events into the copy.
      store = new Store(copy);
    } catch (error) {
      throw new UnusableInput(`this release's Store could not open the restored copy: ${message(error)}`);
    }
    return { bytes, report: verifyStore(store, options) };
  } finally {
    store?.close();
    rmSync(work, { recursive: true, force: true });
  }
}

export function formatReport(source: string, bytes: number, report: VerificationReport): string {
  const lines = [
    'Catanova restored-game verification',
    `Snapshot: ${source} (${bytes} bytes), opened only as a private copy`,
    report.journalChain === 'verified'
      ? 'Journal hash chain: checked with Store.verifyJournal for every room'
      : `Journal hash chain: NOT CHECKED (${MISSING_JOURNAL_CHECK})`,
    `Rooms: ${report.rooms}; with a game: ${report.games} (${
      Object.entries(report.phases)
        .map(([phase, count]) => `${count} ${phase}`)
        .join(', ') || 'none'
    }); without a game: ${report.withoutGame}`,
  ];
  for (const room of report.details) {
    if (room.status === 'no-game') continue;
    const facts = room.phase
      ? `${room.players} players, turn ${room.turn}, ${room.phase}, revision ${room.revision ?? '?'}, ${
          room.historyEntries ?? 0
        } history entries${room.journalEvents === undefined ? '' : `, ${room.journalEvents} journal rows`}; ${
          room.continuedWith ? `continues with ${room.continuedWith}` : 'finished'
        }`
      : 'no loadable game';
    lines.push(`  ${room.status === 'verified' ? 'PASS' : 'FAIL'} ${room.roomId}  ${facts}`);
    for (const problem of room.problems) lines.push(`       - ${problem}`);
  }
  lines.push(
    report.result === 'pass'
      ? `RESULT: PASS - ${report.verified} games in ${report.rooms} rooms verified`
      : `RESULT: FAIL - ${report.failed} of ${report.rooms} rooms failed: ${report.failures.map((f) => f.roomId).join(', ')}`,
  );
  return lines.join('\n');
}

const USAGE =
  'Usage: node dist/scripts/verify-restored-games.js RESTORED.sqlite [--report FILE.json] [--work-dir DIR] [--allow-missing-journal-check]';

export function main(argv: string[]): number {
  const positional: string[] = [];
  let reportPath: string | undefined;
  let workDirectory: string | undefined;
  let requireJournalCheck = true;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === '--help') {
      console.log(USAGE);
      return 0;
    } else if (argument === '--report' || argument === '--work-dir') {
      const value = argv[++i];
      if (!value) {
        console.error(USAGE);
        return 2;
      }
      if (argument === '--report') reportPath = resolve(value);
      else workDirectory = resolve(value);
    } else if (argument === '--allow-missing-journal-check') requireJournalCheck = false;
    else if (argument.startsWith('--')) {
      console.error(USAGE);
      return 2;
    } else positional.push(argument);
  }
  if (positional.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  try {
    const { bytes, report } = verifyRestoredDatabase(positional[0]!, {
      requireJournalCheck,
      ...(workDirectory ? { workDirectory } : {}),
    });
    console.log(formatReport(resolve(positional[0]!), bytes, report));
    if (reportPath)
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return report.result === 'pass' ? 0 : 1;
  } catch (error) {
    console.error(`Verification could not run: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
