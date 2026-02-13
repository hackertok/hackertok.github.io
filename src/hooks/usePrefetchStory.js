import { useCallback, useEffect, useRef } from 'react';
import { prefetchStoryComments } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';

// Threshold: only prefetch stories with 150+ comments (slow loaders)
const MIN_COMMENTS_TO_PREFETCH = 150;

// GLOBAL state - shared across all component instances
// This ensures only ONE prefetch happens at a time across the entire app
let globalAbortController = null;
let currentPrefetchId = null;
const inFlightPrefetches = new Set();

/**
 * Cancel any in-flight prefetch globally
 */
function cancelGlobalPrefetch() {
  if (globalAbortController) {
    globalAbortController.abort();
    globalAbortController = null;
    currentPrefetchId = null;
  }
}

/**
 * Hook to prefetch story comments in the background.
 * Uses GLOBAL singleton - only one prefetch at a time across all components.
 */
export function usePrefetchStory() {
  // Track if this component instance started the current prefetch
  const startedPrefetchRef = useRef(null);
  
  const prefetch = useCallback(async (storyId, commentCount) => {
    // Skip if below threshold (loads fast anyway)
    if (commentCount < MIN_COMMENTS_TO_PREFETCH) {
      return;
    }
    
    // Skip if this exact story is already being prefetched
    if (currentPrefetchId === storyId) {
      return;
    }
    
    // Skip if cache is fresh
    const cached = getCachedStory(storyId);
    if (cached?.isFresh) {
      return;
    }
    
    // Cancel any existing prefetch (from any component)
    cancelGlobalPrefetch();
    
    // Create new global abort controller
    const controller = new AbortController();
    globalAbortController = controller;
    currentPrefetchId = storyId;
    startedPrefetchRef.current = storyId;
    
    // Track in-flight
    inFlightPrefetches.add(storyId);
    
    try {
      const result = await prefetchStoryComments(storyId, controller.signal);
      
      // If successful and not aborted, cache the result
      if (result && !controller.signal.aborted) {
        setCachedStory(storyId, result.story, result.comments);
      }
    } finally {
      // Clean up tracking
      inFlightPrefetches.delete(storyId);
      
      // Clean up global state if we're still the active prefetch
      if (currentPrefetchId === storyId) {
        globalAbortController = null;
        currentPrefetchId = null;
      }
      startedPrefetchRef.current = null;
    }
  }, []);
  
  // Cancel only if THIS component started the current prefetch
  const cancel = useCallback(() => {
    if (startedPrefetchRef.current && startedPrefetchRef.current === currentPrefetchId) {
      cancelGlobalPrefetch();
    }
  }, []);
  
  return { prefetch, cancel };
}

/**
 * Cancel all in-flight prefetches. Call this when navigating to a story.
 */
export function cancelAllPrefetches() {
  cancelGlobalPrefetch();
}

/**
 * Check if a story should be prefetched based on comment count.
 */
export function shouldPrefetch(commentCount) {
  return commentCount >= MIN_COMMENTS_TO_PREFETCH;
}
