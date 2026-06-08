import type { Theme, ThemeMode } from '../types';

// Status-bar / browser-chrome colors per resolved theme. These drive the
// <meta name="theme-color"> tag that Android (Chrome) uses to tint the PWA
// status bar. The status bar sits directly above the pinned header (bg-card),
// so these are the sRGB of the --card tokens in index.css — NOT --background —
// so the bar matches the header with no seam. The index.html bootstrap and the
// web manifest hardcode the same hexes (JS can't reach them pre-paint / from the
// OS); themeColors.test.ts asserts all the copies stay in sync.
export const THEME_COLORS: Record<Theme, string> = {
  light: '#fffdfb',
  dark: '#241e1a',
};

// Single source of truth for the header cycle button's tap order. `nextMode` is
// used by both the provider's cycleMode and the toggle's label, so the label
// announces exactly what the next tap resolves to — they can't drift apart.
const MODE_CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

export function nextMode(mode: ThemeMode): ThemeMode {
  return MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length];
}
