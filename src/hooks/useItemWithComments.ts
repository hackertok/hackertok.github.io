import { useState, useEffect, useEffectEvent, useCallback } from 'react';
import { fetchItemOnly, fetchCommentsForItem } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';
import type { Item, Comment } from '../types';

/**
 * Hook to fetch item and comments
 * @param {number|string} itemId - Item ID to fetch
 * @param {object} options - Hook options
 * @param {object} options.initialItem - Optional pre-loaded item data (avoids redundant fetch)
 * @param {boolean} options.skipOrderingCompletion - Skip background re-fetch for deep ordering (mobile swipe mode)
 * @param {boolean} options.isPriority - If true, fetch immediately; if false, wait for priority fetches to complete first (mobile serialization)
 * @param {boolean} options.deferComments - If true, skip comment fetch entirely (for far panels in mobile swipe view)
 */
interface UseItemWithCommentsOptions {
  initialItem?: Item | null;
  skipOrderingCompletion?: boolean;
  isPriority?: boolean;
  deferComments?: boolean;
}

interface UseItemWithCommentsResult {
  item: Item | null;
  comments: Comment[] | null;
  loading: boolean;
  itemLoading: boolean;
  commentsLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useItemWithComments(itemId: number | string, { initialItem = null, skipOrderingCompletion = false, isPriority = true, deferComments = false }: UseItemWithCommentsOptions = {}): UseItemWithCommentsResult {
  // Check cache at initialization time (runs once per mount)
  const initialCache = getCachedItem(itemId);
  
  // Lazy initialization from cache or initialItem for instant render
  const [item, setItem] = useState(() => initialItem ?? initialCache?.item ?? null);
  const [comments, setComments] = useState(() => initialCache?.comments ?? null);
  
  // If we have initialItem, don't show item loading state
  const [itemLoading, setItemLoading] = useState(!initialItem && !initialCache?.item);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState<string | null>(null);

  // Effect Events: read values without triggering effect re-run
  // These allow reading current props/state in effects and cleanup without adding them as dependencies
  
  // Read non-reactive options (configuration that shouldn't cause re-sync)
  const getStableOptions = useEffectEvent(() => ({
    isPriority,
    initialItem,
    skipOrderingCompletion
  }));

  // Read current state for comparisons (without reacting to state changes)
  const getStateSnapshot = useEffectEvent(() => ({
    currentItemId: item?.id,
    hasComments: !!comments,
    currentItem: item
  }));

  // Cleanup decision logic (needs current itemId and deferComments)
  const shouldSkipAbort = useEffectEvent((effectItemId: number | string) => {
    // Check if itemId changed (effectItemId is OLD, itemId is current)
    const isItemIdChanging = effectItemId !== itemId;
    // Only skip abort if:
    // 1. itemId is NOT changing (same item)
    // 2. AND deferComments is transitioning TO true (becoming deferred)
    // This lets the fetch complete in the background - it will unregister itself
    return !isItemIdChanging && deferComments;
  });
  
  useEffect(() => {
    // Read stable options via Effect Event (won't cause re-sync when they change)
    const { isPriority, initialItem, skipOrderingCompletion } = getStableOptions();
    // Read current state snapshot for comparisons
    const { currentItemId, hasComments, currentItem } = getStateSnapshot();
    
    // Capture itemId for this effect instance (to detect itemId changes in cleanup)
    const effectItemId = itemId;
    // Deferred panels: skip comment fetch entirely (item already initialized via useState)
    if (deferComments) {
      return;
    }
    
    const cached = getCachedItem(itemId);
    
    // We have item from either initialItem prop or cache
    const hasItem = initialItem ?? cached?.item;
    
    // Check if state has a different item's data (itemId changed)
    const stateHasDifferentItem = currentItem && String(currentItemId) !== String(itemId);
    
    // If cache has comments that we don't have in state yet, OR if itemId changed, sync from cache
    // This handles: 1) prefetch populated cache after mount, 2) navigation to cached item
    if (cached?.isFresh && cached?.comments && (!hasComments || stateHasDifferentItem)) {
      setComments(cached.comments);
      setCommentsLoading(false);
      // Sync item too if needed
      if (cached.item && (!currentItem || stateHasDifferentItem)) {
        setItem(cached.item);
        setItemLoading(false);
      }
    } else if (stateHasDifferentItem) {
      // itemId changed but new item is NOT in cache (or cache is stale)
      // Reset state to loading to prevent showing wrong item's content
      // Use initialItem if provided AND it matches the new itemId
      const validInitialItem = initialItem && String(initialItem.id) === String(itemId) 
        ? initialItem 
        : null;
      setItem(validInitialItem);
      setItemLoading(!validInitialItem);
      setComments(null);
      setCommentsLoading(true);
    }
    
    // Determine if we need to fetch: either no cache, stale cache, or partial ordering
    const needsFullFetch = !cached?.isFresh || !hasItem || !cached?.comments;
    // Skip ordering completion in mobile swipe mode (users swipe fast, deep order doesn't matter)
    const needsOrderingCompletion = !skipOrderingCompletion && cached?.isFresh && cached?.orderedDepth < 3;
    
    // If cache is fresh AND fully ordered, skip fetch entirely
    if (cached?.isFresh && hasItem && cached?.comments && cached?.orderedDepth >= 3) {
      return;
    }
    
    // Track if we registered priority (for cleanup)
    let didRegister = false;
    const controller = new AbortController();
    
    // SYNC: Priority panels register immediately (before any async work)
    // This ensures non-priority panels will wait even if their effect runs first
    if (isPriority && needsFullFetch && !cached?.comments) {
      registerPriorityFetch();
      didRegister = true;
    }

    async function loadItem() {
      // If we have initialItem, use it directly - no fetch needed
      if (initialItem) {
        return initialItem;
      }
      
      // Only set loading if we don't have cached item
      if (!cached?.item) {
        setItemLoading(true);
      }
      
      try {
        const itemData = await fetchItemOnly(itemId);
        if (!controller.signal.aborted) {
          setItem(itemData);
          setItemLoading(false);
        }
        return itemData;
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err));
          setItemLoading(false);
          setCommentsLoading(false);
          
          // Unregister priority on item fetch failure so prefetchers aren't blocked
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
        return null;
      }
    }

    async function loadComments(itemData: Item | null, isBackgroundReorder = false) {
      // Check abort before expensive fetch
      if (controller.signal.aborted) return;
      
      // Only set loading if we don't have cached comments AND not a background reorder
      const shouldSetLoading = !cached?.comments && !isBackgroundReorder;
      if (shouldSetLoading) {
        setCommentsLoading(true);
      }
      
      try {
        // Fetch with full ordering (default maxDepth=3)
        const commentsData = await fetchCommentsForItem(itemId, 3, controller.signal);
        if (!controller.signal.aborted) {
          setComments(commentsData);
          setCommentsLoading(false);
          
          // Cache the complete item with comments and full ordering
          if (itemData) {
            setCachedItem(itemId, itemData, commentsData, 3);
          }
          
          // Unregister priority now that comments are loaded
          // This allows section prefetch and other lower-priority fetches to proceed
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'AbortError')) {
          // Comments failed but item succeeded - still usable
          setCommentsLoading(false);
          console.warn('Failed to load comments:', err);
          
          // Unregister priority even on failure so prefetchers aren't blocked forever
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
      }
    }

    async function load() {
      setError(null);
      
      if (needsOrderingCompletion && hasItem) {
        // We have cached/initial data with partial ordering - show it immediately
        // and fetch fully ordered comments in the background
        await loadComments(initialItem ?? cached.item, true);
      } else if (needsFullFetch) {
        // Need to fetch item and/or comments
        const itemData = hasItem ? (initialItem ?? cached?.item) : await loadItem();
        
        // Then load comments (skip for comment items — they use a different fetch path)
        if (itemData && itemData.type !== 'comment' && !controller.signal.aborted) {
          await loadComments(itemData, false);
        }
      }
    }

    void load();

    return () => {
      // Use Effect Event for cleanup decision (reads current itemId and deferComments)
      if (shouldSkipAbort(effectItemId)) {
        return;
      }
      
      // Cleanup due to itemId change, unmount, or becoming non-deferred - abort the fetch
      controller.abort();
      if (didRegister) {
        unregisterPriorityFetch();
      }
    };
  }, [itemId, deferComments]); // All other values read via Effect Events

  // Combined loading state for backward compatibility
  const loading = itemLoading && commentsLoading;

  // Refresh function for pull-to-refresh
  const refresh = useCallback(async () => {
    setError(null);
    
    try {
      const itemData = await fetchItemOnly(itemId);
      setItem(itemData);
      
      // Comment items use a different fetch path (useCommentDetail via Algolia /items)
      if (itemData.type !== 'comment') {
        const commentsData = await fetchCommentsForItem(itemId);
        setComments(commentsData);
        setCachedItem(itemId, itemData, commentsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [itemId]);

  return { 
    item, 
    comments,
    loading,
    itemLoading,
    commentsLoading,
    error,
    refresh
  };
}
