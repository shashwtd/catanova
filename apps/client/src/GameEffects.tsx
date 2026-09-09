import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sparkles } from './GameIcons.js';
import { ResourceIcon } from './Board.js';
import { DevelopmentArt } from './DevelopmentCards.js';
import { DiceThrow } from './DiceThrow.js';
import type { FeedbackEvent, FlightIntent } from './feedback.js';
import { resourceFlightStart, RESOURCE_FLIGHT_MS, PROFILE_GAIN_DWELL_MS } from './useFeedback.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
type Flight = FlightIntent & { key: string; x: number; y: number; dx: number; dy: number; delay: number };
type GainBadge = { playerId: string; key: string; left: number; top: number; gains: FeedbackEvent['gains'] };
type DicePresentation = { id: string; faces: readonly [number, number]; initiallyDocked: boolean };
/** A resync can restore the result, but must never replay its old throw. */
export function nextDicePresentation(
  current: DicePresentation | null,
  event: FeedbackEvent | null,
  lastDice?: readonly [number, number] | null,
): DicePresentation | null {
  const restored = lastDice
    ? { id: `restored:${lastDice.join('-')}`, faces: lastDice, initiallyDocked: true }
    : null;
  if (!event) return restored;
  if (event.dice) return { id: event.id, faces: event.dice, initiallyDocked: false };
  if (lastDice && (!current || current.faces[0] !== lastDice[0] || current.faces[1] !== lastDice[1]))
    return restored;
  return current;
}
export function profileGainArrival(event: FeedbackEvent, playerId: string) {
  const direct = event.flights.flatMap((flight, index) =>
    flight.to === `[data-player-profile="${playerId}"]` ? [index] : [],
  );
  const own = event.flights.flatMap((flight, index) =>
    !flight.spending &&
    flight.to.startsWith('[data-resource-card=') &&
    event.gains.some((gain) => gain.playerId === playerId && gain.resource === flight.resource)
      ? [index]
      : [],
  );
  const indices = direct.length ? direct : own;
  return indices.length ? resourceFlightStart(!!event.dice, Math.max(...indices)) + RESOURCE_FLIGHT_MS : 0;
}
export function GameEffects({
  event,
  reducedMotion,
  activity,
  lastDice,
}: {
  event: FeedbackEvent | null;
  reducedMotion: boolean;
  activity: boolean;
  lastDice?: readonly [number, number] | null;
}) {
  const [flights, setFlights] = useState<Flight[]>([]),
    [badges, setBadges] = useState<GainBadge[]>([]);
  const [dice, setDice] = useState<DicePresentation | null>(() => nextDicePresentation(null, null, lastDice));
  const badgeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const timer of badgeTimers.current.values()) clearTimeout(timer);
    },
    [],
  );
  useEffect(() => {
    setDice((current) => nextDicePresentation(current, event, lastDice));
  }, [event?.id, lastDice?.[0], lastDice?.[1]]);
  useEffect(() => {
    setFlights([]);
    if (!event || document.hidden) {
      for (const timer of badgeTimers.current.values()) clearTimeout(timer);
      badgeTimers.current.clear();
      setBadges([]);
      return;
    }
    let cancelled = false;
    const animations: Animation[] = [];
    const gainTimers: ReturnType<typeof setTimeout>[] = [];
    for (const playerId of new Set(event.gains.map((gain) => gain.playerId))) {
      gainTimers.push(
        setTimeout(
          () => {
            const box = document
              .querySelector(`[data-player-profile="${playerId}"]`)
              ?.getBoundingClientRect();
            if (cancelled || !box) return;
            const badge = {
              playerId,
              key: `${event.id}:${playerId}`,
              left: Math.max(120, box.left - 8),
              top: box.top + Math.min(box.height / 2, 38),
              gains: event.gains.filter((gain) => gain.playerId === playerId),
            };
            setBadges((current) =>
              [...current.filter((item) => item.playerId !== playerId), badge].slice(-4),
            );
            clearTimeout(badgeTimers.current.get(playerId));
            badgeTimers.current.set(
              playerId,
              setTimeout(() => {
                setBadges((current) => current.filter((item) => item.key !== badge.key));
                badgeTimers.current.delete(playerId);
              }, PROFILE_GAIN_DWELL_MS),
            );
          },
          reducedMotion ? 0 : profileGainArrival(event, playerId),
        ),
      );
    }
    const frame = requestAnimationFrame(() => {
      if (cancelled || reducedMotion) return;
      const center = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box && box.width && box.height
          ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
          : null;
      };
      const result = event.flights.flatMap((flight, i) => {
        const from = center(flight.from),
          to = center(flight.to);
        if (!from || !to) return [];
        return [
          {
            ...flight,
            key: `${event.id}-${i}`,
            x: from.x,
            y: from.y,
            dx: to.x - from.x,
            dy: to.y - from.y,
            delay: resourceFlightStart(!!event.dice, i),
          },
        ];
      });
      setFlights(result);
      for (const site of event.sites) {
        const svg = document.querySelector(site);
        if (!svg) continue;
        const leaves = svg.querySelectorAll('path,rect,ellipse,circle,polygon');
        for (const face of Array.from(leaves))
          if (typeof face.animate === 'function')
            animations.push(
              face.animate([{ filter: 'brightness(1.65)' }, { filter: 'brightness(1)' }], {
                duration: 480,
                delay: 80,
                easing: 'ease-out',
              }),
            );
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      animations.forEach((a) => a.cancel());
      gainTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [event?.id, reducedMotion]);
  const notice = event?.notices.find((s) => /played |wins |claimed /.test(s)) ?? event?.notices[0];
  return (
    <>
      {dice && (
        <DiceThrow
          key={dice.id}
          id={dice.id}
          dice={dice.faces}
          initiallyDocked={dice.initiallyDocked}
          reducedMotion={reducedMotion}
        />
      )}
      <div className="profile-gain-layer" aria-hidden="true">
        {badges.map((badge) => (
          <div
            key={badge.key}
            className={`profile-gain-badge ${reducedMotion ? 'gain-static' : ''}`}
            style={{ left: badge.left, top: badge.top }}
          >
            {badge.gains.map((gain) => (
              <span
                key={gain.resource}
                title={gain.resource === 'any' ? 'Resource cards' : RESOURCE_NAMES[gain.resource]}
              >
                {gain.resource === 'any' ? (
                  <DevelopmentArt kind="back" />
                ) : (
                  <ResourceIcon resource={gain.resource} />
                )}
                <b>+{gain.amount}</b>
              </span>
            ))}
          </div>
        ))}
      </div>
      {!reducedMotion && (
        <div className="resource-flights" aria-hidden="true">
          {flights.map((f) => (
            <div
              className={`flying-resource ${f.spending ? 'spent-resource' : ''}`}
              key={f.key}
              style={
                {
                  left: f.x,
                  top: f.y,
                  '--flight-x': `${f.dx}px`,
                  '--flight-y': `${f.dy}px`,
                  '--flight-delay': `${f.delay}ms`,
                  '--flight-duration': `${RESOURCE_FLIGHT_MS}ms`,
                } as CSSProperties
              }
            >
              <div className="mini-card">
                {f.resource === 'any' ? (
                  <DevelopmentArt kind="back" />
                ) : (
                  <ResourceIcon resource={f.resource} />
                )}
                <b>{f.amount > 1 ? f.amount : ''}</b>
              </div>
            </div>
          ))}
        </div>
      )}
      {event && notice && activity && (
        <div key={event.id} className="move-announcement" role="status">
          <Sparkles size={16} />
          <span>{notice}</span>
        </div>
      )}
    </>
  );
}
