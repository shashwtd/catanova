import { CLASSIC, findRuleset, isRulesetId, targetRangeText, validTarget } from '../../rules/src/rulesets.js';
import { DICE_MODES } from '../../rules/src/dice.js';
import type { DiceMode } from '../../rules/src/dice.js';
export type { DiceMode } from '../../rules/src/dice.js';
export const TURN_TIMER_STEPS = [40, 65, 90, 115, 140] as const;
export type TurnTimerSeconds = (typeof TURN_TIMER_STEPS)[number];
export type RoomSettings = {
  turnTimerSeconds: TurnTimerSeconds | null;
  diceMode?: DiceMode;
  victoryPoints?: number;
  /**
   * The mode the room plays, as a ruleset id. A saved room without one plays Classic. A change without one,
   * which a tab from before modes sends, keeps the room's mode.
   */
  mode?: string;
};
export const DEFAULT_ROOM_SETTINGS: RoomSettings = { turnTimerSeconds: 90, diceMode: 'balanced' };
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
  const victoryPoints = (input as Record<string, unknown>).victoryPoints;
  const mode = (input as Record<string, unknown>).mode;
  if (mode !== undefined && !isRulesetId(mode)) throw new Error('Choose a game mode');
  // A target is for its own mode's range. A mode this version does not know is refused where the room
  // changes (MODE_UNAVAILABLE); read back from a saved room, its target only has to be a sensible number.
  const rules = mode === undefined ? CLASSIC : findRuleset(mode);
  if (
    victoryPoints !== undefined &&
    !(rules
      ? validTarget(rules, victoryPoints)
      : Number.isInteger(victoryPoints) && (victoryPoints as number) > 0 && (victoryPoints as number) < 100)
  )
    throw new Error(targetRangeText(rules ?? CLASSIC));
  const diceMode = (input as Record<string, unknown>).diceMode;
  if (seconds !== null && !TURN_TIMER_STEPS.includes(seconds as TurnTimerSeconds))
    throw new Error('Turn timer must be off, 40, 65, 90, 115, or 140 seconds');
  if (diceMode !== undefined && !DICE_MODES.includes(diceMode as DiceMode))
    throw new Error('Choose Natural or Balanced dice');
  return {
    ...(victoryPoints === undefined ? {} : { victoryPoints: victoryPoints as number }),
    turnTimerSeconds: seconds as TurnTimerSeconds | null,
    ...(diceMode === undefined ? {} : { diceMode: diceMode as DiceMode }),
    ...(mode === undefined ? {} : { mode }),
  };
}
