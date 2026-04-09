import { useSyncExternalStore } from 'react';

// Below Tailwind's md breakpoint (768px) = mobile
const mediaQuery = window.matchMedia('(max-width: 767px)');

function subscribe(callback: () => void) {
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getSnapshot() {
  return mediaQuery.matches;
}

/**
 * Hook to detect if the viewport is mobile-sized (<768px)
 * Reactive to viewport changes via matchMedia
 * @returns {boolean} True if viewport width < 768px
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
