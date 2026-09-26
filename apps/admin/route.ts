/**
 * Hash routes (#/games/<room>?status=live), so every view has a link and the
 * server only ever serves one page.
 */
import { useEffect, useState } from 'react';

export const PAGES = [
  { id: 'overview', label: 'Overview' },
  { id: 'growth', label: 'Growth' },
  { id: 'games', label: 'Games' },
  { id: 'players', label: 'Players' },
  { id: 'stats', label: 'Stats' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'modes', label: 'Modes' },
  { id: 'system', label: 'System' },
  { id: 'audit', label: 'Audit' },
] as const;
export type Page = (typeof PAGES)[number]['id'];
export type Route = { page: Page; id: string | undefined; params: URLSearchParams };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [page = '', id] = path.split('/');
  let decoded: string | undefined;
  try {
    decoded = id ? decodeURIComponent(id) : undefined;
  } catch {
    decoded = undefined;
  }
  return {
    page: PAGES.some((candidate) => candidate.id === page) ? (page as Page) : 'overview',
    id: decoded,
    params: new URLSearchParams(query),
  };
}

export function go(page: Page, id?: string, params?: URLSearchParams) {
  const query = params?.toString();
  location.hash = `#/${page}${id ? `/${encodeURIComponent(id)}` : ''}${query ? `?${query}` : ''}`;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return parseRoute(hash);
}
