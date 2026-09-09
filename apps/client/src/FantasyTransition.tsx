import { useEffect, useId, useRef } from 'react';
import type { CSSProperties } from 'react';

export const FANTASY_TRANSITION_MS = 760;
export const FANTASY_REDUCED_MS = 160;

/** A brief cloud curtain for a newly started match; no timers survive unmount. */
export function FantasyTransition({
  id,
  onComplete,
  reducedMotion = false,
}: {
  id: string;
  onComplete?: () => void;
  reducedMotion?: boolean;
}) {
  const paintId = useId().replaceAll(':', '');
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    const quiet = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => complete.current?.(),
      quiet ? FANTASY_REDUCED_MS : FANTASY_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, reducedMotion]);
  return (
    <div
      key={id}
      className={`fantasy-transition ${reducedMotion ? 'fantasy-transition-reduced' : ''}`}
      aria-hidden="true"
      data-transition-id={id}
      style={{ '--fantasy-duration': `${FANTASY_TRANSITION_MS}ms` } as CSSProperties}
    >
      <div className="fantasy-mist" />
      {[0, 1].map((side) => (
        <svg
          key={side}
          className={`fantasy-clouds fantasy-clouds-${side}`}
          viewBox="0 0 700 900"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`${paintId}-cloud-${side}`} x1="0" x2="1" y1="0" y2=".9">
              <stop offset="0" stopColor="#e2ebe2" />
              <stop offset=".4" stopColor="#f7efd9" />
              <stop offset="1" stopColor="#d6e2da" />
            </linearGradient>
          </defs>
          <g transform={side ? 'translate(700 0) scale(-1 1)' : undefined}>
            <path
              fill={`url(#${paintId}-cloud-${side})`}
              d="M0 0H636C693 71 647 132 608 148C685 174 706 248 655 293C704 341 685 419 632 437C700 483 718 557 657 598C700 641 671 720 620 727C697 780 674 853 624 900H0Z"
            />
            <path
              className="fantasy-cloud-stroke"
              d="M403 66C512 13 600 79 576 142M425 259C523 190 614 251 599 305M380 491C477 406 595 449 592 510M398 739C509 682 608 742 588 798"
            />
            <path
              className="fantasy-cloud-brush"
              d="M194 111C360 41 490 89 513 167M133 325C307 250 458 285 502 370M203 605C351 528 488 578 514 633M82 813C253 735 423 777 467 864"
            />
          </g>
        </svg>
      ))}
      <svg className="fantasy-compass" viewBox="0 0 100 100">
        <path d="M50 5L57 39L83 17L61 43L95 50L61 57L83 83L57 61L50 95L43 61L17 83L39 57L5 50L39 43L17 17L43 39Z" />
        <circle cx="50" cy="50" r="13" />
      </svg>
    </div>
  );
}
