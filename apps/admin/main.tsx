/**
 * The Catanova admin console. Served only by the admin listener, behind
 * Cloudflare Access; no third-party scripts, fonts, styles or analytics, and
 * nothing inline, so the page runs under `script-src 'self'; style-src 'self'`.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdminSession } from '../server/src/admin/types.js';
import { onSessionExpired, useApi } from './api.js';
import { PAGES, useRoute } from './route.js';
import { Failure } from './ui.js';
import { Overview } from './pages/Overview.js';
import { GameDetail, Games } from './pages/Games.js';
import { PlayerDetail, Players } from './pages/Players.js';
import { Stats } from './pages/Stats.js';
import { Feedback } from './pages/Feedback.js';
import { System } from './pages/System.js';
import { Audit } from './pages/Audit.js';
import './admin.css';

function App() {
  const route = useRoute();
  const session = useApi<AdminSession>('/api/admin/session');
  const [expired, setExpired] = useState(false);
  useEffect(() => onSessionExpired(() => setExpired(true)), []);
  useEffect(() => {
    const label = PAGES.find((page) => page.id === route.page)?.label ?? 'Overview';
    document.title = `${label} · Catanova admin`;
  }, [route.page]);
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/overview">
          Catanova <span>admin</span>
        </a>
        <nav className="nav" aria-label="Admin sections">
          {PAGES.map((page) => (
            <a key={page.id} href={`#/${page.id}`} aria-current={route.page === page.id ? 'page' : undefined}>
              {page.label}
            </a>
          ))}
        </nav>
        <div className="who">
          {session.data ? (
            <>
              <span>{session.data.actor}</span>
              {session.data.mode === 'local-dev' && <span className="badge badge-warning">local</span>}
            </>
          ) : null}
        </div>
      </header>
      {expired && (
        <div className="notice notice-critical banner" role="alert">
          Your admin session has ended.
          <button type="button" className="button" onClick={() => location.reload()}>
            Reload to sign in
          </button>
        </div>
      )}
      <main className="page">
        <Failure error={session.error?.code === 'SESSION' ? undefined : session.error} />
        {route.page === 'overview' && <Overview />}
        {route.page === 'games' &&
          (route.id ? <GameDetail roomId={route.id} /> : <Games params={route.params} />)}
        {route.page === 'players' &&
          (route.id ? <PlayerDetail userId={route.id} /> : <Players params={route.params} />)}
        {route.page === 'stats' && <Stats />}
        {route.page === 'feedback' && <Feedback params={route.params} />}
        {route.page === 'system' && <System />}
        {route.page === 'audit' && <Audit />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
