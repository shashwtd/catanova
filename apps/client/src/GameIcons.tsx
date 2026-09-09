import type { ReactNode, SVGProps } from 'react';
/** A small original vector vocabulary: filled silhouettes, quiet ink edges and purposeful color. */
export const GAME_ICON_NAMES = [
  'dice',
  'next',
  'trade',
  'settlement',
  'city',
  'road',
  'robber',
  'discard',
  'development',
  'history',
  'settings',
  'volume',
  'muted',
  'connection',
  'disconnected',
  'leave',
  'invite',
  'profile',
  'close',
  'check',
  'plus',
  'back',
  'help',
  'fullscreen',
  'minimize',
  'crown',
  'trophy',
  'shield',
  'swords',
  'cards',
  'timer',
  'lock',
  'play',
  'pause',
  'edit',
  'copy',
  'link',
  'share',
  'refresh',
  'activity',
  'spark',
  'boat',
] as const;
export type GameIconName = (typeof GAME_ICON_NAMES)[number];
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & { size?: number | string };
const c = {
  ink: '#343b3a',
  paper: '#ecdfbd',
  blue: '#72a4b6',
  indigo: '#7181a3',
  green: '#8eac74',
  red: '#d78168',
  gold: '#d9b365',
  wood: '#a87b55',
  light: '#f7edce',
};
const paths: Record<GameIconName, ReactNode> = {
  dice: (
    <>
      <path fill={c.paper} d="M4 7q0-2 2-2l13 1q2 0 2 2l-1 13q0 2-2 2L5 22q-2 0-2-2Z" />
      <path fill={c.light} d="m13 10 12-2q2 0 3 2l2 12q0 2-2 3l-12 2q-2 0-2-2l-2-12q0-2 1-3Z" />
      <g fill={c.ink} stroke="none">
        <circle cx="8" cy="10" r="1.5" />
        <circle cx="9" cy="17" r="1.5" />
        <circle cx="18" cy="14" r="1.5" />
        <circle cx="25" cy="21" r="1.5" />
        <circle cx="22" cy="17.5" r="1.5" />
      </g>
    </>
  ),
  next: <path fill={c.blue} d="m5 11 13 .3-.5-6L29 16 17.5 27l.5-6L5 21q-2-5 0-10Z" />,
  back: <path fill={c.blue} d="m27 11-13 .3.5-6L3 16l11.5 11-.5-6 13-.1q2-5 0-9.9Z" />,
  trade: (
    <>
      <path fill={c.blue} d="M4 11c4-6 11-7 18-4V3l7 8-9 4 1-4c-5-3-9-2-13 2Z" />
      <path fill={c.green} d="M28 21c-4 6-11 7-18 4v4l-7-8 9-4-1 4c5 3 9 2 13-2Z" />
    </>
  ),
  settlement: (
    <>
      <path fill={c.paper} d="m7 14 18-.5-.5 14L7.5 28Z" />
      <path fill={c.red} d="M3 15 15.5 4 29 14l-3 3L16 9 6 18Z" />
      <path fill={c.wood} d="m13 28 .3-10 6 .3.2 9.7" />
      <path fill={c.blue} d="M9 18h2v4H9Z" strokeWidth="1" />
    </>
  ),
  city: (
    <>
      <path fill={c.paper} d="M5 27V12l11-1v16Zm13 0V17h10v10Z" />
      <path fill={c.blue} d="M2 12 10.5 4 19 12l-2 3-6.5-6L4 16Z" />
      <path fill={c.red} d="m16 17 6-6 8 7-2 3-6-5-4 4Z" />
      <path fill={c.ink} d="M9 21h4v6H9Zm12 0h3v6h-3Z" stroke="none" />
      <path d="M9 15h3v3H9Z" fill={c.gold} />
    </>
  ),
  road: (
    <>
      <path d="m5 25 5-7 6-2 4-8 7-2" fill="none" stroke={c.ink} strokeWidth="9" />
      <path d="m5 25 5-7 6-2 4-8 7-2" fill="none" stroke={c.wood} strokeWidth="6" />
      <path d="m5 21 5 3m1-7 4 4m3-12 5 3m1-6 3 4" stroke={c.paper} strokeWidth="1.3" />
    </>
  ),
  robber: (
    <>
      <path fill={c.indigo} d="M4 28 7 13Q9 3 16 2q7 1 9 11l3 15Z" />
      <path fill={c.ink} d="M8 16q1-8 8-9 7 1 8 9l-3 10H11Z" />
      <path d="m10 15 5 1m3 0 4-1" stroke={c.paper} strokeWidth="2" />
      <path d="m7 27 4-7m14 7-4-7" stroke={c.blue} strokeWidth="2" />
    </>
  ),
  discard: (
    <>
      <path fill={c.blue} d="m4 5 11-2 3 17-11 2Z" />
      <path fill={c.paper} d="m11 5 11 2-3 16-11-2Z" />
      <path fill={c.red} d="M23 13h5v9h3l-5.5 7-5.5-7h3Z" />
      <path d="M3 27h13" stroke={c.wood} strokeWidth="3" />
    </>
  ),
  development: (
    <>
      <path fill={c.indigo} d="m7 5 19-2 2 23-19 3Z" />
      <path fill={c.paper} d="m4 7 18 1-1 22-18-2Z" />
      <path fill={c.green} d="m13 11 2 5 5 1-4 4 .5 5-4.5-3-4 2 .5-5L5 16l5-1Z" strokeWidth="1.1" />
    </>
  ),
  history: (
    <>
      <circle cx="17" cy="16" r="10.5" fill={c.paper} />
      <path d="M6 10a12 12 0 1 1-1 12" fill="none" stroke={c.ink} strokeWidth="5" />
      <path d="M6 10a12 12 0 1 1-1 12" fill="none" stroke={c.blue} strokeWidth="3" />
      <path fill={c.blue} d="M2 4v10h10Z" />
      <path d="M17 9v8l5 3" fill="none" stroke={c.wood} strokeWidth="2.5" />
      <circle cx="17" cy="17" r="1.5" fill={c.ink} stroke="none" />
    </>
  ),
  settings: (
    <>
      <path
        fill={c.blue}
        d="m12 3 8 .3 1 4 4 1 3-1 3 7-4 3 1 4 1 3-6 4-3-3-4 1-3 3-6-4 1-4-2-3-4-1 1-7 4-1 2-3Z"
      />
      <circle cx="16" cy="16" r="5" fill={c.ink} />
      <path d="M12.5 15a4 4 0 0 1 5-3" stroke={c.light} fill="none" strokeWidth="1.2" />
    </>
  ),
  volume: (
    <>
      <path fill={c.red} d="M4 12h5l9-7v22l-9-7H4Z" />
      <path d="M22 10q7 6 0 12m4-16q11 10 0 20" fill="none" stroke={c.paper} strokeWidth="2.5" />
    </>
  ),
  muted: (
    <>
      <path fill={c.wood} d="M4 12h5l9-7v22l-9-7H4Z" />
      <path d="m22 12 7 8m0-8-7 8" stroke={c.red} strokeWidth="3" />
    </>
  ),
  connection: (
    <>
      <path
        d="M3 10a20 20 0 0 1 26 0M7 16a13.5 13.5 0 0 1 18 0M11.5 22a7 7 0 0 1 9 0"
        fill="none"
        stroke={c.ink}
        strokeWidth="6"
      />
      <path
        d="M3 10a20 20 0 0 1 26 0M7 16a13.5 13.5 0 0 1 18 0M11.5 22a7 7 0 0 1 9 0"
        fill="none"
        stroke={c.blue}
        strokeWidth="3.5"
      />
      <circle cx="16" cy="27" r="2.8" fill={c.paper} />
    </>
  ),
  disconnected: (
    <>
      <path
        d="M3 10a20 20 0 0 1 26 0M7 16a13.5 13.5 0 0 1 18 0M11.5 22a7 7 0 0 1 9 0"
        fill="none"
        stroke={c.ink}
        strokeWidth="6"
      />
      <path
        d="M3 10a20 20 0 0 1 26 0M7 16a13.5 13.5 0 0 1 18 0M11.5 22a7 7 0 0 1 9 0"
        fill="none"
        stroke={c.paper}
        strokeWidth="3.5"
      />
      <circle cx="16" cy="27" r="2.8" fill={c.paper} />
      <path d="M5 4 28 28" stroke={c.ink} strokeWidth="6.5" />
      <path d="M5 4 28 28" stroke={c.red} strokeWidth="3.5" />
    </>
  ),
  leave: (
    <>
      <path fill={c.paper} d="M4 29V4h15v25Z" />
      <path fill={c.wood} d="M6 5 16 8v21L6 27Z" />
      <path fill={c.blue} d="m15 14 8 .2V10l8 7-8 7v-4l-8 .2Z" />
      <circle cx="12" cy="17" r="1" fill={c.paper} stroke="none" />
    </>
  ),
  invite: (
    <>
      <path fill={c.blue} d="M1 27q1-11 9-11t9 11Z" />
      <circle cx="10" cy="9" r="5.7" fill={c.blue} />
      <path fill={c.green} d="M14 29q0-10 8-10t9 10Z" />
      <circle cx="22" cy="12" r="5.3" fill={c.green} />
    </>
  ),
  profile: (
    <>
      <path fill={c.blue} d="M4 29q0-12 12-12t12 12Z" />
      <path fill={c.paper} d="M10 5q6-4 12 1l-.5 8q-6 6-11 0Z" />
      <path fill={c.wood} d="M9 10q-3-9 6-8 11-2 9 8l-7-4-7 4Z" />
    </>
  ),
  close: <path fill={c.red} d="m7 4 9 8 9-8 4 4-9 8 9 9-4 4-9-9-9 9-4-4 9-9-9-8Z" />,
  check: <path fill={c.green} d="m3 17 5-4 6 7L26 4l4 4-16 22Z" />,
  plus: <path fill={c.green} d="M13 3h6l-.2 10 10-.2v6l-10-.1.2 10h-6l.2-10L3 19v-6l10.2.2Z" />,
  help: (
    <>
      <path fill={c.blue} d="M3 5q6-2 13 1 7-3 13-1v24q-7-2-13 0-6-2-13 0Z" />
      <path fill={c.paper} d="M5 3q6-1 11 3 5-4 11-3v21q-6-2-11 1-5-3-11-1Z" />
      <path
        d="M16 7v18M8 8l5 1M8 13l5 1M8 18l4 .8M19 10l5-1M19 15l5-1"
        fill="none"
        stroke={c.wood}
        strokeWidth="1.5"
      />
      <path fill={c.red} d="M22 18h4v11l-2-2-2 2Z" strokeWidth="1" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M12 3H3v9M20 3h9v9M3 20v9h9M20 29h9v-9" fill="none" stroke={c.ink} strokeWidth="6" />
      <path d="M12 3H3v9M20 3h9v9M3 20v9h9M20 29h9v-9" fill="none" stroke={c.blue} strokeWidth="3.5" />
      <path d="m4 4 6 6m18-6-6 6M4 28l6-6m18 6-6-6" stroke={c.paper} strokeWidth="2" />
    </>
  ),
  minimize: (
    <>
      <path d="M3 12h9V3m8 0v9h9M3 20h9v9m8 0v-9h9" fill="none" stroke={c.ink} strokeWidth="6" />
      <path d="M3 12h9V3m8 0v9h9M3 20h9v9m8 0v-9h9" fill="none" stroke={c.blue} strokeWidth="3.5" />
      <path d="m5 5 6 6m16-6-6 6M5 27l6-6m16 6-6-6" stroke={c.paper} strokeWidth="2" />
    </>
  ),
  crown: (
    <>
      <path fill={c.gold} d="M3 8 10 16 16 4l6 12 7-8-4 20H7Z" />
      <path d="M7 24h18" stroke={c.ink} />
      <path d="m16 15 3 4-3 4-3-4Z" fill={c.red} />
    </>
  ),
  trophy: (
    <>
      <path fill={c.gold} d="M9 5H3v4q0 9 9 9m11-13h6v4q0 9-9 9" />
      <path fill={c.gold} d="M8 3h16l-1 12q-1 5-6 6v5l7 2v2H8v-2l7-2v-5q-5-1-6-6Z" />
      <path d="M12 7v7" stroke={c.light} strokeWidth="2" />
    </>
  ),
  shield: (
    <>
      <path fill={c.paper} d="M3 6 16 2l13 4-2 15q-4 7-11 10-8-4-11-10Z" />
      <path fill={c.blue} d="m7 9 9-3 9 3-2 11q-3 4-7 7-5-3-7-7Z" />
      <path d="M16 7v18" stroke={c.paper} strokeWidth="1.4" />
    </>
  ),
  swords: (
    <>
      <path fill={c.paper} d="M3 2 10 5l16 20-3 3L5 9Z" />
      <path fill={c.blue} d="m29 2-7 3L6 25l3 3L27 9Z" />
      <path d="m4 22 8 7m9 0 7-7" stroke={c.wood} strokeWidth="4" />
    </>
  ),
  cards: (
    <>
      <path fill={c.blue} d="m1 9 12-4 7 20-12 4Z" />
      <path fill={c.green} d="m18 5 13 3-5 21-12-3Z" />
      <path fill={c.paper} d="M9 3h14l-1 24H9Z" />
      <path d="m16 9 3 5-3 5-3-5Z" fill={c.gold} />
    </>
  ),
  timer: (
    <>
      <path fill={c.blue} d="M7 5h18c0 7-3 8-7 11 4 3 7 4 7 11H7c0-7 3-8 7-11-4-3-7-4-7-11Z" />
      <path fill={c.gold} d="M10 10h12l-6 6Zm0 15 6-8 6 8Z" stroke="none" />
      <path d="M5 3h22M5 29h22" stroke={c.wood} strokeWidth="4" />
    </>
  ),
  lock: (
    <>
      <path d="M9 14V9q0-7 7-7t7 7v5" fill="none" stroke={c.paper} strokeWidth="4" />
      <path fill={c.red} d="m5 13 22 1-1 15H6Z" />
      <path d="M16 19v6" stroke={c.ink} strokeWidth="3" />
      <circle cx="16" cy="19" r="2" fill={c.ink} />
    </>
  ),
  play: <path fill={c.green} d="M8 3q-2 0-2 3v21q0 3 3 2l20-12q2-1 0-3Z" />,
  pause: (
    <>
      <path fill={c.blue} d="m6 3 7 1-.5 25-7-1Z" />
      <path fill={c.blue} d="m20 4 7-1-.5 25-7 1Z" />
    </>
  ),
  edit: (
    <>
      <path fill={c.paper} d="M6 25C8 11 13 2 29 2c-1 13-10 18-23 23Z" />
      <path d="M3 30 23 8m-8 12 5 .2m-9 4 6 .1" stroke={c.ink} strokeWidth="1.7" />
      <path fill={c.blue} d="M21 25h8v5h-8Z" />
    </>
  ),
  copy: (
    <>
      <path fill={c.blue} d="M11 3h16v23H11Z" />
      <path fill={c.paper} d="m5 7 16 1-.5 23L4 30Z" />
      <path d="M8 13h9M8 18h9M8 23h6" stroke={c.wood} strokeWidth="1.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M25 9a11 11 0 1 0 2 10" fill="none" stroke={c.blue} strokeWidth="5" />
      <path fill={c.green} d="M26 2 17 12l13 2Z" />
    </>
  ),
  link: (
    <>
      <path
        d="m13 8 3-3a7 7 0 0 1 10 10l-4 4m-3 5-3 3A7 7 0 0 1 6 17l4-4"
        fill="none"
        stroke={c.ink}
        strokeWidth="7"
      />
      <path
        d="m13 8 3-3a7 7 0 0 1 10 10l-4 4m-3 5-3 3A7 7 0 0 1 6 17l4-4"
        fill="none"
        stroke={c.blue}
        strokeWidth="4"
      />
      <path d="m11 21 10-10" stroke={c.paper} strokeWidth="3.5" />
    </>
  ),
  share: (
    <>
      <path d="m9 15 14-8M9 17l14 8" stroke={c.paper} strokeWidth="3" />
      <circle cx="7" cy="16" r="5" fill={c.blue} />
      <circle cx="25" cy="6" r="4.5" fill={c.green} />
      <circle cx="25" cy="26" r="4.5" fill={c.green} />
    </>
  ),
  activity: <path d="M2 18h6l4-10 6 18 5-12 3 4h4" fill="none" stroke={c.green} strokeWidth="3.5" />,
  spark: (
    <>
      <path fill={c.paper} d="m16 2 3 10 10 4-10 3-3 11-4-11-10-3 10-4Z" />
      <path d="m26 3 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill={c.blue} stroke="none" />
    </>
  ),
  boat: (
    <>
      <path d="M16 3v22" stroke={c.wood} strokeWidth="2" />
      <path fill={c.paper} d="M14 4 3 20h11Zm4 2v14h11Z" />
      <path fill={c.red} d="M2 23q15 3 28-1l-5 7H8Z" />
      <path d="M3 31h26" stroke={c.blue} strokeWidth="2" />
    </>
  ),
};
export function GameIcon({ name, size = 24, className = '', ...props }: IconProps & { name: GameIconName }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`game-icon ${className}`}
      fill="none"
      stroke={c.ink}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
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
