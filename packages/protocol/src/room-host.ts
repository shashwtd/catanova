/**
 * Who runs a room: the person who has been seated longest.
 *
 * Seats are listed in the order they were taken, so this used to be simply the
 * first seat. A bot can end up first, though — the host adds bots and then
 * leaves — and a bot cannot press Start, change the settings or remove anyone,
 * which left the people still in the room with a lobby nobody could run.
 * Bots never host; a room with no person left in it has no host.
 */
export function roomHostId(players: readonly { id: string; bot?: boolean }[]): string | undefined {
  return players.find((p) => !p.bot)?.id;
}
