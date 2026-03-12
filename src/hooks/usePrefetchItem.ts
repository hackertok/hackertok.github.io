import { useCallback, useRef, useEffect } from 'react';
import { prefetchItemComments } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { isPriorityFetchActive, onPriorityFetchChange } from '../utils/fetchPriority';
import type { Item } from '../types';

// Maximum concurrent prefetches
const MAX_CONCURRENT = 3;

// Priority queue for prefetching - lower index = higher priority (top of list)
const prefetchQueue = new Map<number, { index: number }>(); // itemId -> { index }
const activePrefetches = new Map<number, AbortController>(); // itemId -> AbortController
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
  // This ensures current item's comments get full network bandwidth
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
      
      for (const [itemId, item] of prefetchQueue) {
        if (item.index < bestIndex) {
          bestIndex = item.index;
          bestId = itemId;
        }
      }
      
      if (bestId === null) break;
      
      prefetchQueue.delete(bestId);
      
      // Skip if cache is fresh
      const cached = getCachedItem(bestId);
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
async function doPrefetch(itemId: number, controller: AbortController) {
  try {
    const result = await prefetchItemComments(itemId, controller.signal, 1);
    
    if (result && !controller.signal.aborted) {
      setCachedItem(itemId, result.item, result.comments, 1);
    }
  } catch {
    // Silent failure for prefetch
  }
}

/**
 * Hook to prefetch item comments in the background.
 * Uses a priority queue - items with lower index (top of list) are prefetched first.
 */
export function usePrefetchItem() {
  const itemIdRef = useRef<number | null>(null);
  
  /**
   * Add item to prefetch queue with priority based on list index.
   * Call when item card enters viewport.
   * @param {number} itemId - Item ID
   * @param {number} index - Position in the item list (0 = top, lower = higher priority)
   */
  const startPrefetch = useCallback((itemId: number, index = 0) => {
    // Skip if already in queue or active
    if (prefetchQueue.has(itemId) || activePrefetches.has(itemId)) {
      return;
    }
    
    // Skip if cache is fresh
    const cached = getCachedItem(itemId);
    if (cached?.isFresh) {
      return;
    }
    
    itemIdRef.current = itemId;
    
    // Add to queue with priority (lower index = prefetch first)
    prefetchQueue.set(itemId, { index });
    
    // Schedule processing (debounced to wait for all visible items)
    scheduleProcessQueue();
  }, []);
  
  /**
   * Remove item from prefetch queue or abort if active.
   * Call when item card exits viewport.
   */
  const stopPrefetch = useCallback(() => {
    const itemId = itemIdRef.current;
    if (!itemId) return;
    
    // Remove from queue if pending
    prefetchQueue.delete(itemId);
    
    // Abort if active
    const controller = activePrefetches.get(itemId);
    if (controller) {
      controller.abort();
      activePrefetches.delete(itemId);
      // Process more from queue immediately
      processQueueNow();
    }
    
    itemIdRef.current = null;
  }, []);
  
  return { startPrefetch, stopPrefetch };
}

/**
 * Hook to prefetch multiple items ahead of the current index.
 * Used by SwipeStoryViewer for batch prefetching.
 * @param {number} currentIndex - Current item index
 * @param {Array} items - Array of item objects with id property
 * @param {number} count - Number of items to prefetch ahead (default: 3)
 */
export function usePrefetchItems(currentIndex: number, items: Item[], count = 3) {
  const prefetchedRef = useRef<Set<number>>(new Set());
  
  useEffect(() => {
    if (!items || items.length === 0) return;
    
    // Prefetch the next `count` items
    for (let i = 1; i <= count; i++) {
      const targetIndex = currentIndex + i;
      if (targetIndex >= items.length) break;
      
      const item = items[targetIndex];
      if (!item?.id) continue;
      
      const itemId = item.id;
      
      // Skip if already prefetched in this session
      if (prefetchedRef.current.has(itemId)) continue;
      
      // Skip if cache is fresh
      const cached = getCachedItem(itemId);
      if (cached?.isFresh) {
        prefetchedRef.current.add(itemId);
        continue;
      }
      
      // Add to queue with priority based on distance from current
      prefetchQueue.set(itemId, { index: targetIndex });
      prefetchedRef.current.add(itemId);
    }
    
    // Schedule processing
    scheduleProcessQueue();
  }, [currentIndex, items, count]);
}

/**
 * Cancel all in-flight prefetches. Call this when navigating to an item.
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
