import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useInfiniteStories } from '../hooks/useInfiniteStories';
import { useSwipeScroll } from '../hooks/useSwipeScroll';
import { usePrefetchItems } from '../hooks/usePrefetchItem';
import { usePrefetchSections } from '../hooks/usePrefetchSections';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { fetchItemOnly, NotFoundError } from '../api/hn';
import { getRecentlyViewedIds, getSessionViewedIds, markViewedWithTime } from '../utils/viewedItems';
import { FEED_TYPE_TITLES } from '../config/feedTypes';
import { FullScreenItem, FullScreenItemSkeletonPanel } from './FullScreenItem';
import { StateView } from './StateView';
import type { StoryItem, FeedType, LocationState } from '../types';

interface SwipeStoryViewerCoreProps {
  /** Story data from the consumer's data source (feed, domain, etc.) */
  stories: StoryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /** ID of the story landed on via /item/:id — triggers anchor/scroll-init */
  initialItemId?: string;
  /** LocationState written to per-item URL via navigate(..., { state }). Also used
   *  to detect history-navigation vs fresh direct link (determines anchor behavior). */
  backState: LocationState;
  /** Document-title fallback when no current story is selected */
  titleFallback?: string;
  /** When provided, a "no results" state is rendered after the fetch completes
   *  with zero stories and no initialItemId. Feeds omit this to preserve the
   *  existing fall-through behavior (they are never truly empty). */
  emptyTitle?: string;
}

/**
 * Data-source-agnostic full-screen horizontal swipe viewer.
 * Uses CSS Scroll Snap for native, smooth horizontal swiping.
 * - Horizontal swipe: CSS Scroll Snap handles navigation natively
 * - Vertical scroll: Each item panel scrolls independently
 * - URL updates on each item change (carries `backState`)
 *
 * All feed-specific wiring (data source, prefetch sections, back link, URL state)
 * is injected via props so both `SwipeStoryViewer` (feeds) and
 * `SwipeDomainStoryViewer` (domain-filtered) can share this implementation.
 */
export function SwipeStoryViewerCore({
  stories,
  loading,
  error,
  hasMore,
  loadMore,
  initialItemId,
  backState,
  titleFallback,
  emptyTitle,
}: SwipeStoryViewerCoreProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const initialItemIdNum = initialItemId != null ? Number(initialItemId) : undefined;

  const [injectedStory, setInjectedStory] = useState<StoryItem | null>(null);
  const [injectedLoading, setInjectedLoading] = useState(false);
  const [injectedError, setInjectedError] = useState<string | null>(null);
  const [isInjectedItemNotFound, setIsInjectedItemNotFound] = useState(false);
  // anchorStoryId: The story that should be at index 0.
  // Only set on FRESH direct links (shared/bookmarked URLs with no location.state).
  // When returning from external URL, location.state is preserved from our earlier navigation,
  // so we DON'T reorder (user expects to return to same position).
  // Recognizes `from` (feed), `fromDomain` (domain), and `fromUser` (user
  // submissions) — any of those signals a history nav and suppresses anchoring.
  const [anchorStoryId, setAnchorStoryId] = useState<number | null>(() => {
    const isHistoryNav = !!(locationState?.from ?? locationState?.fromDomain ?? locationState?.fromUser);
    return isHistoryNav ? null : initialItemIdNum ?? null;
  });
  const lastInitialStoryIdRef = useRef(initialItemId);
  const didInitialLoadRef = useRef(false);
  const fetchedStoryIdRef = useRef<number | null>(null);
  const isOurNavigationRef = useRef(false);
  
  // Snapshots at mount for filtering logic:
  // - recentlyViewedOnMount: stories viewed in last 24h (from localStorage)
  // - sessionViewedOnMount: stories viewed THIS session (from sessionStorage)
  // Stories in sessionStorage are NOT filtered (can always go back to them)
  // Stories in localStorage but NOT sessionStorage are filtered
  const [recentlyViewedOnMount] = useState(() => getRecentlyViewedIds(24));
  const [sessionViewedOnMount] = useState(() => getSessionViewedIds());
  
  // Merge injected story (if any) with feed stories, avoiding duplicates
  // Also filter out stories viewed in the last 24 hours (unless viewed this session)
  // IMPORTANT: If anchorStoryId is set, that story is moved to index 0
  const mergedStories = useMemo(() => {
    // Find anchor story in feed (the story that should be first)
    const anchorStory = anchorStoryId
      ? stories.find(s => s.id === anchorStoryId)
      : null;
    
    // Priority for first position:
    // 1. anchorStory (in-feed story user navigated to)
    // 2. injectedStory (out-of-feed story, only if it matches anchorStoryId or no anchor)
    // This ensures navigation to in-feed stories works even if injectedStory exists
    const shouldUseInjectedStory = injectedStory && 
      (!anchorStoryId || injectedStory.id === anchorStoryId);
    const firstStory = anchorStory ?? (shouldUseInjectedStory ? injectedStory : null);
    
    let result = firstStory 
      ? [firstStory, ...stories.filter(s => s.id !== firstStory.id)]
      : stories;
    
    // Also include injectedStory in the list (for swiping back to it)
    // but only if it's not already the firstStory
    if (injectedStory && firstStory !== injectedStory) {
      result = [result[0], injectedStory, ...result.slice(1).filter(s => s.id !== injectedStory.id)];
    }
    
    // Filter out recently-viewed, but always keep:
    // - firstStory (linked story at anchor position)
    // - injectedStory (so user can swipe back to it)
    // - initialItemId (current URL - browser back/forward)
    // - stories viewed THIS session (in sessionStorage)
    const filtered = result.filter(story => 
      story === firstStory ||
      story === injectedStory ||
      story.id === initialItemIdNum ||
      sessionViewedOnMount.has(story.id) ||
      !recentlyViewedOnMount.has(story.id)
    );
    
    // Fallback: if all filtered out, show everything
    return filtered.length > 0 ? filtered : result;
  }, [injectedStory, stories, anchorStoryId, initialItemIdNum, sessionViewedOnMount, recentlyViewedOnMount]);
  
  // Defer listener attachment until the main container (with ref) actually renders.
  // On cold start (no localStorage cache), stories start empty → loading skeleton renders
  // without the ref → the hook's listener effect would silently miss attachment.
  const anchorResolved = !anchorStoryId ||
    mergedStories.some(s => s.id === anchorStoryId);

  const {
    containerRef,
    currentIndex,
    currentIndexRef,
    scrollToIndex,
    isScrollingProgrammaticallyRef,
  } = useSwipeScroll({
    itemCount: mergedStories.length,
    enabled: mergedStories.length > 0 && anchorResolved,
  });

  // Get current story for document title (updates as user swipes)
  const currentStory = mergedStories[currentIndex];
  const isNonStoryError = injectedError === 'job' || injectedError === 'comment';
  const isInjectedNotFound = injectedError && (isNonStoryError || isInjectedItemNotFound);
  const isAtEndError = error && !loading && mergedStories.length > 0 && currentIndex === mergedStories.length - 1;

  const { isOnline } = useNetworkStatus();
  const { isRetrying, giveUp, resetRetry } = useAutoRetry({
    error,
    retryFn: loadMore,
    isOnline,
    enabled: !injectedError,
  });

  const documentTitle = injectedError
    ? (isInjectedNotFound ? (isNonStoryError ? 'Item not available' : 'Item not found') : 'Failed to load item')
    : (error && mergedStories.length === 0) ? 'Failed to load item'
    : isOnline && isAtEndError && giveUp ? 'Failed to load item'
    : (currentStory?.title || titleFallback);
  useDocumentTitle(documentTitle);
  
  // Trigger initial load when stories are empty or low
  useEffect(() => {
    if (!didInitialLoadRef.current && stories.length < 10 && hasMore && !loading) {
      didInitialLoadRef.current = true;
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [stories.length, hasMore, loading, loadMore]);
  
  // Fetch story if initialItemId is not in the feed list
  useEffect(() => {
    if (!initialItemId) return;
    
    // Don't wait for stories to load - fetch immediately if this is a direct navigation
    const storyInList = stories.some(s => s.id === initialItemIdNum);
    if (storyInList) {
      // Story found in feed, clear injected story and stale error state
      if (injectedStory && injectedStory.id === initialItemIdNum) {
        setInjectedStory(null);
      }
      // Clear stale state from a previous failed navigation (e.g. back from /item/99999999).
      // Reset fetchedStoryIdRef so navigating forward to the failed story re-fetches it.
      if (injectedError) setInjectedError(null);
      fetchedStoryIdRef.current = null;
      return;
    }
    
    if (fetchedStoryIdRef.current === initialItemIdNum) return;
    if (injectedStory && injectedStory.id === initialItemIdNum) return;
    
    fetchedStoryIdRef.current = initialItemIdNum ?? null;
    setInjectedLoading(true);
    setInjectedError(null);
    setIsInjectedItemNotFound(false);
    
    const controller = new AbortController();
    let fetchCompleted = false;
    
    void fetchItemOnly(initialItemId, controller.signal)
      .then(fetchedItem => {
        fetchCompleted = true;
        if (controller.signal.aborted) return;
        // Race condition guard: user may have swiped to another story while fetching.
        // Only update state if this fetch result matches the story we're still waiting for.
        if (fetchedItem.id === fetchedStoryIdRef.current) {
          // Only inject stories (not comments or jobs)
          if (fetchedItem.type === 'comment' || fetchedItem.type === 'job') {
            setInjectedLoading(false);
            setInjectedError(fetchedItem.type === 'job' ? 'job' : 'comment');
            return;
          }
          setInjectedStory(fetchedItem);
          setInjectedLoading(false);
          setInjectedError(null);
        }
      })
      .catch((err: unknown) => {
        fetchCompleted = true;
        if (controller.signal.aborted) return;
        console.error('Failed to fetch item:', err);
        // Only update state if this is still the story we want
        if (initialItemIdNum === fetchedStoryIdRef.current) {
          setInjectedLoading(false);
          setInjectedError(err instanceof Error ? err.message : 'Story not found');
          setIsInjectedItemNotFound(err instanceof NotFoundError);
        }
      });
    
    return () => {
      controller.abort();
      // Only reset the ref when the fetch was aborted mid-flight (e.g. `stories`
      // loaded and the effect re-ran). If the fetch already completed (success or
      // error), the ref must stay so the next effect run skips the re-fetch — otherwise
      // injectedError would be cleared and re-set in an infinite loop.
      if (!fetchCompleted && fetchedStoryIdRef.current === initialItemIdNum) {
        fetchedStoryIdRef.current = null;
      }
    };
  }, [initialItemId, initialItemIdNum, stories, injectedStory, injectedError]);
  
  // Scroll to index 0 when injected story arrives and is anchored
  // This handles: user navigates to out-of-feed story, we fetch it, then scroll to it
  // Track which story we've scrolled to (not just if we scrolled) - handles multiple navigations
  const scrolledToInjectedStoryIdRef = useRef<number | null>(null);
  
  useLayoutEffect(() => {
    if (!injectedStory || !anchorStoryId) return;
    if (injectedStory.id !== anchorStoryId) return;
    
    if (scrolledToInjectedStoryIdRef.current === injectedStory.id) return;
    scrolledToInjectedStoryIdRef.current = injectedStory.id;
    
    scrollToIndex(0);
  }, [injectedStory, anchorStoryId, scrollToIndex]);
  
  // Restore scroll position when returning from external URL
  // Uses both pageshow (for bfcache) and visibilitychange (for tab switches)
  // pageshow fires BEFORE first paint on bfcache restore - critical for preventing flash
  const savedIndexOnHideRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Save position when page is about to be hidden/cached
    const handlePageHide = () => {
      savedIndexOnHideRef.current = currentIndexRef.current;
    };
    
    // Restore position when page is shown from bfcache (persisted=true)
    // This fires BEFORE first paint, preventing flash of wrong item
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        scrollToIndex(targetIndex);
      }
    };
    
    // Fallback: visibilitychange for non-bfcache cases (tab switches, etc)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        savedIndexOnHideRef.current = currentIndexRef.current;
      } else if (document.visibilityState === 'visible' && savedIndexOnHideRef.current !== null) {
        const targetIndex = savedIndexOnHideRef.current;
        savedIndexOnHideRef.current = null;
        scrollToIndex(targetIndex);
      }
    };
    
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentIndexRef, scrollToIndex]);
  
  // Handle initial scroll position when returning from external URL (no anchor)
  // This runs once when items load and we have an initialItemId but didn't anchor
  const hasInitializedScrollRef = useRef(false);
  const pendingScrollToStoryIdRef = useRef<number | null>(null);
  
  // Handle navigation changes (browser back/forward, direct URL entry)
  // IMPORTANT: This must be declared BEFORE the scroll-init effect below.
  // useLayoutEffects run in declaration order. On browser back/forward, this handler
  // scrolls directly when the target story is in the list. Only defers to scroll-init
  // when stories haven't loaded yet.
  useLayoutEffect(() => {
    if (lastInitialStoryIdRef.current !== initialItemId) {
      // We caused this URL change (via the URL-update effect) — already at
      // the correct position; just sync the tracking ref.
      if (isOurNavigationRef.current) {
        isOurNavigationRef.current = false;
        lastInitialStoryIdRef.current = initialItemId;
        return;
      }
      
      lastInitialStoryIdRef.current = initialItemId;
      
      if (initialItemId) {
        // History navigation carries our previously-written state (`from` for feeds,
        // `fromDomain` for domain swipe, `fromUser` for user submissions) — any
        // of those signals "don't reorder, return to the same position".
        const isHistoryNavigation = !!(locationState?.from ?? locationState?.fromDomain ?? locationState?.fromUser);
        
        if (isHistoryNavigation) {
          // History navigation (browser back/forward, return from external)
          // Clear stale anchor so scroll-init isn't blocked if we defer
          if (anchorStoryId) setAnchorStoryId(null);
          // Clear stale error (e.g. back from "story not found" page) so the
          // scroll container renders on the next paint instead of the error div.
          if (injectedError) setInjectedError(null);
          
          const idx = mergedStories.findIndex(s => s.id === initialItemIdNum);
          if (idx >= 0 && containerRef.current) {
            hasInitializedScrollRef.current = true;
            scrollToIndex(idx);
          } else {
            // Story not in list yet OR container not available (e.g. error state clearing)
            // — defer to scroll-init effect
            pendingScrollToStoryIdRef.current = initialItemIdNum ?? null;
            hasInitializedScrollRef.current = false;
          }
        } else {
          // Fresh direct link (share/bookmark) - anchor so story is at index 0
          setAnchorStoryId(initialItemIdNum ?? null);
          scrollToIndex(0);
        }
      }
    }
  }, [initialItemId, initialItemIdNum, locationState, anchorStoryId, mergedStories, injectedError, containerRef, scrollToIndex]);
  
  // Scroll-init: restore scroll position to the target story.
  // Runs after the navigation handler above has set pendingScrollToStoryIdRef.
  useLayoutEffect(() => {
    // Skip if already initialized for this story, or if we're anchoring (story at index 0)
    if (hasInitializedScrollRef.current || anchorStoryId) return;
    
    const targetStoryId = pendingScrollToStoryIdRef.current ?? initialItemIdNum;
    if (!targetStoryId) return;
    
    if (mergedStories.length === 0) return;
    
    const idx = mergedStories.findIndex(s => s.id === targetStoryId);
    if (idx >= 0) {
      pendingScrollToStoryIdRef.current = null;
      hasInitializedScrollRef.current = true;
      if (idx !== currentIndexRef.current) {
        scrollToIndex(idx);
      }
    }
  }, [mergedStories, initialItemId, initialItemIdNum, anchorStoryId, scrollToIndex, currentIndexRef]);
  
  usePrefetchItems(currentIndex, mergedStories, 6);
  
  // Mark stories WITHOUT external URL as viewed on swipe (Ask HN, text posts)
  // Stories WITH URLs are marked when user clicks the external link (in FullScreenItem)
  useEffect(() => {
    const currentStory = mergedStories[currentIndex];
    if (currentStory && !currentStory.url) {
      markViewedWithTime(currentStory.id);
    }
  }, [currentIndex, mergedStories]);
  
  // Load more stories when approaching the end (don't auto-retry on error — user taps Retry)
  useEffect(() => {
    const storiesAhead = mergedStories.length - 1 - currentIndex;
    const needsMore = storiesAhead < 5 || mergedStories.length < 10;
    
    if (needsMore && hasMore && !loading && !error) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [currentIndex, mergedStories.length, hasMore, loading, loadMore, error]);
  
  useEffect(() => {
    // Suppress URL updates during the "story not found" error state.
    if (injectedError) return;
    
    // Don't update URL while a programmatic scroll is in progress (e.g. scroll-init on
    // refresh). currentIndex may not yet reflect the target position — writing the URL
    // now would cause a brief flicker to the wrong story ID.
    if (isScrollingProgrammaticallyRef.current) return;
    
    // If we have an initialItemId from the URL, don't overwrite it until:
    // 1. The story is found in the feed (user can swipe from it)
    // 2. OR the story is resolved via fetch (injectedStory)
    // This prevents the URL from reverting when navigating to a story not yet loaded
    if (initialItemId) {
      const storyInFeed = mergedStories.some(s => s.id === initialItemIdNum);
      const storyInjected = injectedStory && injectedStory.id === initialItemIdNum;
      // If the target story isn't resolved yet, don't update URL
      if (!storyInFeed && !storyInjected) return;
    }
    
    if (mergedStories.length > 0 && mergedStories[currentIndex]) {
      const storyId = mergedStories[currentIndex].id;
      const newPath = `/item/${storyId}`;
      
      if (location.pathname !== newPath) {
        // Mark that WE are causing this navigation, so sync effect won't re-initialize
        isOurNavigationRef.current = true;
        // Always replace: swipe-driven URL changes keep the URL in sync for
        // sharing/bookmarking, but don't create history entries. Without this,
        // Chrome's History Manipulation Intervention marks non-interaction pushState
        // calls as skippable (scrollend → useEffect → navigate is too indirect),
        // which breaks the back button entirely. Back navigates to the previous
        // section instead.
        void navigate(newPath, { 
          replace: true, 
          state: backState,
        });
      }
    }
  }, [currentIndex, mergedStories, navigate, location.pathname, backState, injectedError, initialItemId, initialItemIdNum, injectedStory, isScrollingProgrammaticallyRef]);
  
  if (injectedError) {
    return (
      <div className="swipe-snap-container flex items-center justify-center" data-testid="swipe-container">
        <StateView
          variant={isInjectedNotFound ? 'not-found' : 'error'}
          title={isNonStoryError ? 'This item is not a story' : isInjectedNotFound ? undefined : 'Failed to load item'}
          description={isInjectedNotFound ? undefined : injectedError}
          action={isInjectedNotFound ? { label: 'Back to Home', to: '/' } : { label: 'Try Again', onClick: () => void navigate(0) }}
        />
      </div>
    );
  }
  
  // Direct navigation to a specific story - wait until we resolve it
  // This prevents falling through to showing first story in list while fetch is pending
  // Only block if we're still trying to show the anchored story (initialItemId matches).
  // If the user navigated away (e.g. browser back), the anchor is stale — don't block.
  if (anchorStoryId && initialItemIdNum === anchorStoryId) {
    const anchorInFeed = mergedStories.some(s => s.id === anchorStoryId);
    const anchorIsInjected = injectedStory?.id === anchorStoryId;
    
    // If anchor story isn't resolved yet (not in feed, not injected), show loading skeleton
    // This ensures we wait for fetchItemOnly to complete before deciding what to show
    if (!anchorInFeed && !anchorIsInjected) {
      return (
        <div className="swipe-snap-container" data-testid="swipe-container">
          <div className="swipe-snap-panel" data-testid="swipe-panel">
            <FullScreenItemSkeletonPanel />
          </div>
        </div>
      );
    }
  }
  
  // Initial loading state (also show when fetching injected story)
  if (mergedStories.length === 0 && (loading || injectedLoading)) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <div className="swipe-snap-panel" data-testid="swipe-panel">
          <FullScreenItemSkeletonPanel />
        </div>
      </div>
    );
  }
  
  if (error && mergedStories.length === 0 && !isRetrying) {
    return (
      <div className="swipe-snap-container flex items-center justify-center" data-testid="swipe-container">
        <StateView variant="error" title="Failed to load item" action={{ label: 'Try Again', onClick: () => { resetRetry(); void loadMore().catch(() => { /* error state set internally */ }); } }} />
      </div>
    );
  }
  
  if (error && mergedStories.length === 0 && isRetrying) {
    return (
      <div className="swipe-snap-container" data-testid="swipe-container">
        <div className="swipe-snap-panel" data-testid="swipe-panel">
          <FullScreenItemSkeletonPanel />
        </div>
      </div>
    );
  }

  // No-results state: fetch completed, nothing came back, and we're not waiting on
  // a direct-link injection. Gated on `emptyTitle` so feeds (which never pass one)
  // keep falling through to the existing rendering. Domain wrappers pass an explicit
  // title so users see a meaningful message instead of an empty snap container.
  if (
    emptyTitle &&
    mergedStories.length === 0 &&
    !loading &&
    !injectedLoading &&
    !error &&
    !injectedError &&
    !initialItemId
  ) {
    return (
      <div className="swipe-snap-container flex items-center justify-center" data-testid="swipe-container">
        <StateView variant="empty" title={emptyTitle} />
      </div>
    );
  }
  
  // Virtualization: only render panels within this window around currentIndex
  // Buffer of 2 ensures smooth swiping (pre-rendered neighbors) while keeping DOM light
  // Total rendered: up to 5 panels (current + 2 before + 2 after)
  const VIRTUALIZE_BUFFER = 2;
  
  return (
    <div 
      ref={containerRef}
      className="swipe-snap-container"
      data-testid="swipe-container"
    >
      {mergedStories.map((story, index) => {
        const distance = Math.abs(index - currentIndex);
        const isWithinWindow = distance <= VIRTUALIZE_BUFFER;
        // Current + adjacent panels are priority (fetch in parallel for smooth swiping)
        const isPriority = distance <= 1;
        // Far panels (distance > 1) defer comment fetch entirely to reduce concurrent requests
        // Note: linked story is always at index 0 (reordered), so it's never deferred
        const deferComments = distance > 1;
        
        return (
          <div 
            key={story.id} 
            className="swipe-snap-panel"
            data-testid="swipe-panel"
            data-item-id={story.id}
          >
            {isWithinWindow ? (
              <FullScreenItem
                itemId={story.id}
                initialItem={story}
                isPriority={isPriority}
                deferComments={deferComments}
              />
            ) : (
              // Skeleton placeholder for non-visible panels (consistent UX during quick swipes)
              <FullScreenItemSkeletonPanel />
            )}
          </div>
        );
      })}
      
      {/* Loading indicator — only when online */}
      {isOnline && ((loading && mergedStories.length > 0) || (isRetrying && mergedStories.length > 0 && !loading)) && (
        <div className="swipe-snap-panel" data-testid="swipe-panel-loading">
          <FullScreenItemSkeletonPanel />
        </div>
      )}

      {/* Error panel at the end — only when online and retries exhausted */}
      {isOnline && error && !loading && !isRetrying && mergedStories.length > 0 && (
        <div className="swipe-snap-panel flex items-center justify-center" data-testid="swipe-panel">
          <StateView
            variant="error"
            title="Failed to load item"
            description={error}
            action={{ label: 'Try Again', onClick: () => { resetRetry(); void loadMore().catch(() => { /* error state set internally */ }); } }}
          />
        </div>
      )}
    </div>
  );
}

interface SwipeStoryViewerProps {
  type: FeedType;
  initialItemId?: string;
}

/** Feed-backed swipe viewer wrapping SwipeStoryViewerCore. */
export function SwipeStoryViewer({ type, initialItemId }: SwipeStoryViewerProps) {
  const { stories, loading, error, hasMore, loadMore, isFromCache, isFromSession } = useInfiniteStories(type);

  // Prefetch other sections in background for instant tab switching
  usePrefetchSections(type);

  // Trigger revalidation eagerly — same as StoryList — so the replace
  // happens at index 0, not mid-session after the user has swiped deep.
  useEffect(() => {
    if (isFromSession) return;
    if (isFromCache && !loading && !error) {
      void loadMore().catch(() => { /* error state set internally */ });
    }
  }, [isFromCache, loading, loadMore, isFromSession, error]);

  const backState = useMemo(() => ({ from: type }), [type]);

  return (
    <SwipeStoryViewerCore
      stories={stories}
      loading={loading}
      error={error}
      hasMore={hasMore}
      loadMore={loadMore}
      initialItemId={initialItemId}
      backState={backState}
      titleFallback={FEED_TYPE_TITLES[type]}
    />
  );
}
