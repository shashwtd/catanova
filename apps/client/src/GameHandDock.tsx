import type { ReactNode } from 'react';
/** Separate the development hand from the resource table without stretching the card artwork. */
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
      <div className="development-tray">
        <div className="development-hand-inline purchase-control">{purchase}</div>
        {development}
      </div>
      <div className="resource-table-group">
        <div className="card-table">
          <div className="hand-zone">{resources}</div>
        </div>
        {actions}
      </div>
    </div>
  );
}
