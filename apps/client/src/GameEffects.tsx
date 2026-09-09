import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { ResourceIcon } from './Board.js';
import { DevelopmentArt } from './DevelopmentCards.js';
import { DiceThrow } from './DiceThrow.js';
import type { FeedbackEvent, FlightIntent } from './feedback.js';
import { resourceFlightStart, RESOURCE_FLIGHT_MS } from './useFeedback.js';
type Flight = FlightIntent & { key: string; x: number; y: number; dx: number; dy: number; delay: number };
export function GameEffects({
  event,
  reducedMotion,
  activity,
}: {
  event: FeedbackEvent | null;
  reducedMotion: boolean;
  activity: boolean;
}) {
  const [flights, setFlights] = useState<Flight[]>([]),
    [diceVisible, setDiceVisible] = useState(false);
  useEffect(() => {
    setFlights([]);
    setDiceVisible(!!event?.dice);
    if (!event || reducedMotion) return;
    let cancelled = false;
    const animations: Animation[] = [];
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
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
        const id = svg.getAttribute('data-building-id') ?? svg.getAttribute('data-road-id'),
          isRoad = svg.hasAttribute('data-road-id');
        const target = document.querySelector(`[data-piece-${isRoad ? 'road' : 'building'}="${id}"]`) ?? svg;
        // A filter on a preserve-3d ancestor flattens its entire mesh. Animate only
        // leaf faces (or individual SVG shapes in the flat fallback).
        const leaves = target.querySelectorAll(target === svg ? 'path,rect,ellipse,circle' : '.piece3d-face');
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
    };
  }, [event?.id, reducedMotion]);
  const notice = event?.notices.find((s) => /played |wins |claimed /.test(s)) ?? event?.notices[0];
  return (
    <>
      {event?.dice && diceVisible && (
        <DiceThrow
          key={event.id}
          id={event.id}
          dice={event.dice}
          reducedMotion={reducedMotion}
          onComplete={() => setDiceVisible(false)}
        />
      )}
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
