import type { CSSProperties } from 'react';
import { ResourceIcon } from './Board.js';
import { Avatar } from './Profile.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { ArrowRight, Exchange } from './GameIcons.js';
import { BOARD_THEMES } from './board-theme.js';

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
            {['Fern', 'Moss', 'Pip', 'Oak'].map((name, i) => (
              <div key={name}>
                <Avatar profile={{ ...defaultProfile(name), avatar: [0, 1, 3, 5][i]! }} />
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
            <ResourceIcon resource="wood" />
            <b>2</b>
          </div>
          <Exchange size={36} />
          <div>
            <span>You get</span>
            <ResourceIcon resource="ore" />
            <b>1</b>
          </div>
          <figcaption>Your call.</figcaption>
        </figure>
      </section>
      <div className="feature-footnote">No download. Your own avatar. A room for your friends.</div>
    </div>
  );
}
