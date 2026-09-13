import type { ReactNode } from 'react';
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
  return (
    <div className="hand-dock hand-dock-separated">
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
