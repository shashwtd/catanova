import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Explicit authoring tool, never part of the normal build. Use --check for read-only validation.
const check = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check'))
  throw new Error('Usage: node scripts/optimize-art.mjs [--check]');
const sharp = await import('sharp')
  .catch((error) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !process.env.SHARP_MODULE) throw error;
    return import(pathToFileURL(path.resolve(process.env.SHARP_MODULE)).href);
  })
  .then((module) => module.default);

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(project, 'docs/art/runtime-art.json');
const redirectsFile = path.join(project, 'apps/server/src/art-redirects.ts');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const outputPattern = /^\/art\/optimized\/([a-z0-9][a-z0-9_-]*)\.([a-f0-9]{12})\.webp$/;
const runtimeFile = (url) => path.join(project, 'apps/client/public', url);
function sourceFile(source) {
  const file = path.resolve(project, source);
  if (!file.startsWith(path.join(project, 'assets/source-art') + path.sep))
    throw new Error(`Source must be inside assets/source-art: ${source}`);
  return file;
}
async function alpha(data) {
  return sharp(data).ensureAlpha().extractChannel('alpha').raw().toBuffer();
}
async function atomicWrite(file, data) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (!Array.isArray(manifest.images) || !manifest.images.length) throw new Error('No art in manifest');
const seen = new Set();
const legacyUrls = new Set();
const exports = [];
for (const previous of manifest.images) {
  const match = outputPattern.exec(previous.url);
  if (
    !match ||
    !/^[a-f0-9]{64}$/.test(previous.sha256) ||
    !previous.sha256.startsWith(match[2]) ||
    seen.has(previous.url) ||
    !/^\/art\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.png$/.test(previous.legacyUrl) ||
    legacyUrls.has(previous.legacyUrl) ||
    !Number.isInteger(previous.quality) ||
    previous.quality < 1 ||
    previous.quality > 100
  )
    throw new Error(`Invalid or duplicate runtime image: ${previous.url}`);
  seen.add(previous.url);
  legacyUrls.add(previous.legacyUrl);
  const source = await readFile(sourceFile(previous.source));
  const metadata = await sharp(source).metadata();
  if (metadata.format !== 'png' || metadata.width !== previous.width || metadata.height !== previous.height)
    throw new Error(`Source geometry changed: ${previous.source}`);
  const data = check
    ? await readFile(runtimeFile(previous.url))
    : await sharp(source)
        .webp({ quality: previous.quality, alphaQuality: 100, effort: 6, smartSubsample: true })
        .toBuffer();
  const output = await sharp(data).metadata();
  if (output.format !== 'webp' || output.width !== metadata.width || output.height !== metadata.height)
    throw new Error(`Export changed dimensions: ${previous.source}`);
  if (!(await alpha(source)).equals(await alpha(data)))
    throw new Error(`Export changed transparency: ${previous.source}`);
  const sha256 = hash(data);
  const next = {
    ...previous,
    url: `/art/optimized/${match[1]}.${sha256.slice(0, 12)}.webp`,
    sha256,
    sourceSha256: hash(source),
    originalBytes: source.length,
    bytes: data.length,
  };
  if (
    check &&
    ['url', 'sha256', 'sourceSha256', 'originalBytes', 'bytes'].some((key) => next[key] !== previous[key])
  )
    throw new Error(`Manifest does not match ${previous.source}; export again after reviewing the change`);
  exports.push({ previous, next, data });
}

if (check) {
  const redirects = await readFile(redirectsFile, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (redirects !== null) {
    // Read the generated string pairs without evaluating TypeScript; allow Prettier line wrapping.
    const pairs = [...redirects.matchAll(/['"]([^'"\n]+)['"]\s*:\s*['"]([^'"\n]+)['"]/g)];
    const expected = new Map(exports.map(({ next }) => [next.legacyUrl, next.url]));
    if (
      pairs.length !== expected.size ||
      new Set(pairs.map(([, from]) => from)).size !== expected.size ||
      pairs.some(([, from, to]) => expected.get(from) !== to)
    )
      throw new Error('Art redirects do not match the manifest; export again');
  }
}

let updatedFiles = 0;
if (!check) {
  // Materialize every new image before changing references. Keep old images until all writes succeed.
  await mkdir(path.join(project, 'apps/client/public/art/optimized'), { recursive: true });
  for (const { next, data } of exports) {
    const destination = runtimeFile(next.url);
    const existing = await readFile(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing && hash(existing) !== next.sha256)
      throw new Error(`Refusing to replace different content at an immutable URL: ${next.url}`);
    if (!existing) await atomicWrite(destination, data);
  }
  const replacements = new Map(
    exports
      .filter(({ previous, next }) => previous.url !== next.url)
      .map(({ previous, next }) => [previous.url, next.url]),
  );
  async function updateReferences(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await updateReferences(file);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|css|html|json)$/.test(entry.name)) {
        const original = await readFile(file, 'utf8');
        let updated = original;
        for (const [from, to] of replacements) updated = updated.replaceAll(from, to);
        if (updated !== original) {
          await atomicWrite(file, updated);
          updatedFiles++;
        }
      }
    }
  }
  for (const directory of ['apps/client/src', 'apps/client/public/guide', 'tests'])
    await updateReferences(path.join(project, directory));
  await mkdir(path.dirname(redirectsFile), { recursive: true });
  await atomicWrite(
    redirectsFile,
    '// Generated from docs/art/runtime-art.json by scripts/optimize-art.mjs.\n' +
      'export const ART_REDIRECTS: Readonly<Record<string, string>> = {\n' +
      exports.map(({ next }) => `  '${next.legacyUrl}': '${next.url}',\n`).join('') +
      '};\n',
  );
  await atomicWrite(
    manifestFile,
    JSON.stringify({ ...manifest, images: exports.map(({ next }) => next) }, null, 2) + '\n',
  );
  const currentUrls = new Set(exports.map(({ next }) => next.url));
  for (const { previous } of exports)
    if (!currentUrls.has(previous.url)) await rm(runtimeFile(previous.url), { force: true });
}

const originalBytes = exports.reduce((sum, { next }) => sum + next.originalBytes, 0);
const bytes = exports.reduce((sum, { next }) => sum + next.bytes, 0);
console.log(
  `${check ? 'Verified' : 'Exported'} ${exports.length} images: ${originalBytes.toLocaleString()} → ${bytes.toLocaleString()} bytes (${((1 - bytes / originalBytes) * 100).toFixed(1)}% smaller); full dimensions and alpha retained.`,
);
if (!check) console.log(`Updated ${updatedFiles} reference files. Source PNGs were not changed.`);
