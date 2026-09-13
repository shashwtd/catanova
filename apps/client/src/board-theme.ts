export type BoardTheme = 'storybook' | 'classic';
export const BOARD_THEMES = {
  storybook: {
    terrain: '/art/optimized/terrain-storybook.102c1df356ce.webp',
    environment: '/art/optimized/environment-storybook.0265406d629e.webp',
    concept: true,
  },
  classic: {
    terrain: '/art/optimized/terrain-fantasy.777e0ac07117.webp',
    environment: '/art/optimized/environment-painted.00c506c983c0.webp',
    concept: false,
  },
} as const;
