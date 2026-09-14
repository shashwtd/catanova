import type { SVGProps } from 'react';
import { PAINTED_ICONS, ICON_ATLAS, ICON_ATLAS_WIDTH, ICON_ATLAS_HEIGHT } from './painted-icons.js';
// Everyday controls use crisp, contextual ink; game pieces keep their painted artwork.
const CONTROL_PATHS = {
  settings:
    'M9 2h6v3l2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1v3H9v-3l-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1V2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  invite:
    'M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M3 21v-2a7 7 0 0 1 14 0v2 M18 4a4 4 0 0 1 0 8 M19 16a5 5 0 0 1 3 5',
  edit: 'm4 16 11-11 4 4L8 20l-5 1 1-5 M13 7l4 4 M15 5l2-2a2 2 0 0 1 3 3l-1 3',
  plus: 'M12 5v14 M5 12h14',
  copy: 'M9 8h11v13H9z M15 5V3H3v13h3',
  link: 'm9 15 6-6 M10 7l2-2a5 5 0 0 1 7 7l-2 2 M14 17l-2 2a5 5 0 0 1-7-7l2-2',
  share: 'M12 16V3 m-4 4 4-4 4 4 M5 12H3v9h18v-9h-2',
  refresh: 'M20 9a8 8 0 0 0-14-4L3 8 M3 3v5h5 M4 15a8 8 0 0 0 14 4l3-3 M16 16h5v5',
  bank: 'M3 9l9-6 9 6H3 M5 10v9 M10 10v9 M14 10v9 M19 10v9 M3 21h18',
  statistics: 'M4 20h17 M7 16v-5 M12 16V4 M17 16V8',
  menu: 'M5 6h14 M5 12h14 M5 18h14',
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
const icon = (name: GameIconName) => (props: IconProps) => <GameIcon name={name} {...props} />;
export const Dices = icon('dice'),
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
  LightCheck = icon('light-check');
