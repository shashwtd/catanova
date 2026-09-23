/**
 * Every call carries X-Catanova-Admin: 1, which the server requires and a
 * cross-site page cannot add. Redirects are not followed: when the Cloudflare
 * Access session ends, a call answers with a redirect to the login page, and
 * the console asks for a reload instead of silently failing.
 */
import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        'X-Catanova-Admin': '1',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server.');
  }
  const json = response.headers.get('content-type')?.includes('application/json');
  if (response.type === 'opaqueredirect' || ((response.status === 401 || response.status === 403) && !json)) {
    for (const listener of expiredListeners) listener();
    throw new ApiError(401, 'SESSION', 'Your admin session has ended. Reload to sign in again.');
  }
  const text = await response.text();
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = null;
  }
  if (!response.ok) {
    const error = (value as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'ERROR',
      error?.message ??
        (response.status === 429
          ? 'Too many requests. Wait a moment.'
          : `Request failed (${response.status}).`),
    );
  }
  return value as T;
}

export type Loaded<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  updatedAt: number | undefined;
  reload: () => void;
};

/**
 * Loads a path, again whenever it changes, and every `refreshMs` while the tab
 * is visible. A null path loads nothing.
 */
export function useApi<T>(path: string | null, refreshMs?: number): Loaded<T> {
  type State = { path: string | null; data?: T; error?: ApiError; loading: boolean; updatedAt?: number };
  const [state, setState] = useState<State>({ path, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ path, loading: false });
      return;
    }
    const controller = new AbortController();
    // A refresh keeps what is on screen; a different path starts empty.
    setState((previous) =>
      previous.path === path ? { ...previous, loading: true } : { path, loading: true },
    );
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ path, data, loading: false, updatedAt: Date.now() }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          ...(previous.path === path ? previous : { path }),
          loading: false,
          error: error instanceof ApiError ? error : new ApiError(0, 'ERROR', 'Something went wrong.'),
        }));
      });
    return () => controller.abort();
  }, [path, tick]);
  useEffect(() => {
    if (!refreshMs || !path) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, path]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const current = state.path === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: current ? state.loading : !!path,
    updatedAt: current ? state.updatedAt : undefined,
    reload,
  };
}
