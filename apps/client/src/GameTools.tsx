import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CircleHelp,
  DoorOpen,
  GameIcon,
  History,
  Maximize,
  Minimize,
  Settings2,
  Wifi,
  X,
} from './GameIcons.js';
export type GameToolPanel = 'connection' | 'statistics' | 'journal' | 'rules' | 'settings' | 'leave';
export function GameTools({
  panel,
  onPanel,
  onClosePanel,
  fullscreen,
  onFullscreen,
  onLeave,
  reactions,
  busy = false,
}: {
  panel?: string | null;
  onPanel: (panel: GameToolPanel) => void;
  onClosePanel?: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onLeave: () => void;
  /** Rendered into the tool column; supplied by the game screen. */
  reactions?: ReactNode;
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
    { key: 'connection', label: 'Connection', icon: <Wifi />, action: () => togglePanel('connection') },
    {
      key: 'statistics',
      label: 'Dice statistics',
      icon: <GameIcon name="statistics" />,
      action: () => togglePanel('statistics'),
    },
    { key: 'rules', label: 'How to play', icon: <CircleHelp />, action: () => togglePanel('rules') },
    { key: 'settings', label: 'Settings', icon: <Settings2 />, action: () => togglePanel('settings') },
    { key: 'leave', label: 'Leave game', icon: <DoorOpen />, action: onLeave },
  ];
  return (
    <>
      <nav className="side-controls game-controls" aria-label="Current game tools" data-panel-align="top">
        {/* Fullscreen belongs with the things you set once and leave, not with
            the room controls you reach for mid-turn. */}
        <button
          className="icon-button fullscreen-control"
          onClick={onFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </button>
        <button
          className="icon-button"
          aria-label="Move history"
          data-game-tool="journal"
          aria-pressed={panel === 'journal'}
          aria-expanded={panel === 'journal'}
          aria-haspopup="dialog"
          onClick={() => togglePanel('journal')}
        >
          <History />
          {panel !== 'journal' && <span className="tool-label">Move history</span>}
        </button>
      </nav>
      <nav className="side-controls room-controls" aria-label="Room tools" data-panel-align="bottom">
        {/* Reactions sit beside the menu rather than in the column above,
            where a lone smiling face had nothing to belong to. Both are things
            you do to the room rather than to the board, and the lane has the
            width for two. */}
        <div className="tool-lane">
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
                  data-game-tool={entry.key}
                  aria-label={entry.label}
                  aria-pressed={panel === entry.key}
                  aria-expanded={panel === entry.key}
                  aria-haspopup="dialog"
                  disabled={entry.key === 'leave' && busy}
                  style={{ '--tool-order': entries.length - i - 1 } as CSSProperties}
                  onClick={entry.action}
                >
                  {entry.icon}
                  {panel !== entry.key && <span className="tool-label">{entry.label}</span>}
                </button>
              ))}
            </div>
          </div>
          {reactions}
        </div>
      </nav>
    </>
  );
}
