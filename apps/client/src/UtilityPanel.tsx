import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from './GameIcons.js';

/** Nonmodal game help: dismiss the panel without collapsing its tool rail. */
export function UtilityPanel({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  function dismiss() {
    close.current();
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || ref.current?.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('.side-controls')) return;
      close.current();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
  return (
    <aside ref={ref} className="game-panel game-side-panel" role="dialog" aria-label={title}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label={`Close ${title}`} onClick={dismiss}>
          <X />
        </button>
      </div>
      <div className="game-side-panel-content">{children}</div>
    </aside>
  );
}
