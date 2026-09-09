import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, PointerEvent } from 'react';
/** Hover/focus explains a card; only its explicit button can perform a game action. */
export function CardTooltip({
  children,
  content,
  disabledMotion = false,
  onHover,
}: {
  children: ReactNode;
  content: ReactNode;
  disabledMotion?: boolean;
  onHover?: () => void;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    wrap = useRef<HTMLDivElement>(null),
    hint = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  function reset() {
    const el = wrap.current?.querySelector<HTMLElement>('.t-tilt-card');
    if (!el) return;
    el.classList.remove('is-tilting');
    el.style.setProperty('--tilt-rx', '0deg');
    el.style.setProperty('--tilt-ry', '0deg');
    wrap.current?.classList.remove('is-hover');
  }
  function show() {
    const rect = wrap.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: Math.max(132, Math.min(innerWidth - 132, rect.left + rect.width / 2)),
        top: rect.top - 12,
      });
      setOpen(true);
    }
  }
  useEffect(() => {
    if (!open) return;
    const rect = wrap.current?.getBoundingClientRect(),
      height = hint.current?.offsetHeight ?? 180;
    if (rect)
      setPosition((p) => ({
        ...p,
        top:
          rect.top - height - 12 >= 10
            ? rect.top - height - 12
            : Math.max(10, Math.min(innerHeight - height - 10, rect.bottom + 12)),
      }));
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  function track(e: PointerEvent<HTMLDivElement>) {
    if (disabledMotion || e.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const box = e.currentTarget.getBoundingClientRect(),
      el = e.currentTarget.querySelector<HTMLElement>('.t-tilt-card');
    if (!el) return;
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    e.currentTarget.classList.add('is-hover');
    el.classList.add('is-tilting');
    el.style.setProperty('--tilt-rx', `${(0.5 - y) * 8}deg`);
    el.style.setProperty('--tilt-ry', `${(x - 0.5) * 8}deg`);
    el.style.setProperty('--tilt-gx', `${x * 100}%`);
    el.style.setProperty('--tilt-gy', `${y * 100}%`);
  }
  const tooltip = (
    <span
      ref={hint}
      id={id}
      role="tooltip"
      className={`illustrated-tooltip ${open ? 'card-tooltip-portal' : 'card-tooltip-inline'}`}
      style={
        open
          ? { left: position.left, top: position.top, animation: disabledMotion ? 'none' : undefined }
          : undefined
      }
    >
      {content}
    </span>
  );
  return (
    <div
      ref={wrap}
      className={`t-tt-wrap t-tilt card-hint ${disabledMotion ? 'static-card' : ''}`}
      tabIndex={0}
      aria-describedby={id}
      onPointerMove={track}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          show();
          if (!disabledMotion) onHover?.();
        }
      }}
      onPointerLeave={() => {
        reset();
        setOpen(false);
      }}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (open) setOpen(false);
          else show();
        }
      }}
      onClick={(e) => {
        if ((e.target as Element).closest('button')) setOpen(false);
        else if (open) setOpen(false);
        else show();
      }}
    >
      {children}
      {open ? createPortal(tooltip, document.body) : tooltip}
    </div>
  );
}
