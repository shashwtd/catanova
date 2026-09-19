import type { CSSProperties } from 'react';

/**
 * The scenery behind the entry screen, as a slow crossfade rather than one still.
 *
 * Every slide is a layer over a base that carries the first image, so the first
 * paint is the first slide with nothing fading in over an empty screen, and the
 * wrap at the end of the cycle lands back on that same image invisibly.
 *
 * The keyframes are written out here rather than in the stylesheet because the
 * window a slide is visible for is one nth of the cycle, and CSS keyframe
 * selectors cannot do arithmetic. Adding a slide to the list below is enough;
 * nothing else needs to change.
 */
export const SLIDE_HOLD_SECONDS = 7;
export const SLIDE_FADE_SECONDS = 1.6;

export const TITLE_SLIDES = [
  {
    src: '/art/optimized/title-landscape.05db8101ac33.webp',
    alt: 'A painted island coast of forests, fields and hills under a bright sky.',
  },
] as const;

export function sceneryKeyframes(count: number) {
  const cycle = count * SLIDE_HOLD_SECONDS;
  const at = (seconds: number) => `${((seconds / cycle) * 100).toFixed(3)}%`;
  return `@keyframes title-scenery-slide{0%{opacity:0}${at(SLIDE_FADE_SECONDS)}{opacity:1}${at(SLIDE_HOLD_SECONDS)}{opacity:1}${at(SLIDE_HOLD_SECONDS + SLIDE_FADE_SECONDS)}{opacity:0}100%{opacity:0}}`;
}

export function TitleScenery() {
  const slides = TITLE_SLIDES;
  // One picture is not a slideshow: the stylesheet's own background is the
  // whole of it, and no animation runs.
  if (slides.length < 2) return <div className="title-scenery" aria-hidden="true" />;
  return (
    <div
      className="title-scenery"
      aria-hidden="true"
      style={{ '--scenery-cycle': `${slides.length * SLIDE_HOLD_SECONDS}s` } as CSSProperties}
    >
      <style>{sceneryKeyframes(slides.length)}</style>
      {slides.map((slide, index) => (
        <i
          key={slide.src}
          style={
            {
              backgroundImage: `url('${slide.src}')`,
              animationDelay: `${index * SLIDE_HOLD_SECONDS}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
