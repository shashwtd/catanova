/**
 * Table talk: a reaction button and the animation it throws across the board.
 *
 * The artwork is Twemoji, one collection, so a laugh looks the same on a Pixel
 * as it does on an iPhone instead of inheriting whatever each platform ships.
 * The movement is ours: each reaction gets choreography matched to the feeling,
 * because a laugh that drifts politely upward is not a laugh. That work lives in
 * CSS keyframes (`reactions.css`), keyed off the `motion` in the shared table.
 *
 * Nothing here touches game state. A reaction is chat, so a dropped one costs
 * nothing and it needs no confirmation, revision or receipt.
 */

import { useEffect, useRef, useState } from 'react';
import { REACTIONS, REACTION_LIST } from '../../../packages/protocol/src/reactions.js';
import type { ReactionName } from '../../../packages/protocol/src/reactions.js';
import { Smile } from './GameIcons.js';

export const reactionArt = (name: ReactionName) => `/reactions/${name}.svg`;

/** One reaction in flight. */
export type FlyingReaction = {
  id: number;
  reaction: ReactionName;
  /** Who threw it, shown small beneath so a table of four stays readable. */
  from: string;
  /** Horizontal lane, 0 to 1, so several at once do not stack on one another. */
  lane: number;
};

/**
 * The layer reactions fly through. Sits above the board and ignores pointer
 * events entirely, so it can never swallow a click meant for a settlement.
 */
export function ReactionLayer({ flying }: { flying: FlyingReaction[] }) {
  return (
    <div className="reaction-layer" aria-live="polite" aria-atomic="false">
      {flying.map((item) => (
        <span
          key={item.id}
          className={`reaction-fly motion-${REACTIONS[item.reaction].motion}`}
          style={{ left: `${8 + item.lane * 84}%` }}
        >
          <img src={reactionArt(item.reaction)} alt="" draggable={false} />
          <small>{item.from}</small>
          <span className="reaction-announce">
            {item.from} reacted: {REACTIONS[item.reaction].label}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The button and its tray.
 *
 * On a laptop the whole set fits in a grid. On a phone it becomes a single
 * swipeable row, because a grid of fourteen would eat the board. Either way the
 * order is the same and the common feelings come first.
 */
export function ReactionButton({
  onReact,
  disabled,
}: {
  onReact: (reaction: ReactionName) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className={`reaction-control ${open ? 'open' : ''}`} ref={root}>
      {open && !disabled && (
        <div className="reaction-tray" role="menu" aria-label="Send a reaction">
          {REACTION_LIST.map((name, index) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              disabled={disabled}
              className="reaction-choice"
              // Staggered so the tray unfurls rather than appearing at once.
              style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
              title={REACTIONS[name].label}
              aria-label={REACTIONS[name].label}
              onClick={() => {
                onReact(name);
                setOpen(false);
              }}
            >
              <img src={reactionArt(name)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="reaction-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? 'Close reactions' : 'Send a reaction'}
        title="Send a reaction"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        <Smile size={26} />
      </button>
    </div>
  );
}

/**
 * Keeps the flying list bounded and clears each item once its animation is
 * over. A long game must not accumulate DOM.
 */
export function useFlyingReactions(lifetimeMs = 2600) {
  const [flying, setFlying] = useState<FlyingReaction[]>([]);
  const next = useRef(1);

  const add = (reaction: ReactionName, from: string) => {
    const id = next.current++;
    // Lanes cycle so consecutive reactions never overlap exactly.
    const lane = (((id * 0.37) % 1) + 1) % 1;
    setFlying((current) => [...current.slice(-11), { id, reaction, from, lane }]);
    setTimeout(() => setFlying((current) => current.filter((item) => item.id !== id)), lifetimeMs);
  };

  return { flying, add };
}
