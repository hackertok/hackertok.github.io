import { useContext } from 'react';
import { ScrollContainerContext } from '../context/scrollContainerDef';
import type { ScrollContainerContextValue } from '../types';

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
