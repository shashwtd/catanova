import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameView } from '../../../packages/rules/src/game.js';
import { SHIP_MOVE_BLOCKS } from '../../../packages/rules/src/sea.js';
import { GameIcon } from './GameIcons.js';

/**
 * Open Sea's ship move, once a turn in the action phase (docs/RULEBOOK-OPEN-SEA.md, section 8): under way while
 * the player chooses a ship (`from` null), then where it goes. The board marks the ships that may move, and a
 * placement confirmation confirms the move.
 */
export type ShipMove = { from: number | null };

/** Why the player cannot start a ship move now, or null when they can. */
export function shipMoveUnavailable(game: GameView, me: string): string | null {
  if (game.shipMovedThisTurn) return SHIP_MOVE_BLOCKS['move-used'];
  return Object.values(game.ships ?? {}).includes(me) ? null : 'You have no ships on the board';
}

/**
 * "Move ship", beside Trade in the dock and made like it: the teal button, an icon, one word. "Move ship" would
 * wrap in a button of Trade's width, so the word is the verb and the icon the ship, as Next's is.
 */
export function MoveShipButton({
  game,
  me,
  active,
  disabled,
  onToggle,
}: {
  game: GameView;
  me: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const reason = shipMoveUnavailable(game, me);
  return (
    <button
      className={`trade-action ship-move-action ${active ? 'is-selected' : ''}`}
      aria-label="Move ship"
      aria-pressed={active}
      title={reason ? `Move ship · ${reason}` : 'Move ship'}
      disabled={disabled || !!reason}
      onClick={onToggle}
    >
      <GameIcon name="move-ship" size={33} />
      <span>Move</span>
    </button>
  );
}

/**
 * Why one of the player's ships cannot move, beside it, in the card tooltip's parchment (section 14): shown on
 * hover or focus, or on a tap where there is no hover. Like the card tooltip it lives on the page's top layer and
 * closes on any other press, a scroll, a resize or Escape; the camera cannot move under it without one.
 */
export function ShipMoveTooltip({
  id,
  anchor,
  reason,
  reducedMotion,
  onClose,
}: {
  id: string;
  anchor: Element;
  reason: string;
  reducedMotion: boolean;
  onClose: () => void;
}) {
  const hint = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect(),
      height = hint.current?.offsetHeight ?? 80;
    setPosition({
      left: Math.max(132, Math.min(innerWidth - 132, rect.left + rect.width / 2)),
      top:
        rect.top - height - 12 >= 10
          ? rect.top - height - 12
          : Math.max(10, Math.min(innerHeight - height - 10, rect.bottom + 12)),
    });
  }, [anchor, reason]);
  useEffect(() => {
    const away = (event: Event) => {
      if (!anchor.contains(event.target as Node)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    const dismiss = () => close.current();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('wheel', dismiss, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('wheel', dismiss);
    };
  }, [anchor]);
  return createPortal(
    <span
      ref={hint}
      id={id}
      role="tooltip"
      className="illustrated-tooltip card-tooltip-portal ship-move-tooltip"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? undefined : 'hidden',
        animation: reducedMotion ? 'none' : undefined,
      }}
    >
      <strong>This ship stays put</strong>
      <span>{reason}.</span>
    </span>,
    document.body,
  );
}
