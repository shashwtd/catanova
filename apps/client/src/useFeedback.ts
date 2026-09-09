import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { Hand } from '../../../packages/rules/src/game.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { deriveFeedback } from './feedback.js';
import type { FeedbackEvent } from './feedback.js';
import { SoundEngine } from './sound.js';
import type { Preferences } from './preferences.js';
import { DICE_ROLL_MS } from './DiceThrow.js';
// Dice finish their physical roll before the production wave travels to the hand.
export const PRODUCTION_DELAY_MS = DICE_ROLL_MS,
  RESOURCE_FLIGHT_MS = 700;
export const RESOURCE_STAGGER_MS = 22,
  MAX_RESOURCE_STAGGER = 5;
export const resourceFlightStart = (hasDice: boolean, index: number) =>
  (hasDice ? PRODUCTION_DELAY_MS : 0) +
  Math.min(Math.max(0, index), MAX_RESOURCE_STAGGER) * RESOURCE_STAGGER_MS;
export function resourceCardArrival(event: Pick<FeedbackEvent, 'dice' | 'flights'>, resource: Resource) {
  const indices = event.flights.flatMap((flight, index) => (flight.resource === resource ? [index] : []));
  return indices.length ? resourceFlightStart(!!event.dice, Math.max(...indices)) + RESOURCE_FLIGHT_MS : 0;
}
export function useFeedback(preferences: Preferences, reducedMotion: boolean) {
  const config = useRef({ preferences, reducedMotion });
  config.current = { preferences, reducedMotion };
  const [sound] = useState(() => new SoundEngine(() => config.current.preferences));
  const [event, setEvent] = useState<FeedbackEvent | null>(null),
    [hand, setHand] = useState<Hand | null>(null),
    [pulse, setPulse] = useState<Partial<Record<Resource, string>>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>()),
    last = useRef('');
  const schedule = (run: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, delay);
    timers.current.add(timer);
  };
  const clear = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    setEvent(null);
    setPulse({});
  }, []);
  const reset = useCallback(() => {
    clear();
    setHand(null);
    last.current = '';
    sound.silence();
  }, [clear, sound]);
  useEffect(() => {
    sound.refresh();
    if (reducedMotion) {
      clear();
      setHand(null);
    }
  }, [preferences.sound, preferences.volume, reducedMotion, sound, clear]);
  useEffect(() => {
    const unlock = () => void sound.unlock();
    const hide = () => {
      if (document.hidden) {
        clear();
        setHand(null);
        sound.silence();
      }
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', hide);
      for (const timer of timers.current) clearTimeout(timer);
      sound.dispose();
    };
  }, [sound, clear]);
  const accept = useCallback(
    (previous: RoomState | null, next: RoomState, me: string, welcome = false) => {
      const currentHand = next.game?.players.find((p) => p.id === me)?.hand;
      if (welcome || !previous?.game || document.hidden) {
        clear();
        setHand(currentHand ? { ...currentHand } : null);
        last.current = `${next.roomId}:${next.revision}`;
        return;
      }
      if (next.revision <= previous.revision || last.current === `${next.roomId}:${next.revision}`) return;
      const nextEvent = deriveFeedback(previous, next, me);
      if (!nextEvent) return;
      last.current = nextEvent.id;
      clear();
      setEvent(nextEvent);
      const reduced = config.current.reducedMotion;
      const delay = nextEvent.dice && !reduced ? PRODUCTION_DELAY_MS : 0;
      const hasOwnTransfer = nextEvent.flights.some((f) => f.resource !== 'any');
      if (!hasOwnTransfer || reduced) setHand(nextEvent.hand);
      else {
        setHand(previous.game.players.find((p) => p.id === me)?.hand ?? nextEvent.hand);
        for (const resource of nextEvent.changed)
          schedule(
            () => {
              setHand((current) => ({
                ...(current ?? nextEvent.hand),
                [resource]: nextEvent.hand[resource],
              }));
              setPulse((current) => ({ ...current, [resource]: nextEvent.id }));
            },
            resourceCardArrival(nextEvent, resource),
          );
      }
      const lastOwnArrival = Math.max(
        0,
        ...nextEvent.changed.map((resource) => resourceCardArrival(nextEvent, resource)),
      );
      for (const cue of nextEvent.sounds) {
        const at =
          cue === 'gain'
            ? reduced
              ? 0
              : Math.max(0, lastOwnArrival - 100)
            : cue === 'spend'
              ? 0
              : cue === 'dice'
                ? 0
                : nextEvent.dice
                  ? delay
                  : 90;
        schedule(() => sound.play(cue), at);
      }
      schedule(() => setEvent(null), Math.max(delay + RESOURCE_FLIGHT_MS + 500, 3200));
    },
    [clear, sound],
  );
  return { event, hand, pulse, sound, accept, reset };
}
