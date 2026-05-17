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

// No-op unsubscribe for environments without matchMedia.
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

// SSR fallback: assume desktop.
function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
