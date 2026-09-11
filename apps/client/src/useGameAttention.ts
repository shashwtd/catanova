import { useEffect, useRef } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { AttentionTracker, gameStatus, HOME_TITLE } from './game-attention.js';

export function useGameAttention(
  room: RoomState | null,
  me: string | undefined,
  connected: boolean,
  presenting: boolean,
  notify: (cue: 'turn' | 'warning') => void,
) {
  const tracker = useRef(new AttentionTracker());
  const callback = useRef(notify);
  callback.current = notify;
  const status = room?.game ? gameStatus(room.game, me) : null;
  const title =
    room && !connected
      ? 'Reconnecting — Catanova'
      : (status?.title ?? (room ? 'Lobby — Catanova' : HOME_TITLE));
  const icon = connected ? (status?.favicon ?? null) : null;
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    if (!icon) return;
    const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    existing.forEach((link) => link.remove());
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.sizes.value = 'any';
    link.href = `/branding/attention-${icon}.svg`;
    document.head.append(link);
    return () => {
      link.remove();
      existing.forEach((original) => document.head.append(original));
    };
  }, [icon]);
  useEffect(() => {
    const cue = tracker.current.update(room, me, connected, presenting);
    if (cue) callback.current(cue);
  }, [room, me, connected, presenting]);
  useEffect(
    () => () => {
      document.title = HOME_TITLE;
    },
    [],
  );
  return status;
}
