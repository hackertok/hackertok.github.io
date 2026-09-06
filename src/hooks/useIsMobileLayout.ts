import { useMediaQuery } from './useMediaQuery';

// The question `md:` asks, asked the same way: 48rem, not the 768px it happens
// to equal at a 16px root. Every style around the header switches on `md:`, so
// a px query here would draw one layout's chrome under the other's styling for
// any reader whose default font size is not 16px. `rem` in a media query is
// that default, untouched by `html { font-size }` — `md:`'s rule too, so the
// two stay in step either way.
//
// Asked as the desktop side and inverted, so the two are exact complements
// rather than two edges that can drift past each other.
const DESKTOP_QUERY = '(min-width: 48rem)';

/**
 * Whether the viewport is narrower than `md:`.
 *
 * Shape only — how much chrome fits in the header. Which component tree mounts
 * is `useCanSwipe`, because a narrow window is not a finger.
 */
export function useIsMobileLayout(): boolean {
  // Unanswerable reads as desktop, as it always has.
  return !useMediaQuery(DESKTOP_QUERY, true);
}
