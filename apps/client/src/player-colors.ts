/**
 * Seat colours, as hex, for everything that draws a player.
 *
 * The palette and the rule for resolving it are shared with the server
 * (`packages/protocol/src/colors.ts`) so a road is the same colour in the
 * browser as the seat that owns it. This module only turns the names into
 * values, and gives the board its default four for the case where there is no
 * room to ask — a static preview, a spectator's first frame.
 */
import { DEFAULT_SEAT_COLORS, PLAYER_COLORS, seatColors } from '../../../packages/protocol/src/colors.js';

/** The four the game has always started with, in seat order. */
export const DEFAULT_SEAT_HEX = DEFAULT_SEAT_COLORS.map((name) => PLAYER_COLORS[name]);

/** One hex colour per seat, in seat order, honouring what each seat chose. */
export function seatHexColors(seats: readonly { color?: string }[] | undefined): string[] {
  if (!seats?.length) return [...DEFAULT_SEAT_HEX];
  return seatColors(seats).map((name) => PLAYER_COLORS[name]);
}

/** The colour of one player, by id, falling back to their seat's default. */
export function playerHexColor(
  seats: readonly { id: string; color?: string }[] | undefined,
  id: string | undefined,
): string {
  const index = seats?.findIndex((seat) => seat.id === id) ?? -1;
  if (index < 0) return DEFAULT_SEAT_HEX[0]!;
  return seatHexColors(seats)[index] ?? DEFAULT_SEAT_HEX[0]!;
}
