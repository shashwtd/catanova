import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { placeGamePanel } from './floating-panel.js';
import type { PanelPlacement } from './floating-panel.js';

type Props = {
  anchor: () => HTMLElement | null;
  placement: PanelPlacement;
  width: number;
  onClose: () => void;
  children: (dismiss: () => void) => ReactNode;
  notch?: boolean;
  className?: string;
};

/** A viewport layer shared by tool panels and card choices, outside their transformed triggers. */
export function GamePopover(props: Props) {
  const marker = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setHost(marker.current?.closest('.game-world') ?? document.body);
  }, []);
  return (
    <>
      <span ref={marker} hidden />
      {host && createPortal(<PositionedPanel {...props} />, host)}
    </>
  );
}

function PositionedPanel({
  anchor,
  placement,
  width,
  onClose,
  children,
  notch = true,
  className = '',
}: Props) {
  const frame = useRef<HTMLDivElement>(null),
    motion = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ anchor, onClose });
  callbacks.current = { anchor, onClose };
  const opener = useRef<HTMLElement | null>(null);
  const dismiss = () => {
    callbacks.current.onClose();
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const element = frame.current!;
    const trigger = callbacks.current.anchor();
    opener.current = trigger;
    let disposed = false;
    let followFrame: number | undefined;
    const anchorGroup = trigger?.closest('.side-controls, .development-tray');
    const position = () => {
      if (disposed) return;
      const target = callbacks.current.anchor();
      if (!target?.isConnected) {
        element.style.visibility = 'hidden';
        return;
      }
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? innerWidth,
        height: viewport?.height ?? innerHeight,
      };
      const rect = target.getBoundingClientRect();
      const limits = placeGamePanel(rect, { width, height: Infinity }, bounds, placement);
      element.style.width = `${limits.width}px`;
      element.style.maxHeight = `${limits.maxHeight}px`;
      const result = placeGamePanel(rect, { width, height: element.offsetHeight }, bounds, placement);
      element.style.left = `${result.left}px`;
      element.style.top = `${result.top}px`;
      element.style.setProperty('--popover-notch', `${result.notch}px`);
      element.dataset.notchSide = result.notchSide;
      motion.current!.dataset.origin = result.bottomAligned ? 'bottom-left' : 'top-left';
      element.style.visibility = 'visible';
    };
    // Follow a moving menu trigger only while its own/ancestor transition is running.
    const followTrigger = () => {
      if (followFrame !== undefined) cancelAnimationFrame(followFrame);
      followFrame = undefined;
      position();
      const moving = anchorGroup?.getAnimations?.({ subtree: true }).some((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return (
          animation.playState === 'running' &&
          target instanceof Element &&
          !!trigger &&
          target.contains(trigger)
        );
      });
      if (moving) followFrame = requestAnimationFrame(followTrigger);
    };
    anchorGroup?.addEventListener('transitionrun', followTrigger);
    anchorGroup?.addEventListener('transitionend', followTrigger);
    // Measure and place synchronously, with no intermediate React render at an old position.
    position();
    const animate = requestAnimationFrame(() => {
      followTrigger();
      motion.current?.classList.add('is-open');
      element.querySelector<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(position);
    observer.observe(element);
    if (trigger) observer.observe(trigger);
    document.fonts?.ready.then(() => position());
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        element.contains(event.target) ||
        trigger?.contains(event.target)
      )
        return;
      if (event.target instanceof Element && event.target.closest('.side-controls, .development-hand-inline'))
        return;
      callbacks.current.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      disposed = true;
      cancelAnimationFrame(animate);
      if (followFrame !== undefined) cancelAnimationFrame(followFrame);
      anchorGroup?.removeEventListener('transitionrun', followTrigger);
      anchorGroup?.removeEventListener('transitionend', followTrigger);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [placement, width]);
  return (
    <div ref={frame} className={`game-popover ${className}`} style={{ visibility: 'hidden' }}>
      <div ref={motion} className="game-popover-motion t-dropdown">
        {notch && <span className="game-popover-notch" aria-hidden="true" />}
        {children(dismiss)}
      </div>
    </div>
  );
}
