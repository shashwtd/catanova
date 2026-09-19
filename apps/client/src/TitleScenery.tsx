import type { CSSProperties } from 'react';

/**
 * The scenery behind the entry screen, as a slow crossfade rather than one still.
 *
 * The first slide is the stylesheet's own background and is never an element
 * here: it is already painted before this component renders, so the opening
 * frame has nothing fading in over an empty screen, and the wrap at the end of
 * the cycle lands back on it invisibly. Every later slide is one layer that
 * fades up over it in turn.
 *
 * The keyframes are written out here rather than in the stylesheet because the
 * window a slide is opaque for is one nth of the cycle, and CSS keyframe
 * selectors cannot do arithmetic. Adding a picture to the list below is enough;
 * nothing else needs to change.
 */
export const SLIDE_HOLD_SECONDS = 7;
export const SLIDE_FADE_SECONDS = 1.6;

export const TITLE_SLIDES = [
  {
    src: '/art/optimized/title-landscape.05db8101ac33.webp',
    alt: 'A painted island coast of forests, fields and hills under a bright sky.',
  },
  {
    src: '/art/optimized/title-board.a80caa7a5cac.webp',
    alt: 'The hex island mid-game on a wooden table, with roads, settlements, resource cards and dice.',
  },
  {
    src: '/art/optimized/title-harbour.67cc2ec379af.webp',
    alt: 'A harbour at golden hour: a jetty stacked with goods, a moored sailing boat, clear water.',
  },
  {
    src: '/art/optimized/title-table-dusk.e18276f97f37.webp',
    alt: 'The table after dark under hanging lanterns, with resource cards, dice and pieces.',
  },
] as const;

export function sceneryKeyframes(count: number) {
  const cycle = count * SLIDE_HOLD_SECONDS;
  const at = (seconds: number) => `${((seconds / cycle) * 100).toFixed(3)}%`;
  return `@keyframes title-scenery-slide{0%{opacity:0}${at(SLIDE_FADE_SECONDS)}{opacity:1}${at(SLIDE_HOLD_SECONDS)}{opacity:1}${at(SLIDE_HOLD_SECONDS + SLIDE_FADE_SECONDS)}{opacity:0}100%{opacity:0}}`;
}

export function TitleScenery() {
  const slides = TITLE_SLIDES;
  // One picture is not a slideshow: the stylesheet's background is the whole of
  // it, and no animation runs.
  if (slides.length < 2) return <div className="title-scenery" aria-hidden="true" />;
  return (
    <div
      className="title-scenery"
      aria-hidden="true"
      style={{ '--scenery-cycle': `${slides.length * SLIDE_HOLD_SECONDS}s` } as CSSProperties}
    >
      <style>{sceneryKeyframes(slides.length)}</style>
      {slides.slice(1).map((slide, index) => (
        <img
          key={slide.src}
          src={slide.src}
          alt=""
          width="1672"
          height="941"
          decoding="async"
          // Nobody sees these for seven seconds. They must never compete with
          // the wordmark, the menu, or the first slide behind them.
          fetchPriority="low"
          style={{ animationDelay: `${(index + 1) * SLIDE_HOLD_SECONDS}s` }}
        />
      ))}
    </div>
  );
}
