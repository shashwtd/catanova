import test from 'node:test';
import assert from 'node:assert/strict';
import type { IndexHtmlTransformContext, Plugin } from 'vite';
import config from '../apps/client/vite.config.js';

test('the page preloads the auth client chunk instead of waiting for /api/config to request it', () => {
  const plugin = (config.plugins as Plugin[]).find((p) => p.name === 'catanova:preload-auth-client')!;
  // The handler needs no plugin context, so it is called as a plain function.
  const transform = (plugin.transformIndexHtml as { handler: Function }).handler as (
    html: string,
    context: IndexHtmlTransformContext,
  ) => unknown;
  const chunk = (fileName: string, facadeModuleId: string | null) => ({
    type: 'chunk' as const,
    fileName,
    facadeModuleId,
  });
  const context = (files: ReturnType<typeof chunk>[]) =>
    ({
      path: '/index.html',
      filename: 'index.html',
      bundle: Object.fromEntries(files.map((file) => [file.fileName, file])),
    }) as unknown as IndexHtmlTransformContext;
  const entry = chunk('assets/index-a1.js', '/repo/apps/client/index.html');
  assert.deepEqual(
    transform(
      '',
      context([entry, chunk('assets/auth-client-b2.js', '/repo/apps/client/src/auth-client.ts')]),
    ),
    [
      {
        tag: 'link',
        attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/auth-client-b2.js' },
        injectTo: 'head',
      },
    ],
  );
  assert.throws(
    () => transform('', context([entry])),
    /no longer a separate chunk/,
    'a build that folds the client into the entry must not silently drop the preload',
  );
});
