import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, PointerEvent } from 'react';
/** Hover/focus explains a card; only its explicit button can perform a game action. */
export function CardTooltip({
  children,
  content,
  disabledMotion = false,
  suppressed = false,
  onHover,
}: {
  children: ReactNode;
  content: ReactNode;
  disabledMotion?: boolean;
  suppressed?: boolean;
  onHover?: () => void;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    wrap = useRef<HTMLDivElement>(null),
    hint = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverSound = useRef(onHover);
  hoverSound.current = onHover;
  function close() {
    clearTimeout(pending.current);
    pending.current = undefined;
    setOpen(false);
  }
  useEffect(() => () => clearTimeout(pending.current), []);
  useEffect(() => {
    if (suppressed) close();
  }, [suppressed]);
  useEffect(() => {
    if (!open || suppressed || disabledMotion) return;
    // Only announce a preview that made it to the screen, never a cancelled hover.
    const frame = requestAnimationFrame(() => hoverSound.current?.());
    return () => cancelAnimationFrame(frame);
  }, [open, suppressed, disabledMotion]);
  function reset() {
    const el = wrap.current?.querySelector<HTMLElement>('.t-tilt-card');
    if (!el) return;
    el.classList.remove('is-tilting');
    el.style.setProperty('--tilt-rx', '0deg');
    el.style.setProperty('--tilt-ry', '0deg');
    wrap.current?.classList.remove('is-hover');
  }
  function show() {
    clearTimeout(pending.current);
    pending.current = undefined;
    if (suppressed) return;
    const rect = wrap.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: Math.max(132, Math.min(innerWidth - 132, rect.left + rect.width / 2)),
        top: rect.top - 12,
      });
      setOpen(true);
    }
  }
  useLayoutEffect(() => {
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
        if (e.pointerType === 'mouse' && !suppressed) {
          clearTimeout(pending.current);
          const delay =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tt-delay')) || 80;
          pending.current = setTimeout(show, delay);
        }
      }}
      onPointerLeave={() => {
        reset();
        close();
      }}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (open) close();
          else show();
        }
      }}
      onClick={(e) => {
        const button = (e.target as Element).closest('button');
        // Locked cards still explain themselves on touch, where there is no hover.
        if (button?.getAttribute('aria-disabled') === 'true') show();
        else if (button) close();
        else if (open) close();
        else show();
      }}
    >
      {children}
      {open && !suppressed ? (
        createPortal(tooltip, document.body)
      ) : (
        <span id={id} hidden style={{ display: 'none' }}>
          {content}
        </span>
      )}
    </div>
  );
}
