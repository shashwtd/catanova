import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { Hand } from '../../../packages/rules/src/game.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import {
  AwardPresentationQueue,
  committedRoll,
  deriveFeedback,
  RollPresentationTracker,
} from './feedback.js';
import type { AwardCelebration, FeedbackEvent } from './feedback.js';
import { SoundEngine } from './sound.js';
import type { SoundCue } from './sound.js';
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
/** A new piece's flash in GameEffects: one frame, an 80 ms delay and 480 ms of brightening. */
export const PIECE_FLASH_MS = 600;
export function presentationHold(
  event: Pick<FeedbackEvent, 'dice' | 'flights'> & { sites?: readonly string[] },
  reduced = false,
) {
  if (reduced) return 0;
  return Math.max(
    event.dice ? DICE_READABLE_MS : 0,
    // The next event cancels this one's flashes, so a new piece keeps the stage until it has lit.
    event.sites?.length ? PIECE_FLASH_MS : 0,
    event.flights.length
      ? resourceFlightStart(!!event.dice, event.flights.length - 1) + RESOURCE_FLIGHT_MS + 80
      : 120,
  );
}
type PendingPresentation = { previous: RoomState; next: RoomState; me: string };
/** `settled`: a throw inside this range was overtaken by a newer one and is not thrown again. */
export type Presentation = PendingPresentation & { settled?: boolean };
/**
 * Two snapshot references bound a burst regardless of how many moves it contains.
 * The buffer also remembers where the newest roll in the burst begins, so the burst
 * plays in order: the moves made before that roll, the roll, then what followed it.
 */
export class PresentationBuffer {
  private active: { until: number } | null = null;
  private pending: (PendingPresentation & { roll?: { before: RoomState; after: RoomState } }) | null = null;
  private presented: RoomState | null = null;
  begin(after: RoomState, until: number) {
    this.active = { until };
    this.presented = after;
  }
  observe(after: RoomState) {
    this.reset();
    this.presented = after;
  }
  /** A queued roll must not be seen, or acted on, before its throw. */
  get rollWaiting() {
    return !!this.pending?.roll;
  }
  offer(previous: RoomState, next: RoomState, me: string, now: number): Presentation | null {
    // A retry may supply an overlapping range. Start after the last presented
    // snapshot so production cannot replay, while newer builds/trades still show.
    const baseline = this.presented?.roomId === next.roomId ? this.presented : previous;
    const latest = this.pending?.next ?? baseline;
    if (next.revision <= latest.revision) return null;
    const before = previous.revision > latest.revision ? previous : latest;
    const roll = committedRoll(before, next) ? { before, after: next } : this.pending?.roll;
    this.pending = { previous: this.pending?.previous ?? baseline, next, me, ...(roll ? { roll } : {}) };
    if (this.active && now < this.active.until) return null;
    return this.take();
  }
  /** The next part of the queued burst; any later part waits for this one to finish. */
  take(): Presentation | null {
    this.active = null;
    const range = this.pending;
    if (!range) return null;
    const { previous, next, me, roll } = range;
    if (roll && roll.before.revision > previous.revision) {
      this.pending = { ...range, previous: roll.before };
      return { previous, next: roll.before, me, settled: true };
    }
    this.pending = roll && roll.after.revision < next.revision ? { previous: roll.after, next, me } : null;
    return { previous, next: roll?.after ?? next, me };
  }
  reset() {
    this.active = null;
    this.pending = null;
    this.presented = null;
  }
}
/** Real timers in the browser; tests pass a virtual clock. */
export type PresentationClock = {
  now(): number;
  setTimeout(run: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
};
const browserClock: PresentationClock = {
  now: () => performance.now(),
  setTimeout: (run, delay) => setTimeout(run, delay),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
/** What the table shows while effects play. Commands, persistence and deadlines use the live room. */
export type PresentationView = {
  event: FeedbackEvent | null;
  hand: Hand | null;
  pulse: Partial<Record<Resource, string>>;
  /** Dice are in the air or being read. */
  rolling: boolean;
  /** Rolling, or a roll is queued: live-room controls would give its result away. */
  busy: boolean;
  /** The snapshot the board draws; null draws the live room. */
  board: RoomState | null;
};
const NO_PULSE: PresentationView['pulse'] = {};
export const IDLE_PRESENTATION: PresentationView = {
  event: null,
  hand: null,
  pulse: NO_PULSE,
  rolling: false,
  busy: false,
  board: null,
};
/**
 * Plays accepted snapshots one presentation at a time. The board advances only when
 * a presentation begins, so it never draws a state older than one it has shown, and
 * every piece, robber move and build sound appears together, in the order played.
 */
export class FeedbackPresenter {
  private readonly buffer = new PresentationBuffer();
  private readonly rolls = new RollPresentationTracker();
  private readonly timers = new Set<unknown>();
  private view = IDLE_PRESENTATION;
  constructor(
    private readonly output: {
      view: (view: PresentationView) => void;
      sound: (cue: SoundCue) => void;
      reducedMotion: () => boolean;
    },
    private readonly clock: PresentationClock = browserClock,
  ) {}
  /** Welcome snapshots, hidden tabs and room changes show the current state without replaying it. */
  observe(previous: RoomState | null, next: RoomState, me: string) {
    this.stop();
    this.buffer.observe(next);
    this.rolls.observe(previous, next);
    const hand = next.game?.players.find((p) => p.id === me)?.hand;
    this.update({ ...IDLE_PRESENTATION, hand: hand ? { ...hand } : null });
  }
  offer(previous: RoomState, next: RoomState, me: string) {
    const ready = this.buffer.offer(previous, next, me, this.clock.now());
    if (ready) this.present(ready);
    else this.update({ busy: this.view.rolling || this.buffer.rollWaiting });
  }
  /** Drop transient presentation and show the live room and hand. */
  clear() {
    this.stop();
    this.buffer.reset();
    this.update(IDLE_PRESENTATION);
  }
  reset() {
    this.clear();
    this.rolls.reset();
  }
  /** Cancel scheduled work without publishing anything, for teardown. */
  stop() {
    for (const timer of this.timers) this.clock.clearTimeout(timer);
    this.timers.clear();
  }
  private schedule(run: () => void, delay: number) {
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, delay);
    this.timers.add(timer);
  }
  private update(patch: Partial<PresentationView>) {
    const keys = Object.keys(patch) as (keyof PresentationView)[];
    if (keys.every((key) => Object.is(patch[key], this.view[key]))) return;
    this.view = { ...this.view, ...patch };
    this.output.view(this.view);
  }
  private present({ previous, next, me, settled }: Presentation) {
    const derived = deriveFeedback(previous, next, me);
    if (!derived) {
      // Only a room without a game gets here: there is nothing to play or hold.
      this.clear();
      return;
    }
    const nextEvent = this.rolls.accept(derived, !settled);
    this.stop();
    const reduced = this.output.reducedMotion();
    const throwing = !!nextEvent.dice && !reduced;
    const delay = throwing ? PRODUCTION_DELAY_MS : 0;
    const hold = presentationHold(nextEvent, reduced);
    this.buffer.begin(next, this.clock.now() + hold);
    // A throw holds the board on the snapshot right before it until its faces are readable.
    const view: Partial<PresentationView> = {
      event: nextEvent,
      pulse: NO_PULSE,
      rolling: throwing,
      busy: throwing || this.buffer.rollWaiting,
      board: throwing ? previous : next,
    };
    if (throwing)
      this.schedule(
        () => this.update({ rolling: false, busy: this.buffer.rollWaiting, board: next }),
        DICE_READABLE_MS,
      );
    const hasOwnTransfer = nextEvent.flights.some(
      (f) => f.from.startsWith('[data-resource-card=') || f.to.startsWith('[data-resource-card='),
    );
    if (!hasOwnTransfer || reduced) view.hand = nextEvent.hand;
    else {
      view.hand = previous.game!.players.find((p) => p.id === me)?.hand ?? nextEvent.hand;
      for (const resource of nextEvent.changed)
        this.schedule(
          () =>
            this.update({
              hand: { ...(this.view.hand ?? nextEvent.hand), [resource]: nextEvent.hand[resource] },
              pulse: { ...this.view.pulse, [resource]: nextEvent.id },
            }),
          resourceCardArrival(nextEvent, resource),
        );
    }
    this.update(view);
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
      this.schedule(() => this.output.sound(cue), at);
    }
    this.schedule(() => {
      const queued = this.buffer.take();
      if (queued) this.present(queued);
    }, hold);
    this.schedule(
      () => this.update({ event: null }),
      Math.max(hold + PROFILE_GAIN_DWELL_MS, nextEvent.cardPlay ? 3800 : 3200),
    );
  }
}
export function useFeedback(preferences: Preferences, reducedMotion: boolean) {
  const config = useRef({ preferences, reducedMotion });
  config.current = { preferences, reducedMotion };
  const [sound] = useState(() => new SoundEngine(() => config.current.preferences));
  const [view, setView] = useState(IDLE_PRESENTATION);
  const [presenter] = useState(
    () =>
      new FeedbackPresenter({
        view: setView,
        sound: (cue) => sound.play(cue),
        reducedMotion: () => config.current.reducedMotion,
      }),
  );
  const [awards, setAwards] = useState<readonly AwardCelebration[]>([]);
  const awardQueue = useRef(new AwardPresentationQueue());
  const clearAwards = useCallback(() => {
    awardQueue.current.reset();
    setAwards([]);
  }, []);
  const finishAward = useCallback((id: string) => setAwards(awardQueue.current.finish(id)), []);
  const announceAward = useCallback(() => sound.play('award'), [sound]);
  const last = useRef('');
  const reset = useCallback(
    (keepMusic = false) => {
      presenter.reset();
      clearAwards();
      last.current = '';
      if (keepMusic) sound.resetEffects();
      else sound.silence();
    },
    [presenter, clearAwards, sound],
  );
  useEffect(() => {
    sound.refresh();
    if (reducedMotion) presenter.clear();
  }, [
    preferences.sound,
    preferences.volume,
    preferences.music,
    preferences.musicVolume,
    reducedMotion,
    sound,
    presenter,
  ]);
  useEffect(() => {
    const unlock = () => void sound.unlock();
    const hide = () => {
      if (document.hidden) {
        presenter.clear();
        clearAwards();
        sound.silence();
      } else sound.refresh();
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', hide);
      presenter.stop();
      sound.dispose();
    };
  }, [sound, presenter, clearAwards]);
  const accept = useCallback(
    (previous: RoomState | null, next: RoomState, me: string, welcome = false) => {
      const baseline = welcome || !previous?.game || previous.roomId !== next.roomId;
      if (baseline || document.hidden) {
        presenter.observe(previous, next, me);
        setAwards(awardQueue.current.observe(previous, next, false));
        // Hiding already silenced ambience. Later background snapshots must not cut
        // short the separate, deduplicated turn/required-action attention cue.
        if (baseline) {
          sound.resetEffects();
          if (!document.hidden) sound.refresh();
        }
        last.current = `${next.roomId}:${next.revision}`;
        return;
      }
      if (next.revision <= previous.revision || last.current === `${next.roomId}:${next.revision}`) return;
      last.current = `${next.roomId}:${next.revision}`;
      setAwards(awardQueue.current.observe(previous, next));
      presenter.offer(previous, next, me);
    },
    [presenter, sound],
  );
  const shownAwards = useMemo(() => celebrationsShown(awards, view.board), [awards, view.board]);
  return {
    event: view.event,
    hand: view.hand,
    pulse: view.pulse,
    sound,
    accept,
    reset,
    presentationBusy: view.busy,
    rolling: view.rolling,
    board: view.board,
    awards: shownAwards,
    finishAward,
    announceAward,
  };
}

/** A celebration waits until the board shows the move that earned it. */
export function celebrationsShown(awards: readonly AwardCelebration[], board: RoomState | null) {
  const waiting = board ? awards.findIndex((award) => award.revision > board.revision) : -1;
  return waiting < 0 ? awards : awards.slice(0, waiting);
}
/** Only the visible board follows the presentation. Commands, persistence and deadlines use the live room. */
export function dicePresentationGame(live: RoomState, presented: RoomState | null) {
  if (!presented?.game || presented.roomId !== live.roomId || (presented.round ?? 0) !== (live.round ?? 0))
    return live.game;
  return presented.game;
}
