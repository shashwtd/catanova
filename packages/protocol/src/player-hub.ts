import type { FriendsState, Profile, PublicAccount } from './profile.js';

export type MatchOutcome = 'playing' | 'won' | 'lost' | 'resigned' | 'abandoned';
export type MatchPlayer = {
  /** A seat ID in this match, never the opponent's authentication ID. */
  id: string;
  name: string;
  profile?: Profile;
  points: number;
  winner: boolean;
};
export type MatchSummary = {
  roomId: string;
  roomCode: string | null;
  /** Older imported games may not have a recorded start or finish date. */
  startedAt: number | null;
  finishedAt: number | null;
  turns: number;
  outcome: MatchOutcome;
  points: number;
  players: MatchPlayer[];
  resumable: boolean;
};
export type PlayerGames = {
  /** Played means matches with a winner, including losses after resignation; abandoned games do not count. */
  stats: { played: number; wins: number };
  games: MatchSummary[];
  nextCursor: string | null;
};
/** What a player lets their friends see. Kept deliberately small: one switch,
 *  one meaning, and off is always a safe answer. */
export type AccountPrivacy = { shareLastSeen: boolean };
export const DEFAULT_ACCOUNT_PRIVACY: AccountPrivacy = { shareLastSeen: true };
export function parseAccountPrivacy(value: unknown): AccountPrivacy {
  const v = value && typeof value === 'object' ? (value as Partial<AccountPrivacy>) : {};
  return { shareLastSeen: typeof v.shareLastSeen === 'boolean' ? v.shareLastSeen : true };
}
/** One friend's presence as it changes, pushed over the presence socket. */
export type FriendPresenceChange = {
  id: string;
  online: boolean;
  /** As in `FriendPresenceState`: only when offline, and only if they share it. */
  lastSeenAt?: number;
  watchable?: { roomId: string; roomCode?: string };
};
export type FriendPresenceState = Omit<FriendsState, 'friends'> & {
  friends: (PublicAccount & {
    online: boolean;
    /** Epoch milliseconds, and only for a friend who chose to share it. An
     *  online friend does not carry one: "online" already answers the
     *  question, and the exact moment would say more than they agreed to. */
    lastSeenAt?: number;
    /** Present only for an online friend in an unfinished game, so the client
     *  can offer to watch. Carries no information about their position. */
    watchable?: { roomId: string; roomCode?: string };
  })[];
};
