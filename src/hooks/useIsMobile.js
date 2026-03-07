import { useSyncExternalStore } from 'react';

// Mobile breakpoint - matches Tailwind's sm breakpoint
const MOBILE_BREAKPOINT = 640;

const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

function subscribe(callback) {
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getSnapshot() {
  return mediaQuery.matches;
}

/**
 * Hook to detect if the viewport is mobile-sized (≤640px)
 * Reactive to viewport changes via matchMedia
 * @returns {boolean} True if viewport width ≤ 640px
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
