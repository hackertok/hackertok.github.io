import { useState, useEffect, useRef, useEffectEvent, useCallback } from 'react';
import { fetchItemOnly, fetchItemWithComments, isPollOption, CommentsError, NotFoundError } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';
import { useNetworkStatus } from './useNetworkStatus';
import type { Item, Comment, StoryItem } from '../types';

interface UseItemWithCommentsOptions {
  /** Pre-loaded item data (avoids the redundant item fetch). */
  initialItem?: Item | null;
  /** Skip background re-fetch for deep comment ordering (mobile swipe mode). */
  skipOrderingCompletion?: boolean;
  /** When true, fetch immediately; when false, wait for priority fetches first. */
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
  /** Refetch the comments only; a failure stays a `commentsError`. */
  retryComments: () => Promise<void>;
}

// Swipe-position snapshots store stories without `text` (see swipePosition.ts),
// and feeds don't carry a poll's options, so an initialItem can lack fields
// that another copy of the item has.
function withCachedFields(item: Item | null | undefined, source: Item | null | undefined): Item | null {
  if (!item) return null;
  if (source?.id !== item.id) return item;
  const filled = item.text === undefined && source.text !== undefined ? { ...item, text: source.text } : item;
  if (!isStory(filled) || filled.pollOptions || source.type !== 'poll' || !source.pollOptions) return filled;
  return { ...filled, type: 'poll', pollOptions: source.pollOptions };
}

function isStory(item: Item): item is StoryItem {
  return item.type !== 'comment' && item.type !== 'job' && !isPollOption(item);
}

// The comments fetch reads the item too, so it has newer points, comment
// count, title and poll options than a cached or restored copy. The rest
// stays: Firebase calls Ask/Show posts `story`, and a deleted story comes back
// without a title. A fetched poll or poll option's type wins: copies cached
// before HackerTok knew them call them stories.
function withFetchedFields(item: Item | null | undefined, fetched: Item): Item | null {
  if (item && isPollOption(fetched) && fetched.id === item.id) return fetched;
  if (!item || !isStory(item) || (fetched.type !== 'story' && fetched.type !== 'poll') ||
      fetched.id !== item.id || !fetched.title) {
    return withCachedFields(item, fetched);
  }
  return {
    ...item,
    title: fetched.title,
    url: fetched.url ?? item.url,
    text: fetched.text ?? item.text,
    points: fetched.points,
    commentCount: fetched.commentCount,
    ...(fetched.type === 'poll' && { type: 'poll', pollOptions: fetched.pollOptions ?? item.pollOptions }),
  };
}

// A comments fetch that fails still brings the item it read, so a poll shows
// its options. Not cached: the cache holds an item with its comments.
function withFailedFetchFields(item: Item | null, err: unknown): Item | null {
  return err instanceof CommentsError ? withFetchedFields(item, err.item) : item;
}

// A comment's replies come from useCommentDetail (Algolia /items), and a poll
// option has no comments.
function fetchesComments(item: Item): boolean {
  return item.type !== 'comment' && !isPollOption(item);
}

export function useItemWithComments(itemId: number | string, { initialItem = null, skipOrderingCompletion = false, isPriority = true, deferComments = false }: UseItemWithCommentsOptions = {}): UseItemWithCommentsResult {
  const [initialCache] = useState(() => getCachedItem(itemId));
  
  // Lazy initialization from cache or initialItem for instant render
  const [item, setItem] = useState(() => withCachedFields(initialItem, initialCache?.item) ?? initialCache?.item ?? null);
  const [comments, setComments] = useState(() => initialCache?.comments ?? null);
  
  const [itemLoading, setItemLoading] = useState(!initialItem && !initialCache?.item);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  // Ref to the main effect's AbortController so the reconnect handler can abort stale fetches
  const controllerRef = useRef<AbortController | null>(null);
  // Releases the main effect's priority registration. The reconnect handler
  // calls it: the fetch it aborts no longer can, and a panel that turns
  // deferred skips the effect cleanup.
  const releasePriorityRef = useRef<(() => void) | null>(null);

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
    
    const hasItem = withCachedFields(initialItem, cached?.item) ?? cached?.item;
    
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
      } else if (cached.item) {
        // A feed's copy, held since before the prefetch: it has no poll options.
        setItem(current => withCachedFields(current, cached.item));
      }
    } else if (stateHasDifferentItem) {
      // itemId changed and the new item isn't (freshly) cached — reset to a
      // loading state so we don't render the previous item's content. Reuse
      // initialItem only when it actually matches the new itemId.
      const validInitialItem = initialItem && String(initialItem.id) === String(itemId) 
        ? initialItem 
        : null;
      setItem(withCachedFields(validInitialItem, cached?.item));
      setItemLoading(!validInitialItem);
      setComments(null);
      setCommentsLoading(true);
      setCommentsError(null);
    }
    
    // A poll whose options failed to load with its comments reads them again.
    const lacksPollOptions = hasItem?.type === 'poll' && !hasItem.pollOptions;
    const needsFullFetch = !cached?.isFresh || !hasItem || !cached?.comments || lacksPollOptions;
    // Mobile swipe mode skips ordering completion — users swipe fast and deep
    // order isn't visible.
    const needsOrderingCompletion = !skipOrderingCompletion && cached?.isFresh && cached?.orderedDepth < 3;
    
    if (cached?.isFresh && hasItem && cached?.comments && cached?.orderedDepth >= 3 && !lacksPollOptions) {
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
    const releasePriority = () => {
      if (didRegister) {
        unregisterPriorityFetch();
        didRegister = false;
      }
    };
    releasePriorityRef.current = releasePriority;

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
          releasePriority();
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
        const { item: fetchedItem, comments: commentsData } = await fetchItemWithComments(itemId, controller.signal);
        if (!controller.signal.aborted) {
          setItem(current => withFetchedFields(current, fetchedItem));
          setComments(commentsData);
          setCommentsLoading(false);
          setCommentsError(null);
          
          const fullItem = withFetchedFields(itemData, fetchedItem);
          if (fullItem) {
            setCachedItem(itemId, fullItem, commentsData, 3);
          }
          
          // Unregister priority so section prefetch and other lower-priority
          // fetches can proceed.
          releasePriority();
        }
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof Error && err.name === 'AbortError')) {
          // Comments failed but item succeeded — still usable, but surface the error.
          setItem(current => withFailedFetchFields(current, err));
          setCommentsLoading(false);
          setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
          console.warn('Failed to load comments:', err);
          
          // Unregister priority even on failure so prefetchers aren't blocked forever
          releasePriority();
        }
      }
    }

    async function load() {
      setError(null);
      setIsNotFound(false);
      
      if (needsOrderingCompletion && hasItem) {
        // Show partial-ordering data immediately, complete ordering in background.
        await loadComments(hasItem, true);
      } else if (needsFullFetch) {
        const itemData = hasItem ?? await loadItem();
        
        if (itemData && fetchesComments(itemData) && !controller.signal.aborted) {
          await loadComments(itemData, false);
        }
      }
      // A comment item or poll option fetches nothing more. After an abort,
      // whoever aborted releases it.
      if (!controller.signal.aborted) releasePriority();
    }

    void load();

    return () => {
      if (shouldSkipAbort(effectItemId)) {
        return;
      }
      
      // Cleanup from itemId change, unmount, or becoming non-deferred.
      controller.abort();
      controllerRef.current = null;
      releasePriority();
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
    if (!commentsLoading || comments || commentsError || !item || !fetchesComments(item) || deferComments) return;

    // Abort the hanging fetch so its promise settles (AbortError, swallowed by the effect)
    controllerRef.current?.abort();
    // Read now: by the time this fetch settles, the main effect may have
    // re-run for another item.
    const releasePriority = releasePriorityRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    setCommentsLoading(true);

    void fetchItemWithComments(itemId, controller.signal)
      .then(({ item: fetchedItem, comments: commentsData }) => {
        if (controller.signal.aborted) return;
        setItem(current => withFetchedFields(current, fetchedItem));
        setComments(commentsData);
        setCommentsLoading(false);
        setCommentsError(null);
        const fullItem = withFetchedFields(item, fetchedItem);
        if (fullItem) setCachedItem(itemId, fullItem, commentsData, 3);
      })
      .catch(err => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setItem(current => withFailedFetchFields(current, err));
        setCommentsLoading(false);
        setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
      })
      .finally(() => releasePriority?.());

    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [isOnline, itemId]);

  // Combined loading state for backward compatibility
  const loading = itemLoading && commentsLoading;

  // Refetch behind the error states' retry action. No gesture reaches this: the
  // root contains its overscroll, so there is no pull-to-refresh.
  const refresh = useCallback(async () => {
    setError(null);
    setIsNotFound(false);
    setCommentsError(null);
    setItemLoading(true);
    setCommentsLoading(true);
    
    let itemData: Item;
    try {
      itemData = await fetchItemOnly(itemId);
      setItem(itemData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsNotFound(err instanceof NotFoundError);
      setItemLoading(false);
      setCommentsLoading(false);
      throw err;
    }
    setItemLoading(false);

    if (fetchesComments(itemData)) {
      try {
        // Its read of the item carries a poll's options, which fetchItemOnly's doesn't.
        const { item: fetchedItem, comments: commentsData } = await fetchItemWithComments(itemId);
        const fullItem = withFetchedFields(itemData, fetchedItem) ?? itemData;
        setItem(fullItem);
        setComments(commentsData);
        setCachedItem(itemId, fullItem, commentsData);
      } catch (err) {
        // The item loaded, so the page can show it with the comments error.
        setItem(withFailedFetchFields(itemData, err) ?? itemData);
        setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
      }
    }
    setCommentsLoading(false);
  }, [itemId]);

  // Behind the comments section's retry. `commentsError` stays set until the
  // fetch settles: the section shows its skeleton for it, and clearing it
  // would show "No comments yet." meanwhile. It rejects on failure so
  // useAutoRetry counts the attempt.
  const retryComments = useCallback(async () => {
    try {
      const { item: fetchedItem, comments: commentsData } = await fetchItemWithComments(itemId);
      setItem(current => withFetchedFields(current, fetchedItem));
      setComments(commentsData);
      setCommentsError(null);
      const fullItem = withFetchedFields(item, fetchedItem);
      if (fullItem) setCachedItem(itemId, fullItem, commentsData, 3);
    } catch (err) {
      setItem(current => withFailedFetchFields(current, err));
      setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
      throw err;
    }
  }, [itemId, item]);

  return { 
    item, 
    comments,
    loading,
    itemLoading,
    commentsLoading,
    error,
    isNotFound,
    commentsError,
    refresh,
    retryComments
  };
}
