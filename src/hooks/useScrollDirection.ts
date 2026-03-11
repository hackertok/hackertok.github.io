import { useState, useEffect, useRef } from 'react';

export function useScrollDirection(): { scrollDirection: 'up' | 'down'; isAtTop: boolean } {
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up');
  const [isAtTop, setIsAtTop] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const threshold = 10; // Minimum scroll amount before changing direction

    const updateScrollDir = () => {
      const scrollY = window.scrollY;
      
      setIsAtTop(scrollY < 50);

      if (Math.abs(scrollY - lastScrollY.current) < threshold) {
        ticking.current = false;
        return;
      }

      setScrollDirection(scrollY > lastScrollY.current ? 'down' : 'up');
      lastScrollY.current = scrollY > 0 ? scrollY : 0;
      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDir);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { scrollDirection, isAtTop };
}
