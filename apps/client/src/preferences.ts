import { useEffect, useState } from 'react';
export type Preferences = { sound: boolean; volume: number };
export const DEFAULT_PREFERENCES: Preferences = { sound: true, volume: 0.55 };
/** Ignore retired display options so old saved settings cannot hide gameplay feedback. */
export function parsePreferences(input: unknown): Preferences {
  const p = input && typeof input === 'object' ? (input as Partial<Preferences>) : {};
  return {
    sound: typeof p.sound === 'boolean' ? p.sound : true,
    volume:
      typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 0.55,
  };
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(() => {
    try {
      return parsePreferences(JSON.parse(localStorage.getItem('catanova.preferences') ?? 'null'));
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });
  const [osReduced, setOsReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setOsReduced(q.matches);
    q.addEventListener('change', change);
    return () => q.removeEventListener('change', change);
  }, []);
  function update(patch: Partial<Preferences>) {
    setPreferences((current) => {
      const next = parsePreferences({ ...current, ...patch });
      try {
        localStorage.setItem('catanova.preferences', JSON.stringify(next));
      } catch {
        /* Preferences still work in memory when storage is unavailable. */
      }
      return next;
    });
  }
  return { preferences, update, reducedMotion: osReduced };
}
