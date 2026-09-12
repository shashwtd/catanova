import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyRoomInvites } from '../../../packages/protocol/src/room-invites.js';
import type { RoomInvitesState } from '../../../packages/protocol/src/room-invites.js';
import { accountApi } from './account-api.js';
import { FriendRequestQueue } from './social-presence.js';

/** Account-bound invitations are refreshed while visible; old accounts cannot publish into the next inbox. */
export function useRoomInvites(
  owner: string | undefined,
  accessToken: () => Promise<string | undefined>,
  enabled: boolean,
) {
  const [state, setState] = useState<{
    owner?: string;
    data: RoomInvitesState;
    loading: boolean;
    busy: string;
    error: string;
  }>({ data: emptyRoomInvites(), loading: false, busy: '', error: '' });
  const context = useRef({ owner, accessToken, enabled });
  context.current = { owner, accessToken, enabled };
  const queue = useRef(new FriendRequestQueue<RoomInvitesState>());
  const mutation = useRef<{ owner: string; key: string } | null>(null);
  const refresh = useCallback(async () => {
    const current = context.current;
    if (!current.owner || !current.enabled) return;
    const id = current.owner;
    setState((old) => ({
      owner: id,
      data: old.owner === id ? old.data : emptyRoomInvites(),
      busy: old.owner === id ? old.busy : '',
      loading: true,
      error: '',
    }));
    try {
      await queue.current.read(
        async (signal) => {
          const token = await current.accessToken();
          if (signal.aborted || context.current.owner !== id || !context.current.enabled)
            throw new Error('Account changed');
          return accountApi.roomInvites(token, signal);
        },
        (data) => {
          if (context.current.owner === id && context.current.enabled)
            setState((old) => ({ ...old, owner: id, data, loading: false, error: '' }));
        },
        () => {},
      );
    } catch (error) {
      if (context.current.owner === id && context.current.enabled)
        setState((old) => ({
          ...old,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load room invitations.',
        }));
    }
  }, []);
  const mutate = useCallback(
    async (key: string, action: (token: string | undefined, signal: AbortSignal) => Promise<unknown>) => {
      const current = context.current;
      if (!current.owner || !current.enabled || mutation.current?.owner === current.owner) return false;
      const id = current.owner;
      const work = { owner: id, key };
      mutation.current = work;
      setState((old) => ({ ...old, owner: id, busy: key, error: '' }));
      try {
        await queue.current.write(
          async (signal) => {
            const token = await current.accessToken();
            if (signal.aborted || context.current.owner !== id || !context.current.enabled)
              throw new Error('Account changed');
            await action(token, signal);
            if (signal.aborted || context.current.owner !== id || !context.current.enabled)
              throw new Error('Account changed');
            return accountApi.roomInvites(token, signal);
          },
          (data) => {
            if (context.current.owner === id && context.current.enabled)
              setState({ owner: id, data, loading: false, busy: '', error: '' });
          },
        );
        return context.current.owner === id && context.current.enabled;
      } catch (error) {
        if (context.current.owner === id && context.current.enabled)
          setState((old) => ({
            ...old,
            busy: '',
            loading: false,
            error: error instanceof Error ? error.message : 'Could not update this invitation.',
          }));
        return false;
      } finally {
        if (mutation.current === work) mutation.current = null;
      }
    },
    [],
  );
  useEffect(() => {
    if (!owner || !enabled) return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    update();
    const interval = setInterval(update, 5_000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      queue.current.reset();
      mutation.current = null;
      clearInterval(interval);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [owner, enabled, refresh]);
  const mine = state.owner === owner && enabled;
  return {
    ...(mine ? state.data : emptyRoomInvites()),
    loading: enabled && !!owner && (!mine || state.loading),
    busy: mine ? state.busy : '',
    error: mine ? state.error : '',
    refresh,
    send: (roomId: string, other: string) =>
      mutate(`send:${other}`, (token, signal) => accountApi.sendRoomInvite(token, roomId, other, signal)),
    dismiss: (id: string) =>
      mutate(`dismiss:${id}`, (token, signal) => accountApi.dismissRoomInvite(token, id, signal)),
  };
}
export type RoomInvitesController = ReturnType<typeof useRoomInvites>;
