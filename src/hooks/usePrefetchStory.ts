import { useCallback, useRef, useEffect } from 'react';
import { prefetchStoryComments } from '../api/hn';
import { getCachedStory, setCachedStory } from '../utils/storyCache';
import { isPriorityFetchActive, onPriorityFetchChange } from '../utils/fetchPriority';
import type { Story } from '../types';

// Maximum concurrent prefetches
const MAX_CONCURRENT = 3;

// Priority queue for prefetching - lower index = higher priority (top of list)
const prefetchQueue = new Map<number, { index: number }>(); // storyId -> { index }
const activePrefetches = new Map<number, AbortController>(); // storyId -> AbortController
let isProcessing = false;
let scheduleTimeout: ReturnType<typeof setTimeout> | null = null;
let priorityUnsubscribe: (() => void) | null = null;

/**
 * Schedule queue processing with debounce.
 * This ensures all visible items are added to the queue before processing begins.
 */
function scheduleProcessQueue() {
  if (scheduleTimeout) return;
  scheduleTimeout = setTimeout(() => {
    scheduleTimeout = null;
    void processQueue();
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
  void processQueue();
}

/**
 * Process the prefetch queue - start prefetches for highest priority items.
 * Waits for any user-visible priority fetch to complete first.
 */
async function processQueue() {
  if (isProcessing) return;
  
  // Wait for user-visible content to load first
  // This ensures current story's comments get full network bandwidth
  if (isPriorityFetchActive()) {
    // Subscribe to be notified when priority fetch completes
    priorityUnsubscribe ??= onPriorityFetchChange((isActive) => {
      if (!isActive) {
        // Priority fetch done - resume queue processing
        priorityUnsubscribe?.();
        priorityUnsubscribe = null;
        void processQueue();
      }
    });
    return;
  }
  
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
      void doPrefetch(bestId, controller).finally(() => {
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
async function doPrefetch(storyId: number, controller: AbortController) {
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
  const storyIdRef = useRef<number | null>(null);
  
  /**
   * Add story to prefetch queue with priority based on list index.
   * Call when story card enters viewport.
   * @param {number} storyId - Story ID
   * @param {number} index - Position in the story list (0 = top, lower = higher priority)
   */
  const startPrefetch = useCallback((storyId: number, index = 0) => {
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
 * Hook to prefetch multiple stories ahead of the current index.
 * Used by SwipeStoryViewer for batch prefetching.
 * @param {number} currentIndex - Current story index
 * @param {Array} stories - Array of story objects with id property
 * @param {number} count - Number of stories to prefetch ahead (default: 3)
 */
export function usePrefetchStories(currentIndex: number, stories: Story[], count = 3) {
  const prefetchedRef = useRef<Set<number>>(new Set());
  
  useEffect(() => {
    if (!stories || stories.length === 0) return;
    
    // Prefetch the next `count` stories
    for (let i = 1; i <= count; i++) {
      const targetIndex = currentIndex + i;
      if (targetIndex >= stories.length) break;
      
      const story = stories[targetIndex];
      if (!story?.id) continue;
      
      const storyId = story.id;
      
      // Skip if already prefetched in this session
      if (prefetchedRef.current.has(storyId)) continue;
      
      // Skip if cache is fresh
      const cached = getCachedStory(storyId);
      if (cached?.isFresh) {
        prefetchedRef.current.add(storyId);
        continue;
      }
      
      // Add to queue with priority based on distance from current
      prefetchQueue.set(storyId, { index: targetIndex });
      prefetchedRef.current.add(storyId);
    }
    
    // Schedule processing
    scheduleProcessQueue();
  }, [currentIndex, stories, count]);
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
