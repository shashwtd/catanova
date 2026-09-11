import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createImageCache, GAME_ART, preloadGameFonts } from '../apps/client/src/game-assets.js';

test('game art is decoded once across warmup and renderer requests', async () => {
  let count = 0;
  let done!: () => void;
  const wait = new Promise<void>((resolve) => {
    done = resolve;
  });
  const image = {
    src: '',
    naturalWidth: 512,
    decode: () => {
      count++;
      return wait;
    },
  } as unknown as HTMLImageElement;
  const load = createImageCache(() => image);
  const first = load('/tile.webp'),
    second = load('/tile.webp');
  assert.equal(first, second);
  done();
  assert.equal(await first, image);
  assert.equal(await load('/tile.webp'), image);
  assert.equal(count, 1);
});
test('failed or timed-out art can be retried; late old decode cannot replace the new image', async () => {
  let attempt = 0;
  let late!: () => void;
  const image = { src: '', naturalWidth: 512, decode: async () => {} } as unknown as HTMLImageElement;
  const load = createImageCache(
    () =>
      ++attempt === 1
        ? ({
            src: '',
            naturalWidth: 512,
            decode: () =>
              new Promise<void>((resolve) => {
                late = resolve;
              }),
          } as unknown as HTMLImageElement)
        : image,
    5,
  );
  await assert.rejects(load('/tile.webp'), /too long/);
  assert.equal(await load('/tile.webp'), image);
  late();
  await Promise.resolve();
  assert.equal(await load('/tile.webp'), image);
  assert.equal(attempt, 2);
});
test('essential game art exists, is versioned and stays below a 3 MB first-load budget', async () => {
  let bytes = 0;
  for (const path of GAME_ART) {
    assert.match(path, /\.[a-f0-9]{12}\.webp$/);
    bytes += (await stat(`apps/client/public${path}`)).size;
  }
  assert.ok(bytes < 3_000_000, `Game art is ${bytes} bytes`);
});

test('font failures release readiness for retry and successful font loads are shared', async () => {
  await assert.rejects(
    preloadGameFonts({
      load: async () => {
        throw new Error('network');
      },
    }),
    /could not load/,
  );
  let loads = 0;
  const fonts = {
    load: async () => {
      loads++;
      return [] as FontFace[];
    },
  };
  const first = preloadGameFonts(fonts);
  assert.equal(preloadGameFonts(fonts), first);
  await first;
  assert.equal(loads, 5);
});
