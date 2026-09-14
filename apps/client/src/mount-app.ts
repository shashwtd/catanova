import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

const rootKey = Symbol.for('catanova.react-root');
type AppContainer = HTMLElement & { [rootKey]?: Root };

/** One owner per document, including a repeated entry-script evaluation or dev reload. */
export function mountApp(container: AppContainer): Root {
  // A newly evaluated bundle may own a different React instance. Unmount its
  // predecessor instead of feeding new hooks into an older bundle's renderer.
  container[rootKey]?.unmount();
  // The public prerender is replaced once. It must never live beside the live app.
  container.replaceChildren();
  const root = createRoot(container);
  container[rootKey] = root;
  return root;
}
