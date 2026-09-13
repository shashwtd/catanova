import type { SVGProps } from 'react';
import { PAINTED_ICONS, ICON_ATLAS, ICON_ATLAS_WIDTH, ICON_ATLAS_HEIGHT } from './painted-icons.js';
export type GameIconName = keyof typeof PAINTED_ICONS;
export const GAME_ICON_NAMES = Object.keys(PAINTED_ICONS) as GameIconName[];
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & { size?: number | string };
/** Every icon shares one cached, small painted atlas. The SVG only crops its cell. */
export function GameIcon({ name, size = 24, className = '', ...props }: IconProps & { name: GameIconName }) {
  const [x, y] = PAINTED_ICONS[name];
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
  LogOut = icon('leave'),
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
