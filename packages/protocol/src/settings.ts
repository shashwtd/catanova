export const TURN_TIMER_STEPS = [40, 65, 90, 115, 140] as const;
export type TurnTimerSeconds = (typeof TURN_TIMER_STEPS)[number];
export type RoomSettings = { turnTimerSeconds: TurnTimerSeconds | null };
export const DEFAULT_ROOM_SETTINGS: RoomSettings = { turnTimerSeconds: null };
export const DEFAULT_TURN_TIMER_SECONDS: TurnTimerSeconds = 90;

/** All timestamps use the server's epoch milliseconds. Setup has no clock. */
export type TurnClock = {
  playerId: string;
  turn: number;
  startedAt: number;
  deadlineAt: number;
  /** The active clock pauses while every required player makes their discard. */
  pausedAt?: number;
  discardDeadlines?: Record<string, number>;
};

export function parseRoomSettings(input: unknown): RoomSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid room settings');
  const seconds = (input as Record<string, unknown>).turnTimerSeconds;
  if (seconds !== null && !TURN_TIMER_STEPS.includes(seconds as TurnTimerSeconds))
    throw new Error('Turn timer must be off, 40, 65, 90, 115, or 140 seconds');
  return { turnTimerSeconds: seconds as TurnTimerSeconds | null };
}
