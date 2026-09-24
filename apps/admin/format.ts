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

const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayClockFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
/** "14:05", in the viewer's time. */
export const clock = (at: number) => clockFormat.format(new Date(at));
/** "24 Sept, 14:05", in the viewer's time. */
export const dayClock = (at: number) => dayClockFormat.format(new Date(at));

/** The start of the viewer's day and week (Monday), in their own time zone. */
export function localWindows(now = Date.now()): { day: number; week: number } {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const week = new Date(day);
  week.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return { day: day.getTime(), week: week.getTime() };
}

/**
 * Round times for a time axis between two moments, in the viewer's time: every
 * 15 minutes for an hour, every hour up to eight, every six hours beyond.
 */
export function timeTicks(from: number, to: number): number[] {
  const span = to - from;
  const minutes = span <= 2 * 3_600_000 ? 15 : span <= 8 * 3_600_000 ? 60 : 360;
  const tick = new Date(from);
  tick.setSeconds(0, 0);
  if (minutes < 60) tick.setMinutes(Math.ceil(tick.getMinutes() / minutes) * minutes);
  else {
    if (tick.getMinutes() > 0) tick.setHours(tick.getHours() + 1, 0);
    const hours = minutes / 60;
    tick.setHours(Math.ceil(tick.getHours() / hours) * hours, 0);
  }
  const ticks: number[] = [];
  for (let at = tick.getTime(); at <= to && ticks.length < 12; at += minutes * 60_000) ticks.push(at);
  return ticks;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight UTC of a UTC day written as 2026-09-16. */
export const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The UTC day of a moment, as 2026-09-16. */
export const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** "16 Sep", with the year when it is not the current one: "16 Sep 2025". */
export function dayMonth(iso: string, now = Date.now()): string {
  const date = new Date(utcDay(iso));
  const year = date.getUTCFullYear() === new Date(now).getUTCFullYear() ? '' : ` ${date.getUTCFullYear()}`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${year}`;
}

/** A UTC day in full: "Tue 16 Sep" (or "Tue 16 Sep 2025" in another year). */
export const dayLabel = (iso: string, now = Date.now()) =>
  `${WEEKDAYS[new Date(utcDay(iso)).getUTCDay()]} ${dayMonth(iso, now)}`;

/** A week named by its Monday: "Week of 15 Sep". */
export const weekLabel = (iso: string, now = Date.now()) => `Week of ${dayMonth(iso, now)}`;

/** A month named by its first day: "September 2026". */
export const monthLabel = (iso: string) => {
  const date = new Date(utcDay(iso));
  return `${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(date)} ${date.getUTCFullYear()}`;
};

/**
 * Which of a run of UTC days, or of weeks named by their Monday, to label on a
 * chart's axis, given the width each one has: every one when there is room,
 * otherwise every other one, Mondays, every other Monday, or the first of each
 * month, quarter or year, whichever first keeps the labels clear of each
 * other. Alternate labels are counted back from the latest, so the latest is
 * labelled. Days read "16 Sep"; months by name, with the year on January and
 * on the first month labelled.
 */
export function dateAxis(
  days: string[],
  band: number,
  unit: 'day' | 'week' | 'month' = 'day',
): (index: number) => string | null {
  const fits = (every: number, characters = 7) => every * band >= characters * 6.2 + 14;
  const dates = days.map((day) => new Date(utcDay(day)));
  const back = (i: number) => days.length - 1 - i;
  // A day in an earlier year than the chart's latest says which.
  const latest = days.length ? utcDay(days.at(-1)!) : Date.now();
  const label = (i: number) => dayMonth(days[i]!, latest);
  if (unit === 'month') {
    // Every month by name when it fits, else every quarter or year; the year on January and the first.
    const every = fits(1, 3.5) ? 1 : fits(3, 8) ? 3 : 12;
    const first = dates.findIndex((date) => date.getUTCMonth() % every === 0);
    return (i) => {
      const date = dates[i]!;
      if (date.getUTCMonth() % every) return null;
      const month = MONTHS[date.getUTCMonth()]!;
      return date.getUTCMonth() === 0 || i === first ? `${month} ${date.getUTCFullYear()}` : month;
    };
  }
  if (fits(1)) return label;
  if (fits(2)) return (i) => (back(i) % 2 === 0 ? label(i) : null);
  if (unit === 'day' && fits(7)) return (i) => (dates[i]!.getUTCDay() === 1 ? label(i) : null);
  if (unit === 'day' && fits(14)) {
    const lastMonday = dates.findLastIndex((date) => date.getUTCDay() === 1);
    return (i) => (dates[i]!.getUTCDay() === 1 && ((lastMonday - i) / 7) % 2 === 0 ? label(i) : null);
  }
  const perMonth = unit === 'day' ? 30.4 : 4.35;
  const months = fits(perMonth, 8) ? 1 : fits(3 * perMonth, 8) ? 3 : 12;
  // A day opens its month on the 1st; a week, when its Monday is among the month's first seven days.
  const opens = (i: number) =>
    (unit === 'day' ? dates[i]!.getUTCDate() === 1 : dates[i]!.getUTCDate() <= 7) &&
    dates[i]!.getUTCMonth() % months === 0;
  const first = days.findIndex((_, i) => opens(i));
  return (i) => {
    if (!opens(i)) return null;
    const date = dates[i]!;
    return date.getUTCMonth() === 0 || i === first
      ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
      : MONTHS[date.getUTCMonth()]!;
  };
}

/** A change against an earlier value, as a signed share: "+12%", "−8%", or null when there is nothing to compare. */
export function change(now: number, before: number | null | undefined): string | null {
  if (before === null || before === undefined || before === 0) return null;
  const share = ((now - before) / before) * 100;
  const rounded = Math.abs(share) >= 10 ? Math.round(share) : Math.round(share * 10) / 10;
  return rounded === 0 ? '±0%' : `${rounded > 0 ? '+' : '−'}${numberFormat.format(Math.abs(rounded))}%`;
}

/** A difference in percentage points: "+2.5 pts", "−1 pt". */
export function points(now: number, before: number | null | undefined): string | null {
  if (before === null || before === undefined) return null;
  const delta = Math.round((now - before) * 10) / 10;
  if (delta === 0) return '±0 pts';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pt${Math.abs(delta) === 1 ? '' : 's'}`;
}

/** Minutes as "38 min" or "1 h 12 min". */
export function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const total = Math.round(value);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h${total % 60 ? ` ${total % 60} min` : ''}`;
}

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
