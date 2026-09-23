/** Small, locale-stable formatters for the admin console. */
const numberFormat = new Intl.NumberFormat('en');
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const count = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : numberFormat.format(value);

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value,
    unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const time = (at: number | null | undefined) =>
  at === null || at === undefined ? '—' : dateTime.format(new Date(at));

/** "12s ago", "in 3m": for deadlines and last-seen times. */
export function relative(at: number | null | undefined, now = Date.now()): string {
  if (at === null || at === undefined) return '—';
  const delta = at - now;
  const text = duration(Math.abs(delta) / 1000).split(' ')[0]!;
  if (Math.abs(delta) < 1500) return 'now';
  return delta < 0 ? `${text} ago` : `in ${text}`;
}

export const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—';

export const short = (id: string | null | undefined, length = 8) => (id ? id.slice(0, length) : '—');

/** Dice modes by the names players see in the lobby. */
export const DICE_LABELS: Record<string, string> = {
  classic: 'Natural',
  balanced: 'Balanced',
  flat: 'Flat (retired)',
};
export const diceLabel = (mode: string | null | undefined) =>
  mode ? (DICE_LABELS[mode] ?? mode) : DICE_LABELS.classic!;

/** What the table is waiting for, in words rather than the engine's phase ids. */
const PHASE_LABELS: Record<string, string> = {
  setupSettlement: 'Setup',
  setupRoad: 'Setup',
  roll: 'To roll',
  actions: 'Building and trading',
  discard: 'Discarding',
  robber: 'Moving the robber',
  freeRoads: 'Free roads',
  finished: 'Finished',
};
export const phaseLabel = (phase: string | null | undefined) =>
  phase ? (PHASE_LABELS[phase] ?? phase) : '—';

/** How an account signs in: `permanent` accounts are Google sign-ins; guests have no sign-in. */
export const accountLabel = (type: string | null | undefined): string | null =>
  type === 'permanent' ? 'Google' : type === 'guest' ? 'Guest' : (type ?? null);
