/**
 * Who is which colour.
 *
 * Colour is the only thing on the island that says a road is yours: there are
 * no names on the pieces. It used to be handed out by seat order, which meant
 * the person who joined third was purple whether they liked it or not, and
 * meant nothing about the choice was worth showing anywhere.
 *
 * So a seat can now ask for a colour. Two seats cannot hold the same one, and
 * a seat that has not asked still gets one automatically, so every seat at a
 * table has its own colour whether anybody chose or not. Resolution is pure
 * and deterministic — the same seats always produce the same answer on the
 * server, in the browser and in a test.
 */
export const PLAYER_COLORS = {
  coral: '#ef7756',
  sky: '#54b3dc',
  violet: '#b08be4',
  amber: '#f2ce56',
  jade: '#5fbf8d',
  rose: '#e87fa4',
  slate: '#8fa2b8',
  bronze: '#c98a4b',
} as const;
export type PlayerColor = keyof typeof PLAYER_COLORS;
export const PLAYER_COLOR_LIST = Object.keys(PLAYER_COLORS) as PlayerColor[];
export const PLAYER_COLOR_LABEL: Record<PlayerColor, string> = {
  coral: 'Coral',
  sky: 'Sky',
  violet: 'Violet',
  amber: 'Amber',
  jade: 'Jade',
  rose: 'Rose',
  slate: 'Slate',
  bronze: 'Bronze',
};
/** What the first four seats get when nobody has chosen. These are the colours
 *  the game shipped with, so an untouched table looks exactly as it did. */
export const DEFAULT_SEAT_COLORS: readonly PlayerColor[] = ['coral', 'sky', 'violet', 'amber'];
export function isPlayerColor(value: unknown): value is PlayerColor {
  return typeof value === 'string' && Object.hasOwn(PLAYER_COLORS, value);
}

/**
 * One colour per seat, in seat order.
 *
 * A chosen colour wins, and where two seats somehow hold the same one — an old
 * save, a race the server let through — the earlier seat keeps it and the
 * later seat falls back, so the result is always different colours rather
 * than two players who cannot tell their roads apart.
 *
 * Seats that have not chosen take the first four in their old order, then the
 * rest of the palette: a fifth and sixth seat get jade and rose. Each colour is
 * on that list once, or six seats would come round to coral and sky again.
 */
export function seatColors(seats: readonly { color?: string | null }[]): PlayerColor[] {
  const taken = new Set<PlayerColor>();
  const chosen = seats.map((seat) => {
    if (!isPlayerColor(seat.color) || taken.has(seat.color)) return null;
    taken.add(seat.color);
    return seat.color;
  });
  const spare = [...new Set([...DEFAULT_SEAT_COLORS, ...PLAYER_COLOR_LIST])].filter(
    (color) => !taken.has(color),
  );
  let next = 0;
  return chosen.map((color) => {
    if (color) return color;
    const fallback = spare[next++] ?? PLAYER_COLOR_LIST[0]!;
    taken.add(fallback);
    return fallback;
  });
}

/** Which colours a seat may still ask for: everything nobody else holds. */
export function availableColors(
  seats: readonly { id: string; color?: string | null }[],
  seatId: string,
): PlayerColor[] {
  const held = new Set(
    seats.filter((seat) => seat.id !== seatId && isPlayerColor(seat.color)).map((seat) => seat.color),
  );
  return PLAYER_COLOR_LIST.filter((color) => !held.has(color));
}
