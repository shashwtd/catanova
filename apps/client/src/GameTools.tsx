import { useRef } from 'react';
import {
  CircleHelp,
  DoorOpen,
  GameIcon,
  History,
  Maximize,
  Minimize,
  Settings2,
  Wifi,
  WifiOff,
} from './GameIcons.js';
export type GameToolPanel = 'journal' | 'network' | 'rules' | 'info' | 'settings' | 'leave';
/** Keep frequently used tools visible; group the rest in one labelled menu. */
export function GameTools({
  panel,
  onPanel,
  connected,
  fullscreen,
  onFullscreen,
  onLeave,
  busy = false,
}: {
  panel?: string | null;
  onPanel: (panel: GameToolPanel) => void;
  connected: boolean;
  fullscreen: boolean;
  onFullscreen: () => void;
  onLeave: () => void;
  busy?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const choose = (action: () => void) => {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    }
    action();
  };
  return (
    <>
      <nav className="side-controls game-controls" aria-label="Current game tools">
        <button
          className="icon-button"
          aria-label="Move history"
          title="Move history"
          aria-pressed={panel === 'journal'}
          onClick={() => onPanel('journal')}
        >
          <History />
        </button>
        <button
          className="icon-button fullscreen-control"
          onClick={onFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </button>
      </nav>
      <nav className="side-controls room-controls" aria-label="Room tools">
        <details
          ref={menu}
          className="game-tools-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              menu.current!.open = false;
              menu.current?.querySelector('summary')?.focus();
            }
          }}
        >
          <summary aria-label="Game menu" title="Game menu">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>Menu</span>
          </summary>
          <div className="game-tools-popover">
            <button aria-label="How to play" onClick={() => choose(() => onPanel('rules'))}>
              <CircleHelp />
              <span>How to play</span>
            </button>
            <button aria-label="Game rules" onClick={() => choose(() => onPanel('info'))}>
              <GameIcon name="info" />
              <span>Game rules</span>
            </button>
            <button aria-label="Settings" onClick={() => choose(() => onPanel('settings'))}>
              <Settings2 />
              <span>Settings</span>
            </button>
            <button
              title="Connection and ping"
              aria-label="Connection and ping"
              onClick={() => choose(() => onPanel('network'))}
            >
              {connected ? <Wifi /> : <WifiOff />}
              <span>Connection</span>
            </button>
            <button aria-label="Leave game" disabled={busy} onClick={() => choose(onLeave)}>
              <DoorOpen />
              <span>Leave game</span>
            </button>
          </div>
        </details>
      </nav>
    </>
  );
}
