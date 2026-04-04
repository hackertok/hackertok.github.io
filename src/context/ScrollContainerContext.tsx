import { useCallback, useState, type ReactNode } from 'react';
import { ScrollContainerContext } from './scrollContainerDef';

/**
 * Provider for scroll container context
 * Used to communicate scroll position from SwipeItemViewer to Header
 */
export function ScrollContainerProvider({ children }: { children: ReactNode }) {
  const [isSwipeMode, setIsSwipeMode] = useState(false);

  const enableSwipeMode = useCallback(() => {
    setIsSwipeMode(true);
    document.documentElement.classList.add('swipe-mode');
    document.body.classList.add('swipe-mode');
  }, []);

  const disableSwipeMode = useCallback(() => {
    setIsSwipeMode(false);
    document.documentElement.classList.remove('swipe-mode');
    document.body.classList.remove('swipe-mode');
  }, []);

  return (
    <ScrollContainerContext.Provider 
      value={{ 
        isSwipeMode,
        enableSwipeMode,
        disableSwipeMode
      }}
    >
      {children}
    </ScrollContainerContext.Provider>
  );
}
