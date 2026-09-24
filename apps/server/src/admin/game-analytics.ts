/**
 * How one game went, read back from its journal.
 *
 * Every move is a journal row holding the whole game as it stood afterwards,
 * so replaying the rows in order and comparing each state with the one before
 * gives everything that happened: points turn by turn, dice, where resources
 * came from and went, the robber, trades, development cards, the awards
 * changing hands, and who (or which bot, or the turn timer) made each move,
 * with the public entry's time dating turns.
 *
 * Only what the table could see is reported. Points count victory point
 * cards once a winner revealed them, never before; a steal is counted but its
 * resource is not named; cards bought are counted and only played ones named.
 * Hands, decks and anything else private stay behind the audited private
 * view.
 *
 * This reads every row of a game and decodes each one, so it runs in the
 * analysis worker on its own read-only connection (analysis-runner.ts), never
 * on the game's thread. Rows are read through the same compact-or-whole
 * decoding as Store.journalState, with each board parsed once.
 */
import type { DatabaseSync } from 'node:sqlite';
import { journalReader } from '../journal.js';
import type { JournalRow } from '../journal.js';
import { score } from '../../../../packages/rules/src/game.js';
import type { Game, Player } from '../../../../packages/rules/src/game.js';
import { RESOURCES } from '../../../../packages/rules/src/index.js';
import { DEFAULT_VICTORY_POINTS } from '../../../../packages/rules/src/victory.js';
import type { HistoryEntry } from '../../../../packages/protocol/src/index.js';
import { diceSummary } from './analysis.js';
import type { AnalyticsPlayer, GameAnalytics, GameEndReason, ResourceCounts } from './types.js';

/** Which game to read: a room's current one, or one of its archived rounds, up to its last move. */
export type GameAnalyticsJob = { roomId: string; archiveId: string | null; toRevision: number; now?: number };

type Row = JournalRow & {
  revision: number;
  actor: string | null;
  action: string;
  actorKind: string | null;
  entry: string;
  dice: number | null;
  participants: string | null;
};

type SeatRow = {
  id: string;
  name: string;
  bot: number;
  botLevel: string | null;
  userId: string | null;
  accountType: string | null;
};

const zero = (): ResourceCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
const sum = (hand: ResourceCounts) => RESOURCES.reduce((total, resource) => total + hand[resource], 0);
const time = (value: string | undefined) => {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

/** The points the table saw: every victory point card counts once a winner revealed them. */
const shown = (game: Game, player: Player) => score(game, player, !!game.winner);

function blankPlayer(player: Player, seat: SeatRow | undefined, bot: boolean): AnalyticsPlayer {
  return {
    id: player.id,
    name: player.name,
    bot,
    botLevel: bot ? (seat?.botLevel ?? 'steady') : null,
    userId: seat?.userId ?? null,
    accountType: seat?.accountType ?? null,
    points: 0,
    rank: 0,
    winner: false,
    resigned: null,
    pieces: { settlements: 0, cities: 0, roads: 0 },
    knights: 0,
    longestRoad: false,
    largestArmy: false,
    moves: { own: 0, bot: 0, timer: 0 },
    standIns: 0,
    turnTime: { turns: 0, meanSeconds: null, medianSeconds: null, botTurns: 0 },
    resources: {
      produced: zero(),
      gained: { production: 0, setup: 0, trades: 0, bank: 0, fromCards: 0, stolen: 0 },
      spent: { roads: 0, settlements: 0, cities: 0, devCards: 0, trades: 0, bank: 0, discarded: 0 },
      lost: { robbed: 0, monopoly: 0 },
    },
    devCards: { bought: 0, played: {} },
    robber: { moves: 0, steals: 0, robbed: 0, sevens: 0 },
    trades: { withPlayers: 0, offers: 0, bank: 0 },
  };
}

/** How the last row finished the game, from its action and the engine's own reason. */
function endReason(game: Game, kind: string, action: { kind?: string; reason?: string }): GameEndReason {
  if (game.winner) return game.finishReason === 'resignation' ? 'resignation' : 'points';
  if (action.kind === 'adminEnd') return 'closedByAdmin';
  if (action.kind === 'abandon' || game.players.some((player) => !player.resigned)) return 'botsOnly';
  if (kind === 'leave') return 'everyoneLeft';
  if (kind === 'resign') return 'disconnected';
  return 'abandoned';
}

/** Where the game's rows start: its start entry, or for an imported game its legacy entry. */
function firstRevision(db: DatabaseSync, job: GameAnalyticsJob): number | null {
  const start = db
    .prepare(
      `SELECT revision FROM game_events WHERE room_id = ? AND revision <= ?
         AND json_extract(public_entry, '$.kind') IN ('start', 'legacy')
       ORDER BY revision DESC LIMIT 1`,
    )
    .get(job.roomId, job.toRevision) as { revision: number } | undefined;
  if (start) return start.revision;
  // No start entry: the rows after the room's previous round.
  const floor = db
    .prepare(
      'SELECT coalesce(max(revision), 0) AS revision FROM archived_matches WHERE source_room_id = ? AND revision < ?',
    )
    .get(job.roomId, job.toRevision) as { revision: number };
  const first = db
    .prepare(
      'SELECT min(revision) AS revision FROM game_events WHERE room_id = ? AND revision > ? AND revision <= ?',
    )
    .get(job.roomId, floor.revision, job.toRevision) as { revision: number | null };
  return first.revision;
}

export function computeGameAnalytics(db: DatabaseSync, job: GameAnalyticsJob): GameAnalytics {
  const from = firstRevision(db, job);
  if (from === null) throw new Error('This game has no journal');
  const boards = db.prepare('SELECT board FROM journal_boards WHERE hash = ?');
  const read = journalReader((hash) => boards.get(hash)?.board as string | undefined);
  const seats = new Map(
    (
      db
        .prepare(
          'SELECT id, name, bot, bot_level AS botLevel, user_id AS userId, account_type AS accountType FROM seats WHERE room_id = ?',
        )
        .all(job.roomId) as SeatRow[]
    ).map((seat) => [seat.id, seat]),
  );
  const rows = db
    .prepare(
      `SELECT revision, actor, action, actor_kind AS actorKind, public_entry AS entry, dice_total AS dice,
         participants, state, state_z, board_hash
       FROM game_events WHERE room_id = ? AND revision BETWEEN ? AND ? ORDER BY revision`,
    )
    .iterate(job.roomId, from, job.toRevision) as Iterable<Row>;

  const players = new Map<string, AnalyticsPlayer>();
  let order: string[] = [];
  let first: Game | undefined;
  let prev: Game | undefined;
  let last:
    { game: Game; entry: HistoryEntry; kind: string; action: { kind?: string; reason?: string } } | undefined;
  let legacy = false,
    unreadable = 0,
    moves = 0,
    startedAt: number | null = null,
    lastMoveAt: number | null = null,
    pendingKnight = false;
  const botSeats = new Set<string>();
  const pointsByTurn = new Map<number, number[]>();
  const dice = Array<number>(11).fill(0);
  const pairs = Array<number>(36).fill(0);
  let sevens = 0,
    unpaired = 0;
  const awards: GameAnalytics['awards'] = [];
  const robberMoves: GameAnalytics['robberMoves'] = [];
  const trades: GameAnalytics['trades'] = [];
  const turnTimes = new Map<string, number[]>();
  // The turn under way: whose it is, when it began, and whether a bot played any of it for a person.
  let turn: { number: number; player: string; at: number; botPlayed: boolean } | null = null;
  const closeTurn = (at: number | null) => {
    if (!turn || turn.number < 1 || at === null) return;
    const player = players.get(turn.player);
    if (!player) return;
    if (turn.botPlayed && !player.bot) player.turnTime.botTurns++;
    else turnTimes.set(turn.player, [...(turnTimes.get(turn.player) ?? []), (at - turn.at) / 1000]);
  };

  for (const row of rows) {
    let game: Game | undefined;
    try {
      game = read(row);
    } catch {
      game = undefined;
    }
    if (!game) {
      unreadable++;
      continue;
    }
    const entry = JSON.parse(row.entry) as HistoryEntry;
    const at = time(entry.at);
    let action: {
      kind?: string;
      reason?: string;
      hex?: number;
      victim?: string;
      player?: string;
      players?: string[];
    };
    try {
      action = JSON.parse(row.action) as typeof action;
    } catch {
      action = {};
    }
    if (!first) {
      first = game;
      legacy = entry.kind === 'legacy';
      startedAt = at;
      order = game.players.map((player) => player.id);
      // Who was a bot at the start: the start entry names its participants; otherwise the seats do.
      const participants = row.participants
        ? (JSON.parse(row.participants) as { id: string; bot: number }[])
        : undefined;
      for (const player of game.players) {
        const bot = participants
          ? !!participants.find((seat) => seat.id === player.id)?.bot
          : !!seats.get(player.id)?.bot;
        if (bot) botSeats.add(player.id);
        players.set(player.id, blankPlayer(player, seats.get(player.id), bot));
      }
      turn = { number: game.turn, player: game.players[game.active]!.id, at: at ?? 0, botPlayed: false };
    }
    moves++;
    lastMoveAt = at ?? lastMoveAt;
    const kind = entry.kind;
    const actor = row.actor ? players.get(row.actor) : undefined;
    if (actor && row.actorKind) {
      if (row.actorKind === 'human') actor.moves.own++;
      else if (row.actorKind === 'bot') actor.moves.bot++;
      else if (row.actorKind === 'timer') actor.moves.timer++;
      if (row.actorKind === 'bot' && !actor.bot && turn && turn.player === actor.id) turn.botPlayed = true;
    }
    if (prev) {
      const before = new Map(prev.players.map((player) => [player.id, player]));
      // Resources: each seat's change in hand, filed under what caused it.
      for (const player of game.players) {
        const was = before.get(player.id);
        const stats = players.get(player.id);
        if (!was || !stats) continue;
        const gain = zero(),
          loss = zero();
        for (const resource of RESOURCES) {
          const delta = player.hand[resource] - was.hand[resource];
          if (delta > 0) gain[resource] = delta;
          else loss[resource] = -delta;
        }
        const gained = sum(gain),
          lost = sum(loss);
        if (!gained && !lost) continue;
        const own = row.actor === player.id;
        const { resources } = stats;
        if (kind === 'roll') {
          resources.gained.production += gained;
          for (const resource of RESOURCES) resources.produced[resource] += gain[resource];
        } else if (kind === 'settlement' && prev.phase === 'setupSettlement')
          resources.gained.setup += gained;
        else if (kind === 'road' && own) resources.spent.roads += lost;
        else if (kind === 'settlement' && own) resources.spent.settlements += lost;
        else if (kind === 'city' && own) resources.spent.cities += lost;
        else if (kind === 'buyCard' && own) resources.spent.devCards += lost;
        else if (kind === 'bankTrade' && own) {
          resources.gained.bank += gained;
          resources.spent.bank += lost;
        } else if (kind === 'acceptProposal' || kind === 'acceptTrade') {
          resources.gained.trades += gained;
          resources.spent.trades += lost;
        } else if (kind === 'discard') resources.spent.discarded += lost;
        else if (kind === 'robber') {
          resources.gained.stolen += gained;
          resources.lost.robbed += lost;
        } else if (kind === 'playCard') {
          resources.gained.fromCards += gained;
          resources.lost.monopoly += lost;
        }
      }
      // Development cards: bought, and which were played (the table is told when one is).
      if (kind === 'buyCard' && actor) actor.devCards.bought++;
      if (kind === 'playCard' && actor) {
        const was = before.get(actor.id);
        const now = game.players.find((player) => player.id === actor.id);
        const played = was?.cards.find((card) => !now?.cards.some((other) => other.id === card.id));
        if (played) {
          actor.devCards.played[played.kind] = (actor.devCards.played[played.kind] ?? 0) + 1;
          if (played.kind === 'knight') pendingKnight = true;
        }
      }
      // The robber: who moved it where, and whether a card was taken.
      if (kind === 'robber' && actor) {
        const hex = game.board.hexes[game.robber];
        const victim = action.victim ? players.get(action.victim) : undefined;
        const victimBefore = action.victim ? before.get(action.victim) : undefined;
        const victimAfter = action.victim
          ? game.players.find((player) => player.id === action.victim)
          : undefined;
        const stole = !!victimBefore && !!victimAfter && sum(victimAfter.hand) < sum(victimBefore.hand);
        actor.robber.moves++;
        if (stole) {
          actor.robber.steals++;
          if (victim) victim.robber.robbed++;
        }
        robberMoves.push({
          turn: game.turn,
          playerId: actor.id,
          terrain: hex?.terrain ?? 'unknown',
          number: hex && hex.number > 0 ? hex.number : null,
          victimId: action.victim ?? null,
          stole,
          cause: pendingKnight ? 'knight' : 'seven',
        });
        pendingKnight = false;
      }
      // Trades: offers made, bank trades, and exchanges between players as announced.
      if ((kind === 'offerTrade' || kind === 'openTrade') && actor) actor.trades.offers++;
      if (kind === 'bankTrade' && actor) actor.trades.bank++;
      if (kind === 'acceptProposal' || kind === 'acceptTrade') {
        const changed = game.players.filter((player) => {
          const was = before.get(player.id);
          return was && RESOURCES.some((resource) => was.hand[resource] !== player.hand[resource]);
        });
        if (changed.length === 2) {
          for (const player of changed) players.get(player.id)!.trades.withPlayers++;
          const line = entry.lines.find((text) => / traded /.test(text));
          trades.push({
            turn: game.turn,
            text: line ?? `${changed[0]!.name} and ${changed[1]!.name} traded`,
          });
        }
      }
      // Longest Road and Largest Army changing hands.
      for (const award of ['longestRoad', 'largestArmy'] as const)
        if (game[award] !== prev[award])
          awards.push({ turn: game.turn, award, playerId: game[award], fromId: prev[award] });
      // Resignations, and how they came about.
      for (const player of game.players) {
        const stats = players.get(player.id);
        if (stats && player.resigned && !before.get(player.id)?.resigned)
          stats.resigned = {
            turn: game.turn,
            how:
              action.kind === 'adminEnd'
                ? 'closed by the admin'
                : kind === 'leave'
                  ? 'left'
                  : kind === 'resign'
                    ? 'did not come back'
                    : 'resigned',
          };
      }
    }
    // Stand-ins taking a seat over.
    if (kind === 'standIn' && action.kind === 'standIn')
      for (const id of action.players ?? []) {
        const stats = players.get(id);
        if (stats) stats.standIns++;
      }
    if (kind === 'roll' && row.dice !== null && row.dice >= 2 && row.dice <= 12) {
      dice[row.dice - 2]!++;
      // The saved game holds both dice of the roll it has just made.
      const [first, second] = game.dice ?? [];
      if (first && second && first + second === row.dice) pairs[(first - 1) * 6 + (second - 1)]!++;
      else unpaired++;
      if (row.dice === 7) {
        sevens++;
        if (actor) actor.robber.sevens++;
      }
    }
    // A new turn: the last one ends now.
    if (turn && game.turn !== turn.number) {
      closeTurn(at);
      turn = { number: game.turn, player: game.players[game.active]!.id, at: at ?? 0, botPlayed: false };
    }
    pointsByTurn.set(
      game.turn,
      order.map((id) => {
        const player = game.players.find((candidate) => candidate.id === id);
        return player ? shown(game, player) : 0;
      }),
    );
    last = { game, entry, kind, action };
    prev = game;
  }
  if (!first || !last) throw new Error('No move of this game could be read');
  const final = last.game;
  const finished = final.phase === 'finished';
  if (finished) closeTurn(lastMoveAt);
  // Pieces, knights and awards at the end; rank by the points the table saw, the winner first.
  for (const player of final.players) {
    const stats = players.get(player.id);
    if (!stats) continue;
    stats.points = shown(final, player);
    stats.winner = final.winner === player.id;
    stats.knights = player.knights;
    stats.longestRoad = final.longestRoad === player.id;
    stats.largestArmy = final.largestArmy === player.id;
    stats.pieces = {
      settlements: Object.values(final.buildings).filter(
        (b) => b.player === player.id && b.kind === 'settlement',
      ).length,
      cities: Object.values(final.buildings).filter((b) => b.player === player.id && b.kind === 'city')
        .length,
      roads: Object.values(final.roads).filter((owner) => owner === player.id).length,
    };
    const times = turnTimes.get(player.id) ?? [];
    stats.turnTime = {
      turns: times.length,
      meanSeconds: round(times.length ? times.reduce((a, b) => a + b, 0) / times.length : null),
      medianSeconds: round(median(times)),
      botTurns: stats.turnTime.botTurns,
    };
  }
  // Standings: the winner, then those still at the table by points, then those who resigned.
  const standing = (player: AnalyticsPlayer) => (player.winner ? 0 : player.resigned ? 2 : 1);
  const ranked = [...players.values()].sort((a, b) => standing(a) - standing(b) || b.points - a.points);
  ranked.forEach((player, index) => {
    const before = ranked[index - 1];
    const tied =
      !!before && !player.winner && standing(before) === standing(player) && before.points === player.points;
    player.rank = tied ? before.rank : index + 1;
  });
  const turns = [...pointsByTurn.keys()].sort((a, b) => a - b);
  const mode = typeof first.diceMode === 'string' ? first.diceMode : 'classic';
  const code = db
    .prepare('SELECT code FROM room_codes WHERE room_id = ? AND expires_at > ?')
    .get(job.roomId, job.now ?? Date.now()) as { code: string } | undefined;
  return {
    roomId: job.roomId,
    roomCode: code?.code ?? null,
    archiveId: job.archiveId,
    fromRevision: from,
    toRevision: job.toRevision,
    legacy,
    unreadable,
    status: finished ? 'finished' : final.turn === 0 ? 'setup' : 'playing',
    diceMode: mode,
    victoryPoints: final.victoryPoints ?? DEFAULT_VICTORY_POINTS,
    startedAt,
    endedAt: finished ? lastMoveAt : null,
    lastMoveAt,
    turns: final.turn,
    moves,
    end: finished
      ? {
          reason: endReason(final, last.kind, last.action),
          winnerId: final.winner,
          text: last.entry.lines.join(' '),
        }
      : null,
    players: order.map((id) => players.get(id)!),
    points: {
      turns,
      byPlayer: order.map((_, index) => turns.map((number) => pointsByTurn.get(number)![index]!)),
    },
    dice: { ...diceSummary(dice, mode, { pairs, unpaired }), sevens },
    awards,
    robberMoves,
    trades,
  };
}
