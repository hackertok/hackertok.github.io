import { useSyncExternalStore } from 'react';

// Below Tailwind's md breakpoint (768px) = mobile
const MOBILE_QUERY = '(max-width: 767px)';

// Lazily resolve the MediaQueryList. Resolving at module load would crash
// in any environment without a `window` (SSR, Node-side test harnesses,
// older jsdom revisions that don't ship matchMedia), and it would also
// fire before the test setup mock can install — so we defer until the
// first hook call and cache the result for subsequent subscribers.
let mediaQuery: MediaQueryList | null = null;
function getMediaQuery(): MediaQueryList | null {
  if (mediaQuery) return mediaQuery;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  mediaQuery = window.matchMedia(MOBILE_QUERY);
  return mediaQuery;
}

// useSyncExternalStore expects subscribe to return an unsubscribe fn
// — when matchMedia is unavailable (SSR / older jsdom), we have no
// listener to detach, so this is the correct shape.
const noopUnsubscribe = (): void => undefined;

function subscribe(callback: () => void): () => void {
  const mq = getMediaQuery();
  if (!mq) return noopUnsubscribe;
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  const mq = getMediaQuery();
  return mq ? mq.matches : false;
}

// SSR fallback for useSyncExternalStore — assume desktop. The hook
// re-runs on hydration with the real client snapshot, so this is only
// the value rendered into the SSR HTML; matching the more common
// (desktop) case minimizes hydration mismatch flicker for typical loads.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Hook to detect if the viewport is mobile-sized (<768px)
 * Reactive to viewport changes via matchMedia
 * @returns {boolean} True if viewport width < 768px
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
