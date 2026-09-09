import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { Hand } from '../../../packages/rules/src/game.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { deriveFeedback } from './feedback.js';
import type { FeedbackEvent } from './feedback.js';
import { SoundEngine } from './sound.js';
import type { Preferences } from './preferences.js';
import { DICE_READABLE_MS } from './DiceThrow.js';
// Let everyone read the settled faces before any production leaves the island.
export const PRODUCTION_DELAY_MS = DICE_READABLE_MS,
  RESOURCE_FLIGHT_MS = 1000;
export const PROFILE_GAIN_DWELL_MS = 2200;
export const RESOURCE_STAGGER_MS = 40,
  MAX_RESOURCE_STAGGER = 5;
export const resourceFlightStart = (hasDice: boolean, index: number) =>
  (hasDice ? PRODUCTION_DELAY_MS : 0) +
  Math.min(Math.max(0, index), MAX_RESOURCE_STAGGER) * RESOURCE_STAGGER_MS;
export function resourceCardArrival(event: Pick<FeedbackEvent, 'dice' | 'flights'>, resource: Resource) {
  const indices = event.flights.flatMap((flight, index) =>
    flight.resource === resource && !flight.to.startsWith('[data-player-profile=') ? [index] : [],
  );
  return indices.length ? resourceFlightStart(!!event.dice, Math.max(...indices)) + RESOURCE_FLIGHT_MS : 0;
}
export function presentationHold(event: Pick<FeedbackEvent, 'dice' | 'flights'>, reduced = false) {
  if (reduced) return 0;
  return Math.max(
    event.dice ? DICE_READABLE_MS : 0,
    event.flights.length
      ? resourceFlightStart(!!event.dice, event.flights.length - 1) + RESOURCE_FLIGHT_MS + 80
      : 120,
  );
}
type PendingPresentation = { previous: RoomState; next: RoomState; me: string };
/** Two snapshot references bound a burst regardless of how many moves it contains. */
export class PresentationBuffer {
  private active: { until: number; after: RoomState } | null = null;
  private pending: PendingPresentation | null = null;
  begin(after: RoomState, until: number) {
    this.active = { after, until };
    this.pending = null;
  }
  offer(previous: RoomState, next: RoomState, me: string, now: number): PendingPresentation | null {
    if (this.active && now < this.active.until) {
      this.pending = { previous: this.pending?.previous ?? this.active.after, next, me };
      return null;
    }
    const result = { previous: this.pending?.previous ?? previous, next, me };
    this.pending = null;
    return result;
  }
  take() {
    const result = this.pending;
    this.pending = null;
    this.active = null;
    return result;
  }
  reset() {
    this.active = null;
    this.pending = null;
  }
}
export function useFeedback(preferences: Preferences, reducedMotion: boolean) {
  const config = useRef({ preferences, reducedMotion });
  config.current = { preferences, reducedMotion };
  const [sound] = useState(() => new SoundEngine(() => config.current.preferences));
  const [event, setEvent] = useState<FeedbackEvent | null>(null),
    [hand, setHand] = useState<Hand | null>(null),
    [pulse, setPulse] = useState<Partial<Record<Resource, string>>>({});
  const [presentationBusy, setPresentationBusy] = useState(false);
  const buffer = useRef(new PresentationBuffer());
  const present = useRef<(previous: RoomState, next: RoomState, me: string) => void>(() => {});
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
    buffer.current.reset();
    setPresentationBusy(false);
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
  present.current = (previous, next, me) => {
    const nextEvent = deriveFeedback(previous, next, me);
    if (!nextEvent) return;
    clear();
    setEvent(nextEvent);
    const reduced = config.current.reducedMotion;
    const delay = nextEvent.dice && !reduced ? PRODUCTION_DELAY_MS : 0;
    const hold = presentationHold(nextEvent, reduced);
    buffer.current.begin(next, performance.now() + hold);
    setPresentationBusy(!!nextEvent.dice && !reduced);
    if (nextEvent.dice && !reduced) schedule(() => setPresentationBusy(false), DICE_READABLE_MS);
    const hasOwnTransfer = nextEvent.flights.some(
      (f) => f.from.startsWith('[data-resource-card=') || f.to.startsWith('[data-resource-card='),
    );
    if (!hasOwnTransfer || reduced) setHand(nextEvent.hand);
    else {
      setHand(previous.game!.players.find((p) => p.id === me)?.hand ?? nextEvent.hand);
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
    const gainArrival = Math.max(
      lastOwnArrival,
      ...nextEvent.flights.map((flight, index) =>
        !flight.spending ? resourceFlightStart(!!nextEvent.dice, index) + RESOURCE_FLIGHT_MS : 0,
      ),
    );
    for (const cue of nextEvent.sounds) {
      const at =
        cue === 'gain'
          ? reduced
            ? 0
            : Math.max(0, gainArrival - 100)
          : cue === 'spend'
            ? 0
            : cue === 'dice'
              ? 0
              : nextEvent.dice
                ? delay
                : 90;
      schedule(() => sound.play(cue), at);
    }
    schedule(() => {
      const queued = buffer.current.take();
      if (queued) present.current(queued.previous, queued.next, queued.me);
    }, hold);
    schedule(() => setEvent(null), Math.max(hold + PROFILE_GAIN_DWELL_MS, 3200));
  };
  const accept = useCallback(
    (previous: RoomState | null, next: RoomState, me: string, welcome = false) => {
      const currentHand = next.game?.players.find((p) => p.id === me)?.hand;
      if (welcome || !previous?.game || document.hidden) {
        clear();
        sound.silence();
        setHand(currentHand ? { ...currentHand } : null);
        last.current = `${next.roomId}:${next.revision}`;
        return;
      }
      if (next.revision <= previous.revision || last.current === `${next.roomId}:${next.revision}`) return;
      last.current = `${next.roomId}:${next.revision}`;
      const ready = buffer.current.offer(previous, next, me, performance.now());
      if (ready) present.current(ready.previous, ready.next, ready.me);
    },
    [clear, sound],
  );
  return { event, hand, pulse, sound, accept, reset, presentationBusy };
}
