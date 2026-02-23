import { useCallback, useRef } from 'react';
import { prefetchStoryComments } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';

// Maximum concurrent prefetches
const MAX_CONCURRENT = 2;

// Priority queue for prefetching - lower index = higher priority (top of list)
const prefetchQueue = new Map(); // storyId -> { index }
const activePrefetches = new Map(); // storyId -> AbortController
let isProcessing = false;
let scheduleTimeout = null;

/**
 * Schedule queue processing with debounce.
 * This ensures all visible items are added to the queue before processing begins.
 */
function scheduleProcessQueue() {
  if (scheduleTimeout) return;
  scheduleTimeout = setTimeout(() => {
    scheduleTimeout = null;
    processQueue();
  }, 200); // Wait 200ms for all intersection observers to fire and React to process state updates
}

/**
 * Process the prefetch queue immediately (used when a prefetch completes)
 */
function processQueueNow() {
  // Clear any pending scheduled processing
  if (scheduleTimeout) {
    clearTimeout(scheduleTimeout);
    scheduleTimeout = null;
  }
  processQueue();
}

/**
 * Process the prefetch queue - start prefetches for highest priority items
 */
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    while (activePrefetches.size < MAX_CONCURRENT && prefetchQueue.size > 0) {
      // Find the item with lowest index (highest priority)
      let bestId = null;
      let bestIndex = Infinity;
      
      for (const [storyId, item] of prefetchQueue) {
        if (item.index < bestIndex) {
          bestIndex = item.index;
          bestId = storyId;
        }
      }
      
      if (bestId === null) break;
      
      prefetchQueue.delete(bestId);
      
      // Skip if cache is fresh
      const cached = getCachedStory(bestId);
      if (cached?.isFresh) {
        continue;
      }
      
      // Create controller and start prefetch
      const controller = new AbortController();
      activePrefetches.set(bestId, controller);
      
      // Start prefetch (don't await - let it run in parallel)
      doPrefetch(bestId, controller).finally(() => {
        activePrefetches.delete(bestId);
        // Process more from queue immediately when this one finishes
        processQueueNow();
      });
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Execute a single prefetch
 */
async function doPrefetch(storyId, controller) {
  try {
    const result = await prefetchStoryComments(storyId, controller.signal, 1);
    
    if (result && !controller.signal.aborted) {
      setCachedStory(storyId, result.story, result.comments, 1);
    }
  } catch {
    // Silent failure for prefetch
  }
}

/**
 * Hook to prefetch story comments in the background.
 * Uses a priority queue - stories with lower index (top of list) are prefetched first.
 */
export function usePrefetchStory() {
  const storyIdRef = useRef(null);
  
  /**
   * Add story to prefetch queue with priority based on list index.
   * Call when story card enters viewport.
   * @param {number} storyId - Story ID
   * @param {number} index - Position in the story list (0 = top, lower = higher priority)
   */
  const startPrefetch = useCallback((storyId, index = 0) => {
    // Skip if already in queue or active
    if (prefetchQueue.has(storyId) || activePrefetches.has(storyId)) {
      return;
    }
    
    // Skip if cache is fresh
    const cached = getCachedStory(storyId);
    if (cached?.isFresh) {
      return;
    }
    
    storyIdRef.current = storyId;
    
    // Add to queue with priority (lower index = prefetch first)
    prefetchQueue.set(storyId, { index });
    
    // Schedule processing (debounced to wait for all visible items)
    scheduleProcessQueue();
  }, []);
  
  /**
   * Remove story from prefetch queue or abort if active.
   * Call when story card exits viewport.
   */
  const stopPrefetch = useCallback(() => {
    const storyId = storyIdRef.current;
    if (!storyId) return;
    
    // Remove from queue if pending
    prefetchQueue.delete(storyId);
    
    // Abort if active
    const controller = activePrefetches.get(storyId);
    if (controller) {
      controller.abort();
      activePrefetches.delete(storyId);
      // Process more from queue immediately
      processQueueNow();
    }
    
    storyIdRef.current = null;
  }, []);
  
  return { startPrefetch, stopPrefetch };
}

/**
 * Cancel all in-flight prefetches. Call this when navigating to a story.
 */
export function cancelAllPrefetches() {
  // Clear scheduled processing
  if (scheduleTimeout) {
    clearTimeout(scheduleTimeout);
    scheduleTimeout = null;
  }
  
  // Clear queue
  prefetchQueue.clear();
  
  // Abort all active
  for (const controller of activePrefetches.values()) {
    controller.abort();
  }
  activePrefetches.clear();
}
