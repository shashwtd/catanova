import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CircleHelp, DoorOpen, GameIcon, History, Maximize, Minimize, Settings2, X } from './GameIcons.js';
export type GameToolPanel = 'journal' | 'rules' | 'info' | 'settings' | 'leave';
export function GameTools({
  panel,
  onPanel,
  onClosePanel,
  fullscreen,
  onFullscreen,
  onLeave,
  busy = false,
}: {
  panel?: string | null;
  onPanel: (panel: GameToolPanel) => void;
  onClosePanel?: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onLeave: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => () => clearTimeout(timeout.current), []);
  function closeMenu() {
    clearTimeout(timeout.current);
    setOpen(false);
    setClosing(true);
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')) ||
        150;
    timeout.current = setTimeout(() => setClosing(false), ms);
    trigger.current?.focus({ preventScroll: true });
  }
  const togglePanel = (next: GameToolPanel) => {
    if (panel === next) onClosePanel?.();
    else onPanel(next);
  };
  const entries = [
    { key: 'rules', label: 'How to play', icon: <CircleHelp />, action: () => togglePanel('rules') },
    { key: 'info', label: 'Game rules', icon: <GameIcon name="info" />, action: () => togglePanel('info') },
    { key: 'settings', label: 'Settings', icon: <Settings2 />, action: () => togglePanel('settings') },
    { key: 'leave', label: 'Leave game', icon: <DoorOpen />, action: onLeave },
  ];
  return (
    <>
      <nav className="side-controls game-controls" aria-label="Current game tools">
        <button
          className="icon-button"
          aria-label="Move history"
          title="Move history"
          aria-pressed={panel === 'journal'}
          onClick={() => togglePanel('journal')}
        >
          <History />
          <span className="tool-label">Move history</span>
        </button>
        <button
          className="icon-button fullscreen-control"
          onClick={onFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
          <span className="tool-label">{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
        </button>
      </nav>
      <nav className="side-controls room-controls" aria-label="Room tools">
        <div
          className="game-tools-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open && !panel) {
              e.preventDefault();
              closeMenu();
            }
          }}
        >
          <button
            ref={trigger}
            type="button"
            className="icon-button game-menu-trigger"
            aria-label={open ? 'Close game menu' : 'Game menu'}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => {
              if (open) {
                closeMenu();
                onClosePanel?.();
              } else {
                clearTimeout(timeout.current);
                setClosing(false);
                setOpen(true);
              }
            }}
          >
            <span className="t-icon-swap" data-state={open ? 'b' : 'a'}>
              <span className="t-icon" data-icon="a">
                <GameIcon name="menu" />
              </span>
              <span className="t-icon" data-icon="b">
                <X />
              </span>
            </span>
            <span className="tool-label">{open ? 'Close menu' : 'Menu'}</span>
          </button>
          <div
            id={id}
            className={`game-tools-popover t-dropdown ${open ? 'is-open' : closing ? 'is-closing' : ''}`}
            data-origin="bottom-left"
            inert={!open}
            aria-hidden={!open}
          >
            {entries.map((entry, i) => (
              <button
                key={entry.key}
                aria-label={entry.label}
                aria-pressed={panel === entry.key}
                disabled={entry.key === 'leave' && busy}
                style={{ '--tool-order': entries.length - i - 1 } as CSSProperties}
                onClick={entry.action}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}
