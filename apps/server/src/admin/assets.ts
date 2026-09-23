/**
 * The built admin interface, read into memory once at startup.
 *
 * Requests are answered from an exact map of the files Vite produced, so no
 * request path is ever turned into a filesystem path: there is nothing to
 * traverse. The bundle is small, and a restart picks up a new build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

export type AdminAsset = { body: Buffer; type: string };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export function loadAdminAssets(directory: string): Map<string, AdminAsset> | null {
  let root: string;
  try {
    if (!statSync(directory).isDirectory()) return null;
    root = directory;
  } catch {
    return null;
  }
  const assets = new Map<string, AdminAsset>();
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const type = TYPES[extname(entry.name).toLowerCase()];
        // Source maps and anything unexpected stay on disk.
        if (!type) continue;
        const body = readFileSync(file);
        total += body.length;
        if (total > MAX_TOTAL_BYTES) throw new Error('The admin build is unexpectedly large');
        assets.set('/' + relative(root, file).split(sep).join('/'), { body, type });
      }
    }
  };
  walk(root);
  const index = assets.get('/index.html');
  if (!index) return null;
  assets.set('/', index);
  assets.delete('/index.html');
  return assets;
}
