export const AVATAR_COUNT = 12;
export const ACCENTS = {
  sea: '#438b9f',
  pine: '#66866a',
  clay: '#bd795e',
  gold: '#bd9b55',
  plum: '#9379a7',
  coral: '#c4827e',
} as const;
export type Profile = {
  name: string;
  username?: string;
  avatar: number;
  accent: keyof typeof ACCENTS;
  frame: 'rope' | 'brass' | 'plain';
};
export type Account = {
  id: string;
  username: string | null;
  isGuest: boolean;
  registered: boolean;
  profile: Profile | null;
  lastActiveAt: string;
  expiresAt: string | null;
};
export type PublicAccount = { id: string; username: string; isGuest: boolean; profile: Profile };
export type FriendsState = { friends: PublicAccount[]; incoming: PublicAccount[]; outgoing: PublicAccount[] };
export type UsernameAvailability = { available: boolean; reason?: string };
export const emptyFriends = (): FriendsState => ({ friends: [], incoming: [], outgoing: [] });
export const validUsername = (value: string) => /^[A-Za-z0-9_]{3,20}$/.test(value);
export const defaultProfile = (name = 'Player'): Profile => ({
  name,
  avatar: 0,
  accent: 'sea',
  frame: 'rope',
});
export function parseProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile');
  const p = value as Record<string, unknown>;
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 32)
    throw new Error('Choose a name of 1–32 characters');
  if (!Number.isInteger(p.avatar) || (p.avatar as number) < 0 || (p.avatar as number) >= AVATAR_COUNT)
    throw new Error('Choose an available avatar');
  if (typeof p.accent !== 'string' || !Object.hasOwn(ACCENTS, p.accent))
    throw new Error('Choose an available accent');
  if (!['rope', 'brass', 'plain'].includes(String(p.frame))) throw new Error('Choose an available frame');
  if (p.username !== undefined && (typeof p.username !== 'string' || !validUsername(p.username.trim())))
    throw new Error('Use 3–20 letters, numbers or underscores');
  // Legacy saved profiles may contain provider fields. Never carry them into current snapshots.
  return {
    name: p.name.trim(),
    avatar: p.avatar as number,
    accent: p.accent as Profile['accent'],
    frame: p.frame as Profile['frame'],
    ...(p.username === undefined ? {} : { username: (p.username as string).trim() }),
  };
}
