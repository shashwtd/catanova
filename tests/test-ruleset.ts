/**
 * A mode that exists only in tests. It plays on Classic's island with Classic's rules, but every number a mode
 * sets is different, and it has no bots: whatever still said four seats, 19 cards or 15 roads would show up in
 * a game of it. docs/GAME-MODES.md, step 1: the mode system, proved with a hidden test mode.
 *
 * Only tests register it. No build, environment setting or request can, so no player can ever meet it.
 */
import { CLASSIC, registerRuleset } from '../packages/rules/src/rulesets.js';
import type { Ruleset } from '../packages/rules/src/rulesets.js';

export const TEST_TABLE: Ruleset = {
  ...CLASSIC,
  id: 'test-table-v1',
  name: 'Test Table',
  summary: 'A mode for tests, for three to five players.',
  earlierBoards: [],
  seats: { min: 3, max: 5 },
  victoryPoints: { default: 11, min: 9, max: 13 },
  supply: {
    bank: 24,
    deck: { knight: 10, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3, victoryPoint: 3 },
    pieces: { roads: 12, settlements: 4, cities: 3 },
  },
  bots: false,
  standIns: false,
};
export const TEST_DECK_SIZE = 22;

/** Register the test mode for the rest of this test file's process. Safe to call more than once. */
let registered = false;
export function useTestTable() {
  if (!registered) registerRuleset(TEST_TABLE);
  registered = true;
  return TEST_TABLE;
}
