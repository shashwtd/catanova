import { defineConfig } from 'vite';

/**
 * The admin console is served under a CSP of `script-src 'self'; style-src
 * 'self'`, so the build must never inline anything: no data-URI assets and no
 * inline module-preload polyfill. `npm run dev:admin` proxies the API to a
 * local admin listener (ADMIN_AUTH=local-dev); set ADMIN_ORIGIN to
 * http://127.0.0.1:5174 for that listener so changes are accepted from here.
 */
export default defineConfig({
  build: {
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api/admin': `http://127.0.0.1:${process.env.ADMIN_PORT ?? '3100'}`,
    },
  },
});
