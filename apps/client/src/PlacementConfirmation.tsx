import { useLayoutEffect, useRef, useState } from 'react';
import type { BuildAction } from './placement.js';
import { Check, X } from './GameIcons.js';
import { PlacementChoice } from './PlacementChoice.js';
import type { PieceChoice } from './PlacementChoice.js';

export function placementSelector(action: BuildAction) {
  // An Open Sea edge that takes a road or a ship is one site, a road's that also takes a ship.
  if (action.kind === 'ship')
    return `[data-site-id="${action.edge}"]:is([data-build-site="ship"], [data-ship-site])`;
  if (action.kind === 'moveShip') return `[data-build-site="moveShip"][data-site-id="${action.to}"]`;
  return `[data-build-site="${action.kind}"][data-site-id="${action.kind === 'road' ? action.edge : action.vertex}"]`;
}
/** Fixed-size confirmation follows its board location, including during camera pan and zoom. */
export function PlacementConfirmation({
  action,
  disabled,
  choice,
  onCancel,
  onConfirm,
}: {
  action: BuildAction;
  disabled: boolean;
  /** Open Sea: where the edge takes a road or a ship, the two to choose between. */
  choice?: PieceChoice;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [point, setPoint] = useState<{ left: number; top: number } | null>(null);
  const callbacks = useRef({ onCancel, onConfirm });
  callbacks.current = { onCancel, onConfirm };
  const selector = placementSelector(action);
  useLayoutEffect(() => {
    const anchor = document.querySelector(selector),
      camera = anchor?.closest('.board-camera');
    if (!anchor) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const box = anchor.getBoundingClientRect(),
        popover = ref.current?.getBoundingClientRect();
      const width = popover?.width || 196,
        height = popover?.height || 46;
      const left = Math.max(8, Math.min(innerWidth - width - 8, box.left + box.width / 2 - width / 2));
      const below = box.bottom + 9;
      const top = below + height < innerHeight - 8 ? below : Math.max(8, box.top - height - 9);
      setPoint((current) => (current?.left === left && current.top === top ? current : { left, top }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const observer = new MutationObserver(schedule);
    if (camera) observer.observe(camera, { attributes: true, attributeFilter: ['style'] });
    const resize = new ResizeObserver(schedule);
    if (camera) resize.observe(camera);
    if (ref.current) resize.observe(ref.current);
    window.addEventListener('resize', schedule);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        callbacks.current.onCancel();
      }
    };
    window.addEventListener('keydown', escape);
    // Move keyboard focus to Cancel so a second Enter cannot accidentally build.
    if (document.activeElement === anchor)
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('keydown', escape);
    };
  }, [selector]);
  return (
    <aside
      ref={ref}
      className="placement-confirmation"
      role="dialog"
      aria-label="Confirm placement"
      style={{ left: point?.left ?? 0, top: point?.top ?? 0, visibility: point ? 'visible' : 'hidden' }}
    >
      {choice ? (
        <PlacementChoice {...choice} selected={action.kind} />
      ) : (
        <strong>
          {action.kind === 'moveShip'
            ? 'Move ship here?'
            : `Confirm ${action.kind === 'settlement' ? 'house' : action.kind}?`}
        </strong>
      )}
      <button className="placement-cancel" aria-label="Cancel placement" onClick={onCancel}>
        <X size={18} />
      </button>
      <button
        className="placement-confirm"
        aria-label={action.kind === 'moveShip' ? 'Confirm ship move' : `Confirm ${action.kind}`}
        disabled={disabled}
        onClick={onConfirm}
      >
        <Check size={19} />
      </button>
    </aside>
  );
}
