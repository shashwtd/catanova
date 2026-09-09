const INTENT_KEY = 'catanova.entry.intent';
const INTENT_TTL_MS = 30 * 60 * 1000;
export type RoomEntryIntent = 'create' | 'join';
/** Preserve the chosen action across OAuth without automatically creating or joining anything. */
export function rememberEntryIntent(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  entry: string,
  now = Date.now(),
) {
  if (entry === 'create' || entry === 'join') storage.setItem(INTENT_KEY, JSON.stringify({ entry, at: now }));
  else storage.removeItem(INTENT_KEY);
}
export function takeEntryIntent(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): RoomEntryIntent | 'home' {
  const raw = storage.getItem(INTENT_KEY);
  storage.removeItem(INTENT_KEY);
  try {
    const value = JSON.parse(raw ?? 'null') as { entry?: unknown; at?: unknown } | null;
    if (
      value &&
      (value.entry === 'create' || value.entry === 'join') &&
      typeof value.at === 'number' &&
      Number.isFinite(value.at) &&
      now >= value.at &&
      now - value.at < INTENT_TTL_MS
    )
      return value.entry;
  } catch {
    /* An invalid or abandoned choice returns to the menu. */
  }
  return 'home';
}
