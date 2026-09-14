import { useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from './GameIcons.js';
import { GamePopover } from './GamePopover.js';
import type { GameToolPanel } from './GameTools.js';

/** Nonmodal game help follows its tool and dismisses without collapsing the tool rail. */
export function UtilityPanel({
  title,
  children,
  onClose,
  tool,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  tool?: GameToolPanel;
}) {
  const fallback = useRef<HTMLElement | null>(null);
  const anchor = () =>
    (tool
      ? document.querySelector<HTMLElement>(`[data-game-tool="${tool}"]`)
      : (fallback.current ??= document.activeElement?.closest<HTMLElement>('[data-game-tool]') ?? null)) ??
    document.querySelector<HTMLElement>('.game-menu-trigger');
  return (
    <GamePopover
      key={tool ?? title}
      anchor={anchor}
      placement="beside"
      width={tool === 'settings' ? 310 : tool === 'journal' ? 330 : 390}
      onClose={onClose}
    >
      {(dismiss) => (
        <aside className="game-panel game-side-panel" role="dialog" aria-label={title} tabIndex={-1}>
          <div className="panel-heading">
            <h2>{title}</h2>
            <button className="icon-button" aria-label={`Close ${title}`} onClick={dismiss}>
              <X />
            </button>
          </div>
          <div className="game-side-panel-content">{children}</div>
        </aside>
      )}
    </GamePopover>
  );
}
