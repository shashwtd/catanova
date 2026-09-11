import type { PublicAccount } from './profile.js';

export type RoomInvite = {
  id: string;
  /** Permanent room identity; short aliases must never authorize or retarget an invitation. */
  roomId: string;
  roomCode?: string;
  from: PublicAccount;
  players: number;
  createdAt: number;
  expiresAt: number;
};
export type SentRoomInvite = {
  id: string;
  roomId: string;
  to: string;
  createdAt: number;
  expiresAt: number;
};
export type RoomInvitesState = { incoming: RoomInvite[]; sent: SentRoomInvite[] };
export const emptyRoomInvites = (): RoomInvitesState => ({ incoming: [], sent: [] });
