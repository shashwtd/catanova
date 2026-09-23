import type { CSSProperties } from 'react';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import { ArrowRight, Exchange } from './GameIcons.js';
import { BOARD_THEMES } from './board-theme.js';

/**
 * The six small pictures below the fold, cut out of the game's art in advance.
 *
 * The game draws avatars and resources from two whole atlases, 860 KB between
 * them, and an inline SVG image downloads eagerly, so a first visit used to
 * pay for all of it to show four faces and two resources. These are the same
 * crops at twice their largest display size, loaded only as they approach the
 * viewport. How they were made: docs/art/RUNTIME.md, "Landing thumbnails".
 */
const LANDING_AVATARS = [
  ['Fern', '/art/optimized/landing-avatar-0.e2df3fd346a0.webp'],
  ['Moss', '/art/optimized/landing-avatar-1.eca9a26781c1.webp'],
  ['Pip', '/art/optimized/landing-avatar-3.028c962ae3c7.webp'],
  ['Oak', '/art/optimized/landing-avatar-5.5a2f5a7641f3.webp'],
] as const;
const LANDING_RESOURCES = {
  wood: '/art/optimized/landing-timber.fce8cddc0b3d.webp',
  ore: '/art/optimized/landing-rock.52e98dbe36d0.webp',
} as const;

function LandingResource({ resource }: { resource: keyof typeof LANDING_RESOURCES }) {
  return (
    <img
      className="feature-resource"
      src={LANDING_RESOURCES[resource]}
      alt={RESOURCE_NAMES[resource]}
      width="72"
      height="72"
      loading="lazy"
      decoding="async"
    />
  );
}

/** Small, non-interactive examples reuse the actual game art; no game loop or canvas. */
export function LandingFeatures({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="landing-features" aria-label="Discover Catanova">
      <section className="landing-feature">
        <div className="feature-copy">
          <span className="feature-eyebrow">Your people. Your island.</span>
          <h2>Make room for game night.</h2>
          <p>
            Create a private room, send the link, and gather 2–4 friends. Everyone plays right in their
            browser.
          </p>
          <button className="feature-link" onClick={onPlay}>
            Create your room <ArrowRight size={20} />
          </button>
        </div>
        <figure className="feature-crew" aria-label="Example room with four friends ready to play">
          <div className="feature-room-label">
            <span>Room</span>
            <b>AB2C</b>
            <small>4 / 4</small>
          </div>
          <div className="feature-avatars">
            {LANDING_AVATARS.map(([name, src]) => (
              <div key={name}>
                <span className="avatar-medallion">
                  <img
                    src={src}
                    alt={`${name}'s avatar`}
                    width="192"
                    height="192"
                    loading="lazy"
                    decoding="async"
                  />
                </span>
                <span>{name}</span>
              </div>
            ))}
          </div>
          <figcaption>All here. Let’s play.</figcaption>
        </figure>
      </section>
      <section className="landing-feature feature-reverse">
        <figure
          className="feature-island"
          aria-label="Illustration of resource tiles, a road and a settlement"
        >
          <div className="feature-hexes">
            {[0, 3, 2, 1, 4, 0, 3].map((terrain, i) => (
              <div className="feature-hex" key={i} style={{ '--tile': i } as CSSProperties}>
                <img
                  loading="lazy"
                  decoding="async"
                  src={BOARD_THEMES.storybook.terrain}
                  alt=""
                  width="1536"
                  height="1024"
                  style={{ left: `${-(terrain % 3) * 100}%`, top: `${-Math.floor(terrain / 3) * 100}%` }}
                />
                <b>{[5, 9, 6, 4, 8, 10, 3][i]}</b>
              </div>
            ))}
            <svg className="feature-settlement" viewBox="0 0 300 300" aria-hidden="true">
              <path
                d="M150 104L106 129L106 181"
                fill="none"
                stroke="#49382d"
                strokeWidth="13"
                strokeLinejoin="round"
              />
              <path
                d="M150 104L106 129L106 181"
                fill="none"
                stroke="#f18b65"
                strokeWidth="9"
                strokeLinejoin="round"
              />
              <path d="M136 108V91L151 76L166 91V108Z" fill="#ffac7c" stroke="#49382d" strokeWidth="3" />
              <path d="M147 108V99H155V108" fill="#49382d" />
            </svg>
          </div>
        </figure>
        <div className="feature-copy">
          <span className="feature-eyebrow">Build. Trade. Settle.</span>
          <h2>
            A new island.
            <br />A new way to win.
          </h2>
          <p>
            Collect resources, connect your settlements, and grow them into cities. Chase the longest road, or
            keep a surprise in your hand.
          </p>
          <a className="feature-link" href="/guide/">
            Learn how to play <ArrowRight size={20} />
          </a>
        </div>
      </section>
      <section className="landing-feature">
        <div className="feature-copy">
          <span className="feature-eyebrow">One good trade changes everything.</span>
          <h2>Bring your best offer.</h2>
          <p>
            Trade with friends or the bank. See exactly what you give and get, then decide whether the deal is
            worth it.
          </p>
          <button className="feature-link" onClick={onPlay}>
            Let’s play <ArrowRight size={20} />
          </button>
        </div>
        <figure className="feature-trade" aria-label="Example trade: give two Timber, get one Rock">
          <div>
            <span>You give</span>
            <LandingResource resource="wood" />
            <b>2</b>
          </div>
          <Exchange size={36} />
          <div>
            <span>You get</span>
            <LandingResource resource="ore" />
            <b>1</b>
          </div>
          <figcaption>Your call.</figcaption>
        </figure>
      </section>
      <div className="feature-footnote">No download. Your own avatar. A room for your friends.</div>
    </div>
  );
}
