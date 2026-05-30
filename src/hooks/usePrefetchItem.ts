import { useCallback, useRef, useEffect } from 'react';
import { prefetchItemComments } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { isPriorityFetchActive, onPriorityFetchChange } from '../utils/fetchPriority';
import type { Item } from '../types';

const MAX_CONCURRENT = 3;

// Lower index = higher priority (top of list).
const prefetchQueue = new Map<number, { index: number }>(); // itemId -> { index }
const activePrefetches = new Map<number, AbortController>(); // itemId -> AbortController
let isProcessing = false;
let cancelSchedule: (() => void) | null = null;
let priorityUnsubscribe: (() => void) | null = null;

// Defer to browser idle so prefetches don't compete with initial render/paint.
// Timeout ensures they still start within 2s on busy pages.
function scheduleProcessQueue() {
  if (cancelSchedule) return; // Already scheduled

  if (typeof requestIdleCallback !== 'undefined') {
    const id = requestIdleCallback(() => {
      cancelSchedule = null;
      void processQueue();
    }, { timeout: 2000 });
    cancelSchedule = () => { cancelIdleCallback(id); cancelSchedule = null; };
  } else {
    // Fallback for environments without requestIdleCallback (SSR, old WebViews)
    const id = setTimeout(() => {
      cancelSchedule = null;
      void processQueue();
    }, 200);
    cancelSchedule = () => { clearTimeout(id); cancelSchedule = null; };
  }
}

function processQueueNow() {
  cancelSchedule?.();
  void processQueue();
}

// Wait for any user-visible priority fetch first so the current item's
// comments get full network bandwidth before background prefetches start.
async function processQueue() {
  if (isProcessing) return;
  
  if (isPriorityFetchActive()) {
    priorityUnsubscribe ??= onPriorityFetchChange((isActive) => {
      if (!isActive) {
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
      
      const cached = getCachedItem(bestId);
      if (cached?.isFresh) {
        continue;
      }
      
      const controller = new AbortController();
      activePrefetches.set(bestId, controller);
      
      // Don't await — let prefetches run in parallel, refilling the queue
      // as each completes.
      void doPrefetch(bestId, controller).finally(() => {
        activePrefetches.delete(bestId);
        processQueueNow();
      });
    }
  } finally {
    isProcessing = false;
  }
}

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

/** Priority-queued background prefetch (lower index = higher priority). */
export function usePrefetchItem() {
  const itemIdRef = useRef<number | null>(null);
  
  const startPrefetch = useCallback((itemId: number, index = 0) => {
    if (prefetchQueue.has(itemId) || activePrefetches.has(itemId)) {
      return;
    }
    
    const cached = getCachedItem(itemId);
    if (cached?.isFresh) {
      return;
    }
    
    itemIdRef.current = itemId;
    prefetchQueue.set(itemId, { index });
    scheduleProcessQueue();
  }, []);
  
  const stopPrefetch = useCallback(() => {
    const itemId = itemIdRef.current;
    if (!itemId) return;
    
    prefetchQueue.delete(itemId);
    
    const controller = activePrefetches.get(itemId);
    if (controller) {
      controller.abort();
      activePrefetches.delete(itemId);
      processQueueNow();
    }
    
    itemIdRef.current = null;
  }, []);
  
  return { startPrefetch, stopPrefetch };
}

/** Prefetch next N items ahead of currentIndex. */
export function usePrefetchItems(currentIndex: number, items: Item[], count = 3) {
  const prefetchedRef = useRef<Set<number>>(new Set());
  
  useEffect(() => {
    if (!items || items.length === 0) return;
    
    for (let i = 1; i <= count; i++) {
      const targetIndex = currentIndex + i;
      if (targetIndex >= items.length) break;
      
      const item = items[targetIndex];
      if (!item?.id) continue;
      
      const itemId = item.id;
      
      if (prefetchedRef.current.has(itemId)) continue;
      
      const cached = getCachedItem(itemId);
      if (cached?.isFresh) {
        prefetchedRef.current.add(itemId);
        continue;
      }
      
      prefetchQueue.set(itemId, { index: targetIndex });
      prefetchedRef.current.add(itemId);
    }
    
    scheduleProcessQueue();
  }, [currentIndex, items, count]);
}

/** Cancel all in-flight prefetches. Call when navigating to an item. */
export function cancelAllPrefetches() {
  cancelSchedule?.();
  
  prefetchQueue.clear();
  
  for (const controller of activePrefetches.values()) {
    controller.abort();
  }
  activePrefetches.clear();
}
