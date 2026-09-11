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
export type FriendPresenceState = Omit<FriendsState, 'friends'> & {
  friends: (PublicAccount & { online: boolean })[];
};
