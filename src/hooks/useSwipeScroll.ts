import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useScrollContainer } from './useScrollContainer';

interface UseSwipeScrollOptions {
  itemCount: number;
  initialIndex?: number;
  enabled?: boolean;
}

interface UseSwipeScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentIndex: number;
  currentIndexRef: React.MutableRefObject<number>;
  scrollToIndex: (index: number) => void;
  isScrollingProgrammaticallyRef: React.MutableRefObject<boolean>;
}

export function useSwipeScroll({
  itemCount,
  initialIndex = 0,
  enabled = true,
}: UseSwipeScrollOptions): UseSwipeScrollResult {
  const { enableSwipeMode, disableSwipeMode } = useScrollContainer();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(currentIndex);
  const itemCountRef = useRef(itemCount);
  const isScrollingProgrammaticallyRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useLayoutEffect(() => {
    itemCountRef.current = itemCount;
  }, [itemCount]);

  useLayoutEffect(() => {
    enableSwipeMode();
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      disableSwipeMode();
      history.scrollRestoration = previousScrollRestoration;
    };
  }, [enableSwipeMode, disableSwipeMode]);

  const scrollToIndex = useCallback((index: number) => {
    isScrollingProgrammaticallyRef.current = true;
    setCurrentIndex(index);

    const el = containerRef.current;
    const panelWidth = el ? el.clientWidth : window.innerWidth;
    const targetLeft = index * panelWidth;
    if (el) {
      el.scrollTo({ left: targetLeft, behavior: 'instant' });
    }
    requestAnimationFrame(() => {
      if (containerRef.current && Math.round(containerRef.current.scrollLeft / (containerRef.current.clientWidth || window.innerWidth)) !== index) {
        containerRef.current.scrollTo({ left: index * containerRef.current.clientWidth, behavior: 'instant' });
      }
      setTimeout(() => {
        isScrollingProgrammaticallyRef.current = false;
      }, 100);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const updateIndex = () => {
      // Check the programmatic flag BEFORE clearing the debounce timeout.
      // When scrollend fires during the programmatic window, returning early
      // without clearing the timeout preserves the pending handleScroll callback
      // that will re-invoke updateIndex after the flag clears.
      if (isScrollingProgrammaticallyRef.current) return;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }

      const scrollLeft = container.scrollLeft;
      const panelWidth = container.clientWidth;
      const newIndex = Math.round(scrollLeft / panelWidth);

      if (newIndex !== currentIndexRef.current && newIndex >= 0 && newIndex < itemCountRef.current) {
        setCurrentIndex(newIndex);
      }
    };

    // Always schedule — filtering here would lose the final position update
    // after programmatic scrolls; updateIndex checks the flag instead.
    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(updateIndex, 150);
    };

    const hasScrollEnd = 'onscrollend' in window;
    if (hasScrollEnd) {
      container.addEventListener('scrollend', updateIndex, { passive: true });
    }
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (hasScrollEnd) {
        container.removeEventListener('scrollend', updateIndex);
      }
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [enabled]);

  return {
    containerRef,
    currentIndex,
    currentIndexRef,
    scrollToIndex,
    isScrollingProgrammaticallyRef,
  };
}
