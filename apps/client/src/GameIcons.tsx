import type { SVGProps } from 'react';
import { isBotLevel } from '../../../packages/protocol/src/bots.js';
import { PAINTED_ICONS, ICON_ATLAS, ICON_ATLAS_WIDTH, ICON_ATLAS_HEIGHT } from './painted-icons.js';
// Everyday controls use crisp, contextual ink; game pieces keep their painted artwork.
const CONTROL_PATHS = {
  settings:
    'M9 2h6v3l2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1v3H9v-3l-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1V2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  invite:
    'M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M3 21v-2a7 7 0 0 1 14 0v2 M18 4a4 4 0 0 1 0 8 M19 16a5 5 0 0 1 3 5',
  'add-friend': 'M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M2 21v-2a7 7 0 0 1 14 0v2 M19 8v6 M16 11h6',
  edit: 'm4 16 11-11 4 4L8 20l-5 1 1-5 M13 7l4 4 M15 5l2-2a2 2 0 0 1 3 3l-1 3',
  plus: 'M12 5v14 M5 12h14',
  copy: 'M9 8h11v13H9z M15 5V3H3v13h3',
  link: 'm9 15 6-6 M10 7l2-2a5 5 0 0 1 7 7l-2 2 M14 17l-2 2a5 5 0 0 1-7-7l2-2',
  share: 'M12 16V3 m-4 4 4-4 4 4 M5 12H3v9h18v-9h-2',
  refresh: 'M20 9a8 8 0 0 0-14-4L3 8 M3 3v5h5 M4 15a8 8 0 0 0 14 4l3-3 M16 16h5v5',
  bank: 'M3 9l9-6 9 6H3 M5 10v9 M10 10v9 M14 10v9 M19 10v9 M3 21h18',
  statistics: 'M4 20h17 M7 16v-5 M12 16V4 M17 16V8',
  menu: 'M5 6h14 M5 12h14 M5 18h14',
  // Sliders, not a cog. A cog is the everyday settings a player keeps for
  // themselves; this is the board being set up, which only the host touches.
  configure:
    'M3 7h3.5 M11.5 7h9.5 M3 12h9.5 M17.5 12h3.5 M3 17h4.5 M12.5 17h8.5 M6.5 7a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0 M12.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0 M7.5 17a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0',
  history: 'M4 7a9 9 0 1 1-1 9 M3 3v5h5 M12 7v5l4 2',
  join: 'M14 3h7v18h-7 M3 12h12 m-5-5 5 5-5 5',
  logout: 'M10 3H4v18h6 M9 12h12 M16 7l5 5-5 5',
  defeat: 'M5 3h14v8l-4 6-3-3-2 7-5-5V3 M12 3l-2 6 4 3',
  music: 'M9 18V5l11-2v13 M9 8l11-2 M9 18a3 3 0 1 1-3-3c2 0 3 1 3 3 M20 16a3 3 0 1 1-3-3c2 0 3 1 3 3',
  chevron: 'm9 5 7 7-7 7',
  'light-check': 'm4 12 5 5L20 6',
  'light-close': 'm6 6 12 12 M18 6 6 18',
  exchange: 'M4 8h15 m-4-4 4 4-4 4 M20 16H5 m4-4-4 4 4 4',
  'next-turn': 'M5 20v-7a5 5 0 0 1 5-5h10 m-5-5 5 5-5 5',
  play: 'm7 3 14 9-14 9V3',
  // Three machines from one drawing. The head, the ears and the aerial stay put
  // so they read as the same kind of thing; only the face and what is on top
  // change, which is enough to tell three players apart at portrait size.
  bot: 'M8.6 3.2 10 6 M15.4 3.2 14 6 M7 6h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3 M9 12v2 M15 12v2 M2 11v4 M22 11v4',
  'bot-sharp':
    'M12 3v3 M7 6h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3 M8.4 11.4 10.8 13 M15.6 11.4 13.2 13 M2 11v4 M22 11v4',

  smile: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M9 10v.5 M15 10v.5 M8 14a5 5 0 0 0 8 0',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  feedback:
    'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 9h8 M8 12.5h5',
  // Three tiles of an island: which game the table plays. Stands in until the painted icon is made.
  'game-mode':
    'M8 4l4 2.3v4.6L8 13.2l-4-2.3V6.3z M16 4l4 2.3v4.6l-4 2.3-4-2.3V6.3z M12 10.9l4 2.3v4.6l-4 2.3-4-2.3v-4.6z',
  // A ship and the way it sails: Open Sea's one ship move a turn.
  'move-ship': 'M3 15.5h12.5l-2 4H5z M9.5 15.5V4 M9.5 5l5 8h-5 M17 9.5h4.5 m-2-2 2 2-2 2',
} as const;
export type GameIconName = keyof typeof PAINTED_ICONS | keyof typeof CONTROL_PATHS;
export const GAME_ICON_NAMES = [
  ...new Set([...Object.keys(PAINTED_ICONS), ...Object.keys(CONTROL_PATHS)]),
] as GameIconName[];
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & { size?: number | string };
/** Painted game symbols share one cached atlas; utility paths add no network requests. */
export function GameIcon({ name, size = 24, className = '', ...props }: IconProps & { name: GameIconName }) {
  if (name in CONTROL_PATHS)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`game-icon control-icon ${className}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        <path d={CONTROL_PATHS[name as keyof typeof CONTROL_PATHS]} />
      </svg>
    );
  const [x, y] = PAINTED_ICONS[name as keyof typeof PAINTED_ICONS];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      overflow="hidden"
      className={`game-icon ${className}`}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <image href={ICON_ATLAS} x={-x} y={-y} width={ICON_ATLAS_WIDTH} height={ICON_ATLAS_HEIGHT} />
    </svg>
  );
}
/**
 * The GitHub mark, which is a filled silhouette rather than one of our strokes.
 *
 * It sits outside the icon sets on purpose: those are our own drawings and this
 * is somebody's logo, used the way it is meant to be, to mark a link to GitHub.
 */
export function GithubMark({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`github-mark ${className}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
const icon = (name: GameIconName) => (props: IconProps) => <GameIcon name={name} {...props} />;
export const Bot = icon('bot'),
  BotSharp = icon('bot-sharp'),
  Eye = icon('eye'),
  Smile = icon('smile'),
  Dices = icon('dice'),
  ArrowRight = icon('next'),
  ArrowLeftRight = icon('trade'),
  House = icon('settlement'),
  Castle = icon('city'),
  Route = icon('road'),
  Robber = icon('robber'),
  Discard = icon('discard'),
  ScrollText = icon('development'),
  History = icon('history'),
  Settings2 = icon('settings'),
  Volume2 = icon('volume'),
  VolumeX = icon('muted'),
  Wifi = icon('connection'),
  WifiOff = icon('disconnected'),
  DoorOpen = icon('leave'),
  LogOut = icon('logout'),
  Users = icon('invite'),
  UserRound = icon('profile'),
  X = icon('close'),
  Check = icon('check'),
  Plus = icon('plus'),
  ArrowLeft = icon('back'),
  CircleHelp = icon('help'),
  Maximize = icon('fullscreen'),
  Minimize = icon('minimize'),
  Crown = icon('crown'),
  Trophy = icon('trophy'),
  Shield = icon('shield'),
  Swords = icon('swords'),
  Layers = icon('cards'),
  Clock3 = icon('timer'),
  LockKeyhole = icon('lock'),
  Play = icon('play'),
  Pause = icon('pause'),
  Pencil = icon('edit'),
  Copy = icon('copy'),
  Link = icon('link'),
  Share2 = icon('share'),
  RefreshCw = icon('refresh'),
  Activity = icon('activity'),
  Sparkles = icon('spark'),
  Sailboat = icon('boat');
export const JoinRoom = icon('join'),
  ChevronRight = icon('chevron'),
  Defeat = icon('defeat'),
  Music = icon('music'),
  NextTurn = icon('next-turn'),
  Exchange = icon('exchange'),
  LightClose = icon('light-close'),
  LightCheck = icon('light-check'),
  Configure = icon('configure'),
  MessageSquare = icon('feedback'),
  GameMode = icon('game-mode');

/**
 * The champion.
 *
 * The same machine as the other two — one head, one pair of ears, one face —
 * wearing a crown instead of an aerial. What sets it apart is the finish: it is
 * the only one struck in gold rather than a flat ink, because it is the one you
 * are meant to spot across the table.
 */
const CHAMP = 'catanova-champion-gold';
export function BotChamp({ size = 24, className = '', ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`game-icon control-icon bot-champion ${className}`}
      fill="none"
      stroke={`url(#${CHAMP})`}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        {/* One id for every copy: they are identical, so a document holding
            four champions still paints the same gold. */}
        <linearGradient id={CHAMP} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#fff2c6" />
          <stop offset="0.45" stopColor="#e8b24d" />
          <stop offset="1" stopColor="#a9682b" />
        </linearGradient>
      </defs>
      <path d="M8.4 4 10.3 6 12 3.1 13.7 6 15.6 4" />
      <path d="M7 6h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3" />
      <path d="M9 12v2 M15 12v2 M2 11v4 M22 11v4" />
    </svg>
  );
}

/**
 * The mark beside a bot's name.
 *
 * It says "bot" and nothing else. Which of the three you have drawn is
 * something the drawing tells you and the game teaches you; naming the
 * difficulty on the seat would give away a game you have not played yet.
 */
export function BotMark({ level, size = 17 }: { level?: string; size?: number }) {
  const known = isBotLevel(level) ? level : 'steady';
  const Mark = known === 'champ' ? BotChamp : known === 'sharp' ? BotSharp : Bot;
  return (
    <span className="player-bot-tag" data-level={known} role="img" aria-label="Bot" title="Bot">
      <Mark size={size} />
    </span>
  );
}
