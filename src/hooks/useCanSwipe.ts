import { useIsMobileLayout } from './useIsMobileLayout';
import { useMediaQuery } from './useMediaQuery';

// The swipe viewer binds touch and nothing else — no keys, no wheel, no
// buttons — so mounting it for a reader without a finger is a dead end: the
// feed cannot be advanced at all. Width alone cannot tell us: a mouse user
// meets it by narrowing a window, and a low-vision reader on a large default
// font meets it at 1100px.
//
// Primary-pointer form on purpose. A touch laptop answers `hover: hover` and
// keeps the list, which is right — it has a mouse. (index.css asks the same
// thing in `any-` form, a different question: whether a finger *could* land on
// an element, so it suppresses the long-press that would eat a swipe.)
const TOUCH_PRIMARY_QUERY = '(pointer: coarse) and (hover: none)';

/**
 * Whether to mount the swipe viewer instead of the scrolling list.
 *
 * Needs both: a finger to drive the gesture, and a viewport narrow enough for
 * one story to fill it.
 */
export function useCanSwipe(): boolean {
  const isMobileLayout = useIsMobileLayout();
  // Unanswerable reads as no finger: the list works for everyone.
  const isTouchPrimary = useMediaQuery(TOUCH_PRIMARY_QUERY);
  return isMobileLayout && isTouchPrimary;
}
