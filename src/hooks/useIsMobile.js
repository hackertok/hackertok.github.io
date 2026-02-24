import { useState, useEffect } from 'react';

// Mobile breakpoint - matches Tailwind's sm breakpoint
const MOBILE_BREAKPOINT = 640;

/**
 * Hook to detect if the viewport is mobile-sized (≤640px)
 * Reactive to window resize
 * @returns {boolean} True if viewport width ≤ 640px
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    
    const handleChange = (e) => {
      setIsMobile(e.matches);
    };

    // Listen for changes
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
