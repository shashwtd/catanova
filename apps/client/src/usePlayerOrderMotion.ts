import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
type Position = { x: number; y: number };

/** FLIP only the four profile positions. Score changes never remount portraits or their timers. */
export function usePlayerOrderMotion(
  rail: RefObject<HTMLElement | null>,
  order: string,
  roomId: string,
  reducedMotion: boolean,
) {
  const previous = useRef<{
    order: string;
    room: string;
    width: number;
    positions: Map<string, Position>;
  } | null>(null);
  const running = useRef(new Map<string, Animation>());
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => {
      for (const animation of running.current.values()) animation.cancel();
      running.current.clear();
    };
    const changed = () => {
      if (query.matches) cancel();
    };
    query.addEventListener('change', changed);
    return () => {
      query.removeEventListener('change', changed);
      cancel();
    };
  }, []);
  useLayoutEffect(() => {
    const container = rail.current;
    if (!container) return;
    const old = previous.current;
    const width = container.clientWidth;
    const positions = new Map<string, Position>();
    const changed = old && old.room === roomId && old.order !== order && old.width === width;
    const allowed = changed && !reducedMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const styles = getComputedStyle(container);
    const duration = parseFloat(styles.getPropertyValue('--rank-move-duration')) || 500;
    const easing = styles.getPropertyValue('--rank-move-ease').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)';
    for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-player-profile]'))) {
      const id = node.dataset.playerProfile!;
      const position = { x: node.offsetLeft, y: node.offsetTop };
      positions.set(id, position);
      if (!changed && old?.room === roomId && old.width === width && !reducedMotion) continue;
      const animation = running.current.get(id);
      // A second lead change starts from the current visual position, even mid-swap.
      const offset =
        animation && typeof DOMMatrixReadOnly !== 'undefined'
          ? new DOMMatrixReadOnly(getComputedStyle(node).transform)
          : null;
      animation?.cancel();
      running.current.delete(id);
      const from = old?.positions.get(id);
      if (!allowed || !from || typeof node.animate !== 'function') continue;
      const x = from.x + (offset?.m41 ?? 0) - position.x;
      const y = from.y + (offset?.m42 ?? 0) - position.y;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      const next = node.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing },
      );
      running.current.set(id, next);
      next.onfinish = () => {
        if (running.current.get(id) === next) running.current.delete(id);
      };
    }
    previous.current = { order, room: roomId, width, positions };
  });
}
