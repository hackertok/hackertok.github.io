import { useState, useEffect, useRef, useEffectEvent, useCallback } from 'react';
import { fetchItemOnly, fetchCommentsForItem, NotFoundError } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';
import { useNetworkStatus } from './useNetworkStatus';
import type { Item, Comment } from '../types';

interface UseItemWithCommentsOptions {
  /** Pre-loaded item data (avoids the redundant item fetch). */
  initialItem?: Item | null;
  /** Skip background re-fetch for deep comment ordering (mobile swipe mode). */
  skipOrderingCompletion?: boolean;
  /**
   * When true, fetch immediately. When false, wait for any in-flight priority
   * fetches to complete first — the mobile swipe view uses this to serialize
   * far-panel fetches behind the visible panel's fetch.
   */
  isPriority?: boolean;
  /** Skip comment fetch entirely (for far panels in mobile swipe view). */
  deferComments?: boolean;
}

interface UseItemWithCommentsResult {
  item: Item | null;
  comments: Comment[] | null;
  loading: boolean;
  itemLoading: boolean;
  commentsLoading: boolean;
  error: string | null;
  isNotFound: boolean;
  commentsError: string | null;
  refresh: () => Promise<void>;
}

export function useItemWithComments(itemId: number | string, { initialItem = null, skipOrderingCompletion = false, isPriority = true, deferComments = false }: UseItemWithCommentsOptions = {}): UseItemWithCommentsResult {
  const initialCache = getCachedItem(itemId);
  
  // Lazy initialization from cache or initialItem for instant render
  const [item, setItem] = useState(() => initialItem ?? initialCache?.item ?? null);
  const [comments, setComments] = useState(() => initialCache?.comments ?? null);
  
  const [itemLoading, setItemLoading] = useState(!initialItem && !initialCache?.item);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  // Ref to the main effect's AbortController so the reconnect handler can abort stale fetches
  const controllerRef = useRef<AbortController | null>(null);

  // Effect Events read current props/state without re-syncing the effect.

  const getStableOptions = useEffectEvent(() => ({
    isPriority,
    initialItem,
    skipOrderingCompletion
  }));

  const getStateSnapshot = useEffectEvent(() => ({
    currentItemId: item?.id,
    hasComments: !!comments,
    currentItem: item
  }));

  const shouldSkipAbort = useEffectEvent((effectItemId: number | string) => {
    const isItemIdChanging = effectItemId !== itemId;
    // Skip abort only when itemId is unchanged AND we're transitioning into
    // deferred mode — the fetch will finish in the background and unregister
    // itself.
    return !isItemIdChanging && deferComments;
  });
  
  useEffect(() => {
    const { isPriority, initialItem, skipOrderingCompletion } = getStableOptions();
    const { currentItemId, hasComments, currentItem } = getStateSnapshot();
    
    // Captured for cleanup: lets us detect itemId changes when the effect re-runs.
    const effectItemId = itemId;
    if (deferComments) {
      return;
    }
    
    const cached = getCachedItem(itemId);
    
    const hasItem = initialItem ?? cached?.item;
    
    const stateHasDifferentItem = currentItem && String(currentItemId) !== String(itemId);
    
    // Sync from cache when:
    //   1) prefetch populated the cache after mount, or
    //   2) navigation to a (cached) item.
    if (cached?.isFresh && cached?.comments && (!hasComments || stateHasDifferentItem)) {
      setComments(cached.comments);
      setCommentsLoading(false);
      if (cached.item && (!currentItem || stateHasDifferentItem)) {
        setItem(cached.item);
        setItemLoading(false);
      }
    } else if (stateHasDifferentItem) {
      // itemId changed and the new item isn't (freshly) cached — reset to a
      // loading state so we don't render the previous item's content. Reuse
      // initialItem only when it actually matches the new itemId.
      const validInitialItem = initialItem && String(initialItem.id) === String(itemId) 
        ? initialItem 
        : null;
      setItem(validInitialItem);
      setItemLoading(!validInitialItem);
      setComments(null);
      setCommentsLoading(true);
      setCommentsError(null);
    }
    
    const needsFullFetch = !cached?.isFresh || !hasItem || !cached?.comments;
    // Mobile swipe mode skips ordering completion — users swipe fast and deep
    // order isn't visible.
    const needsOrderingCompletion = !skipOrderingCompletion && cached?.isFresh && cached?.orderedDepth < 3;
    
    if (cached?.isFresh && hasItem && cached?.comments && cached?.orderedDepth >= 3) {
      return;
    }
    
    let didRegister = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    
    // SYNC: priority panels register BEFORE any async work so non-priority
    // panels wait even if their effect happens to run first.
    if (isPriority && needsFullFetch && !cached?.comments) {
      registerPriorityFetch();
      didRegister = true;
    }

    async function loadItem() {
      if (initialItem) {
        return initialItem;
      }
      
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
          setIsNotFound(err instanceof NotFoundError);
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
      if (controller.signal.aborted) return;
      
      const shouldSetLoading = !cached?.comments && !isBackgroundReorder;
      if (shouldSetLoading) {
        setCommentsLoading(true);
      }
      
      try {
        const commentsData = await fetchCommentsForItem(itemId, controller.signal);
        if (!controller.signal.aborted) {
          setComments(commentsData);
          setCommentsLoading(false);
          setCommentsError(null);
          
          if (itemData) {
            setCachedItem(itemId, itemData, commentsData, 3);
          }
          
          // Unregister priority so section prefetch and other lower-priority
          // fetches can proceed.
          if (didRegister) {
            unregisterPriorityFetch();
            didRegister = false;
          }
        }
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'AbortError')) {
          // Comments failed but item succeeded — still usable, but surface the error.
          setCommentsLoading(false);
          setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
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
      setIsNotFound(false);
      
      if (needsOrderingCompletion && hasItem) {
        // Show partial-ordering data immediately, complete ordering in background.
        await loadComments(initialItem ?? cached.item, true);
      } else if (needsFullFetch) {
        const itemData = hasItem ? (initialItem ?? cached?.item) : await loadItem();
        
        // Comment items use a different fetch path (useCommentDetail via Algolia /items).
        if (itemData && itemData.type !== 'comment' && !controller.signal.aborted) {
          await loadComments(itemData, false);
        }
      }
    }

    void load();

    return () => {
      if (shouldSkipAbort(effectItemId)) {
        return;
      }
      
      // Cleanup from itemId change, unmount, or becoming non-deferred.
      controller.abort();
      controllerRef.current = null;
      if (didRegister) {
        unregisterPriorityFetch();
      }
    };
  }, [itemId, deferComments]); // All other values read via Effect Events

  // Reconnect: when going online with a stale comment fetch hanging, abort it and retry.
  // The main effect's fetch may be pending indefinitely (TCP doesn't fail instantly on
  // network loss). useAutoRetry in CommentsSection can't help because no error has fired.
  const { isOnline } = useNetworkStatus();
  const wasOnlineRef = useRef(isOnline);

  const getReconnectSnapshot = useEffectEvent(() => ({
    commentsLoading,
    comments,
    commentsError,
    item,
    deferComments,
  }));

  useEffect(() => {
    const wasOffline = !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (!wasOffline || !isOnline) return;

    const { commentsLoading, comments, commentsError, item, deferComments } = getReconnectSnapshot();

    // Only act when comments are stuck loading (hanging fetch, no error surfaced)
    if (!commentsLoading || comments || commentsError || !item || item.type === 'comment' || deferComments) return;

    // Abort the hanging fetch so its promise settles (AbortError, swallowed by the effect)
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    setCommentsLoading(true);

    void fetchCommentsForItem(itemId, controller.signal)
      .then(commentsData => {
        if (controller.signal.aborted) return;
        setComments(commentsData);
        setCommentsLoading(false);
        setCommentsError(null);
        if (item) setCachedItem(itemId, item, commentsData, 3);
      })
      .catch(err => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setCommentsLoading(false);
        setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
      });

    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [isOnline, itemId]);

  // Combined loading state for backward compatibility
  const loading = itemLoading && commentsLoading;

  // Pull-to-refresh handler.
  const refresh = useCallback(async () => {
    setError(null);
    setIsNotFound(false);
    setCommentsError(null);
    setItemLoading(true);
    setCommentsLoading(true);
    
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
      setIsNotFound(err instanceof NotFoundError);
    } finally {
      setItemLoading(false);
      setCommentsLoading(false);
    }
  }, [itemId]);

  return { 
    item, 
    comments,
    loading,
    itemLoading,
    commentsLoading,
    error,
    isNotFound,
    commentsError,
    refresh
  };
}
