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
          className={`icon-button ${connected ? 'connected' : 'disconnected'}`}
          aria-label="Connection and ping"
          title="Connection and ping"
          aria-pressed={panel === 'network'}
          onClick={() => onPanel('network')}
        >
          {connected ? <Wifi /> : <WifiOff />}
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
            <button onClick={() => choose(() => onPanel('rules'))}>
              <CircleHelp />
              <span>How to play</span>
            </button>
            <button onClick={() => choose(() => onPanel('info'))}>
              <GameIcon name="info" />
              <span>Game rules</span>
            </button>
            <button onClick={() => choose(() => onPanel('settings'))}>
              <Settings2 />
              <span>Sound settings</span>
            </button>
            <button onClick={() => choose(onFullscreen)}>
              {fullscreen ? <Minimize /> : <Maximize />}
              <span>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
            </button>
            <button disabled={busy} onClick={() => choose(onLeave)}>
              <DoorOpen />
              <span>Leave game</span>
            </button>
          </div>
        </details>
      </nav>
    </>
  );
}
