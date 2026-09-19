import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
/** Keep inventory and turn actions together in the bottom-right corner. */
export function GameHandDock({
  purchase,
  development,
  resources,
  actions,
}: {
  purchase: ReactNode;
  development?: ReactNode;
  resources: ReactNode;
  actions: ReactNode;
}) {
  const dock = useRef<HTMLDivElement>(null);
  /**
   * Publish how tall the dock actually is, so the board can clear it.
   *
   * Its height changes with what is in it — holding development cards adds a
   * row — and the reserve used to be a constant picked for one of those cases,
   * which meant the board was either overlapped or short-changed. Measuring is
   * the only version that stays true as the shelf changes.
   */
  useEffect(() => {
    const node = dock.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const publish = () =>
      document.documentElement.style.setProperty('--dock-height', `${Math.round(node.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--dock-height');
    };
  }, []);
  return (
    <div className="hand-dock hand-dock-separated" ref={dock}>
      <div className="card-table">
        <div className="hand-zone">{resources}</div>
        {development && <div className="development-tray">{development}</div>}
      </div>
      <div className="table-actions">
        <div className="development-hand-inline purchase-control">{purchase}</div>
        {actions}
      </div>
    </div>
  );
}
