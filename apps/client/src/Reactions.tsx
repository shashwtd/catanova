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
  REACTION_WINDOW_MS,
  reactionWaitMs,
} from '../../../packages/protocol/src/reactions.js';
import type { ReactionName } from '../../../packages/protocol/src/reactions.js';
import { ReactionFace } from './ReactionArt.js';
import { Smile } from './GameIcons.js';

/** Breathing room between the button and its tray, in both placements. */
const GAP = 12;

/**
 * Which edges of the tray have more of the set beyond them.
 *
 * Separated out because the rule is easy to get subtly wrong and impossible to
 * see when it is: a fade that stays on at the bottom of a list is indeed a
 * gradient, and is also a lie about there being more.
 *
 * The two pixels of slack matter. Sub-pixel scroll heights leave a fraction of
 * overflow behind, and while the tray is unfurling a face sits a few pixels
 * below where it will settle, so the list is briefly taller than it stays.
 */
export function scrollEdges(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const room = scrollHeight - clientHeight;
  return { above: scrollTop > 2, below: room > 2 && scrollTop < room - 2 };
}

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
  /** When the cooldown after a full burst ends, or 0 while reactions can go. */
  const [restUntil, setRestUntil] = useState(0);
  const resting = restUntil > 0;
  const history = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * Where the tray goes.
   *
   * Beside the button and along the bottom is the better place: it uses the
   * empty strip that is already there and never floats over the board. But
   * that strip ends where the hand dock begins, and how much of it there is
   * depends on the window. So it is measured rather than assumed, and when the
   * room is not there the tray stacks against the button instead — upward on a
   * desktop, downward on a phone, where the button is at the top.
   */
  const [place, setPlace] = useState<'stacked' | 'beside'>('stacked');
  /**
   * Whether there is more of the set above or below what is showing.
   *
   * The tray fades its own edge where there is more to reach, and stops the
   * moment you arrive, so the fade is a fact about the list rather than
   * decoration that goes on lying once you are at the end of it.
   */
  const [edges, setEdges] = useState({ above: false, below: false });

  useEffect(() => {
    if (!open) return;
    const decide = () => {
      const panel = tray.current,
        anchor = root.current;
      if (!panel || !anchor) return;
      const from = anchor.getBoundingClientRect().right + GAP;
      // The dock's own box runs the width of the screen; its table is where
      // the bottom strip actually stops being empty.
      const table = document.querySelector('.hand-dock .card-table');
      const until = table ? table.getBoundingClientRect().left : window.innerWidth;
      setPlace(until - from >= panel.offsetWidth ? 'beside' : 'stacked');
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, [open]);

  useEffect(() => {
    const node = scroller.current;
    if (!open || !node) return;
    const measure = () => setEdges(scrollEdges(node.scrollTop, node.scrollHeight, node.clientHeight));
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    // The faces arrive staggered, and a face part-way through arriving sits
    // below where it will end up, so the list is briefly taller than it stays.
    node.addEventListener('animationend', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      node.removeEventListener('animationend', measure);
      observer?.disconnect();
    };
  }, [open]);

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

  // Wake once, when the cooldown is due to end, and clear it outright rather
  // than asking the rule again: the faces must never be left asleep. A tap a
  // moment too early just starts the rest of the wait.
  useEffect(() => {
    if (!restUntil) return;
    const timer = setTimeout(() => setRestUntil(0), Math.max(0, restUntil - now()));
    return () => clearTimeout(timer);
  }, [restUntil, now]);

  function send(reaction: ReactionName) {
    const at = now();
    const wait = reactionWaitMs(history.current, at);
    if (wait > 0) {
      setRestUntil(at + wait);
      return;
    }
    history.current = [...history.current.filter((time) => at - time < REACTION_WINDOW_MS), at];
    onReact(reaction);
    setSent({ reaction, id: at });
    const next = reactionWaitMs(history.current, at);
    if (next > 0) setRestUntil(at + next);
  }

  return (
    <div className={`reaction-control ${open ? 'open' : ''}`} ref={root}>
      {open && !disabled && (
        <div className="reaction-tray" ref={tray} data-place={place}>
          <div
            className="reaction-scroll"
            role="menu"
            aria-label="Send a reaction"
            ref={scroller}
            data-above={edges.above}
            data-below={edges.below}
          >
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
