/**
 * Table talk: a call button and the token it throws across the board.
 *
 * The faces are ours, drawn as SVG in `ReactionArt.tsx` rather than taken from
 * the emoji font, so a laugh is the same face on a Pixel as on an iPhone
 * instead of whatever each platform happens to ship. The movement is ours too:
 * each reaction gets choreography matched to the feeling, because a laugh that
 * drifts politely upward is not a laugh. That work lives in CSS keyframes
 * (`reactions.css`), keyed off the `motion` in the shared table.
 *
 * Nothing here touches game state. A reaction is chat, so a dropped one costs
 * nothing and it needs no confirmation, revision or receipt.
 */

import { useEffect, useRef, useState } from 'react';
import {
  REACTIONS,
  REACTION_LIST,
  REACTION_MIN_GAP_MS,
  reactionAllowedAt,
} from '../../../packages/protocol/src/reactions.js';
import type { ReactionName } from '../../../packages/protocol/src/reactions.js';
import { ReactionFace } from './ReactionArt.js';
import { Smile } from './GameIcons.js';

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
          <ReactionFace name={item.reaction} />
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
 * The tray stays open after a reaction goes out, because reacting is rarely a
 * single thing: a laugh is usually followed by a second laugh. It closes on
 * Escape, on a click away, or on the button itself.
 *
 * On a laptop the whole set wraps into a few rows. On a phone it becomes one
 * swipeable row, because a block of fourteen would cover the board, which is
 * the thing being reacted to.
 */
export function ReactionButton({
  onReact,
  disabled,
  now = Date.now,
}: {
  onReact: (reaction: ReactionName) => void;
  disabled?: boolean;
  /** Injectable so the resting beat between reactions can be tested. */
  now?: () => number;
}) {
  const [open, setOpen] = useState(false);
  /** The last reaction sent, kept only to flash the face that was pressed. */
  const [sent, setSent] = useState<{ reaction: ReactionName; id: number } | null>(null);
  /** True while the shared rate limit says the next reaction must wait. */
  const [resting, setResting] = useState(false);
  const history = useRef<number[]>([]);
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

  // While resting, wake up once the gate is expected to reopen rather than
  // polling: the shortest wait the limit can impose is the gap between calls.
  useEffect(() => {
    if (!resting) return;
    const timer = setTimeout(
      () => setResting(!reactionAllowedAt(history.current, now())),
      REACTION_MIN_GAP_MS,
    );
    return () => clearTimeout(timer);
  }, [resting, sent, now]);

  function send(reaction: ReactionName) {
    const at = now();
    if (!reactionAllowedAt(history.current, at)) {
      setResting(true);
      return;
    }
    history.current = [...history.current.slice(-8), at];
    onReact(reaction);
    setSent({ reaction, id: at });
    setResting(!reactionAllowedAt(history.current, at));
  }

  return (
    <div className={`reaction-control ${open ? 'open' : ''}`} ref={root}>
      {open && !disabled && (
        <div className="reaction-tray" role="menu" aria-label="Send a reaction">
          {REACTION_LIST.map((name, index) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className={`reaction-choice ${sent?.reaction === name ? 'just-sent' : ''}`}
              // Staggered so the tray unfurls rather than appearing at once.
              style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
              title={REACTIONS[name].label}
              aria-label={REACTIONS[name].label}
              disabled={disabled || resting}
              onClick={() => send(name)}
            >
              <ReactionFace name={name} />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="reaction-toggle icon-button"
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
