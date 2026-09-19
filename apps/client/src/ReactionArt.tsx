/**
 * Reaction faces, drawn here rather than borrowed from the emoji font.
 *
 * An emoji is rendered by the reader's own device, so the same character is a
 * different face on every phone and none of them belong on a carved wooden
 * island. These are ours: the same expression everywhere, in the game's palette
 * of waxes and inks, and nothing to download.
 *
 * Every face is built the same way — a wax disc, a soft highlight, and brows,
 * eyes and a mouth drawn in one ink. Keeping the construction identical is what
 * makes twelve separate feelings read as one set, so the expression is the
 * only thing that changes between them.
 */

import type { ReactionName } from '../../../packages/protocol/src/reactions.js';

const INK = '#2b1a08';
const WHITE = '#fdf6e4';
const TEAR = '#a9dcf2';
const TONGUE = '#d9694f';

/** The disc every face is drawn on. `wax` is the skin, `rim` its shadowed edge. */
function Face({ wax, rim, children }: { wax: string; rim: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 32 32" className="reaction-face" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="15" fill={wax} />
      <ellipse cx="12.4" cy="10" rx="8.6" ry="6.2" fill="#fff" opacity="0.17" />
      <circle cx="16" cy="16" r="14.2" fill="none" stroke={rim} strokeWidth="1.7" />
      <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.92">
        {children}
      </g>
    </svg>
  );
}

/** Eyes squeezed shut in the same curve, shared by every delighted face. */
const shutEyes = (
  <>
    <path d="M7.9 14.4c1.5-2.8 4.4-2.8 5.9 0" />
    <path d="M18.2 14.4c1.5-2.8 4.4-2.8 5.9 0" />
  </>
);

const dot = (x: number, y: number, r = 1.8) => <circle cx={x} cy={y} r={r} fill={INK} stroke="none" />;

/** A four-point sparkle, for the faces that deserve one. */
const spark = (x: number, y: number, s: number, fill: string) => (
  <path
    d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}z`}
    fill={fill}
    stroke="none"
  />
);

const REACTION_FACES: Record<ReactionName, React.ReactElement> = {
  /* Helpless: eyes shut, mouth wide, tongue out. */
  laugh: (
    <Face wax="#f2c45c" rim="#a8762c">
      {shutEyes}
      <path d="M8.8 18.8h14.4c0 4.7-3.2 8-7.2 8s-7.2-3.3-7.2-8z" fill={INK} stroke={INK} strokeWidth="1.4" />
      <path
        d="M12.6 24.1c.9-.9 4.9-.9 5.8 0 .4.4-.6 2.2-2.9 2.2s-3.3-1.8-2.9-2.2z"
        fill={TONGUE}
        stroke="none"
      />
    </Face>
  ),
  /* The robber landed on you: brows driven down, jaw set. */
  angry: (
    <Face wax="#d4593b" rim="#7b2a1a">
      <path d="M7.4 11 13.5 14.2" strokeWidth="2.3" />
      <path d="M24.6 11 18.5 14.2" strokeWidth="2.3" />
      {dot(11.5, 17.4)}
      {dot(20.5, 17.4)}
      <path d="M10.6 24.6c2.2-3.6 8.6-3.6 10.8 0" />
    </Face>
  ),
  /* Something is being planned, and it is not good for you. */
  evil: (
    <Face wax="#8e63b2" rim="#4a2c66">
      <path d="M7.6 12.1 13.4 14.8" strokeWidth="2.2" />
      <path d="M24.4 12.1 18.6 14.8" strokeWidth="2.2" />
      <ellipse cx="11.4" cy="17.1" rx="2.5" ry="1.5" fill={INK} stroke="none" />
      <ellipse cx="20.6" cy="17.1" rx="2.5" ry="1.5" fill={INK} stroke="none" />
      <path d="M10.4 21.4c3 3.6 8.8 3.4 11.8-1.6" />
    </Face>
  ),
  /* You saw that coming and you would like everyone to know. */
  smug: (
    <Face wax="#dcb45f" rim="#8b6122">
      <path d="M18.2 10.8c1.7-1.3 4.1-1.1 5.4.5" strokeWidth="1.7" />
      <path d="M8.6 14.8h5.6" />
      <path d="M17.8 14.8h5.6" />
      <path d="M8.8 15c1.4 1.9 4.2 1.9 5.6 0" strokeWidth="1.5" />
      <path d="M18 15c1.4 1.9 4.2 1.9 5.6 0" strokeWidth="1.5" />
      <path d="M11 23.2c3.5 1.6 7.2-.5 8.6-3.4" />
    </Face>
  ),
  /* A seven. Again. */
  shock: (
    <Face wax="#ead4a2" rim="#9b8352">
      <path d="M7.9 10.2c1.5-1.7 4-1.9 5.7-.6" strokeWidth="1.7" />
      <path d="M24.1 10.2c-1.5-1.7-4-1.9-5.7-.6" strokeWidth="1.7" />
      <circle cx="11.6" cy="15.4" r="3.2" fill={WHITE} strokeWidth="1.7" />
      <circle cx="20.4" cy="15.4" r="3.2" fill={WHITE} strokeWidth="1.7" />
      {dot(11.6, 15.6, 1.5)}
      {dot(20.4, 15.6, 1.5)}
      <ellipse cx="16" cy="24" rx="3" ry="3.6" fill={INK} stroke="none" />
    </Face>
  ),
  /* You cannot be serious. */
  eyeroll: (
    <Face wax="#ccb68d" rim="#7f6c47">
      <path d="M8.4 10.6h5.2" strokeWidth="1.7" />
      <path d="M18.4 10.6h5.2" strokeWidth="1.7" />
      <circle cx="11.6" cy="15.2" r="3.1" fill={WHITE} strokeWidth="1.7" />
      <circle cx="20.4" cy="15.2" r="3.1" fill={WHITE} strokeWidth="1.7" />
      {dot(11.6, 13.3, 1.4)}
      {dot(20.4, 13.3, 1.4)}
      <path d="M11.4 23.2h9.2" />
    </Face>
  ),
  /* Everything was going so well. */
  sad: (
    <Face wax="#7392aa" rim="#3b5468">
      <path d="M8.2 13.6 12.9 11.1" strokeWidth="1.8" />
      <path d="M23.8 13.6 19.1 11.1" strokeWidth="1.8" />
      {dot(11.6, 17)}
      {dot(20.4, 17)}
      <path d="M11 24.8c2-3.2 8-3.2 10 0" />
      <path
        d="M23 18.9c1.7 2.2 2.5 3.3 2.5 4.1a2.5 2.5 0 0 1-5 0c0-.8.8-1.9 2.5-4.1z"
        fill={TEAR}
        stroke="none"
      />
    </Face>
  ),
  /* Ten points to the player on your left. */
  dead: (
    <Face wax="#9aa3a0" rim="#555f5d">
      <path d="m9.3 12.8 4.6 4.4M13.9 12.8l-4.6 4.4" strokeWidth="2.1" />
      <path d="m18.1 12.8 4.6 4.4M22.7 12.8l-4.6 4.4" strokeWidth="2.1" />
      <path d="M11.8 23.4q1.4-1.6 2.8 0t2.8 0 2.8 0" strokeWidth="1.8" />
    </Face>
  ),
  /* Nobody rolls an eight four times in a row. */
  suspicious: (
    <Face wax="#bd944f" rim="#6d4d1e">
      <path d="M7.9 11.4c1.7-1.7 4.3-1.7 6 -.2" strokeWidth="1.8" />
      <path d="M18.3 12.8c1.6-.9 4-.7 5.7.6" strokeWidth="1.8" />
      <path d="M8.6 15.4c1.7-1.5 4.4-1.5 6.1 0" strokeWidth="1.8" />
      <path d="M8.8 17.6c1.6 1.1 4.3 1.1 5.9 0" strokeWidth="1.5" />
      <path d="M17.3 15.4c1.7-1.5 4.4-1.5 6.1 0" strokeWidth="1.8" />
      {dot(11.7, 16.5, 1.3)}
      {dot(20.4, 16.5, 1.3)}
      <path d="M11.6 23.6 20.6 22" />
    </Face>
  ),
  /* One sheep. One. Please. */
  pleading: (
    <Face wax="#e0b07a" rim="#91653a">
      <path d="M8 12.6 12.8 10.6" strokeWidth="1.7" />
      <path d="M24 12.6 19.2 10.6" strokeWidth="1.7" />
      <circle cx="11.4" cy="16.4" r="3.7" fill={WHITE} strokeWidth="1.7" />
      <circle cx="20.6" cy="16.4" r="3.7" fill={WHITE} strokeWidth="1.7" />
      {dot(11.4, 16.9, 2)}
      {dot(20.6, 16.9, 2)}
      <circle cx="10.2" cy="15" r="1" fill="#fff" stroke="none" />
      <circle cx="19.4" cy="15" r="1" fill="#fff" stroke="none" />
      <path d="M13.2 24q1.4-1.4 2.8 0t2.8 0" strokeWidth="1.7" />
    </Face>
  ),
  /* A decision so bad it deserves the full costume. */
  clown: (
    <Face wax="#f0e3d6" rim="#a08577">
      <path d="M6.2 13.2a3.4 3.4 0 0 1 4.6-4.4" fill="#e2753a" stroke="none" />
      <path d="M25.8 13.2a3.4 3.4 0 0 0-4.6-4.4" fill="#e2753a" stroke="none" />
      <path d="M8.8 11.9c1.4-2 4-2 5.4 0" strokeWidth="1.8" />
      <path d="M23.2 11.9c-1.4-2-4-2-5.4 0" strokeWidth="1.8" />
      {dot(11.6, 15.6, 1.7)}
      {dot(20.4, 15.6, 1.7)}
      <circle cx="7.9" cy="19.6" r="2.4" fill="#ef9aa6" stroke="none" />
      <circle cx="24.1" cy="19.6" r="2.4" fill="#ef9aa6" stroke="none" />
      <path d="M10.2 22.2c2.2 3.8 9.4 3.8 11.6 0" strokeWidth="1.9" />
      <circle cx="16" cy="19.1" r="2.7" fill="#e04b36" stroke="none" />
      <circle cx="15.2" cy="18.3" r="0.9" fill="#fff" opacity="0.55" stroke="none" />
    </Face>
  ),
  /* The roll of the game, and everybody heard about it. */
  hype: (
    <Face wax="#ef8c3c" rim="#9c4a12">
      <path d="M8.4 11.2c1.5-1.9 4.1-1.9 5.6 0" strokeWidth="1.8" />
      <path d="M23.6 11.2c-1.5-1.9-4.1-1.9-5.6 0" strokeWidth="1.8" />
      {spark(11.6, 16, 3.4, WHITE)}
      {spark(20.4, 16, 3.4, WHITE)}
      <path
        d="M9.6 20.8h12.8c0 4.2-2.9 7.2-6.4 7.2s-6.4-3-6.4-7.2z"
        fill={INK}
        stroke={INK}
        strokeWidth="1.4"
      />
      <path
        d="M13.4 25.1c1-.9 4.2-.9 5.2 0 .4.4-.7 2.1-2.6 2.1s-3-1.7-2.6-2.1z"
        fill={TONGUE}
        stroke="none"
      />
      {spark(26.4, 7.6, 2.6, '#ffe08a')}
      {spark(5.8, 9.8, 1.9, '#ffe08a')}
    </Face>
  ),
};

/** The face for one reaction, identical in the picker and on the board. */
export function ReactionFace({ name }: { name: ReactionName }) {
  return REACTION_FACES[name];
}
