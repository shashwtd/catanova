export type BoardTheme = 'storybook' | 'classic';
/**
 * Each theme's pictures. `gold` is the gold field's own 512-pixel tile, drawn like one cell of `terrain`. It
 * sits beside the 3 × 2 atlas rather than in it, so the six Classic tiles stay exactly as they are.
 */
export const BOARD_THEMES = {
  storybook: {
    terrain: '/art/optimized/terrain-storybook.102c1df356ce.webp',
    environment: '/art/optimized/environment-storybook.0265406d629e.webp',
    gold: '/art/optimized/gold-storybook.017351263200.webp',
    concept: true,
  },
  classic: {
    terrain: '/art/optimized/terrain-fantasy.777e0ac07117.webp',
    environment: '/art/optimized/environment-painted.00c506c983c0.webp',
    gold: '/art/optimized/gold-classic.5a9996f0725b.webp',
    concept: false,
  },
} as const;
