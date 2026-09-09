import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Prefer a normal Sharp installation. SHARP_MODULE can point to a bundled Sharp entry point.
const sharp = await import('sharp')
  .catch((error) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !process.env.SHARP_MODULE) throw error;
    return import(pathToFileURL(path.resolve(process.env.SHARP_MODULE)).href);
  })
  .then((module) => module.default);

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(project, 'apps/client/public');
const destination = path.join(publicDir, 'branding');
const inputs = {
  mark: path.join(publicDir, 'art/branding/catanova-mark-v2.png'),
  logo: path.join(publicDir, 'art/branding/catanova-logo-v2.png'),
  scenery: path.join(publicDir, 'art/title-landscape.png'),
};
const cream = '#f5ebd0';
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const sourceHashes = await Promise.all(
  Object.values(inputs).map(async (file) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
  ),
);
await mkdir(destination, { recursive: true });

async function icon(size, opaque = false) {
  // These approved display bounds trim unused source margins, without cutting the mark or spark.
  const contentSize = size <= 32 ? size : Math.round(size * (opaque ? 0.8 : 0.92));
  const inset = Math.floor((size - contentSize) / 2);
  const background = opaque ? cream : transparent;
  let output = sharp(inputs.mark)
    .extract({ left: 145, top: 105, width: 983, height: 1113 })
    .resize(contentSize, contentSize, { fit: 'contain', background })
    .extend({
      top: inset,
      bottom: size - contentSize - inset,
      left: inset,
      right: size - contentSize - inset,
      background,
    });
  if (opaque) output = output.flatten({ background: cream }).removeAlpha();
  return output.png({ palette: true, colours: 256, compressionLevel: 9, effort: 10 }).toBuffer();
}

const exports = [
  ['favicon-48.png', 48, false],
  ['favicon-96.png', 96, false],
  ['apple-touch-icon.png', 180, true],
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
];
for (const [name, size, opaque] of exports) {
  const data = await icon(size, opaque);
  await writeFile(path.join(destination, name), data);
}

// A standard ICO directory containing independent PNG frames, supported by modern browsers.
const icoSizes = [16, 32, 48];
const frames = await Promise.all(icoSizes.map((size) => icon(size)));
const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (let index = 0; index < frames.length; index++) {
  const position = 6 + index * 16;
  directory[position] = icoSizes[index];
  directory[position + 1] = icoSizes[index];
  directory.writeUInt16LE(1, position + 4);
  directory.writeUInt16LE(32, position + 6);
  directory.writeUInt32LE(frames[index].length, position + 8);
  directory.writeUInt32LE(offset, position + 12);
  offset += frames[index].length;
}
await writeFile(path.join(destination, 'favicon.ico'), Buffer.concat([directory, ...frames]));
for (let index = 0; index < frames.length; index++) {
  const frame = await sharp(frames[index]).metadata();
  if (frame.format !== 'png' || frame.width !== icoSizes[index] || frame.height !== icoSizes[index])
    throw new Error('Unexpected ICO frame');
}

// The social image composes the approved wordmark and scenery; neither source is repainted.
const sceneryMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="230">
  <defs><linearGradient id="fade" x2="0" y2="1"><stop stop-color="white" stop-opacity="0"/><stop offset=".34" stop-color="white"/></linearGradient></defs>
  <rect width="1200" height="230" fill="url(#fade)"/>
</svg>`);
const scenery = await sharp(inputs.scenery)
  .resize(1200, 230, { fit: 'cover', position: 'centre' })
  .ensureAlpha()
  .composite([{ input: sceneryMask, blend: 'dest-in' }])
  .png()
  .toBuffer();
const wordmark = await sharp(inputs.logo).resize({ width: 1080 }).png().toBuffer();
const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <text x="600" y="414" text-anchor="middle" fill="#245348" font-family="Arial, sans-serif" font-size="29" font-weight="500">Build. Trade. Play with friends.</text>
</svg>`);
await sharp({ create: { width: 1200, height: 630, channels: 3, background: cream } })
  .composite([
    { input: scenery, left: 0, top: 400 },
    { input: wordmark, left: 60, top: 25 },
    { input: caption, left: 0, top: 0 },
  ])
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toFile(path.join(destination, 'social-card.jpg'));

// Validate output geometry and source integrity on every export, without changing the source PNGs.
for (const [index, file] of Object.values(inputs).entries()) {
  const hash = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  if (hash !== sourceHashes[index]) throw new Error(`Source changed: ${file}`);
}
for (const [name, size, opaque] of exports) {
  const file = path.join(destination, name);
  const metadata = await sharp(file).metadata();
  if (metadata.width !== size || metadata.height !== size)
    throw new Error(`Unexpected icon dimensions: ${name}`);
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minAlpha = 255;
  for (let offset = 3; offset < data.length; offset += 4) minAlpha = Math.min(minAlpha, data[offset]);
  if ((opaque && minAlpha !== 255) || (!opaque && minAlpha !== 0))
    throw new Error(`Unexpected icon alpha: ${name}`);
  console.log(
    `${name}: ${size}×${size}, ${(await stat(file)).size} bytes, ${opaque ? 'opaque' : 'transparent'}`,
  );
}
const social = await sharp(path.join(destination, 'social-card.jpg')).metadata();
if (social.width !== 1200 || social.height !== 630 || social.hasAlpha)
  throw new Error('Unexpected social-card geometry or alpha');
console.log(
  `social-card.jpg: 1200×630, ${(await stat(path.join(destination, 'social-card.jpg'))).size} bytes, opaque`,
);
console.log(`favicon.ico: 16/32/48 PNG frames, ${offset} bytes`);
