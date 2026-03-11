/* eslint-disable react-refresh/only-export-components -- Context pattern: Provider + hook from same file */
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import type { ScrollContainerContextValue } from '../types';

const ScrollContainerContext = createContext<ScrollContainerContextValue | null>(null);

/**
 * Provider for scroll container context
 * Used to communicate scroll position from SwipeStoryViewer to Header
 */
export function ScrollContainerProvider({ children }: { children: ReactNode }) {
  const [isSwipeMode, setIsSwipeMode] = useState(false);

  const enableSwipeMode = useCallback(() => {
    setIsSwipeMode(true);
    document.body.classList.add('swipe-mode');
  }, []);

  const disableSwipeMode = useCallback(() => {
    setIsSwipeMode(false);
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

/**
 * Hook to access scroll container context
 */
export function useScrollContainer(): ScrollContainerContextValue {
  const context = useContext(ScrollContainerContext);
  if (!context) {
    // Return default values when not in provider (desktop/tablet)
    return { 
      isSwipeMode: false,
      enableSwipeMode: () => { /* noop */ },
      disableSwipeMode: () => { /* noop */ }
    };
  }
  return context;
}
