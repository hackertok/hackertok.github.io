import { useState, useEffect, useRef, useEffectEvent, useCallback } from 'react';
import { fetchItemAndComments, fetchItemOnly, fetchItemWithComments, isPollOption, CommentsError, NotFoundError } from '../api/hn';
import { getCachedItem, setCachedItem } from '../utils/itemCache';
import { registerPriorityFetch, unregisterPriorityFetch } from '../utils/fetchPriority';
import { useNetworkStatus } from './useNetworkStatus';
import { errorMessage, isAbortError } from '../utils/errors';
import type { Item, Comment, StoryItem, PrefetchResult } from '../types';

interface UseItemWithCommentsOptions {
  /** Pre-loaded item data (avoids the redundant item fetch). */
  initialItem?: Item | null;
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

export function useItemWithComments(itemId: number | string, { initialItem = null, isPriority = true, deferComments = false }: UseItemWithCommentsOptions = {}): UseItemWithCommentsResult {
  const [initialCache] = useState(() => getCachedItem(itemId));
  
  // Lazy initialization from cache or initialItem for instant render
  const [item, setItem] = useState(() => withCachedFields(initialItem, initialCache?.item) ?? initialCache?.item ?? null);
  const [comments, setComments] = useState(() => initialCache?.comments ?? null);
  
  const [itemLoading, setItemLoading] = useState(!initialItem && !initialCache?.item);
  const [commentsLoading, setCommentsLoading] = useState(!initialCache?.comments);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  // A comments fetch reads the item too. `base` is the caller's copy of the
  // item, cached with the thread. Callers settle `commentsLoading` themselves.
  const applyThread = useCallback((base: Item | null, { item: fetchedItem, comments: commentsData }: PrefetchResult) => {
    setItem(current => withFetchedFields(current, fetchedItem));
    setComments(commentsData);
    setCommentsError(null);
    const fullItem = withFetchedFields(base, fetchedItem);
    if (fullItem) setCachedItem(itemId, fullItem, commentsData);
  }, [itemId]);

  // A failed comments fetch: the item stays usable, with the error surfaced.
  const applyThreadError = useCallback((err: unknown) => {
    setItem(current => withFailedFetchFields(current, err));
    setCommentsError(errorMessage(err, 'Failed to load comments'));
  }, []);

  // Ref to the main effect's AbortController so the reconnect handler can abort stale fetches
  const controllerRef = useRef<AbortController | null>(null);
  // Releases the main effect's priority registration. The reconnect handler
  // calls it: the fetch it aborts no longer can, and a panel that turns
  // deferred skips the effect cleanup.
  const releasePriorityRef = useRef<(() => void) | null>(null);

  const getStableOptions = useEffectEvent(() => ({
    isPriority,
    initialItem,
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
    const { isPriority, initialItem } = getStableOptions();
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
    
    if (!needsFullFetch) {
      return;
    }
    
    let didRegister = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    
    // SYNC: priority panels register BEFORE any async work so non-priority
    // panels wait even if their effect happens to run first.
    if (isPriority && !cached?.comments) {
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

    async function loadItem(itemRead: Promise<Item>) {
      if (!cached?.item) {
        setItemLoading(true);
      }
      
      try {
        const itemData = await itemRead;
        if (!controller.signal.aborted) {
          setItem(itemData);
          setItemLoading(false);
        }
        return itemData;
      } catch (err) {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(errorMessage(err));
          setIsNotFound(err instanceof NotFoundError);
          setItemLoading(false);
          setCommentsLoading(false);
          
          // Unregister priority on item fetch failure so prefetchers aren't blocked
          releasePriority();
        }
        return null;
      }
    }

    async function loadComments(itemData: Item, commentsRead?: Promise<PrefetchResult>) {
      if (controller.signal.aborted) return;
      
      if (!cached?.comments) {
        setCommentsLoading(true);
      }
      
      try {
        const thread = await (commentsRead ?? fetchItemWithComments(itemId, controller.signal));
        if (!controller.signal.aborted) {
          applyThread(itemData, thread);
          setCommentsLoading(false);
          
          // Unregister priority so section prefetch and other lower-priority
          // fetches can proceed.
          releasePriority();
        }
      } catch (err) {
        if (!controller.signal.aborted && !isAbortError(err)) {
          // Comments failed but item succeeded — still usable, but surface the error.
          applyThreadError(err);
          setCommentsLoading(false);
          console.warn('Failed to load comments:', err);
          
          // Unregister priority even on failure so prefetchers aren't blocked forever
          releasePriority();
        }
      }
    }

    async function load() {
      setError(null);
      setIsNotFound(false);
      
      // With no copy of the item, the comments fetch starts alongside the
      // item's, sharing its read. A comment or poll option turns out to need
      // none, and its result goes unused.
      const reads = hasItem ? undefined : fetchItemAndComments(itemId, controller.signal);
      reads?.thread.catch(() => { /* loadComments handles it, if it's used */ });
      const itemData = reads ? await loadItem(reads.item) : hasItem;
      
      if (itemData && fetchesComments(itemData) && !controller.signal.aborted) {
        await loadComments(itemData, reads?.thread);
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
    // The apply helpers change only with itemId; all other values are read via Effect Events.
  }, [itemId, deferComments, applyThread, applyThreadError]);

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
      .then(thread => {
        if (controller.signal.aborted) return;
        applyThread(item, thread);
        setCommentsLoading(false);
      })
      .catch(err => {
        if (controller.signal.aborted || isAbortError(err)) return;
        applyThreadError(err);
        setCommentsLoading(false);
      })
      .finally(() => releasePriority?.());

    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [isOnline, itemId, applyThread, applyThreadError]);

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
      setError(errorMessage(err));
      setIsNotFound(err instanceof NotFoundError);
      setItemLoading(false);
      setCommentsLoading(false);
      throw err;
    }
    setItemLoading(false);

    if (fetchesComments(itemData)) {
      try {
        // Its read of the item carries a poll's options, which fetchItemOnly's doesn't.
        applyThread(itemData, await fetchItemWithComments(itemId));
      } catch (err) {
        // The item loaded, so the page can show it with the comments error.
        applyThreadError(err);
      }
    }
    setCommentsLoading(false);
  }, [itemId, applyThread, applyThreadError]);

  // Behind the comments section's retry. `commentsError` stays set until the
  // fetch settles: the section shows its skeleton for it, and clearing it
  // would show "No comments yet." meanwhile. It rejects on failure so
  // useAutoRetry counts the attempt.
  const retryComments = useCallback(async () => {
    try {
      applyThread(item, await fetchItemWithComments(itemId));
    } catch (err) {
      applyThreadError(err);
      throw err;
    }
  }, [itemId, item, applyThread, applyThreadError]);

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
