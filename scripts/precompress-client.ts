import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipFile = promisify(gzip);
const textAsset = /\.(?:html|js|css|svg|json|xml|txt|webmanifest)$/i;

/** Compress at build time; binary artwork/fonts already use compressed formats. */
export async function precompressClient(directory: string) {
  const totals = { files: 0, originalBytes: 0, brotliBytes: 0, gzipBytes: 0 };
  async function visit(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && textAsset.test(entry.name)) {
        // Rerunning the build step cannot retain an old or now-unhelpful variant.
        await Promise.all([rm(`${file}.br`, { force: true }), rm(`${file}.gz`, { force: true })]);
        const input = await readFile(file);
        if (input.length < 512) continue;
        const [br, gz] = await Promise.all([
          brotli(input, {
            params: {
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
              [constants.BROTLI_PARAM_QUALITY]: 9,
            },
          }),
          gzipFile(input, { level: 9 }),
        ]);
        // Only ship sidecars that save at least ten percent.
        const saveBr = br.length <= input.length * 0.9;
        const saveGzip = gz.length <= input.length * 0.9;
        if (saveBr) await writeFile(`${file}.br`, br);
        if (saveGzip) await writeFile(`${file}.gz`, gz);
        totals.files += 1;
        totals.originalBytes += input.length;
        totals.brotliBytes += saveBr ? br.length : input.length;
        totals.gzipBytes += saveGzip ? gz.length : input.length;
      }
    }
  }
  await visit(directory);
  return totals;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const totals = await precompressClient(resolve('dist/client'));
  console.info(
    `Static text: ${totals.files} files, ${totals.originalBytes} bytes → ${totals.brotliBytes} Brotli / ${totals.gzipBytes} gzip bytes.`,
  );
}
