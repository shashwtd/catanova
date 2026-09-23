/**
 * Who is here right now, and where.
 *
 * Two sources, merged per person. The game server's presence hub
 * (`runtime.online()`) reports every signed-in account with Catanova open,
 * wherever they are in it. The sockets report which seats are connected to a
 * room right now, including local players without an account. Where an
 * account is comes from its seats: the room of the seat its socket is
 * connected to, or else a seat it still holds in an unfinished game (it is
 * then elsewhere, such as the hub, while its table goes on without it).
 *
 * Everything here is bounded: a primary-key or indexed lookup per person
 * online, and one room lookup per room they are in.
 */
import type { Store } from '../store.js';
import { ROOM_CODE_LEASE_MS } from '../store.js';
import type { GameRuntime } from './api.js';
import { indexRoom } from './room-index.js';
import type { IndexedRoom } from './room-index.js';
import type { OnlineNow, OnlinePerson, OnlinePlace } from './types.js';

/** Most accounts given a place; any beyond are still counted, as elsewhere. */
export const ONLINE_DETAIL_LIMIT = 500;

type SeatRow = {
  id: string;
  roomId: string;
  name: string;
  userId: string | null;
  accountType: string | null;
  bot: number;
};

const ORDER: Record<string, number> = { table: 0, away: 1, lobby: 2, hub: 3 };
const rank = (place: OnlinePlace) =>
  ORDER[place.kind === 'game' ? (place.atTable ? 'table' : 'away') : place.kind]!;

export function whoIsOnline(store: Store, runtime: GameRuntime, now: number): OnlineNow {
  const sockets = runtime.sockets();
  const accounts = runtime.online?.();
  const rooms = new Map<string, IndexedRoom | undefined>();
  const room = (roomId: string) => {
    if (!rooms.has(roomId)) rooms.set(roomId, indexRoom(store.db, now, ROOM_CODE_LEASE_MS, roomId));
    return rooms.get(roomId);
  };
  const placeIn = (roomId: string, atTable: boolean): OnlinePlace => {
    const found = room(roomId);
    if (!found || !found.hasGame) return { kind: 'lobby', roomId, roomCode: found?.code ?? null };
    return { kind: 'game', roomId, roomCode: found.code, status: found.status, turn: found.turn, atTable };
  };
  const seatQuery = store.db.prepare(
    'SELECT id, room_id AS roomId, name, user_id AS userId, account_type AS accountType, bot FROM seats WHERE id = ?',
  );
  // Connected seats first: they say exactly where someone is.
  const connected = new Map<string, SeatRow>();
  for (const id of new Set(sockets.seats)) {
    const seat = seatQuery.get(id) as SeatRow | undefined;
    if (seat && !seat.bot) connected.set(id, seat);
  }
  const byAccount = new Map<string, SeatRow>();
  for (const seat of connected.values()) if (seat.userId) byAccount.set(seat.userId, seat);
  const people: OnlinePerson[] = [];
  const listed = new Set<string>();
  const heldSeat = store.db.prepare(
    `SELECT s.room_id AS roomId FROM seats s JOIN game_phases g ON g.room_id = s.room_id
     WHERE s.user_id = ? AND s.departed = 0 AND coalesce(g.phase, '') <> 'finished'
     ORDER BY s.rowid DESC LIMIT 1`,
  );
  const latestName = store.db.prepare(
    'SELECT name, account_type AS accountType FROM seats WHERE user_id = ? ORDER BY rowid DESC LIMIT 1',
  );
  let unplaced = 0;
  for (const account of accounts ?? []) {
    if (listed.has(account.userId)) continue;
    listed.add(account.userId);
    const accountType = account.guest ? 'guest' : 'permanent';
    if (people.length >= ONLINE_DETAIL_LIMIT) {
      unplaced++;
      continue;
    }
    const seat = byAccount.get(account.userId);
    if (seat) {
      people.push({
        userId: account.userId,
        seatId: seat.id,
        name: account.name ?? seat.name,
        accountType,
        since: account.since,
        tabs: account.tabs,
        place: placeIn(seat.roomId, true),
      });
      continue;
    }
    const held = heldSeat.get(account.userId) as { roomId: string } | undefined;
    const known = account.name
      ? null
      : (latestName.get(account.userId) as { name: string; accountType: string | null } | undefined);
    people.push({
      userId: account.userId,
      seatId: null,
      name: account.name ?? known?.name ?? 'Unknown account',
      accountType,
      since: account.since,
      tabs: account.tabs,
      place: held ? placeIn(held.roomId, false) : { kind: 'hub' },
    });
  }
  // Everyone else at a room: local players, and accounts the hub did not (or cannot) report.
  for (const seat of connected.values()) {
    if (seat.userId && listed.has(seat.userId)) continue;
    if (seat.userId) listed.add(seat.userId);
    people.push({
      userId: seat.userId,
      seatId: seat.id,
      name: seat.name,
      accountType: seat.accountType,
      since: null,
      tabs: null,
      place: placeIn(seat.roomId, true),
    });
  }
  people.sort((a, b) => rank(a.place) - rank(b.place) || a.name.localeCompare(b.name));
  const playing = people.filter(
    (person) =>
      person.place.kind === 'game' &&
      person.place.atTable &&
      (person.place.status === 'live' || person.place.status === 'paused'),
  ).length;
  const inLobbies = people.filter((person) => person.place.kind === 'lobby').length;
  return {
    accounts: !!accounts,
    people,
    counts: {
      online: people.length + unplaced,
      playing,
      inLobbies,
      elsewhere: people.length + unplaced - playing - inLobbies,
      spectators: sockets.spectators,
    },
  };
}
