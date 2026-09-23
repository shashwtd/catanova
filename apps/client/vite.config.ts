import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Sign-in imports the auth client only after /api/config answers, so a signed-in
 * player waited for the chunk after that round trip. Preloading it alongside the
 * entry lets both downloads overlap; the import then resolves from the preload.
 */
function preloadAuthClient(): Plugin {
  return {
    name: 'catanova:preload-auth-client',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const chunk = Object.values(bundle ?? {}).find(
          (file) => file.type === 'chunk' && !!file.facadeModuleId?.endsWith('/src/auth-client.ts'),
        );
        if (!chunk) throw new Error('The auth client is no longer a separate chunk to preload');
        return [
          {
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: `/${chunk.fileName}` },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}
export default defineConfig({
  plugins: [preloadAuthClient()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
      '/healthz': 'http://127.0.0.1:3000',
    },
  },
});
