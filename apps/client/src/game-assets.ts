export const TERRAIN_ART = '/art/optimized/terrain-fantasy.777e0ac07117.webp';
export const ENVIRONMENT_ART = '/art/optimized/environment-painted.00c506c983c0.webp';
export const GAME_ART = [
  TERRAIN_ART,
  ENVIRONMENT_ART,
  '/art/optimized/environment-dark.c55c6de597e4.webp',
  '/art/optimized/sprites-fantasy.3aaf69915ec6.webp',
  '/art/optimized/avatars-fantasy.6bf04e83341a.webp',
  '/art/optimized/development-cards.d7fcdf84252a.webp',
  '/art/optimized/portrait-frame.de152d0c9426.webp',
] as const;

/** Shared decoded images prevent lobby preloading and the terrain renderer doing the same work twice. */
export function createImageCache(makeImage: () => HTMLImageElement = () => new Image(), timeoutMs = 8_000) {
  const cache = new Map<string, Promise<HTMLImageElement>>();
  return (src: string) => {
    const cached = cache.get(src);
    if (cached) return cached;
    const pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = makeImage();
      const timer = setTimeout(() => reject(new Error('An image took too long to load')), timeoutMs);
      image.decoding = 'async';
      image.src = src;
      void image.decode().then(
        () => {
          clearTimeout(timer);
          if (!image.naturalWidth) reject(new Error('An image could not be decoded'));
          else resolve(image);
        },
        () => {
          clearTimeout(timer);
          reject(new Error('An image could not load'));
        },
      );
    });
    cache.set(src, pending);
    void pending.catch(() => {
      if (cache.get(src) === pending) cache.delete(src);
    });
    return pending;
  };
}
export const decodedGameImage = createImageCache();
/** Three concurrent decodes limit memory spikes on phones. Music streams independently. */
export async function preloadGameArt(onProgress?: (ready: number, total: number) => void) {
  let cursor = 0,
    ready = 0;
  onProgress?.(ready, GAME_ART.length);
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < GAME_ART.length) {
        const src = GAME_ART[cursor++]!;
        await decodedGameImage(src);
        onProgress?.(++ready, GAME_ART.length);
      }
    }),
  );
}

let gameFonts: Promise<void> | undefined;
export function preloadGameFonts(fonts: Pick<FontFaceSet, 'load'> = document.fonts, timeoutMs = 8_000) {
  if (gameFonts) return gameFonts;
  const request = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Game fonts took too long to load')), timeoutMs);
    void Promise.all([
      fonts.load('400 16px Barlow'),
      fonts.load('500 16px Barlow'),
      fonts.load('600 16px Barlow'),
      fonts.load('600 16px Cinzel'),
      fonts.load('700 16px Cinzel'),
    ]).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        reject(new Error('Game fonts could not load'));
      },
    );
  });
  gameFonts = request;
  void request.catch(() => {
    if (gameFonts === request) gameFonts = undefined;
  });
  return request;
}
export async function preloadGameAssets(onProgress?: (ready: number, total: number) => void) {
  await Promise.all([preloadGameArt(onProgress), preloadGameFonts()]);
}
