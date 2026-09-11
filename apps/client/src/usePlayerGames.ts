import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerGames } from '../../../packages/protocol/src/player-hub.js';
import { accountApi } from './account-api.js';

export function mergePlayerGames(previous: PlayerGames, next: PlayerGames): PlayerGames {
  return {
    ...next,
    games: [...new Map([...previous.games, ...next.games].map((game) => [game.roomId, game])).values()],
  };
}

/** Account-bound, cancellable reads; a late response can never show another account's history. */
export function usePlayerGames(
  owner: string | undefined,
  accessToken: () => Promise<string | undefined>,
  enabled: boolean,
) {
  const [state, setState] = useState<{
    owner?: string;
    data: PlayerGames | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: '', loading: false });
  const current = useRef({ owner, enabled, accessToken });
  current.current = { owner, enabled, accessToken };
  const request = useRef<{ controller: AbortController; owner: string } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const fetchPage = useCallback(async (more = false) => {
    const context = current.current;
    if (!context.owner || !context.enabled) return;
    const existing = stateRef.current.owner === context.owner ? stateRef.current.data : null;
    const cursor = more ? existing?.nextCursor : undefined;
    if (more && (!cursor || request.current)) return;
    request.current?.controller.abort();
    const work = { controller: new AbortController(), owner: context.owner };
    request.current = work;
    setState({ owner: context.owner, data: existing, error: '', loading: true });
    try {
      const token = await context.accessToken();
      if (work.controller.signal.aborted || current.current.owner !== work.owner || !current.current.enabled)
        return;
      const next = await accountApi.games(token, cursor ?? undefined, work.controller.signal);
      if (
        request.current !== work ||
        current.current.owner !== work.owner ||
        !current.current.enabled ||
        work.controller.signal.aborted
      )
        return;
      setState({
        owner: work.owner,
        data: more && existing ? mergePlayerGames(existing, next) : next,
        error: '',
        loading: false,
      });
    } catch (error) {
      if (
        request.current !== work ||
        current.current.owner !== work.owner ||
        !current.current.enabled ||
        work.controller.signal.aborted
      )
        return;
      setState({
        owner: work.owner,
        data: existing,
        error: error instanceof Error ? error.message : 'Could not load your games.',
        loading: false,
      });
    } finally {
      if (request.current === work) request.current = null;
    }
  }, []);
  useEffect(() => {
    if (!owner || !enabled) return;
    void fetchPage();
    const refresh = () => {
      if (document.visibilityState === 'visible' && !request.current) void fetchPage();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      request.current?.controller.abort();
      request.current = null;
    };
  }, [owner, enabled, fetchPage]);
  const mine = state.owner === owner && enabled;
  return {
    data: mine ? state.data : null,
    error: mine ? state.error : '',
    loading: !!owner && enabled && (!mine || state.loading),
    refresh: () => void fetchPage(),
    loadMore: () => void fetchPage(true),
  };
}
